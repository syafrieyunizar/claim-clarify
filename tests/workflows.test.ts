import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "../src/lib/ai/anthropic";
import { extractProviderText } from "../src/lib/ai/extractText";
import { aiHttpError, prepareAiEndpoint } from "../src/lib/ai/http";
import { getProvider } from "../src/lib/ai/provider";
import { getAdminProviderLabel, listClaimLibrary, manageClaimLibraryItem, normalizeAdminProviderKey, reviewClaimLibraryItem } from "../src/lib/ai/admin";
import { appendAuditEntry, listAuditEntries, removeAuditEntry, replaceAuditEntries } from "../src/lib/audit/log";
import { buildKnowledgeChunkUserMessage, parseKnowledgeChunks, retrieveKnowledgeChunks } from "../src/lib/knowledge/chunks";
import { parseSepInput } from "../src/lib/eklaim/regrouping";
import { captureActiveTabPdf, readLocalFileUrl } from "../src/lib/pdf/parse";
import { analyzeReadmisiTexts } from "../src/workflows/readmisi";
import { buildClaimChallengeUserMessage, buildRevisionUserMessage, buildStandardUserMessage, CLAIM_CHALLENGE_SYSTEM_PROMPT, GENERATED_ANSWER_SCHEMA, parseClaimChallengeAssessment, parseGeneratedAnswer, REVISION_SYSTEM_PROMPT, STANDARD_SYSTEM_PROMPT } from "../src/workflows/standard";
import { buildStrictTemplateSystemPrompt, extractTemplatePlaceholders, hasStrictTemplatePlaceholders, matchTemplate, parseStrictTemplateAnswer, renderStrictTemplate, resolveTemplateSelection } from "../src/workflows/template";

describe("workflow guards", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the model for a concise BPJS-ready answer", () => {
    expect(STANDARD_SYSTEM_PROMPT).toContain("5-7 kalimat, maksimal 130 kata");
    expect(STANDARD_SYSTEM_PROMPT).toContain("rawat jalan atau di FKTP");
    expect(STANDARD_SYSTEM_PROMPT).toContain("[POLA JAWABAN DEFAULT]");
    expect(STANDARD_SYSTEM_PROMPT).toContain("ketentuan atau kriteria → bukti klinis pasien → terapi yang dibutuhkan");
    expect(STANDARD_SYSTEM_PROMPT).toContain('Gunakan "mendukung diagnosis"');
    expect(STANDARD_SYSTEM_PROMPT).toContain("[CONTOH POLA — JANGAN SALIN FAKTANYA]");
    expect(GENERATED_ANSWER_SCHEMA.properties.jawabanPending.description).toContain("maksimal 130 kata");
  });

  it("normalizes bulleted Jawaban Pending into one paragraph", () => {
    const parsed = parseGeneratedAnswer(JSON.stringify({ ringkasan: "ok", jawabanPending: "- poin pertama\n- poin kedua", sources: [] }));
    expect(parsed.jawabanPending).toBe("poin pertama. poin kedua.");
  });

  it("keeps an inline dash as normal punctuation", () => {
    const parsed = parseGeneratedAnswer(JSON.stringify({ ringkasan: "ok", jawabanPending: "Terapi diberikan - kondisi pasien membaik.", sources: [] }));
    expect(parsed.jawabanPending).toBe("Terapi diberikan - kondisi pasien membaik.");
  });

  it("normalizes numbered lines without losing their text", () => {
    const parsed = parseGeneratedAnswer(JSON.stringify({ ringkasan: "ok", jawabanPending: "1. Rawat inap terindikasi\n2) Klaim dapat diproses", sources: [] }));
    expect(parsed.jawabanPending).toBe("Rawat inap terindikasi. Klaim dapat diproses.");
  });

  it("accepts JSON wrapped in model text", () => {
    expect(
      parseGeneratedAnswer('Berikut JSON:\n{"ringkasan":"ok","jawabanPending":"Jawaban ringkas.","sources":[]}').jawabanPending,
    ).toBe("Jawaban ringkas.");
  });

  it("accepts JSON followed by model text", () => {
    const parsed = parseGeneratedAnswer('{"ringkasan":"ok","jawabanPending":"Jawaban ringkas.","sources":[]}\n\nBerikut penjelasan tambahan.');
    expect(parsed.jawabanPending).toBe("Jawaban ringkas.");
  });

  it("accepts loose Ringkasan/Jawaban text", () => {
    const parsed = parseGeneratedAnswer("Ringkasan Kasus: pasien dirawat.\nJawaban Pending: Klaim layak disetujui karena bukti klinis cukup.");
    expect(parsed.ringkasan).toBe("pasien dirawat.");
    expect(parsed.jawabanPending).toBe("Klaim layak disetujui karena bukti klinis cukup.");
  });

  it("accepts partial JSON by falling back", () => {
    const parsed = parseGeneratedAnswer('{"jawabanPending":"Klaim layak disetujui.\nMohon diproses."}');
    expect(parsed.ringkasan).toMatch(/Ringkasan/);
    expect(parsed.jawabanPending).toBe("Klaim layak disetujui. Mohon diproses.");
  });

  it("matches template keywords case-insensitively", () => {
    expect(matchTemplate(" readmisi ", [{ keyword: "Readmisi", note: "", instruction: "" }])?.keyword).toBe("Readmisi");
  });

  it("resolves template switch rules", () => {
    const templates = [{ keyword: "readmisi", note: "", instruction: "" }];
    expect(resolveTemplateSelection({ enabled: true, keyword: "", workflow: "standard", templates }).error).toBe("keyword template tidak boleh kosong");
    expect(resolveTemplateSelection({ enabled: true, keyword: "x", workflow: "standard", templates }).error).toBe("keyword template yang kamu tulis belum diatur");
    expect(resolveTemplateSelection({ enabled: true, keyword: "", workflow: "readmisi", templates }).template?.keyword).toBe("readmisi");
  });

  it("distinguishes diagnosis parentheses from strict instruction placeholders", () => {
    const template = "Penegakan diagnosa Typhoid fever (A01.0, A01.1, A01.2, A01.3, A01.4) sesuai regulasi. Pasien..... (Jelaskan kegawatdaruratan pasien sampai harus dirawat inap)";
    expect(extractTemplatePlaceholders(template)).toEqual(["Jelaskan kegawatdaruratan pasien sampai harus dirawat inap"]);
    expect(hasStrictTemplatePlaceholders(template)).toBe(true);
  });

  it("keeps strict template text exact and replaces only its instruction slot", () => {
    const fixed = "Penegakan diagnosa Typhoid fever (A01.0, A01.1) sesuai Kepmenkes.  Pasien";
    const template = `${fixed}..... (Jelaskan kegawatdaruratan pasien)`;
    expect(renderStrictTemplate(template, ["datang dengan demam 40,1 C dan takikardia."])).toBe(`${fixed} datang dengan demam 40,1 C dan takikardia.`);
  });

  it("reconstructs a strict template instead of accepting model paraphrases", () => {
    const template = "Kalimat regulasi wajib. Pasien..... (Jelaskan kondisi dan terapi pasien)";
    const parsed = parseStrictTemplateAnswer(JSON.stringify({
      ringkasan: "Demam tinggi memerlukan rawat inap.",
      fills: ["datang dengan demam tinggi dan memerlukan antibiotik intravena."],
      sources: ["Kepmenkes"],
      jawabanPending: "Kalimat regulasi yang sudah diubah AI.",
    }), template);
    expect(parsed.jawabanPending).toBe("Kalimat regulasi wajib. Pasien datang dengan demam tinggi dan memerlukan antibiotik intravena.");
    expect(buildStrictTemplateSystemPrompt(template)).toContain("Jumlah fills wajib tepat 1");
  });

  it("flags likely readmisi from repeated patient markers", () => {
    const result = analyzeReadmisiTexts([
      "No RM: 123 Nama Pasien: Budi Diagnosis: CHF",
      "No RM: 123 Nama Pasien: Budi Diagnosis: CHF masuk kembali",
    ]);
    expect(result.likely).toBe(true);
  });

  it("parses unique SEP values from common separators", () => {
    expect(parseSepInput("1709R0090626V007001\n1709r0090626v007002, 1709R0090626V007001;bad")).toEqual({
      seps: ["1709R0090626V007001", "1709R0090626V007002"],
      invalid: ["BAD"],
    });
  });

  it("reads text from common provider response shapes", () => {
    expect(extractProviderText({ content: [{ type: "text", text: "anthropic" }] })).toBe("anthropic");
    expect(extractProviderText({ choices: [{ message: { content: [{ type: "text", text: "openai" }] } }] })).toBe("openai");
    expect(extractProviderText({ output: [{ content: [{ text: "responses" }] }] })).toBe("responses");
    expect(extractProviderText({ candidates: [{ content: { parts: [{ text: "gemini" }] } }] })).toBe("gemini");
  });
  it("retrieves relevant active knowledge chunks by keyword", () => {
    const chunks = [
      { id: "1", title: "Anemia", source: "PPK", keywords: ["anemia", "hb"], content: "Kriteria transfusi anemia.", active: true },
      { id: "2", title: "Tifoid", source: "PPK", keywords: ["tifoid"], content: "Kriteria tifoid.", active: true },
      { id: "3", title: "Nonaktif", source: "PPK", keywords: ["anemia"], content: "Jangan dipakai.", active: false },
    ];
    expect(retrieveKnowledgeChunks(chunks, "pending anemia hb rendah").map((chunk) => chunk.id)).toEqual(["1"]);
  });

  it("requires a whole keyword or phrase and ignores generic keywords", () => {
    const chunks = [
      { id: "aki", title: "AKI", source: "Manual", keywords: ["aki", "pasien"], content: "Kriteria AKI.", active: true },
      { id: "rawat", title: "Rawat inap", source: "Manual", keywords: ["rawat inap", "pasien"], content: "Kriteria rawat inap.", active: true },
    ];
    expect(retrieveKnowledgeChunks(chunks, "Pasien laki-laki memerlukan rawat inap.").map((chunk) => chunk.id)).toEqual(["rawat"]);
  });

  it("does not fall back to title or content when no keyword matches", () => {
    const chunks = [{ id: "aki", title: "Gagal ginjal", source: "Manual", keywords: ["aki"], content: "Gagal ginjal akut.", active: true }];
    expect(retrieveKnowledgeChunks(chunks, "Pasien laki-laki dengan gagal ginjal akut.")).toEqual([]);
  });

  it("deduplicates identical knowledge before applying the limit", () => {
    const duplicate = { title: "Rawat inap", source: "Manual", keywords: ["rawat inap"], content: "Kriteria rawat inap.", active: true };
    expect(retrieveKnowledgeChunks([{ id: "local", ...duplicate }, { id: "shared", ...duplicate }], "rawat inap").map((chunk) => chunk.id)).toEqual(["local"]);
  });

  it("matches a keyword placed after a long medical record", () => {
    const chunks = [{ id: "target", title: "Readmisi", source: "Manual", keywords: ["readmisi"], content: "Kriteria readmisi.", active: true }];
    const query = `${Array.from({ length: 100 }, (_, index) => `istilah${index}`).join(" ")} readmisi`;
    expect(retrieveKnowledgeChunks(chunks, query).map((chunk) => chunk.id)).toEqual(["target"]);
  });

  it("accepts knowledge JSON followed by model text", () => {
    const chunks = parseKnowledgeChunks('{"chunks":[{"title":"Anemia","source":"PPK","keywords":["anemia"],"content":"Kriteria anemia."}]}\nCatatan tambahan.', "fallback");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toBe("Anemia");
  });

  it("removes common identity markers from generated answer", () => {
    const parsed = parseGeneratedAnswer(JSON.stringify({ ringkasan: "atas nama Budi SEP 123", jawabanPending: "Klaim atas nama Budi (SEP 1709R0090526V002855) layak dibayar.", sources: [] }));
    expect(parsed.jawabanPending).toBe("Klaim pasien layak dibayar.");
  });


  it("removes opening objection and missing-regulation filler", () => {
    const parsed = parseGeneratedAnswer(JSON.stringify({ ringkasan: "ok", jawabanPending: "Kami berkeberatan atas pending klaim. Pasien dirawat inap karena kolik abdomen dan cystitis. Dasar regulasi tidak tersedia di konteks, namun telaah klinis mendukung rawat inap.", sources: [] }));
    expect(parsed.jawabanPending).toBe("Pasien dirawat inap karena kolik abdomen dan cystitis.");
  });


  it("does not trim template-directed wording in preserve mode", () => {
    const parsed = parseGeneratedAnswer(JSON.stringify({ ringkasan: "ok", jawabanPending: "Kami berkeberatan atas pending klaim. Pasien tetap memerlukan rawat inap.", sources: [] }), { preserveTemplate: true });
    expect(parsed.jawabanPending).toBe("Kami berkeberatan atas pending klaim. Pasien tetap memerlukan rawat inap.");
  });


  it("builds critique prompts without losing user direction or reason", () => {
    const previous = { ringkasan: "ok", jawabanPending: "Kami berkeberatan atas pending klaim.", sources: [] };
    expect(REVISION_SYSTEM_PROMPT).toContain("Mode kritik dan revisi");
    const prompt = buildRevisionUserMessage("rekam medis", "pending", "pasien belum stabil", previous, "tekankan rawat inap");
    expect(prompt).toContain("tekankan rawat inap");
    expect(prompt).toContain("pasien belum stabil");
  });

  it("builds and parses a two-sided challenge assessment", () => {
    const previous = { ringkasan: "ok", jawabanPending: "Pasien memerlukan rawat inap.", sources: [] };
    expect(CLAIM_CHALLENGE_SYSTEM_PROMPT).toContain("Skor 1 berarti");
    expect(buildClaimChallengeUserMessage("rekam medis", "pending", "", previous)).toContain(previous.jawabanPending);
    const assessment = parseClaimChallengeAssessment(JSON.stringify({
      challengeScore: 8.4,
      verdict: "Layak disanggah dengan bukti klinis yang tersedia.",
      bpjsPerspective: ["Durasi rawat perlu dibuktikan."],
      casemixPerspective: ["Indikasi rawat inap tercatat."],
      missingEvidence: ["Clinical pathway belum tersedia."],
      recommendation: "Tekankan indikasi rawat inap dan lampirkan clinical pathway.",
    }));
    expect(assessment.challengeScore).toBe(8);
    expect(assessment.bpjsPerspective).toEqual(["Durasi rawat perlu dibuktikan."]);
    expect(assessment.casemixPerspective).toEqual(["Indikasi rawat inap tercatat."]);
  });

  it("rejects a one-sided challenge assessment", () => {
    expect(() => parseClaimChallengeAssessment(JSON.stringify({
      challengeScore: 7,
      verdict: "Layak disanggah.",
      bpjsPerspective: [],
      casemixPerspective: ["Bukti klinis tersedia."],
      missingEvidence: [],
      recommendation: "Ajukan sanggahan.",
    }))).toThrow("Analisis dua sisi");
  });


  it("redacts sensitive case data before building AI prompts", () => {
    const prompt = buildStandardUserMessage(
      "Nama Pasien: Budi Santoso\nNIK: 3171010101010001\nNo RM: 123456\nSEP: 1709R0090526V002855\nRSUD Melati Indah",
      "pending atas nama Budi Santoso",
      "alamat: Jalan Mawar 10",
    );
    expect(prompt).not.toMatch(/Budi|3171010101010001|123456|1709R0090526V002855|Melati Indah|Jalan Mawar/i);
    expect(prompt).toContain("[disensor]");
  });

  it("redacts sensitive knowledge text before chunking with AI", () => {
    const prompt = buildKnowledgeChunkUserMessage("RSUD Melati.pdf", "Pasien: Budi NIK: 3171010101010001");
    expect(prompt).not.toMatch(/Melati|Budi|3171010101010001/i);
  });
  it("normalizes admin provider labels", () => {
    expect(normalizeAdminProviderKey("Provider Saya!" )).toBe("provider-saya");
    expect(getAdminProviderLabel("gemini")).toBe("Gemini");
  });

  it("routes admin api source through admin provider", () => {
    const provider = getProvider({ source: "admin", provider: "anthropic", endpoint: "", model: "", apiKey: "", adminSession: null });
    expect(provider.testConnection).toBeTypeOf("function");
  });

  it("scopes the shared library request to Claim Clarify and the logged-in user", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ knowledge: [], templates: [], submissions: { knowledge: [], templates: [] } }) });
    vi.stubGlobal("fetch", fetch);
    const session = { username: "dokter", sessionToken: "token", deviceId: "device" };
    await listClaimLibrary(session);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ action: "claim_library_list", app_id: "claim-clarify", user_session: session });
  });

  it("sends Claim Clarify moderation through a separate owner-only action", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: { id: "item-1", status: "approved" } }) });
    vi.stubGlobal("fetch", fetch);
    await reviewClaimLibraryItem({ username: "owner", password: "secret" }, { resourceType: "knowledge", id: "item-1", decision: "approved" });
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ action: "claim_library_admin_review", app_id: "claim-clarify", username: "owner", resource_type: "knowledge", id: "item-1", decision: "approved" });
  });

  it("scopes Claim Clarify admin CRUD through its owner-only action", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: { id: "item-1", status: "approved" } }) });
    vi.stubGlobal("fetch", fetch);
    await manageClaimLibraryItem(
      { username: "owner", password: "secret" },
      { resourceType: "template", operation: "save", item: { keyword: "Readmisi", instruction: "Bandingkan episode." } },
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ action: "claim_library_admin_manage", app_id: "claim-clarify", username: "owner", resource_type: "template", operation: "save" });
  });

  it("requests optional host access for a personal AI endpoint", async () => {
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("chrome", { permissions: { contains: vi.fn().mockResolvedValue(false), request } });
    await expect(prepareAiEndpoint("https://api.example.com/v1/chat/completions")).resolves.toBe("https://api.example.com/v1/chat/completions");
    expect(request).toHaveBeenCalledWith({ origins: ["https://api.example.com/*"] });
  });

  it("sends the required direct-browser header to Anthropic", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "OK" }] }) });
    vi.stubGlobal("fetch", fetch);
    await anthropicProvider.send({ systemPrompt: "S", userMessage: "U", context: [] }, { source: "personal", provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-5", apiKey: "secret" });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ "anthropic-dangerous-direct-browser-access": "true", "x-api-key": "secret" });
  });

  it("explains common personal API failures", () => {
    expect(aiHttpError("Endpoint AI", 401)).toContain("API key ditolak");
    expect(aiHttpError("Endpoint AI", 404)).toContain("model tidak ditemukan");
  });

  it("reads local PDF bytes through the extension service worker", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, base64: "AQIDBA==" });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const bytes = new Uint8Array(await readLocalFileUrl("file:///C:/uji.pdf"));
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(sendMessage).toHaveBeenCalledWith({ type: "claim-clarify:read-local-pdf", url: "file:///C:/uji.pdf" });
  });

  it("reads a local PDF directly before using extension fallbacks", async () => {
    const sendMessage = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    const bytes = new Uint8Array(await readLocalFileUrl("file:///C:/uji.pdf"));
    expect([...bytes]).toEqual([5, 6, 7]);
    expect(fetch).toHaveBeenCalledWith("file:///C:/uji.pdf");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("captures an active local PDF through the browser MIME stream", async () => {
    const values: Record<string, unknown> = {};
    const setMimeHandlerOptions = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      mimeHandler: { setMimeHandlerOptions },
      tabs: {
        reload: vi.fn().mockImplementation(async (tabId: number) => {
          values[`claimClarify.activePdf.${tabId}`] = { originalUrl: "file:///C:/uji.pdf", text: "Isi PDF" };
        }),
      },
      storage: {
        session: {
          get: vi.fn().mockImplementation(async (key: string) => ({ [key]: values[key] })),
          set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => Object.assign(values, items)),
          remove: vi.fn().mockImplementation(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
          }),
        },
      },
    });

    await expect(captureActiveTabPdf(42, "file:///C:/uji.pdf")).resolves.toBe("Isi PDF");
    expect(setMimeHandlerOptions).toHaveBeenNthCalledWith(1, "application/pdf", { enabled: true });
    expect(setMimeHandlerOptions).toHaveBeenLastCalledWith("application/pdf", { enabled: false });
  });


  it("removes audit history by id", async () => {
    const keep = { id: "keep-history-test", timestamp: "2026-01-01T00:00:00.000Z", workflow: "standard" as const, inputReference: "keep", output: { ringkasan: "r", jawabanPending: "j", sources: [] } };
    const drop = { ...keep, id: "drop-history-test", inputReference: "drop" };
    await appendAuditEntry(keep);
    await appendAuditEntry(drop);
    await removeAuditEntry(drop.id);
    const ids = (await listAuditEntries()).map((entry) => entry.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(drop.id);
  });

  it("replaces audit history during backup import", async () => {
    const entry = { id: "backup-history-test", timestamp: "2026-01-01T00:00:00.000Z", workflow: "standard" as const, inputReference: "backup", output: { ringkasan: "r", jawabanPending: "j", sources: [] } };
    await replaceAuditEntries([entry]);
    expect((await listAuditEntries()).map((item) => item.id)).toEqual([entry.id]);
    await replaceAuditEntries([]);
  });

});
