import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, Bot, Check, ChevronDown, ChevronRight, ClipboardList, Copy, Eye, EyeOff,
  DatabaseBackup, FileText, FolderOpen, Globe, History, KeyRound, Layers, Link2, Plus, RefreshCw,
  Pencil, Scale, Search, Server, Settings, ShieldCheck, Stethoscope, Tag, Trash2, Upload, Download, Users, X, type LucideIcon,
} from "lucide-react";
import { appendAuditEntry, listAuditEntries, removeAuditEntry, replaceAuditEntries } from "../lib/audit/log";
import { ADMIN_PROVIDER_OPTIONS, clearAdminUserSession, createAdminAccessUser, deleteAdminAccessUser, getAdminAiConfig, getAdminProviderLabel, listAdminAccessUsers, listClaimLibrary, listClaimLibraryReviews, loginAdminBackend, loginAdminUser, manageClaimLibraryItem, normalizeAdminProviderKey, resetAdminAccessUserPassword, resetAdminAiConfig, reviewClaimLibraryItem, saveAdminAiConfig, submitClaimKnowledge, submitClaimTemplate, validateAdminAiConfig, validateStoredAdminUserSession, type AdminAccessUser, type AdminAiDraft, type AdminAiProviderMeta, type ClaimKnowledgeEntry, type ClaimLibraryData, type ClaimTemplateEntry } from "../lib/ai/admin";
import { getProvider } from "../lib/ai/provider";
import { buildKnowledgeChunkUserMessage, formatKnowledgeContext, KNOWLEDGE_CHUNK_SYSTEM_PROMPT, parseKnowledgeChunks, retrieveKnowledgeChunks } from "../lib/knowledge/chunks";
import { captureActiveTabPdf, parsePdfFile, parsePdfUrl } from "../lib/pdf/parse";
import { redactSensitiveData } from "../lib/privacy/redact";
import { getLocal, removeLocal, setLocal } from "../lib/storage/local";
import { parseSepInput, runRegroupingBatch, type RegroupingProgress } from "../lib/eklaim/regrouping";
import { AMBER, AMBER_SOFT, INK, MIST, MIST_DARK, PAPER, PLUM, PLUM_SOFT, SLATE, TEAL, TEAL_SOFT } from "../theme";
import type { AIConfig, AuditEntry, ClaimChallengeAssessment, GeneratedAnswer, KnowledgeChunk, Template, WorkflowId } from "../types";
import { analyzeReadmisiTexts, hasMinimumReadmisiFiles } from "../workflows/readmisi";
import { buildClaimChallengeUserMessage, buildRevisionUserMessage, buildStandardUserMessage, CLAIM_CHALLENGE_SCHEMA, CLAIM_CHALLENGE_SYSTEM_PROMPT, GENERATED_ANSWER_SCHEMA, parseClaimChallengeAssessment, parseGeneratedAnswer, REVISION_SYSTEM_PROMPT, STANDARD_SYSTEM_PROMPT } from "../workflows/standard";
import { buildStrictTemplateSystemPrompt, hasStrictTemplatePlaceholders, parseStrictTemplateAnswer, resolveTemplateSelection, STRICT_TEMPLATE_SCHEMA } from "../workflows/template";

const AI_KEY = "claimClarify.aiConfig";
const TEMPLATE_KEY = "claimClarify.templates";
const KB_KEY = "claimClarify.knowledgeText";
const KB_CHUNKS_KEY = "claimClarify.knowledgeChunks";
const DRAFT_KEY = "claimClarify.caseDraft";
const DISABLED_SHARED_KNOWLEDGE_KEY = "claimClarify.disabledSharedKnowledge";
const DISABLED_SHARED_TEMPLATES_KEY = "claimClarify.disabledSharedTemplates";

type CaseDraft = { workflow: WorkflowId | null; stage: "select" | "input" | "processing" | "question" | "generating" | "output"; inputMethod: "upload" | "link" | "tab"; linkUrl: string; inputReference: string; recordText: string; answer: string; hasUserReason: boolean; userReason: string; output: GeneratedAnswer | null; templateEnabled: boolean; templateKeyword: string; templateInstruction?: string };
type WorkflowMeta = { label: string; accent: string; soft: string; desc: string };
const WORKFLOWS: Record<WorkflowId, WorkflowMeta> = {
  standard: { label: "Klaim Standar", accent: TEAL, soft: TEAL_SOFT, desc: "Satu kasus pending, jawab langsung." },
  readmisi: { label: "Kasus Readmisi", accent: PLUM, soft: PLUM_SOFT, desc: "Analisis 2 episode rawat atau lebih." },
  template: { label: "Template Kustom", accent: AMBER, soft: AMBER_SOFT, desc: "Output sesuai kata kunci milikmu." },
};
const VISIBLE_WORKFLOWS: WorkflowId[] = ["standard", "readmisi"];
const DEFAULT_AI: AIConfig = { source: "admin", provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-5", apiKey: "", adminSession: null };
const PERSONAL_PROVIDER_DEFAULTS = {
  anthropic: { endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-5" },
  "openai-compatible": { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini" },
} as const;
function normalizeAiConfig(config: Partial<AIConfig>): AIConfig {
  const merged = { ...DEFAULT_AI, ...config };
  return { ...merged, source: config.source ?? (config.apiKey ? "personal" : "admin"), adminSession: config.adminSession ?? null };
}
function createEmptyAdminAiDraft(): AdminAiDraft {
  return { provider: "gemini", provider_label: "Gemini", base_url: "", api_key: "", model: "gemini-2.0-flash", gemini_fallback_api_key: "", gemini_fallback_model: "gemini-2.0-flash" };
}
const DEFAULT_TEMPLATES: Template[] = [
  { keyword: "Tifoid", note: "Teks regulasi dikunci, AI hanya mengisi kondisi pasien", instruction: "Penegakan diagnosa Typhoid fever (A01.0, A01.1, A01.2, A01.3, A01.4) sesuai dengan Kepmenkes RI Nomor : HK.02.02/Meknes/514/2015 Skor tes Tubex berkisar antara 0–10, di mana nilai 0 diinterpretasikan negatif dan nilai 4–10 diinterpretasikan positif. Pasien..... (Jelaskan kegawatdaruratan pasien sampai harus di rawat inap, pemberian antibiotik intravena jika ada, dan seterusnya yang dapat mendukung klaim)" },
  { keyword: "readmisi", note: "Bandingkan episode rawat dan alasan klaim berdiri sendiri", instruction: "(Bandingkan episode rawat pertama dan berikutnya, jelaskan jarak waktu, diagnosis, bukti klinis, dan alasan readmisi layak menjadi episode klaim terpisah)" },
];
const LEGACY_DEFAULT_TEMPLATE_INSTRUCTIONS: Record<string, string> = {
  tifoid: "Tekankan diagnosis tifoid, bukti lab, indikasi rawat inap, dan PPK RS.",
  readmisi: "Bandingkan episode rawat pertama dan berikutnya, jelaskan jarak waktu, diagnosis, bukti klinis, dan alasan readmisi layak menjadi episode klaim terpisah.",
};

function upgradeLegacyDefaultTemplates(stored: Template[]) {
  return stored.map((template) => {
    const replacement = DEFAULT_TEMPLATES.find((candidate) => candidate.keyword.toLocaleLowerCase("id-ID") === template.keyword.toLocaleLowerCase("id-ID"));
    const legacyInstruction = LEGACY_DEFAULT_TEMPLATE_INSTRUCTIONS[template.keyword.toLocaleLowerCase("id-ID")];
    return replacement && template.instruction === legacyInstruction ? replacement : template;
  });
}

function claimKnowledgeToChunk(entry: ClaimKnowledgeEntry): KnowledgeChunk {
  return { id: `shared:${entry.id}`, title: entry.title, source: entry.source_name || "Library Claim Clarify", keywords: entry.keywords || [], content: entry.content, active: true };
}

function claimTemplateToTemplate(entry: ClaimTemplateEntry): Template {
  return { keyword: entry.keyword, note: entry.note || "Template bersama", instruction: entry.instruction, sharedId: entry.id };
}

function mergeTemplates(shared: Template[], local: Template[]) {
  const result = [...local];
  for (const template of shared) {
    const index = result.findIndex((item) => item.keyword.toLocaleLowerCase("id-ID") === template.keyword.toLocaleLowerCase("id-ID"));
    const existingIsDefault = index >= 0 && DEFAULT_TEMPLATES.some((item) => item.keyword === result[index].keyword && item.instruction === result[index].instruction);
    if (index < 0) result.push(template);
    else if (existingIsDefault) result[index] = template;
  }
  return result;
}

export default function App() {
  const [view, setView] = useState<"home" | "settings">("home");
  const [automation, setAutomation] = useState<"regrouping" | null>(null);
  const [settingsTab, setSettingsTab] = useState<"ai" | "kb" | "template" | "history">("ai");
  const [workflow, setWorkflow] = useState<WorkflowId | null>(null);
  const [stage, setStage] = useState<"select" | "input" | "processing" | "question" | "generating" | "output">("select");
  const [inputMethod, setInputMethod] = useState<"upload" | "link" | "tab">("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [inputReference, setInputReference] = useState("");
  const [recordText, setRecordText] = useState("");
  const [answer, setAnswer] = useState("");
  const [hasUserReason, setHasUserReason] = useState(false);
  const [userReason, setUserReason] = useState("");
  const [output, setOutput] = useState<GeneratedAnswer | null>(null);
  const [revisionPreview, setRevisionPreview] = useState<GeneratedAnswer | null>(null);
  const [challengeAssessment, setChallengeAssessment] = useState<ClaimChallengeAssessment | null>(null);
  const [generatingLabel, setGeneratingLabel] = useState("Menyusun jawaban...");
  const [previousOutputs, setPreviousOutputs] = useState<GeneratedAnswer[]>([]);
  const [usedKnowledge, setUsedKnowledge] = useState<KnowledgeChunk[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [templateEnabled, setTemplateEnabled] = useState(false);
  const [templateKeyword, setTemplateKeyword] = useState("");
  const [templateInstruction, setTemplateInstruction] = useState("");
  const [generateSeconds, setGenerateSeconds] = useState(0);
  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI);
  const [templates, setTemplates] = useState<Template[]>(DEFAULT_TEMPLATES);
  const [knowledgeText, setKnowledgeText] = useState("");
  const [knowledgeChunks, setKnowledgeChunks] = useState<KnowledgeChunk[]>([]);
  const [sharedKnowledgeChunks, setSharedKnowledgeChunks] = useState<KnowledgeChunk[]>([]);
  const [sharedTemplates, setSharedTemplates] = useState<Template[]>([]);
  const [disabledSharedKnowledge, setDisabledSharedKnowledge] = useState<string[]>([]);
  const [disabledSharedTemplates, setDisabledSharedTemplates] = useState<string[]>([]);
  const [claimSubmissions, setClaimSubmissions] = useState<ClaimLibraryData["submissions"]>({ knowledge: [], templates: [] });
  const [libraryStatus, setLibraryStatus] = useState("");
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  useEffect(() => {
    void getLocal(AI_KEY, DEFAULT_AI).then((config) => setAiConfig(normalizeAiConfig(config)));
    void getLocal(TEMPLATE_KEY, DEFAULT_TEMPLATES).then((stored) => {
      const upgraded = upgradeLegacyDefaultTemplates(stored);
      setTemplates(upgraded);
      if (JSON.stringify(upgraded) !== JSON.stringify(stored)) void setLocal(TEMPLATE_KEY, upgraded);
    });
    void getLocal(KB_KEY, "").then(setKnowledgeText);
    void getLocal(KB_CHUNKS_KEY, [] as KnowledgeChunk[]).then(setKnowledgeChunks);
    void getLocal(DISABLED_SHARED_KNOWLEDGE_KEY, [] as string[]).then(setDisabledSharedKnowledge);
    void getLocal(DISABLED_SHARED_TEMPLATES_KEY, [] as string[]).then(setDisabledSharedTemplates);
    void listAuditEntries().then(setHistory);
  }, []);

  useEffect(() => {
    void getLocal<CaseDraft | null>(DRAFT_KEY, null).then((draft) => {
      if (draft) {
        setWorkflow(draft.workflow);
        setStage(draft.stage === "processing" || draft.stage === "generating" ? "question" : draft.stage);
        setInputMethod(draft.inputMethod);
        setLinkUrl(draft.linkUrl);
        setInputReference(draft.inputReference);
        setRecordText(draft.recordText);
        setAnswer(draft.answer);
        setHasUserReason(draft.hasUserReason);
        setUserReason(draft.userReason);
        setOutput(draft.output);
        setTemplateEnabled(draft.templateEnabled);
        setTemplateKeyword(draft.templateKeyword);
        setTemplateInstruction(draft.templateInstruction ?? "");
      }
      setDraftLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (stage !== "generating") return;
    setGenerateSeconds(0);
    const timer = window.setInterval(() => setGenerateSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    const session = aiConfig.adminSession;
    if (!session) {
      setSharedKnowledgeChunks([]);
      setSharedTemplates([]);
      setClaimSubmissions({ knowledge: [], templates: [] });
      return;
    }
    void refreshClaimLibrary(session);
  }, [aiConfig.adminSession?.sessionToken]);

  useEffect(() => {
    if (!draftLoaded) return;
    const draft: CaseDraft = { workflow, stage, inputMethod, linkUrl, inputReference, recordText, answer, hasUserReason, userReason, output, templateEnabled, templateKeyword, templateInstruction };
    void setLocal(DRAFT_KEY, draft);
  }, [draftLoaded, workflow, stage, inputMethod, linkUrl, inputReference, recordText, answer, hasUserReason, userReason, output, templateEnabled, templateKeyword, templateInstruction]);

  const wf = workflow ? WORKFLOWS[workflow] : null;
  const availableTemplates = useMemo(() => mergeTemplates(sharedTemplates.filter((template) => template.sharedId && !disabledSharedTemplates.includes(template.sharedId)), templates), [disabledSharedTemplates, sharedTemplates, templates]);
  const availableKnowledgeChunks = useMemo(() => [...knowledgeChunks, ...sharedKnowledgeChunks.filter((chunk) => !disabledSharedKnowledge.includes(chunk.id))], [disabledSharedKnowledge, sharedKnowledgeChunks, knowledgeChunks]);
  const steps = ["Alur", "Dokumen", "Konfirmasi", "Hasil"];
  const stageIndex = { select: 0, input: 1, processing: 1, question: 2, generating: 2, output: 3 }[stage];

  function toggleSharedKnowledge(id: string) {
    setDisabledSharedKnowledge((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      void setLocal(DISABLED_SHARED_KNOWLEDGE_KEY, next);
      return next;
    });
  }

  function toggleSharedTemplate(id: string) {
    setDisabledSharedTemplates((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      void setLocal(DISABLED_SHARED_TEMPLATES_KEY, next);
      return next;
    });
  }

  function resetFlow() {
    setAutomation(null); setWorkflow(null); setStage("select"); setFiles([]); setLinkUrl(""); setInputReference(""); setRecordText(""); setAnswer(""); setHasUserReason(false); setUserReason(""); setOutput(null); setRevisionPreview(null); setChallengeAssessment(null); setPreviousOutputs([]); setUsedKnowledge([]); setError(""); setCopied(false); setTemplateEnabled(false); setTemplateKeyword(""); setTemplateInstruction(""); setGenerateSeconds(0); setGeneratingLabel("Menyusun jawaban..."); setInputMethod("upload"); void removeLocal(DRAFT_KEY);
  }

  async function refreshClaimLibrary(session = aiConfig.adminSession) {
    if (!session) return;
    try {
      const data = await listClaimLibrary(session);
      setSharedKnowledgeChunks(data.knowledge.map(claimKnowledgeToChunk));
      setSharedTemplates(data.templates.map(claimTemplateToTemplate));
      setClaimSubmissions(data.submissions);
      const pending = [...data.submissions.knowledge, ...data.submissions.templates].filter((item) => item.status === "pending").length;
      const rejected = [...data.submissions.knowledge, ...data.submissions.templates].filter((item) => item.status === "rejected").length;
      setLibraryStatus(`Library bersama: ${data.knowledge.length} knowledge, ${data.templates.length} template. Pengajuan: ${pending} pending${rejected ? `, ${rejected} ditolak` : ""}.`);
    } catch (error) {
      setSharedKnowledgeChunks([]);
      setSharedTemplates([]);
      setClaimSubmissions({ knowledge: [], templates: [] });
      setLibraryStatus(error instanceof Error ? error.message : "Library Claim Clarify gagal dimuat.");
    }
  }

  async function processFiles() {
    if (!workflow) return;
    setError("");
    if (workflow === "readmisi" && inputMethod === "upload" && !hasMinimumReadmisiFiles(files)) return setError("Unggah minimal 2 dokumen untuk kasus readmisi.");
    if (workflow === "readmisi" && inputMethod !== "upload") return setError("Readmisi masih wajib upload minimal 2 PDF.");
    if (inputMethod === "upload" && !files.length) return setError("Unggah PDF rekam medis terlebih dahulu.");
    if (inputMethod === "link" && !linkUrl.trim()) return setError("Masukkan link PDF terlebih dahulu.");
    try {
      setStage("processing");
      const texts = inputMethod === "link" ? [await parsePdfLink(linkUrl)] : inputMethod === "tab" ? [await parseActiveTabPdf()] : await Promise.all(files.map(parsePdfFile));
      const readmisiNote = workflow === "readmisi" ? formatReadmisiAnalysis(analyzeReadmisiTexts(texts)) : "";
      setInputReference(inputMethod === "link" ? linkUrl : inputMethod === "tab" ? "Tab aktif" : files.map((file) => file.name).join(", "));
      setRecordText([readmisiNote, texts.join("\n\n--- EPISODE BERIKUTNYA ---\n\n")].filter(Boolean).join("\n\n"));
      setStage("question");
    } catch (err) {
      setStage("input");
      setError(err instanceof Error ? err.message : "PDF gagal dibaca.");
    }
  }

  function templateSelection() {
    const selection = resolveTemplateSelection({ enabled: templateEnabled, keyword: templateKeyword, workflow, templates: availableTemplates });
    if (!selection.template || !templateInstruction.trim()) return selection;
    return { ...selection, template: { ...selection.template, instruction: templateInstruction.trim() } };
  }

  async function saveCaseTemplatePermanently(keyword: string, instruction: string) {
    const existing = templates.find((template) => template.keyword.toLocaleLowerCase("id-ID") === keyword.toLocaleLowerCase("id-ID"));
    const saved = { keyword, note: instruction.slice(0, 80), instruction };
    const next = existing ? templates.map((template) => template === existing ? saved : template) : [...templates, saved];
    setTemplates(next);
    await setLocal(TEMPLATE_KEY, next);
  }

  function selectedTemplateForCurrent() {
    return templateSelection().template;
  }

  function caseSystemPrompt(template: Template | null, basePrompt = STANDARD_SYSTEM_PROMPT) {
    return template ? `${basePrompt}\nAturan khusus template: template adalah kerangka wajib dan mengalahkan aturan panjang atau struktur default. Ikuti urutan dan frasa utama template, isi bagian kosong/titik-titik dengan fakta kasus, jangan membuat struktur baru, jangan memotong pembuka atau penutup template. Aturan singkat berarti kalimat tidak bertele-tele, bukan menghapus komponen template.\nInstruksi template: ${template.instruction}` : basePrompt;
  }

  function relevantContext(extra = "") {
    const relevantKnowledge = retrieveKnowledgeChunks(availableKnowledgeChunks, `${answer}\n${hasUserReason ? userReason : ""}\n${extra}\n${recordText}`, 6);
    setUsedKnowledge(relevantKnowledge);
    return relevantKnowledge.length ? [formatKnowledgeContext(relevantKnowledge)] : [];
  }

  async function auditOutput(parsed: GeneratedAnswer, suffix = "") {
    if (!workflow) return;
    const entry: AuditEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), workflow, inputReference: suffix ? `${inputReference} (${suffix})` : inputReference, output: parsed };
    await appendAuditEntry(entry);
    setHistory((current) => [entry, ...current]);
  }
  async function storeOutput(parsed: GeneratedAnswer, suffix = "", writeAudit = true) {
    if (output) setPreviousOutputs((current) => [output, ...current.filter((version) => JSON.stringify(version) !== JSON.stringify(parsed))].slice(0, 10));
    setOutput(parsed); setRevisionPreview(null); setChallengeAssessment(null); setStage("output");
    if (writeAudit) await auditOutput(parsed, suffix);
  }
  async function submitAnswer() {
    if (!workflow || !answer.trim()) return;
    setError("");
    try {
      const selection = templateSelection();
      if (selection.error) return setError(selection.error);
      const selectedTemplate = selection.template;
      if (selectedTemplate && !hasStrictTemplatePlaceholders(selectedTemplate.instruction)) throw new Error("Template strict harus memiliki bagian instruksi dalam tanda kurung, misalnya (Jelaskan kondisi pasien). Teks di luar kurung tidak akan diubah.");
      const strictTemplate = selectedTemplate;
      setGeneratingLabel("Menyusun jawaban...");
      setStage("generating");
      const result = await getProvider(aiConfig).send({
        systemPrompt: strictTemplate ? buildStrictTemplateSystemPrompt(strictTemplate.instruction) : caseSystemPrompt(selectedTemplate),
        userMessage: buildStandardUserMessage(recordText, answer, hasUserReason ? userReason : ""),
        context: relevantContext(),
        responseJson: true,
        responseSchema: strictTemplate ? STRICT_TEMPLATE_SCHEMA : GENERATED_ANSWER_SCHEMA,
      }, aiConfig);
      const parsed = strictTemplate ? parseStrictTemplateAnswer(result.text, strictTemplate.instruction) : parseGeneratedAnswer(result.text, { preserveTemplate: Boolean(selectedTemplate) });
      await storeOutput(parsed);
    } catch (err) {
      setStage("question");
      setError(err instanceof Error ? err.message : "Gagal membuat jawaban.");
    }
  }

  async function reviseOutput(revisionNote: string, preserveTemplate: boolean) {
    if (!workflow || !output || !revisionNote.trim()) return;
    setError("");
    setChallengeAssessment(null);
    try {
      const selection = templateSelection();
      if (selection.error) return setError(selection.error);
      const selectedTemplate = preserveTemplate ? selection.template : null;
      if (selectedTemplate && !hasStrictTemplatePlaceholders(selectedTemplate.instruction)) throw new Error("Template strict harus memiliki bagian instruksi dalam tanda kurung, misalnya (Jelaskan kondisi pasien). Teks di luar kurung tidak akan diubah.");
      const strictTemplate = selectedTemplate;
      setGeneratingLabel("Membuat preview revisi...");
      setStage("generating");
      const result = await getProvider(aiConfig).send({
        systemPrompt: strictTemplate ? buildStrictTemplateSystemPrompt(strictTemplate.instruction, revisionNote) : caseSystemPrompt(selectedTemplate, REVISION_SYSTEM_PROMPT),
        userMessage: buildRevisionUserMessage(recordText, answer, hasUserReason ? userReason : "", output, revisionNote),
        context: relevantContext(revisionNote),
        responseJson: true,
        responseSchema: strictTemplate ? STRICT_TEMPLATE_SCHEMA : GENERATED_ANSWER_SCHEMA,
      }, aiConfig);
      const parsed = strictTemplate ? parseStrictTemplateAnswer(result.text, strictTemplate.instruction) : parseGeneratedAnswer(result.text, { preserveTemplate: Boolean(selectedTemplate) });
      setRevisionPreview(parsed);
      setChallengeAssessment(null);
      setStage("output");
      await auditOutput(parsed, "preview revisi");
    } catch (err) {
      setStage("output");
      setError(err instanceof Error ? err.message : "Gagal merevisi jawaban.");
    }
  }

  async function assessChallenge() {
    if (!workflow || !output) return;
    setError("");
    setRevisionPreview(null);
    try {
      setGeneratingLabel("Menimbang peluang sanggah...");
      setStage("generating");
      const result = await getProvider(aiConfig).send({
        systemPrompt: CLAIM_CHALLENGE_SYSTEM_PROMPT,
        userMessage: buildClaimChallengeUserMessage(recordText, answer, hasUserReason ? userReason : "", output),
        context: relevantContext(output.jawabanPending),
        responseJson: true,
        responseSchema: CLAIM_CHALLENGE_SCHEMA,
      }, aiConfig);
      setChallengeAssessment(parseClaimChallengeAssessment(result.text));
      setRevisionPreview(null);
      setStage("output");
    } catch (err) {
      setStage("output");
      setError(err instanceof Error ? err.message : "Gagal menilai peluang sanggah.");
    }
  }

  async function applyRevisionPreview() {
    if (!revisionPreview) return;
    await storeOutput(revisionPreview, "", false);
  }

  async function restoreOutput(version: GeneratedAnswer) {
    await storeOutput(version, "versi dipulihkan");
  }
  function copyText(text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function importBackup(file: File) {
    const data = JSON.parse(await file.text()) as { templates?: Template[]; knowledgeText?: string; knowledgeChunks?: KnowledgeChunk[]; history?: AuditEntry[]; aiConfig?: Partial<AIConfig> };
    if (Array.isArray(data.templates)) { setTemplates(data.templates); await setLocal(TEMPLATE_KEY, data.templates); }
    if (typeof data.knowledgeText === "string") { setKnowledgeText(data.knowledgeText); await setLocal(KB_KEY, data.knowledgeText); }
    if (Array.isArray(data.knowledgeChunks)) { setKnowledgeChunks(data.knowledgeChunks); await setLocal(KB_CHUNKS_KEY, data.knowledgeChunks); }
    if (Array.isArray(data.history)) { setHistory(data.history); await replaceAuditEntries(data.history); }
    if (data.aiConfig) { const next = normalizeAiConfig({ ...aiConfig, ...data.aiConfig, apiKey: aiConfig.apiKey, adminSession: aiConfig.adminSession }); setAiConfig(next); await setLocal(AI_KEY, next); }
    setBackupOpen(false);
  }

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: "#F2F4F5" }}>

      <div className="flex flex-1 justify-end">
        <main className="w-full max-w-[400px] flex flex-col" style={{ backgroundColor: PAPER, borderLeft: `1px solid ${MIST_DARK}`, boxShadow: "-6px 0 18px rgba(0,0,0,0.06)" }}>
          <PanelHeader view={view} setView={setView} onBackup={() => setBackupOpen(true)} />
          {view === "settings" ? (
            <SettingsView aiConfig={aiConfig} setAiConfig={setAiConfig} settingsTab={settingsTab} setSettingsTab={setSettingsTab} templates={templates} setTemplates={setTemplates} sharedTemplates={sharedTemplates} disabledSharedTemplates={disabledSharedTemplates} toggleSharedTemplate={toggleSharedTemplate} knowledgeText={knowledgeText} setKnowledgeText={setKnowledgeText} knowledgeChunks={knowledgeChunks} setKnowledgeChunks={setKnowledgeChunks} sharedKnowledgeChunks={sharedKnowledgeChunks} disabledSharedKnowledge={disabledSharedKnowledge} toggleSharedKnowledge={toggleSharedKnowledge} claimSubmissions={claimSubmissions} libraryStatus={libraryStatus} refreshClaimLibrary={refreshClaimLibrary} history={history} setHistory={setHistory} onBack={() => setView("home")} />
          ) : (
            <div className="flex flex-col flex-1">
              {!automation && workflow && wf && <StepDots steps={steps} activeIndex={stageIndex} accent={wf.accent} />}
              <div className="flex-1 p-4 overflow-y-auto" style={{ minHeight: 420 }}>
                {automation ? <RegroupingStage onBack={() => setAutomation(null)} /> : <>
                  {inputReference && ["question", "generating", "output"].includes(stage) && <ActiveFileLabel inputReference={inputReference} />}
                  {stage === "select" && <WorkflowSelect workflow={workflow} selectWorkflow={(id) => { setWorkflow(id); setStage("input"); }} selectAutomation={() => setAutomation("regrouping")} />}
                  {stage === "input" && workflow && wf && <InputStage workflow={workflow} wf={wf} inputMethod={inputMethod} setInputMethod={setInputMethod} files={files} setFiles={setFiles} linkUrl={linkUrl} setLinkUrl={setLinkUrl} resetFlow={resetFlow} processFiles={processFiles} />}
                  {stage === "processing" && wf && <Processing accent={wf.accent} label="Membaca rekam medis..." />}
                  {stage === "generating" && wf && <Processing accent={wf.accent} label={`${generatingLabel} ${generateSeconds}s`} />}
                  {stage === "question" && workflow && wf && <QuestionStage workflow={workflow} wf={wf} answer={answer} setAnswer={setAnswer} templates={availableTemplates} templateEnabled={templateEnabled} setTemplateEnabled={setTemplateEnabled} templateKeyword={templateKeyword} setTemplateKeyword={setTemplateKeyword} templateInstruction={templateInstruction} setTemplateInstruction={setTemplateInstruction} saveTemplatePermanently={saveCaseTemplatePermanently} hasUserReason={hasUserReason} setHasUserReason={setHasUserReason} userReason={userReason} setUserReason={setUserReason} submitAnswer={submitAnswer} goBack={() => setStage("input")} />}
                  {stage === "output" && wf && output && <OutputStage output={output} wf={wf} copied={copied} copyText={copyText} resetFlow={resetFlow} onRevise={reviseOutput} revisionPreview={revisionPreview} applyRevision={applyRevisionPreview} dismissRevision={() => setRevisionPreview(null)} onAssess={assessChallenge} challengeAssessment={challengeAssessment} dismissAssessment={() => setChallengeAssessment(null)} previousOutputs={previousOutputs} restoreOutput={restoreOutput} templateActive={Boolean(selectedTemplateForCurrent())} usedKnowledge={usedKnowledge} />}
                  {error && <p className="text-[11px] mt-3 rounded-lg p-2" style={{ color: "#93000a", backgroundColor: "#ffdad6" }}>{error}</p>}
                </>}
              </div>
            </div>
          )}
        </main>
        {backupOpen && <BackupModal templates={templates} knowledgeText={knowledgeText} knowledgeChunks={knowledgeChunks} history={history} aiConfig={aiConfig} onImport={importBackup} onClose={() => setBackupOpen(false)} />}
      </div>
    </div>
  );
}

function PanelHeader({ view, setView, onBackup }: { view: "home" | "settings"; setView: (view: "home" | "settings") => void; onBackup: () => void }) {
  return <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid " + MIST }}><div className="flex items-center gap-2"><img src="/icons/icon32.png" alt="Claim Clarify" className="rounded-md" style={{ width: 28, height: 28 }} /><div><p className="text-[13px] font-bold leading-tight" style={{ color: INK }}>Claim Clarify</p><p className="text-[9.5px] leading-tight" style={{ color: SLATE }}>by Syafrie Yunizar</p></div></div><div className="flex items-center gap-1.5"><button aria-label="Import dan export data" title="Import dan export data" onClick={onBackup} className="p-1.5 rounded-md transition-all hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.95]" style={{ color: SLATE, backgroundColor: "transparent" }}><DatabaseBackup size={16} /></button><button aria-label="Settings" onClick={() => setView(view === "home" ? "settings" : "home")} className="p-1.5 rounded-md transition-all hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.95]" style={{ color: view === "settings" ? TEAL : SLATE, backgroundColor: view === "settings" ? TEAL_SOFT : "transparent" }}><Settings size={16} /></button></div></div>;
}

function StepDots({ steps, activeIndex, accent }: { steps: string[]; activeIndex: number; accent: string }) {
  return <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ borderBottom: `1px solid ${MIST}` }}>{steps.map((step, i) => <div key={step} className="flex items-center gap-1.5 flex-1 min-w-0"><div className="flex items-center justify-center rounded-full text-[10px] font-semibold shrink-0" style={{ width: 18, height: 18, backgroundColor: i <= activeIndex ? accent : MIST, color: i <= activeIndex ? "#fff" : SLATE }}>{i < activeIndex ? <Check size={11} /> : i + 1}</div><span className="text-[10.5px] font-medium truncate" style={{ color: i <= activeIndex ? INK : SLATE }}>{step}</span>{i < steps.length - 1 && <div className="h-px flex-1" style={{ backgroundColor: i < activeIndex ? accent : MIST_DARK }} />}</div>)}</div>;
}

function WorkflowSelect({ workflow, selectWorkflow, selectAutomation }: { workflow: WorkflowId | null; selectWorkflow: (id: WorkflowId) => void; selectAutomation: () => void }) {
  return <div className="space-y-2.5"><p className="text-[11.5px] leading-relaxed" style={{ color: SLATE }}>Asisten pending klaim BPJS untuk membantu menyusun jawaban berdasarkan rekam medis dan knowledge yang tersimpan.</p><p className="text-[12px] font-semibold mb-1" style={{ color: SLATE }}>Pilih jenis kasus</p>{VISIBLE_WORKFLOWS.map((id) => <WorkflowCard key={id} id={id} active={workflow === id} onClick={selectWorkflow} />)}<div className="pt-2"><p className="text-[12px] font-semibold mb-2" style={{ color: SLATE }}>Pilih jenis otomatisasi</p><button onClick={selectAutomation} className="w-full text-left rounded-xl p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-[0.99]" style={{ border: `1.5px solid ${MIST_DARK}`, backgroundColor: "#fff" }}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><RefreshCw size={15} color={TEAL} /><span className="font-semibold text-[13.5px]" style={{ color: INK }}>Re-grouping</span></div><ChevronRight size={16} color={SLATE} /></div><p className="text-[11.5px] mt-1" style={{ color: SLATE }}>Proses grouping ulang beberapa SEP secara berurutan.</p></button></div></div>;
}

function WorkflowCard({ id, active, onClick }: { id: WorkflowId; active: boolean; onClick: (id: WorkflowId) => void }) {
  const wf = WORKFLOWS[id];
  return <button onClick={() => onClick(id)} className="w-full text-left rounded-xl p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-[0.99]" style={{ border: `1.5px solid ${active ? wf.accent : MIST_DARK}`, backgroundColor: active ? wf.soft : "#fff" }}><div className="flex items-center justify-between"><span className="font-semibold text-[13.5px]" style={{ color: INK }}>{wf.label}</span><ChevronRight size={16} color={active ? wf.accent : SLATE} /></div><p className="text-[11.5px] mt-0.5" style={{ color: SLATE }}>{wf.desc}</p></button>;
}

function RegroupingStage({ onBack }: { onBack: () => void }) {
  const [value, setValue] = useState("");
  const [progress, setProgress] = useState<RegroupingProgress[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const cancelled = useRef(false);
  const parsed = useMemo(() => parseSepInput(value), [value]);

  useEffect(() => () => { cancelled.current = true; }, []);

  async function start() {
    if (!parsed.seps.length || parsed.invalid.length) return;
    cancelled.current = false;
    setRunning(true);
    setStatus("");
    setProgress(parsed.seps.map((sep, index) => ({ sep, index, total: parsed.seps.length, status: "pending", step: "Menunggu" })));
    try {
      await runRegroupingBatch(parsed.seps, (next) => {
        setProgress((current) => current.map((item) => item.sep === next.sep ? next : item));
      }, () => cancelled.current);
      setStatus(`${parsed.seps.length} SEP selesai di-re-grouping dan terkirim.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Re-grouping gagal.");
    } finally {
      setRunning(false);
    }
  }

  const done = progress.filter((item) => item.status === "done").length;
  return <div className="space-y-3.5">
    <button onClick={running ? undefined : onBack} disabled={running} className="flex items-center gap-1 text-[11px] font-medium disabled:opacity-50" style={{ color: SLATE }}><ArrowLeft size={12} /> Kembali</button>
    <div className="rounded-lg px-3 py-2 flex items-center gap-2 text-[11.5px] font-semibold" style={{ backgroundColor: TEAL_SOFT, color: TEAL }}><RefreshCw size={13} /> Re-grouping</div>
    <div>
      <label htmlFor="regrouping-seps" className="text-[11px] font-semibold" style={{ color: INK }}>Nomor SEP</label>
      <textarea id="regrouping-seps" value={value} onChange={(event) => setValue(event.target.value)} disabled={running} rows={7} spellCheck={false} placeholder={"1709R0090626V007001\n1709R0090626V007002"} className="mt-1.5 w-full resize-y rounded-lg p-3 font-mono text-[11.5px] leading-relaxed outline-none focus:ring-2 disabled:opacity-70" style={{ border: `1.5px solid ${parsed.invalid.length ? "#BA1A1A" : MIST_DARK}`, color: INK, backgroundColor: "#fff", minHeight: 150 }} />
      <div className="mt-1.5 flex items-start justify-between gap-3 text-[10.5px]" style={{ color: parsed.invalid.length ? "#BA1A1A" : SLATE }}><span>{parsed.invalid.length ? `Format tidak dikenali: ${parsed.invalid.join(", ")}` : "Pisahkan SEP dengan baris baru, koma, atau titik koma."}</span><span className="shrink-0 tabular-nums">{parsed.seps.length} SEP</span></div>
    </div>
    {progress.length > 0 && <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${MIST_DARK}` }}>
      <div className="flex items-center justify-between px-3 py-2 text-[10.5px] font-semibold" style={{ backgroundColor: MIST, color: SLATE }}><span>Progres</span><span className="tabular-nums">{done}/{progress.length}</span></div>
      <div className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: MIST }}>
        {progress.map((item) => <div key={item.sep} className="flex items-start gap-2.5 px-3 py-2.5" style={{ backgroundColor: item.status === "failed" ? "#FFF1F0" : "#fff" }}>
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: item.status === "done" ? TEAL : item.status === "failed" ? "#BA1A1A" : item.status === "running" ? TEAL_SOFT : MIST, color: item.status === "running" ? TEAL : "#fff" }}>{item.status === "done" ? <Check size={10} /> : item.status === "failed" ? <X size={10} /> : item.status === "running" ? <RefreshCw size={10} className="animate-spin" /> : null}</span>
          <div className="min-w-0 flex-1"><p className="truncate font-mono text-[10.5px] font-semibold" style={{ color: INK }}>{item.sep}</p><p className="text-[10px] leading-snug" style={{ color: item.status === "failed" ? "#BA1A1A" : SLATE }}>{item.error || item.step}</p></div>
        </div>)}
      </div>
    </div>}
    {status && <p className="rounded-lg p-2.5 text-[10.5px] leading-relaxed" style={{ color: status.includes("selesai") ? TEAL : "#93000a", backgroundColor: status.includes("selesai") ? TEAL_SOFT : "#ffdad6" }}>{status}</p>}
    <div className="flex justify-end gap-2">{running && <PanelButton variant="ghost" onClick={() => { cancelled.current = true; }} icon={X}>Hentikan</PanelButton>}<PanelButton onClick={start} icon={RefreshCw} disabled={running || !parsed.seps.length || Boolean(parsed.invalid.length)}>Re-grouping</PanelButton></div>
  </div>;
}

function InputStage({ workflow, wf, inputMethod, setInputMethod, files, setFiles, linkUrl, setLinkUrl, resetFlow, processFiles }: { workflow: WorkflowId; wf: WorkflowMeta; inputMethod: "upload" | "link" | "tab"; setInputMethod: (method: "upload" | "link" | "tab") => void; files: File[]; setFiles: (files: File[]) => void; linkUrl: string; setLinkUrl: (url: string) => void; resetFlow: () => void; processFiles: () => void }) {
  return <div className="space-y-3.5"><button onClick={resetFlow} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: SLATE }}><ArrowLeft size={12} /> Ganti alur</button><div className="rounded-lg px-3 py-2 text-[11.5px] font-medium" style={{ backgroundColor: wf.soft, color: wf.accent }}>{wf.label}</div>{workflow === "readmisi" && <div className="flex items-start gap-2 rounded-lg p-2.5 text-[11px]" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}><Layers size={13} className="mt-0.5 shrink-0" /> Wajib unggah minimal 2 dokumen (rawat pertama & kedua).</div>}<InputMethodTabs method={inputMethod} setMethod={setInputMethod} accent={wf.accent} />{inputMethod === "upload" ? <div className="space-y-2"><label className="rounded-lg p-4 flex flex-col items-center gap-1.5 text-center cursor-pointer" style={{ border: `1.5px dashed ${MIST_DARK}` }}><Upload size={18} color={SLATE} /><span className="text-[11px]" style={{ color: SLATE }}>Tarik file ke sini atau klik untuk unggah</span><input className="hidden" type="file" accept="application/pdf" multiple={workflow === "readmisi"} onChange={(event) => setFiles([...files, ...Array.from(event.target.files ?? [])])} /></label>{files.map((file, i) => <div key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: MIST }}><FileText size={13} color={SLATE} /><span className="text-[11px] flex-1 truncate font-mono" style={{ color: INK }}>{file.name}</span><button aria-label="Hapus file" onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><X size={12} color={SLATE} /></button></div>)}</div> : <div className="rounded-lg p-3 flex items-center gap-2" style={{ backgroundColor: MIST }}>{inputMethod === "link" ? <Link2 size={14} color={SLATE} /> : <Globe size={14} color={SLATE} />}{inputMethod === "link" ? <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} className="w-full bg-transparent text-[11px] outline-none" style={{ color: INK }} placeholder="https://.../rekam-medis.pdf" /> : <span className="text-[11px]" style={{ color: SLATE }}>Gunakan PDF dari tab aktif Chrome.</span>}</div>}<PanelButton onClick={processFiles} accent={wf.accent} className="w-full mt-2" disabled={(workflow === "readmisi" && inputMethod !== "upload") || (workflow === "readmisi" && files.length < 2)}>Proses Dokumen</PanelButton>{workflow === "readmisi" && inputMethod !== "upload" && <p className="text-[10.5px]" style={{ color: AMBER }}>Readmisi saat ini wajib memakai upload minimal 2 PDF.</p>}{workflow === "readmisi" && inputMethod === "upload" && files.length < 2 && <p className="text-[10.5px]" style={{ color: AMBER }}>Unggah minimal 2 dokumen untuk melanjutkan.</p>}</div>;
}

function InputMethodTabs({ method, setMethod, accent }: { method: "upload" | "link" | "tab"; setMethod: (method: "upload" | "link" | "tab") => void; accent: string }) {
  const methods = [{ id: "upload", label: "Upload", icon: Upload }, { id: "link", label: "Link", icon: Link2 }, { id: "tab", label: "Tab Aktif", icon: Globe }] as const;
  return <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: MIST }}>{methods.map((m) => <button key={m.id} onClick={() => setMethod(m.id)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-semibold transition-all hover:bg-white/70 active:scale-[0.98]" style={{ backgroundColor: method === m.id ? "#fff" : "transparent", color: method === m.id ? accent : SLATE, boxShadow: method === m.id ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}><m.icon size={12.5} /> {m.label}</button>)}</div>;
}

function Processing({ accent, label }: { accent: string; label: string }) {
  return <div className="flex flex-col items-center justify-center h-full gap-4 py-10"><div className="relative w-16 h-20 rounded-md overflow-hidden" style={{ border: `1.5px solid ${MIST_DARK}`, backgroundColor: "#fff" }}><div className="absolute left-0 right-0 h-0.5 scanline" style={{ backgroundColor: accent }} /><FileText size={28} color={MIST_DARK} className="absolute inset-0 m-auto" /></div><p className="text-[12px] font-medium tabular-nums" style={{ color: SLATE }}>{label}</p></div>;
}

function ActiveFileLabel({ inputReference }: { inputReference: string }) {
  return <div className="mb-3 flex min-h-11 items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: MIST }}><FileText aria-hidden size={14} color={TEAL} className="shrink-0" /><span className="min-w-0 break-all font-mono text-[11px] font-semibold" style={{ color: INK }}>{inputReference}</span></div>;
}

function QuestionStage({ workflow, wf, answer, setAnswer, templates, templateEnabled, setTemplateEnabled, templateKeyword, setTemplateKeyword, templateInstruction, setTemplateInstruction, saveTemplatePermanently, hasUserReason, setHasUserReason, userReason, setUserReason, submitAnswer, goBack }: { workflow: WorkflowId; wf: WorkflowMeta; answer: string; setAnswer: (answer: string) => void; templates: Template[]; templateEnabled: boolean; setTemplateEnabled: (value: boolean) => void; templateKeyword: string; setTemplateKeyword: (value: string) => void; templateInstruction: string; setTemplateInstruction: (value: string) => void; saveTemplatePermanently: (keyword: string, instruction: string) => Promise<void>; hasUserReason: boolean; setHasUserReason: (value: boolean) => void; userReason: string; setUserReason: (value: string) => void; submitAnswer: () => void; goBack: () => void }) {
  const [saveScopeOpen, setSaveScopeOpen] = useState(false);
  const [templateStatus, setTemplateStatus] = useState("");
  const question = workflow === "readmisi" ? "Dari BPJS kenapa mempending kasus readmisi ini?" : "Dari BPJS kenapa mempending kasus ini?";
  const switchStyle = { backgroundColor: templateEnabled ? TEAL_SOFT : "#ffdad6", color: templateEnabled ? TEAL : "#93000a", border: "1.5px solid " + (templateEnabled ? TEAL : "#ffb4ab") };
  const normalizedTemplateQuery = templateKeyword.trim().toLocaleLowerCase("id-ID");
  const selectedTemplate = templates.find((template) => template.keyword.toLocaleLowerCase("id-ID") === normalizedTemplateQuery) ?? null;
  const matchingTemplates = templates.filter((template) => {
    const searchableText = `${template.keyword} ${template.note ?? ""} ${template.instruction}`.toLocaleLowerCase("id-ID");
    return searchableText.includes(normalizedTemplateQuery);
  });
  const templateChanged = Boolean(selectedTemplate && templateInstruction.trim() !== selectedTemplate.instruction.trim());

  useEffect(() => {
    if (selectedTemplate && !templateInstruction) setTemplateInstruction(selectedTemplate.instruction);
  }, [templateKeyword]);

  function selectTemplate(keyword: string) {
    const selected = templates.find((template) => template.keyword === keyword);
    setTemplateKeyword(keyword);
    setTemplateInstruction(selected?.instruction ?? "");
    setTemplateStatus("");
  }

  function searchTemplate(value: string) {
    const normalizedValue = value.trim().toLocaleLowerCase("id-ID");
    const exactMatch = templates.find((template) => template.keyword.toLocaleLowerCase("id-ID") === normalizedValue);
    if (exactMatch) {
      selectTemplate(exactMatch.keyword);
      return;
    }
    setTemplateKeyword(value);
    setTemplateInstruction("");
    setTemplateStatus("");
  }

  function toggleTemplate() {
    const next = !templateEnabled;
    setTemplateEnabled(next);
    if (!next || selectedTemplate) return;
    const preferred = templates.find((template) => workflow === "readmisi" && template.keyword.toLocaleLowerCase("id-ID") === "readmisi") ?? templates[0];
    if (preferred) selectTemplate(preferred.keyword);
  }

  async function savePermanently() {
    if (!selectedTemplate || !templateInstruction.trim()) return;
    await saveTemplatePermanently(selectedTemplate.keyword, templateInstruction.trim());
    setTemplateInstruction(templateInstruction.trim());
    setTemplateStatus("Perubahan tersimpan permanen.");
    setSaveScopeOpen(false);
  }

  return <div className="space-y-3"><button onClick={goBack} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: SLATE }}><ArrowLeft size={12} /> Kembali</button><div className="rounded-xl rounded-tl-sm p-3" style={{ backgroundColor: MIST }}><div className="flex items-center gap-1.5 mb-1"><Bot size={13} color={wf.accent} /><span className="text-[10.5px] font-semibold" style={{ color: wf.accent }}>Claim Clarify</span></div><p className="text-[12.5px]" style={{ color: INK }}>{question}</p></div><textarea aria-label="Alasan pending dari BPJS" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="cth: lama hari rawat dianggap tidak sesuai clinical pathway" rows={3} className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none resize-none" style={{ border: `1.5px solid ${MIST_DARK}` }} /><button type="button" onClick={toggleTemplate} className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold transition-all active:scale-[0.98]" style={switchStyle}><span>Template {templateEnabled ? "ON" : "OFF"}</span>{templateEnabled ? <Check size={14} /> : <X size={14} />}</button>{templateEnabled && <div className="space-y-2.5 rounded-lg p-2.5" style={{ backgroundColor: MIST }}><label htmlFor="case-template" className="block text-[10.5px] font-semibold" style={{ color: SLATE }}>Cari dan pilih template</label><div className="relative"><Search aria-hidden size={14} color={SLATE} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" /><input id="case-template" type="search" list="case-template-options" value={templateKeyword} onChange={(event) => searchTemplate(event.target.value)} placeholder="Ketik nama template..." autoComplete="off" className="w-full rounded-lg bg-white py-2.5 pl-9 pr-9 text-[12px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}`, color: INK }} /><ChevronDown aria-hidden size={14} color={SLATE} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /><datalist id="case-template-options">{matchingTemplates.map((template) => <option key={template.keyword} value={template.keyword} label={template.note || undefined} />)}</datalist></div>{normalizedTemplateQuery && !matchingTemplates.length && <p className="text-[10.5px]" style={{ color: AMBER }}>Template tidak ditemukan.</p>}{selectedTemplate && <><label htmlFor="case-template-preview" className="block text-[10.5px] font-semibold" style={{ color: SLATE }}>Preview template</label><textarea id="case-template-preview" value={templateInstruction} onChange={(event) => { setTemplateInstruction(event.target.value); setTemplateStatus(""); }} rows={6} className="w-full rounded-lg bg-white px-3 py-2.5 text-[11.5px] leading-relaxed outline-none resize-y" style={{ border: `1.5px solid ${templateChanged ? AMBER : MIST_DARK}`, color: INK }} />{templateChanged && <PanelButton className="w-full" accent={AMBER} onClick={() => setSaveScopeOpen(true)} disabled={!templateInstruction.trim()}>Konfirmasi Edit</PanelButton>}{templateStatus && <p className="text-[10.5px] font-medium" style={{ color: TEAL }}>{templateStatus}</p>}</>}{!templates.length && <p className="text-[10.5px]" style={{ color: AMBER }}>Belum ada template. Tambahkan dari Pengaturan.</p>}</div>}<label className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: SLATE }}><input type="checkbox" checked={hasUserReason} onChange={(event) => setHasUserReason(event.target.checked)} />Kamu punya alasan?</label>{hasUserReason && <textarea aria-label="Alasan tambahan pengguna" value={userReason} onChange={(event) => setUserReason(event.target.value)} placeholder="Tulis alasan tambahan. Teks akan disusun ulang, bukan disalin mentah." rows={4} className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none resize-none" style={{ border: `1.5px solid ${MIST_DARK}` }} />}<PanelButton onClick={submitAnswer} accent={wf.accent} className="w-full" disabled={!answer.trim() || (templateEnabled && !selectedTemplate)}>Kirim Jawaban</PanelButton>{saveScopeOpen && <TemplateSaveScopeModal templateName={selectedTemplate?.keyword ?? ""} onCaseOnly={() => { setTemplateStatus("Perubahan hanya dipakai untuk kasus ini."); setSaveScopeOpen(false); }} onPermanent={() => void savePermanently()} onClose={() => setSaveScopeOpen(false)} />}</div>;
}

function OutputStage({ output, wf, copied, copyText, resetFlow, onRevise, revisionPreview, applyRevision, dismissRevision, onAssess, challengeAssessment, dismissAssessment, previousOutputs, restoreOutput, templateActive, usedKnowledge }: { output: GeneratedAnswer; wf: WorkflowMeta; copied: boolean; copyText: (text: string) => void; resetFlow: () => void; onRevise: (note: string, preserveTemplate: boolean) => void; revisionPreview: GeneratedAnswer | null; applyRevision: () => void; dismissRevision: () => void; onAssess: () => void; challengeAssessment: ClaimChallengeAssessment | null; dismissAssessment: () => void; previousOutputs: GeneratedAnswer[]; restoreOutput: (version: GeneratedAnswer) => void; templateActive: boolean; usedKnowledge: KnowledgeChunk[] }) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [preserveTemplate, setPreserveTemplate] = useState(templateActive);
  const revisionPresets = ["Lebih ringkas", "Lebih tegas", "Perkuat bukti klinis", "Perkuat dasar regulasi"];
  const scoreColor = challengeAssessment && challengeAssessment.challengeScore >= 7 ? TEAL : challengeAssessment && challengeAssessment.challengeScore >= 4 ? AMBER : "#93000a";

  return <div className="space-y-3">
    <span className="text-[11px] font-semibold" style={{ color: SLATE }}>1. Ringkasan Kasus</span>
    <div className="rounded-lg p-3" style={{ backgroundColor: MIST }}><p className="text-[12px] leading-relaxed" style={{ color: INK }}>{output.ringkasan}</p></div>
    <div className="flex items-center justify-between pt-1"><span className="text-[11px] font-semibold" style={{ color: SLATE }}>2. Jawaban Pending</span><button onClick={() => copyText(output.jawabanPending)} className="flex min-h-9 items-center gap-1 rounded-md px-2 text-[10.5px] font-semibold" style={{ color: copied ? "#fff" : wf.accent, backgroundColor: copied ? wf.accent : wf.soft }}>{copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Disalin" : "Salin"}</button></div>
    <div className="relative rounded-lg p-3.5" style={{ backgroundColor: "#fff", border: "1.5px solid " + wf.accent }}><p className="text-[12px] leading-relaxed" style={{ color: INK }}>{output.jawabanPending}</p><div className="absolute -top-2.5 right-2 flex items-center gap-1 px-2 py-1 rounded-full font-mono uppercase tracking-wide" style={{ fontSize: 8.5, backgroundColor: "#fff", border: "1.5px dashed " + wf.accent, color: wf.accent, transform: "rotate(4deg)" }}><ShieldCheck size={10} /> Siap Diajukan</div></div>
    <div className="flex flex-wrap gap-1.5 pt-1">{output.sources.map((source) => <span key={source} className="text-[9.5px] px-2 py-1 rounded-full" style={{ backgroundColor: MIST, color: SLATE }}>{source}</span>)}</div>
    {usedKnowledge.length > 0 && <details className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><summary className="cursor-pointer text-[11px] font-semibold" style={{ color: SLATE }}>Knowledge dipakai ({usedKnowledge.length})</summary><div className="mt-2 space-y-2">{usedKnowledge.map((chunk) => <div key={chunk.id} className="border-t pt-2" style={{ borderColor: MIST_DARK }}><p className="text-[10.5px] font-semibold" style={{ color: INK }}>{chunk.title || chunk.source}</p><p className="text-[9.5px]" style={{ color: SLATE }}>{chunk.keywords.slice(0, 4).join(", ")}</p><p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: SLATE }}>{chunk.content.slice(0, 240)}{chunk.content.length > 240 ? "..." : ""}</p></div>)}</div></details>}
    {revisionPreview && <section className="space-y-2 border-t pt-3" style={{ borderColor: MIST_DARK }}><p className="text-[11px] font-semibold" style={{ color: SLATE }}>Preview revisi</p><p className="text-[12px] leading-relaxed" style={{ color: INK }}><HighlightedText base={output.jawabanPending} text={revisionPreview.jawabanPending} /></p><div className="grid grid-cols-2 gap-2"><PanelButton onClick={dismissRevision} variant="ghost">Batalkan</PanelButton><PanelButton onClick={applyRevision} accent={TEAL}>Terapkan Revisi</PanelButton></div></section>}
    {challengeAssessment && <section className="space-y-3 border-t pt-3" style={{ borderColor: MIST_DARK }}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5"><Scale size={15} color={scoreColor} /><p className="text-[11px] font-semibold" style={{ color: INK }}>Peluang Sanggah</p></div><p className="text-[20px] font-bold leading-none" style={{ color: scoreColor }}>{challengeAssessment.challengeScore}<span className="text-[10px] font-semibold" style={{ color: SLATE }}> / 10</span></p></div><div className="grid grid-cols-10 gap-1" aria-label={`Skor peluang sanggah ${challengeAssessment.challengeScore} dari 10`}>{Array.from({ length: 10 }, (_, index) => <span key={index} className="h-2 rounded-sm" style={{ backgroundColor: index < challengeAssessment.challengeScore ? scoreColor : MIST_DARK }} />)}</div><div className="flex justify-between text-[9px]" style={{ color: SLATE }}><span>Sulit disanggah</span><span>Kuat disanggah</span></div><p className="border-l-2 pl-2.5 text-[12px] font-semibold leading-relaxed" style={{ color: INK, borderColor: scoreColor }}>{challengeAssessment.verdict}</p><div className="space-y-1.5 rounded-lg p-2.5" style={{ backgroundColor: MIST }}><div className="flex items-center gap-1.5"><ShieldCheck size={13} color={PLUM} /><p className="text-[10.5px] font-semibold" style={{ color: PLUM }}>Sudut pandang BPJS</p></div><AssessmentItems items={challengeAssessment.bpjsPerspective} /></div><div className="space-y-1.5 rounded-lg p-2.5" style={{ backgroundColor: TEAL_SOFT }}><div className="flex items-center gap-1.5"><Stethoscope size={13} color={TEAL} /><p className="text-[10.5px] font-semibold" style={{ color: TEAL }}>Sudut pandang Dokter Casemix</p></div><AssessmentItems items={challengeAssessment.casemixPerspective} /></div>{challengeAssessment.missingEvidence.length > 0 && <div><p className="text-[10.5px] font-semibold" style={{ color: AMBER }}>Bukti yang perlu diperkuat</p><AssessmentItems items={challengeAssessment.missingEvidence} /></div>}<div><p className="mb-1 text-[10.5px] font-semibold" style={{ color: TEAL }}>Rekomendasi</p><p className="text-[11px] leading-relaxed" style={{ color: INK }}>{challengeAssessment.recommendation}</p></div><PanelButton onClick={dismissAssessment} variant="ghost" className="w-full">Tutup Penilaian</PanelButton></section>}
    {revisionOpen && <section className="space-y-2.5 rounded-lg p-2.5" style={{ backgroundColor: MIST }}><p className="text-[11px] font-semibold" style={{ color: SLATE }}>Apa yang perlu diperbaiki?</p><div className="grid grid-cols-2 gap-2">{revisionPresets.map((preset) => <button key={preset} type="button" onClick={() => setRevisionNote(preset)} className="min-h-11 rounded-lg bg-white px-2 text-[10.5px] font-semibold" style={{ border: `1.5px solid ${revisionNote === preset ? wf.accent : MIST_DARK}`, color: INK }}>{preset}</button>)}</div><textarea aria-label="Kritik dan arahan revisi" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} rows={3} className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none" style={{ border: "1.5px solid " + MIST_DARK }} placeholder="cth: lebih tekankan indikasi rawat inap, jangan bahas pneumonia" />{templateActive && <label className="flex min-h-11 items-center gap-2 text-[11px] font-semibold" style={{ color: SLATE }}><input type="checkbox" checked={preserveTemplate} onChange={(event) => setPreserveTemplate(event.target.checked)} />Pertahankan susunan template</label>}<PanelButton onClick={() => { onRevise(revisionNote, preserveTemplate); setRevisionOpen(false); }} accent={wf.accent} className="w-full" disabled={!revisionNote.trim()} icon={RefreshCw}>Buat Preview Revisi</PanelButton></section>}
    <div className="grid grid-cols-2 gap-2"><PanelButton onClick={() => { dismissAssessment(); setRevisionOpen(!revisionOpen); }} variant="ghost" icon={RefreshCw}>Kritik &amp; Revisi</PanelButton><PanelButton onClick={() => { setRevisionOpen(false); dismissRevision(); onAssess(); }} variant="ghost" icon={Scale}>Timbang Kasus</PanelButton></div>
    {previousOutputs.length > 0 && <details className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><summary className="cursor-pointer text-[11px] font-semibold" style={{ color: SLATE }}>Riwayat versi ({previousOutputs.length})</summary><div className="mt-2 space-y-2">{previousOutputs.map((version, index) => <div key={`${index}-${version.jawabanPending.slice(0, 20)}`} className="flex items-start gap-2 border-t pt-2" style={{ borderColor: MIST_DARK }}><p className="min-w-0 flex-1 text-[10.5px] leading-relaxed" style={{ color: SLATE }}>Versi {previousOutputs.length - index}: {version.jawabanPending.slice(0, 100)}{version.jawabanPending.length > 100 ? "..." : ""}</p><button type="button" onClick={() => restoreOutput(version)} className="min-h-9 shrink-0 rounded-md px-2 text-[10px] font-semibold" style={{ color: TEAL, border: `1px solid ${TEAL}` }}>Gunakan</button></div>)}</div></details>}
    <PanelButton onClick={resetFlow} accent={TEAL} className="w-full mt-2" icon={Plus}>Kasus Baru</PanelButton>
  </div>;
}

function AssessmentItems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <ul className="space-y-1 pl-4">{items.map((item, index) => <li key={index} className="list-disc text-[10.5px] leading-relaxed" style={{ color: SLATE }}>{item}</li>)}</ul>;
}

function HighlightedText({ base, text }: { base: string; text: string }) {
  const baseWords = new Set(base.split(/\s+/).map(cleanDiffWord).filter(Boolean));
  return <>{text.split(/(\s+)/).map((part, index) => /\s+/.test(part) ? part : baseWords.has(cleanDiffWord(part)) ? part : <mark key={index} className="rounded px-0.5" style={{ backgroundColor: "#fff1a8", color: INK }}>{part}</mark>)}</>;
}

function cleanDiffWord(value: string) {
  return value.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/gi, "");
}

function SettingsView({ aiConfig, setAiConfig, settingsTab, setSettingsTab, templates, setTemplates, sharedTemplates, disabledSharedTemplates, toggleSharedTemplate, knowledgeText, setKnowledgeText, knowledgeChunks, setKnowledgeChunks, sharedKnowledgeChunks, disabledSharedKnowledge, toggleSharedKnowledge, claimSubmissions, libraryStatus, refreshClaimLibrary, history, setHistory, onBack }: { aiConfig: AIConfig; setAiConfig: (config: AIConfig) => void; settingsTab: "ai" | "kb" | "template" | "history"; setSettingsTab: (tab: "ai" | "kb" | "template" | "history") => void; templates: Template[]; setTemplates: (templates: Template[]) => void; sharedTemplates: Template[]; disabledSharedTemplates: string[]; toggleSharedTemplate: (id: string) => void; knowledgeText: string; setKnowledgeText: (text: string) => void; knowledgeChunks: KnowledgeChunk[]; setKnowledgeChunks: (chunks: KnowledgeChunk[]) => void; sharedKnowledgeChunks: KnowledgeChunk[]; disabledSharedKnowledge: string[]; toggleSharedKnowledge: (id: string) => void; claimSubmissions: ClaimLibraryData["submissions"]; libraryStatus: string; refreshClaimLibrary: () => Promise<void>; history: AuditEntry[]; setHistory: (history: AuditEntry[]) => void; onBack: () => void }) {
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [activeAiStatus, setActiveAiStatus] = useState("");
  const [adminBackendUser, setAdminBackendUser] = useState("");
  const [adminBackendPassword, setAdminBackendPassword] = useState("");
  const [adminAiStatus, setAdminAiStatus] = useState("");
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminProviders, setAdminProviders] = useState<AdminAiProviderMeta[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminAccessUser[]>([]);
  const [claimReviews, setClaimReviews] = useState<{ knowledge: ClaimKnowledgeEntry[]; templates: ClaimTemplateEntry[] }>({ knowledge: [], templates: [] });
  const [claimAdminLibrary, setClaimAdminLibrary] = useState<{ knowledge: ClaimKnowledgeEntry[]; templates: ClaimTemplateEntry[] }>({ knowledge: [], templates: [] });
  const [adminUserDraft, setAdminUserDraft] = useState({ username: "", password: "", resetUsername: "", resetPassword: "" });
  const [adminAiDraft, setAdminAiDraft] = useState<AdminAiDraft>(() => createEmptyAdminAiDraft());
  const [draft, setDraft] = useState({ keyword: "", instruction: "" });
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateLibraryTab, setTemplateLibraryTab] = useState<"mine" | "shared">("mine");
  const [expandedTemplate, setExpandedTemplate] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeLibraryTab, setKnowledgeLibraryTab] = useState<"mine" | "shared">("mine");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualChunk, setManualChunk] = useState<KnowledgeChunk>(() => createEmptyManualChunk());
  const [draftChunks, setDraftChunks] = useState<KnowledgeChunk[]>([]);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const [knowledgeDelete, setKnowledgeDelete] = useState<{ id: string; label: string } | null>(null);
  const [templateDelete, setTemplateDelete] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedHistory, setSelectedHistory] = useState<AuditEntry | null>(null);
  const maskedKey = useMemo(() => aiConfig.apiKey ? `${aiConfig.apiKey.slice(0, 6)}...${aiConfig.apiKey.slice(-4)}` : "", [aiConfig.apiKey]);
  const filteredHistory = history.filter((entry) => `${entry.inputReference} ${entry.output.ringkasan} ${entry.output.jawabanPending}`.toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID")));
  const filteredTemplates = templates.filter((template) => `${template.keyword} ${template.note} ${template.instruction}`.toLocaleLowerCase("id-ID").includes(templateQuery.toLocaleLowerCase("id-ID")));
  const filteredKnowledgeChunks = knowledgeChunks.filter((chunk) => chunkMatches(chunk, knowledgeQuery));
  const filteredSharedTemplates = sharedTemplates.filter((template) => `${template.keyword} ${template.note} ${template.instruction}`.toLocaleLowerCase("id-ID").includes(templateQuery.toLocaleLowerCase("id-ID")));
  const filteredSharedKnowledgeChunks = sharedKnowledgeChunks.filter((chunk) => chunkMatches(chunk, knowledgeQuery));
  const tabs = [{ id: "ai", label: "AI (BYOK)", icon: Bot }, { id: "kb", label: "Knowledge", icon: FolderOpen }, { id: "template", label: "Template", icon: Tag }, { id: "history", label: "Riwayat", icon: History }] as const;
  const activeAdminUser = aiConfig.source === "admin" ? aiConfig.adminSession?.username || "" : "";

  function knowledgeReviewStatus(chunk: KnowledgeChunk) {
    if (sharedKnowledgeChunks.some((item) => item.title === chunk.title && item.content === chunk.content)) return "approved";
    return claimSubmissions.knowledge.find((item) => item.title === chunk.title)?.status || "";
  }

  function templateReviewStatus(template: Template) {
    if (sharedTemplates.some((item) => item.keyword.toLocaleLowerCase("id-ID") === template.keyword.toLocaleLowerCase("id-ID") && item.instruction === template.instruction)) return "approved";
    return claimSubmissions.templates.find((item) => item.keyword?.toLocaleLowerCase("id-ID") === template.keyword.toLocaleLowerCase("id-ID"))?.status || "";
  }

  useEffect(() => {
    void refreshActiveAiStatus();
    if (aiConfig.source !== "admin") return;
    void validateStoredAdminUserSession().then((session) => {
      setAdminStatus(session ? `Admin aktif: ${session.username}` : "Belum login admin.");
      if (session) setAiConfig({ ...aiConfig, adminSession: session });
    });
    void loadAdminAiPanel();
  }, [aiConfig.source]);

  async function saveConfig(next: AIConfig) { const normalized = normalizeAiConfig(next); setAiConfig(normalized); await setLocal(AI_KEY, normalized); }
  async function saveKnowledge(text: string) { setKnowledgeText(text); await setLocal(KB_KEY, text); }
  async function saveKnowledgeChunks(next: KnowledgeChunk[]) { setKnowledgeChunks(next); await setLocal(KB_CHUNKS_KEY, next); }
  async function addTemplate() { if (!draft.keyword.trim()) return; const instruction = draft.instruction.trim(); const next = [...templates, { keyword: draft.keyword.trim(), note: instruction.slice(0, 80), instruction }]; setTemplates(next); setDraft({ keyword: "", instruction: "" }); setTemplateOpen(false); await setLocal(TEMPLATE_KEY, next); }
  async function saveTemplate(template: Template) { const next = templates.map((item) => item.keyword === editingTemplate?.keyword ? template : item); setTemplates(next); setEditingTemplate(null); await setLocal(TEMPLATE_KEY, next); }
  async function submitLocalKnowledgeForReview() {
    const candidates = knowledgeChunks.filter((chunk) => !["pending", "approved"].includes(knowledgeReviewStatus(chunk)));
    if (!aiConfig.adminSession) return setKnowledgeStatus("Login dengan akses API admin sebelum mengajukan knowledge.");
    if (!candidates.length) return setKnowledgeStatus("Tidak ada knowledge lokal baru untuk diajukan.");
    try {
      setKnowledgeStatus(`Mengajukan ${candidates.length} knowledge...`);
      await submitClaimKnowledge(aiConfig.adminSession, candidates.map((chunk) => ({ title: redactSensitiveData(chunk.title), content: redactSensitiveData(chunk.content), category: "klaim BPJS", keywords: chunk.keywords.map(redactSensitiveData), source_name: redactSensitiveData(chunk.source) })));
      await refreshClaimLibrary();
      setKnowledgeStatus(`${candidates.length} knowledge menunggu persetujuan admin.`);
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Knowledge gagal diajukan.");
    }
  }
  async function submitLocalTemplatesForReview() {
    const candidates = templates.filter((template) => !["pending", "approved"].includes(templateReviewStatus(template)));
    if (!aiConfig.adminSession) return setKnowledgeStatus("Login dengan akses API admin sebelum mengajukan template.");
    if (!candidates.length) return setKnowledgeStatus("Tidak ada template lokal baru untuk diajukan.");
    try {
      setKnowledgeStatus(`Mengajukan ${candidates.length} template...`);
      for (const template of candidates) await submitClaimTemplate(aiConfig.adminSession, { keyword: redactSensitiveData(template.keyword), note: redactSensitiveData(template.note), instruction: redactSensitiveData(template.instruction) });
      await refreshClaimLibrary();
      setKnowledgeStatus(`${candidates.length} template menunggu persetujuan admin.`);
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Template gagal diajukan.");
    }
  }
  async function uploadKnowledge(file: File) {
    setKnowledgeStatus("Membaca dokumen...");
    const text = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? await parsePdfFile(file) : await file.text();
    setKnowledgeStatus("AI menyusun draft chunk...");
    const result = await getProvider(aiConfig).send({ systemPrompt: KNOWLEDGE_CHUNK_SYSTEM_PROMPT, userMessage: buildKnowledgeChunkUserMessage(file.name, text), context: [] }, aiConfig);
    const chunks = parseKnowledgeChunks(result.text, file.name);
    setDraftChunks(chunks);
    setKnowledgeStatus(`${chunks.length} draft chunk siap direview.`);
  }
  function removeTemplate(keyword: string) { setTemplateDelete(keyword); }
  async function confirmTemplateDelete() {
    if (!templateDelete) return;
    const next = templates.filter((template) => template.keyword !== templateDelete);
    setTemplates(next);
    await setLocal(TEMPLATE_KEY, next);
    if (expandedTemplate === templateDelete) setExpandedTemplate("");
    if (editingTemplate?.keyword === templateDelete) setEditingTemplate(null);
    setTemplateDelete(null);
  }
  async function addManualChunk() {
    if (!manualChunk.title.trim() || !manualChunk.content.trim()) return setKnowledgeStatus("Judul dan long form wajib diisi.");
    const keywords = manualChunk.keywords.length ? manualChunk.keywords : manualChunk.title.split(/\s+/).filter((word) => word.length > 2).slice(0, 6);
    await saveKnowledgeChunks([...knowledgeChunks, { ...manualChunk, id: crypto.randomUUID(), keywords }]);
    setManualChunk(createEmptyManualChunk());
    setManualOpen(false);
    setKnowledgeStatus("Knowledge manual tersimpan.");
  }
  async function confirmDraftChunks() { await saveKnowledgeChunks([...knowledgeChunks, ...draftChunks]); setDraftChunks([]); setKnowledgeStatus("Knowledge chunk tersimpan."); }
  function updateDraftChunk(id: string, patch: Partial<KnowledgeChunk>) { setDraftChunks((current) => current.map((chunk) => chunk.id === id ? { ...chunk, ...patch } : chunk)); }
  function updateSavedChunk(id: string, patch: Partial<KnowledgeChunk>) { void saveKnowledgeChunks(knowledgeChunks.map((chunk) => chunk.id === id ? { ...chunk, ...patch } : chunk)); }
  function removeDraftChunk(id: string) { setDraftChunks((current) => current.filter((chunk) => chunk.id !== id)); }
  async function confirmKnowledgeDelete() {
    if (!knowledgeDelete) return;
    const next = knowledgeDelete.id === "*" ? [] : knowledgeChunks.filter((chunk) => chunk.id !== knowledgeDelete.id);
    await saveKnowledgeChunks(next);
    setKnowledgeStatus(knowledgeDelete.id === "*" ? "Semua knowledge chunk dihapus." : `Knowledge “${knowledgeDelete.label}” dihapus.`);
    setKnowledgeDelete(null);
  }
  async function loginAdminAccess() {
    if (!adminUsername.trim() || !adminPassword.trim()) return setAdminStatus("Username dan password wajib diisi.");
    setTestStatus("testing");
    try {
      const session = await loginAdminUser(adminUsername, adminPassword);
      setAdminPassword("");
      setAdminStatus(`Admin aktif: ${session.username}`);
      await saveConfig({ ...aiConfig, source: "admin", adminSession: session });
      setTestStatus("success");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Login admin gagal.");
      setTestStatus("error");
    }
  }
  async function logoutAdminAccess() {
    await clearAdminUserSession();
    setAdminUsername("");
    setAdminPassword("");
    setAdminStatus("Belum login admin.");
    await saveConfig({ ...aiConfig, source: "admin", adminSession: null });
  }
  async function runTest() {
    if (aiConfig.source === "personal" && (!aiConfig.endpoint.trim() || !aiConfig.model.trim() || !aiConfig.apiKey.trim())) {
      setAdminStatus("Endpoint, model, dan API key wajib diisi.");
      setTestStatus("error");
      return;
    }
    setTestStatus("testing");
    const result = await getProvider(aiConfig).testConnection(aiConfig);
    setAdminStatus(result.message);
    setTestStatus(result.ok ? "success" : "error");
    await refreshActiveAiStatus();
  }
  async function refreshActiveAiStatus() {
    if (aiConfig.source === "personal") {
      const label = aiConfig.provider === "anthropic" ? "Anthropic" : "OpenAI-compatible";
      setActiveAiStatus(aiConfig.apiKey && aiConfig.model ? label + " aktif dari API key pribadi" : "Tidak ada API key aktif");
      return;
    }
    const session = await validateStoredAdminUserSession();
    if (!session) return setActiveAiStatus("Tidak ada API key aktif");
    try {
      const data = await getAdminAiConfig();
      setAdminProviders(data.providers);
      const config = data.config;
      const label = config ? getAdminProviderLabel(config.provider, config.providerLabel || "") : "Provider";
      setActiveAiStatus(config?.hasApiKey ? label + " aktif dari API key admin, user: " + session.username : "Tidak ada API key aktif");
    } catch {
      setActiveAiStatus("API key admin dipilih, user: " + session.username + ". Status provider belum terbaca");
    }
  }
  async function loadAdminAiPanel() {
    try {
      const data = await getAdminAiConfig();
      setAdminProviders(data.providers);
      if (!data.config) return;
      setAdminAiDraft({
        provider: data.config.provider || "gemini",
        provider_label: data.config.providerLabel || getAdminProviderLabel(data.config.provider),
        base_url: data.config.baseUrl || "",
        api_key: "",
        model: data.config.model || "gemini-2.0-flash",
        gemini_fallback_api_key: "",
        gemini_fallback_model: data.config.geminiFallbackModel || "gemini-2.0-flash",
      });
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Konfigurasi admin gagal dibaca.");
    }
  }
  function adminBackendAuth() {
    return { username: adminBackendUser.trim(), password: adminBackendPassword };
  }
  async function openAdminModal() {
    if (!adminBackendUser.trim() || !adminBackendPassword) return setAdminAiStatus("Username dan password admin backend wajib diisi.");
    try {
      setAdminAiStatus("Memeriksa admin backend...");
      await loginAdminBackend(adminBackendAuth());
      setAdminAiStatus("Admin backend aktif.");
      await loadAdminAiPanel();
      await loadAdminUsers();
      await loadClaimReviews();
      await loadClaimAdminLibrary();
      setAdminModalOpen(true);
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Login admin backend gagal.");
    }
  }
  async function loadAdminUsers() {
    try {
      setAdminUsers(await listAdminAccessUsers(adminBackendAuth()));
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "User admin gagal dimuat.");
    }
  }
  async function loadClaimReviews() {
    try {
      setClaimReviews(await listClaimLibraryReviews(adminBackendAuth()));
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Pengajuan library gagal dimuat.");
    }
  }
  async function loadClaimAdminLibrary() {
    try {
      setClaimAdminLibrary(await listClaimLibraryReviews(adminBackendAuth(), "approved"));
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Library admin gagal dimuat.");
    }
  }
  async function reviewClaimItem(resourceType: "knowledge" | "template", id: string, decision: "approved" | "rejected", reviewNote = "") {
    try {
      await reviewClaimLibraryItem(adminBackendAuth(), { resourceType, id, decision, reviewNote });
      setAdminAiStatus(decision === "approved" ? "Pengajuan disetujui." : "Pengajuan ditolak.");
      await loadClaimReviews();
      await loadClaimAdminLibrary();
      if (aiConfig.adminSession) await refreshClaimLibrary();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Review pengajuan gagal.");
    }
  }
  async function manageClaimItem(resourceType: "knowledge" | "template", operation: "save" | "set_active" | "delete", input: { id?: string; item?: Record<string, unknown>; active?: boolean } = {}) {
    try {
      await manageClaimLibraryItem(adminBackendAuth(), { resourceType, operation, ...input });
      setAdminAiStatus(operation === "delete" ? "Item library dihapus." : operation === "set_active" ? "Status library diperbarui." : "Item library tersimpan.");
      await loadClaimAdminLibrary();
      if (aiConfig.adminSession) await refreshClaimLibrary();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Library gagal diperbarui.");
      throw error;
    }
  }
  async function addAdminUser() {
    if (!adminUserDraft.username.trim() || !adminUserDraft.password) return setAdminAiStatus("Username dan password user wajib diisi.");
    try {
      await createAdminAccessUser(adminBackendAuth(), adminUserDraft.username, adminUserDraft.password);
      setAdminUserDraft({ ...adminUserDraft, username: "", password: "" });
      setAdminAiStatus("User akses admin tersimpan.");
      await loadAdminUsers();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "User gagal disimpan.");
    }
  }
  async function resetAdminUserPassword() {
    if (!adminUserDraft.resetUsername || !adminUserDraft.resetPassword) return setAdminAiStatus("Pilih user dan isi password baru.");
    try {
      await resetAdminAccessUserPassword(adminBackendAuth(), adminUserDraft.resetUsername, adminUserDraft.resetPassword);
      setAdminUserDraft({ ...adminUserDraft, resetUsername: "", resetPassword: "" });
      setAdminAiStatus("Password user diperbarui.");
      await loadAdminUsers();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Reset password gagal.");
    }
  }
  async function removeAdminUser(username: string) {
    try {
      await deleteAdminAccessUser(adminBackendAuth(), username);
      setAdminAiStatus("User akses admin dihapus.");
      await loadAdminUsers();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Hapus user gagal.");
    }
  }
  function currentAdminAiConfig() {
    const custom = adminAiDraft.provider === "custom";
    const provider = custom ? normalizeAdminProviderKey(adminAiDraft.provider_label) : adminAiDraft.provider;
    if (custom && !provider) throw new Error("Nama provider custom wajib diisi.");
    if (custom && !adminAiDraft.base_url.trim()) throw new Error("Endpoint URL provider custom wajib diisi.");
    return { ...adminAiDraft, provider, provider_label: adminAiDraft.provider_label || getAdminProviderLabel(provider) };
  }
  async function saveAdminKey(validateFirst: boolean) {
    if (!adminBackendUser.trim() || !adminBackendPassword) return setAdminAiStatus("Username dan password admin backend wajib diisi.");
    try {
      const config = currentAdminAiConfig();
      setAdminAiStatus(validateFirst ? "Memvalidasi API key admin..." : "Menyimpan API key admin...");
      if (validateFirst) await validateAdminAiConfig(adminBackendAuth(), config);
      const data = await saveAdminAiConfig(adminBackendAuth(), config);
      setAdminProviders(data.providers);
      setAdminAiDraft({ ...adminAiDraft, api_key: "", gemini_fallback_api_key: "" });
      setAdminAiStatus(validateFirst ? "API key admin valid dan tersimpan." : "API key admin tersimpan tanpa validasi.");
      await refreshActiveAiStatus();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "API key admin gagal disimpan.");
    }
  }
  async function resetAdminKey() {
    if (!adminBackendUser.trim() || !adminBackendPassword) return setAdminAiStatus("Username dan password admin backend wajib diisi.");
    try {
      const provider = currentAdminAiConfig().provider;
      setAdminAiStatus("Mereset API key admin...");
      const data = await resetAdminAiConfig(adminBackendAuth(), provider);
      setAdminProviders(data.providers);
      setAdminAiDraft({ ...adminAiDraft, api_key: "", gemini_fallback_api_key: "" });
      setAdminAiStatus("API key admin berhasil dikosongkan.");
      await refreshActiveAiStatus();
    } catch (error) {
      setAdminAiStatus(error instanceof Error ? error.message : "Reset API key admin gagal.");
    }
  }
  async function deleteHistoryEntry(id: string) {
    const next = history.filter((entry) => entry.id !== id);
    setHistory(next);
    if (selectedHistory?.id === id) setSelectedHistory(null);
    await removeAuditEntry(id);
  }

  return <div className="flex flex-col flex-1"><div className="flex items-center gap-1 px-2 pt-2"><button onClick={onBack} className="p-1.5"><ArrowLeft size={14} color={SLATE} /></button><div className="flex flex-1 gap-0.5 p-1 rounded-lg" style={{ backgroundColor: MIST }}>{tabs.map((tab) => <button key={tab.id} onClick={() => { setSettingsTab(tab.id); setSelectedHistory(null); }} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-md" style={{ backgroundColor: settingsTab === tab.id ? "#fff" : "transparent", boxShadow: settingsTab === tab.id ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}><tab.icon size={13} color={settingsTab === tab.id ? TEAL : SLATE} /><span className="text-[8.5px] font-semibold" style={{ color: settingsTab === tab.id ? TEAL : SLATE }}>{tab.label}</span></button>)}</div></div><div className="flex-1 p-4 overflow-y-auto" style={{ minHeight: 420 }}>
    {templateDelete && <DeleteTemplateModal templateName={templateDelete} onCancel={() => setTemplateDelete(null)} onConfirm={() => void confirmTemplateDelete()} />}
    {settingsTab === "ai" && <div className="space-y-3.5">
      <div className="rounded-lg p-2 text-[10.5px] font-semibold" style={{ color: activeAiStatus.includes("aktif") ? TEAL : SLATE, backgroundColor: MIST }}>{activeAiStatus || "Memeriksa API key aktif..."}</div>
      <label className="text-[10.5px] font-semibold" style={{ color: SLATE }}>Sumber API key</label>
      <div className="grid grid-cols-2 gap-2">{(["admin", "personal"] as const).map((source) => <button key={source} onClick={() => void saveConfig({ ...aiConfig, source })} className="rounded-lg px-2 py-2 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98]" style={{ backgroundColor: aiConfig.source === source ? TEAL_SOFT : MIST, color: aiConfig.source === source ? TEAL : SLATE, border: "1.5px solid " + (aiConfig.source === source ? TEAL : "transparent") }}>{source === "admin" ? "Admin" : "Pribadi"}</button>)}</div>
      {aiConfig.source === "admin" ? <div className="space-y-3">
        {activeAdminUser ? <><PanelButton className="w-full" icon={ShieldCheck}>Admin aktif: {activeAdminUser}</PanelButton><PanelButton onClick={logoutAdminAccess} variant="ghost" className="w-full">Logout</PanelButton></> : <><p className="rounded-lg p-2 text-[10.5px]" style={{ color: SLATE, backgroundColor: MIST }}>{adminStatus || "Login akses admin untuk memakai API key pusat."}</p><Field icon={KeyRound} label="Username user admin" value={adminUsername} onChange={setAdminUsername} /><div><label className="text-[10.5px] font-semibold flex items-center gap-1" style={{ color: SLATE }}><KeyRound size={11} /> Password user admin</label><div className="flex items-center gap-2 mt-1.5 rounded-lg px-3 py-2.5" style={{ border: "1.5px solid " + MIST_DARK }}><input aria-label="Password user admin" type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="text-[12px] flex-1 outline-none bg-transparent" placeholder="Password" /></div></div><PanelButton onClick={loginAdminAccess} className="w-full" icon={ShieldCheck}>{testStatus === "testing" ? "Memeriksa..." : "Login Admin"}</PanelButton></>}
        <PanelButton onClick={runTest} variant="ghost" className="w-full" icon={testStatus === "testing" ? RefreshCw : ShieldCheck}>{testStatus === "testing" ? "Menguji koneksi..." : testStatus === "success" ? "Terhubung" : testStatus === "error" ? "Gagal terhubung" : "Uji Koneksi"}</PanelButton>
        <details className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}>
          <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: INK }}>Panel Admin API Key</summary>
          <div className="mt-3 space-y-2.5">
            <Field icon={KeyRound} label="Username admin" value={adminBackendUser} onChange={setAdminBackendUser} />
            <div><label className="text-[10.5px] font-semibold flex items-center gap-1" style={{ color: SLATE }}><KeyRound size={11} /> Password admin</label><div className="flex items-center gap-2 mt-1.5 rounded-lg px-3 py-2.5 bg-white" style={{ border: "1.5px solid " + MIST_DARK }}><input aria-label="Password admin" type="password" value={adminBackendPassword} onChange={(event) => setAdminBackendPassword(event.target.value)} className="text-[12px] flex-1 outline-none bg-transparent" /></div></div>
            {adminAiStatus && <p className="rounded-lg p-2 text-[10.5px]" style={{ color: SLATE, backgroundColor: "#fff" }}>{adminAiStatus}</p>}
            <PanelButton onClick={() => void openAdminModal()} className="w-full" icon={ShieldCheck}>Masuk Admin</PanelButton>
          </div>
        </details>      </div> : <div className="space-y-3.5">
        <label className="text-[10.5px] font-semibold" style={{ color: SLATE }}>Provider personal</label>
        <div className="flex gap-2">{(["anthropic", "openai-compatible"] as const).map((provider) => <button key={provider} onClick={() => { if (provider !== aiConfig.provider) void saveConfig({ ...aiConfig, provider, ...PERSONAL_PROVIDER_DEFAULTS[provider] }); }} className="flex-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98]" style={{ backgroundColor: aiConfig.provider === provider ? TEAL_SOFT : MIST, color: aiConfig.provider === provider ? TEAL : SLATE, border: "1.5px solid " + (aiConfig.provider === provider ? TEAL : "transparent") }}>{provider === "anthropic" ? "Anthropic" : "OpenAI-compatible"}</button>)}</div>
        <Field icon={Server} label="Endpoint URL" value={aiConfig.endpoint} onChange={(value) => void saveConfig({ ...aiConfig, endpoint: value })} />
        <Field icon={Bot} label="Model" value={aiConfig.model} onChange={(value) => void saveConfig({ ...aiConfig, model: value })} hasChevron />
        <div><label className="text-[10.5px] font-semibold flex items-center gap-1" style={{ color: SLATE }}><KeyRound size={11} /> API Key</label><div className="flex items-center gap-2 mt-1.5 rounded-lg px-3 py-2.5" style={{ border: "1.5px solid " + MIST_DARK }}><input aria-label="API Key" type={showKey ? "text" : "password"} value={showKey ? aiConfig.apiKey : maskedKey} onChange={(event) => void saveConfig({ ...aiConfig, apiKey: event.target.value })} onFocus={() => setShowKey(true)} className="text-[12px] font-mono flex-1 outline-none bg-transparent" placeholder="sk-..." /><button onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} color={SLATE} /> : <Eye size={14} color={SLATE} />}</button></div></div>
        <PanelButton onClick={runTest} className="w-full" icon={testStatus === "testing" ? RefreshCw : ShieldCheck}>{testStatus === "testing" ? "Menguji koneksi..." : testStatus === "success" ? "Terhubung" : testStatus === "error" ? "Gagal terhubung" : "Uji Koneksi"}</PanelButton>
        {testStatus !== "idle" && testStatus !== "testing" && <p role="status" className="rounded-lg p-2 text-[10.5px] leading-relaxed" style={{ color: testStatus === "success" ? TEAL : "#93000a", backgroundColor: testStatus === "success" ? TEAL_SOFT : "#ffdad6" }}>{adminStatus}</p>}
      </div>}
    </div>}
    {settingsTab === "kb" && <div className="space-y-4"><LibraryScopeTabs active={knowledgeLibraryTab} mineLabel="Knowledge Saya" sharedLabel="Knowledge Bersama" onChange={(tab) => { setKnowledgeLibraryTab(tab); setKnowledgeQuery(""); }} /><div className={knowledgeLibraryTab === "shared" ? "block" : "hidden"}><SharedKnowledgeLibrary chunks={filteredSharedKnowledgeChunks} disabledIds={disabledSharedKnowledge} onToggle={toggleSharedKnowledge} query={knowledgeQuery} setQuery={setKnowledgeQuery} status={libraryStatus} /></div><div className={knowledgeLibraryTab === "mine" ? "space-y-3" : "hidden"}><p className="text-[11px]" style={{ color: SLATE }}>Upload dokumen knowledge akan diproses AI menjadi draft chunk, atau tulis manual. Saat generate kasus hanya chunk relevan yang dikirim ke AI.</p><SharedLibrarySearch value={knowledgeQuery} onChange={setKnowledgeQuery} placeholder="Cari knowledge saya..." /><div className="grid grid-cols-2 gap-2"><PanelButton onClick={() => setManualOpen(true)} icon={Plus}>Tulis Manual</PanelButton><PanelButton onClick={() => void submitLocalKnowledgeForReview()} variant="ghost" icon={Upload}>Ajukan ke Admin</PanelButton></div><div className="flex gap-2"><label className="flex-1"><input type="file" accept="application/pdf,text/plain,.txt,.md" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadKnowledge(file).catch((error) => setKnowledgeStatus(error instanceof Error ? error.message : "Knowledge gagal diproses.")); }} /><span className="flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold px-3.5 py-2.5" style={{ color: INK, border: `1.5px solid ${MIST_DARK}` }}><Upload size={14} />Upload & Chunk</span></label><PanelButton variant="ghost" className="flex-1" icon={Trash2} disabled={!knowledgeChunks.length} onClick={() => setKnowledgeDelete({ id: "*", label: `${knowledgeChunks.length} knowledge chunk` })}>Hapus Chunk</PanelButton></div>{knowledgeStatus && <p className="text-[10.5px] rounded-lg p-2" style={{ color: SLATE, backgroundColor: MIST }}>{knowledgeStatus}</p>}{draftChunks.length > 0 && <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold" style={{ color: SLATE }}>Draft chunk, review dulu</p><PanelButton onClick={confirmDraftChunks} className="px-2 py-1 text-[11px]">Simpan</PanelButton></div>{draftChunks.map((chunk) => <KnowledgeChunkCard key={chunk.id} chunk={chunk} onChange={(patch) => updateDraftChunk(chunk.id, patch)} onRemove={() => removeDraftChunk(chunk.id)} />)}</div>}<p className="text-[10.5px]" style={{ color: SLATE }}>{knowledgeChunks.filter((chunk) => chunk.active).length} chunk aktif dari {knowledgeChunks.length} total.</p><div className="space-y-2">{filteredKnowledgeChunks.map((chunk) => <KnowledgeChunkCard key={chunk.id} chunk={chunk} onChange={(patch) => updateSavedChunk(chunk.id, patch)} onRemove={() => setKnowledgeDelete({ id: chunk.id, label: chunk.title || chunk.source || "Tanpa judul" })} />)}{!filteredKnowledgeChunks.length && <p className="text-[10.5px]" style={{ color: SLATE }}>Belum ada chunk yang cocok.</p>}</div>{manualOpen && <ManualKnowledgeModal chunk={manualChunk} onChange={(patch) => setManualChunk({ ...manualChunk, ...patch })} onReset={() => setManualChunk(createEmptyManualChunk())} onClose={() => setManualOpen(false)} onSave={addManualChunk} />}{knowledgeDelete && <DeleteKnowledgeModal label={knowledgeDelete.label} all={knowledgeDelete.id === "*"} onCancel={() => setKnowledgeDelete(null)} onConfirm={() => void confirmKnowledgeDelete()} />}</div></div>}
    {settingsTab === "template" && <div className="space-y-4"><LibraryScopeTabs active={templateLibraryTab} mineLabel="Template Saya" sharedLabel="Template Bersama" onChange={(tab) => { setTemplateLibraryTab(tab); setTemplateQuery(""); }} /><div className={templateLibraryTab === "shared" ? "block" : "hidden"}><SharedTemplateLibrary templates={filteredSharedTemplates} disabledIds={disabledSharedTemplates} onToggle={toggleSharedTemplate} query={templateQuery} setQuery={setTemplateQuery} status={libraryStatus} /></div><div className={templateLibraryTab === "mine" ? "space-y-3" : "hidden"}><p className="text-[11px]" style={{ color: SLATE }}>Buat template berdasarkan kata kunci untuk mengatur format dan gaya jawaban pending sesuai kebutuhan.</p><SharedLibrarySearch value={templateQuery} onChange={setTemplateQuery} placeholder="Cari template saya..." /><div className="grid grid-cols-2 gap-2"><PanelButton icon={Plus} onClick={() => setTemplateOpen(true)}>Tambah Template</PanelButton><PanelButton onClick={() => void submitLocalTemplatesForReview()} variant="ghost" icon={Upload}>Ajukan ke Admin</PanelButton></div>{knowledgeStatus && <p className="text-[10.5px] rounded-lg p-2" style={{ color: SLATE, backgroundColor: MIST }}>{knowledgeStatus}</p>}{filteredTemplates.map((template) => <div key={template.keyword} className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><button onClick={() => setExpandedTemplate(expandedTemplate === template.keyword ? "" : template.keyword)} className="w-full flex items-center gap-2 text-left"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>{template.keyword}</span><p className="text-[10.5px] flex-1 truncate" style={{ color: SLATE }}>{template.note || template.instruction.slice(0, 72)}</p><ChevronDown size={13} color={SLATE} /></button>{expandedTemplate === template.keyword && <div className="mt-2 space-y-2">{editingTemplate?.keyword === template.keyword ? <><input value={editingTemplate.keyword} onChange={(event) => setEditingTemplate({ ...editingTemplate, keyword: event.target.value })} className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" /><textarea value={editingTemplate.instruction} onChange={(event) => setEditingTemplate({ ...editingTemplate, note: event.target.value.slice(0, 80), instruction: event.target.value })} rows={4} className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none resize-none" /><div className="flex gap-2"><PanelButton className="flex-1" onClick={() => saveTemplate(editingTemplate)}>Simpan</PanelButton><PanelButton className="flex-1" variant="ghost" onClick={() => setEditingTemplate(null)}>Batal</PanelButton></div></> : <><p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: INK }}>{template.instruction}</p><div className="flex gap-2"><PanelButton className="flex-1" variant="ghost" onClick={() => setEditingTemplate(template)}>Edit</PanelButton><PanelButton className="flex-1" variant="ghost" icon={Trash2} onClick={() => void removeTemplate(template.keyword)}>Hapus</PanelButton></div></>}</div>}</div>)}{!filteredTemplates.length && <p className="text-[11px]" style={{ color: SLATE }}>Template tidak ditemukan.</p>}{templateOpen && <TemplateModal draft={draft} setDraft={setDraft} onClose={() => setTemplateOpen(false)} onSave={addTemplate} />}</div></div>}
    {settingsTab === "history" && <div className="space-y-3">{selectedHistory ? <HistoryDetail entry={selectedHistory} onBack={() => setSelectedHistory(null)} /> : <><div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: MIST }}><Search size={13} color={SLATE} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="text-[11px] flex-1 bg-transparent outline-none" style={{ color: INK }} placeholder="Cari kasus..." /></div>{filteredHistory.map((entry) => <div key={entry.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm" style={{ backgroundColor: MIST }}><button onClick={() => setSelectedHistory(entry)} className="flex flex-1 items-center gap-2.5 text-left min-w-0"><ClipboardList size={14} color={WORKFLOWS[entry.workflow].accent} /><div className="flex-1 min-w-0"><p className="text-[11px] font-medium truncate" style={{ color: INK }}>{entry.inputReference}</p><p className="text-[9.5px]" style={{ color: SLATE }}>{new Date(entry.timestamp).toLocaleString("id-ID")}</p></div></button><button aria-label="Hapus riwayat" onClick={() => void deleteHistoryEntry(entry.id)} className="rounded-md p-1.5 transition-all hover:bg-white active:scale-[0.95]"><Trash2 size={14} color={SLATE} /></button></div>)}{!filteredHistory.length && <p className="text-[11px]" style={{ color: SLATE }}>Belum ada riwayat yang cocok.</p>}<p className="text-[10px] flex items-center gap-1" style={{ color: SLATE }}><ShieldCheck size={11} /> Setiap kasus tercatat sebagai log audit.</p></>}</div>}
  </div>{adminModalOpen && <AdminKeyModal draft={adminAiDraft} setDraft={setAdminAiDraft} providers={adminProviders} users={adminUsers} reviews={claimReviews} library={claimAdminLibrary} userDraft={adminUserDraft} setUserDraft={setAdminUserDraft} status={adminAiStatus} onClose={() => setAdminModalOpen(false)} onSave={(validate) => void saveAdminKey(validate)} onReset={() => void resetAdminKey()} onAddUser={() => void addAdminUser()} onResetUser={() => void resetAdminUserPassword()} onDeleteUser={(username) => void removeAdminUser(username)} onReview={(resourceType, id, decision) => void reviewClaimItem(resourceType, id, decision)} onManage={manageClaimItem} />}</div>;
}

function createEmptyManualChunk(): KnowledgeChunk {
  return { id: crypto.randomUUID(), title: "", source: "Manual", keywords: [], content: "", active: true };
}

function LibraryScopeTabs({ active, mineLabel, sharedLabel, onChange }: { active: "mine" | "shared"; mineLabel: string; sharedLabel: string; onChange: (tab: "mine" | "shared") => void }) {
  return <div className="grid grid-cols-2 border-b" style={{ borderColor: MIST_DARK }} role="tablist" aria-label="Pilih koleksi">{([['mine', mineLabel], ['shared', sharedLabel]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => onChange(id)} className="relative min-h-11 px-2 py-2 text-[11px] transition-colors" style={{ color: active === id ? INK : SLATE, fontWeight: active === id ? 700 : 500 }}>{label}{active === id && <span className="absolute inset-x-2 bottom-0 h-0.5" style={{ backgroundColor: TEAL }} />}</button>)}</div>;
}

function SharedUseToggle({ kind, enabled, onToggle }: { kind: "Knowledge" | "Template"; enabled: boolean; onToggle: () => void }) {
  const label = `${kind} ${enabled ? "digunakan" : "tidak digunakan"}`;
  return <div className="group relative shrink-0"><button type="button" aria-pressed={enabled} aria-label={label} title={label} onClick={onToggle} className="flex h-11 w-11 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2" style={{ color: enabled ? TEAL : SLATE, backgroundColor: enabled ? TEAL_SOFT : "#fff", border: `1px solid ${enabled ? TEAL : MIST_DARK}` }}>{enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button><span role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-max max-w-48 rounded-md px-2 py-1 text-[9.5px] font-medium text-white shadow-lg group-hover:block group-focus-within:block" style={{ backgroundColor: INK }}>{label}</span></div>;
}

function SharedLibrarySearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2" style={{ border: `1px solid ${MIST_DARK}` }}><Search size={13} color={SLATE} /><input aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" style={{ color: INK }} placeholder={placeholder} /></div>;
}

function SharedKnowledgeLibrary({ chunks, disabledIds, onToggle, query, setQuery, status }: { chunks: KnowledgeChunk[]; disabledIds: string[]; onToggle: (id: string) => void; query: string; setQuery: (value: string) => void; status: string }) {
  return <section className="space-y-2.5" aria-label="Knowledge Bersama"><p className="text-[10px]" style={{ color: SLATE }}>Read-only, telah disetujui admin</p><SharedLibrarySearch value={query} onChange={setQuery} placeholder="Cari knowledge bersama atau milik saya..." /><p className="rounded-lg p-2 text-[10.5px]" style={{ color: SLATE, backgroundColor: MIST }}>{status || "Login dengan akses API admin untuk melihat library bersama."}</p><div className="space-y-2">{chunks.map((chunk) => <div key={chunk.id} className="flex items-start gap-1 rounded-lg p-2.5" style={{ backgroundColor: MIST }}><details className="min-w-0 flex-1"><summary className="cursor-pointer list-none"><div className="flex min-h-11 items-center gap-2"><Layers size={13} color={TEAL} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold" style={{ color: INK }}>{chunk.title || "Tanpa judul"}</p><p className="truncate text-[9.5px]" style={{ color: SLATE }}>{chunk.source}{chunk.keywords.length ? ` · ${chunk.keywords.join(", ")}` : ""}</p></div><ChevronDown size={13} color={SLATE} /></div></summary><p className="mt-2 whitespace-pre-wrap border-t pt-2 text-[10.5px] leading-relaxed" style={{ color: INK, borderColor: MIST_DARK }}>{chunk.content}</p></details><SharedUseToggle kind="Knowledge" enabled={!disabledIds.includes(chunk.id)} onToggle={() => onToggle(chunk.id)} /></div>)}{!chunks.length && <p className="text-[10.5px]" style={{ color: SLATE }}>Belum ada knowledge bersama yang cocok.</p>}</div></section>;
}

function SharedTemplateLibrary({ templates, disabledIds, onToggle, query, setQuery, status }: { templates: Template[]; disabledIds: string[]; onToggle: (id: string) => void; query: string; setQuery: (value: string) => void; status: string }) {
  return <section className="space-y-2.5" aria-label="Template Bersama"><p className="text-[10px]" style={{ color: SLATE }}>Read-only, telah disetujui admin</p><SharedLibrarySearch value={query} onChange={setQuery} placeholder="Cari template bersama atau milik saya..." /><p className="rounded-lg p-2 text-[10.5px]" style={{ color: SLATE, backgroundColor: MIST }}>{status || "Login dengan akses API admin untuk melihat library bersama."}</p><div className="space-y-2">{templates.map((template) => <div key={template.sharedId || template.keyword} className="flex items-start gap-1 rounded-lg p-2.5" style={{ backgroundColor: MIST }}><details className="min-w-0 flex-1"><summary className="cursor-pointer list-none"><div className="flex min-h-11 items-center gap-2"><span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>{template.keyword}</span><p className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: SLATE }}>{template.note || template.instruction.slice(0, 72)}</p><ChevronDown size={13} color={SLATE} /></div></summary><p className="mt-2 whitespace-pre-wrap border-t pt-2 text-[10.5px] leading-relaxed" style={{ color: INK, borderColor: MIST_DARK }}>{template.instruction}</p></details>{template.sharedId && <SharedUseToggle kind="Template" enabled={!disabledIds.includes(template.sharedId)} onToggle={() => onToggle(template.sharedId!)} />}</div>)}{!templates.length && <p className="text-[10.5px]" style={{ color: SLATE }}>Belum ada template bersama yang cocok.</p>}</div></section>;
}

function AdminKeyModal({ draft, setDraft, providers, users, reviews, library, userDraft, setUserDraft, status, onClose, onSave, onReset, onAddUser, onResetUser, onDeleteUser, onReview, onManage }: { draft: AdminAiDraft; setDraft: (draft: AdminAiDraft) => void; providers: AdminAiProviderMeta[]; users: AdminAccessUser[]; reviews: { knowledge: ClaimKnowledgeEntry[]; templates: ClaimTemplateEntry[] }; library: { knowledge: ClaimKnowledgeEntry[]; templates: ClaimTemplateEntry[] }; userDraft: { username: string; password: string; resetUsername: string; resetPassword: string }; setUserDraft: (draft: { username: string; password: string; resetUsername: string; resetPassword: string }) => void; status: string; onClose: () => void; onSave: (validate: boolean) => void; onReset: () => void; onAddUser: () => void; onResetUser: () => void; onDeleteUser: (username: string) => void; onReview: (resourceType: "knowledge" | "template", id: string, decision: "approved" | "rejected") => void; onManage: (resourceType: "knowledge" | "template", operation: "save" | "set_active" | "delete", input?: { id?: string; item?: Record<string, unknown>; active?: boolean }) => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<"knowledge" | "template" | "users" | "apikey">("knowledge");
  const [libraryView, setLibraryView] = useState<"library" | "pending">("library");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [knowledgeDraft, setKnowledgeDraft] = useState<ClaimKnowledgeEntry | null>(null);
  const [templateDraft, setTemplateDraft] = useState<ClaimTemplateEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ resourceType: "knowledge" | "template"; id: string; label: string } | null>(null);
  const tabs = [
    { id: "knowledge" as const, label: "Knowledge", icon: Layers },
    { id: "template" as const, label: "Template", icon: Tag },
    { id: "users" as const, label: "User", icon: Users },
    { id: "apikey" as const, label: "API Key", icon: KeyRound },
  ];
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const filteredKnowledge = library.knowledge.filter((item) => `${item.title} ${item.category || ""} ${item.source_name || ""} ${item.keywords.join(" ")} ${item.content}`.toLocaleLowerCase("id-ID").includes(libraryQuery.toLocaleLowerCase("id-ID")));
  const filteredAdminTemplates = library.templates.filter((item) => `${item.keyword} ${item.note || ""} ${item.instruction}`.toLocaleLowerCase("id-ID").includes(libraryQuery.toLocaleLowerCase("id-ID")));

  function selectAdminTab(tab: typeof activeTab) {
    setActiveTab(tab);
    setLibraryView("library");
    setLibraryQuery("");
    setKnowledgeDraft(null);
    setTemplateDraft(null);
  }

  async function saveKnowledgeDraft() {
    if (!knowledgeDraft?.title.trim() || !knowledgeDraft.content.trim()) return;
    try {
      await onManage("knowledge", "save", { id: knowledgeDraft.id || undefined, item: { ...knowledgeDraft } });
      setKnowledgeDraft(null);
    } catch {
      // Parent keeps the status message; leave the editor open for correction.
    }
  }

  async function saveTemplateDraft() {
    if (!templateDraft?.keyword.trim() || !templateDraft.instruction.trim()) return;
    try {
      await onManage("template", "save", { id: templateDraft.id || undefined, item: { ...templateDraft } });
      setTemplateDraft(null);
    } catch {
      // Parent keeps the status message; leave the editor open for correction.
    }
  }

  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-3 pt-8" role="dialog" aria-modal="true" aria-labelledby="admin-panel-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <p id="admin-panel-title" className="text-[12px] font-semibold" style={{ color: INK }}>Panel Admin</p>
        <button aria-label="Tutup modal" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-slate-100"><X size={15} color={SLATE} /></button>
      </div>

      <div className="relative mb-3 grid grid-cols-4 rounded-lg p-1" style={{ backgroundColor: MIST }} role="tablist" aria-label="Menu panel admin">
        <span className="absolute bottom-1 left-1 top-1 rounded-md bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none" style={{ width: "calc((100% - 8px) / 4)", transform: `translateX(${activeIndex * 100}%)` }} />
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} id={`admin-tab-${id}`} role="tab" aria-selected={activeTab === id} aria-controls={`admin-panel-${id}`} onClick={() => selectAdminTab(id)} className="relative z-10 flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[9.5px] font-semibold transition-colors" style={{ color: activeTab === id ? TEAL : SLATE }}><Icon size={13} /><span className="truncate">{label}</span>{(id === "knowledge" ? reviews.knowledge.length : id === "template" ? reviews.templates.length : 0) > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full px-1 text-[8.5px]" style={{ backgroundColor: AMBER_SOFT, color: AMBER }}>{id === "knowledge" ? reviews.knowledge.length : reviews.templates.length}</span>}</button>)}
      </div>

      {activeTab === "knowledge" && <div id="admin-panel-knowledge" role="tabpanel" aria-labelledby="admin-tab-knowledge" className="space-y-2.5">
        <AdminLibraryViewTabs active={libraryView} pending={reviews.knowledge.length} onChange={setLibraryView} />
        {libraryView === "library" ? <>
          <div className="flex gap-2"><div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-3" style={{ backgroundColor: MIST }}><Search size={13} color={SLATE} /><input aria-label="Cari knowledge admin" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" placeholder="Cari knowledge..." /></div><button type="button" aria-label="Tambah knowledge bersama" title="Tambah knowledge bersama" onClick={() => setKnowledgeDraft({ id: "", title: "", content: "", category: "", keywords: [], source_name: "", status: "approved", active: true })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: TEAL }}><Plus size={16} /></button></div>
          {knowledgeDraft && <AdminKnowledgeEditor item={knowledgeDraft} onChange={setKnowledgeDraft} onCancel={() => setKnowledgeDraft(null)} onSave={() => void saveKnowledgeDraft()} />}
          <div className="space-y-2">{filteredKnowledge.map((item) => <AdminLibraryRow key={item.id} label={item.title} detail={item.category || item.source_name || "Knowledge bersama"} content={item.content} active={item.active !== false} onEdit={() => setKnowledgeDraft({ ...item })} onToggle={() => void onManage("knowledge", "set_active", { id: item.id, active: item.active === false }).catch(() => undefined)} onDelete={() => setDeleteTarget({ resourceType: "knowledge", id: item.id, label: item.title })} />)}{!filteredKnowledge.length && <p className="py-3 text-center text-[10.5px]" style={{ color: SLATE }}>Belum ada knowledge bersama yang cocok.</p>}</div>
        </> : <div className="space-y-2">{reviews.knowledge.map((item) => <ClaimReviewRow key={item.id} label={item.title} detail={`Knowledge oleh ${item.submitted_by}`} content={item.content} onApprove={() => onReview("knowledge", item.id, "approved")} onReject={() => onReview("knowledge", item.id, "rejected")} />)}{!reviews.knowledge.length && <p className="py-3 text-center text-[10.5px]" style={{ color: SLATE }}>Tidak ada pengajuan knowledge.</p>}</div>}
      </div>}

      {activeTab === "template" && <div id="admin-panel-template" role="tabpanel" aria-labelledby="admin-tab-template" className="space-y-2.5">
        <AdminLibraryViewTabs active={libraryView} pending={reviews.templates.length} onChange={setLibraryView} />
        {libraryView === "library" ? <>
          <div className="flex gap-2"><div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-3" style={{ backgroundColor: MIST }}><Search size={13} color={SLATE} /><input aria-label="Cari template admin" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" placeholder="Cari template..." /></div><button type="button" aria-label="Tambah template bersama" title="Tambah template bersama" onClick={() => setTemplateDraft({ id: "", keyword: "", note: "", instruction: "", status: "approved", active: true })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: TEAL }}><Plus size={16} /></button></div>
          {templateDraft && <AdminTemplateEditor item={templateDraft} onChange={setTemplateDraft} onCancel={() => setTemplateDraft(null)} onSave={() => void saveTemplateDraft()} />}
          <div className="space-y-2">{filteredAdminTemplates.map((item) => <AdminLibraryRow key={item.id} label={item.keyword} detail={item.note || "Template bersama"} content={item.instruction} active={item.active !== false} onEdit={() => setTemplateDraft({ ...item })} onToggle={() => void onManage("template", "set_active", { id: item.id, active: item.active === false }).catch(() => undefined)} onDelete={() => setDeleteTarget({ resourceType: "template", id: item.id, label: item.keyword })} />)}{!filteredAdminTemplates.length && <p className="py-3 text-center text-[10.5px]" style={{ color: SLATE }}>Belum ada template bersama yang cocok.</p>}</div>
        </> : <div className="space-y-2">{reviews.templates.map((item) => <ClaimReviewRow key={item.id} label={item.keyword} detail={`Template oleh ${item.submitted_by}`} content={item.instruction} onApprove={() => onReview("template", item.id, "approved")} onReject={() => onReview("template", item.id, "rejected")} />)}{!reviews.templates.length && <p className="py-3 text-center text-[10.5px]" style={{ color: SLATE }}>Tidak ada pengajuan template.</p>}</div>}
      </div>}

      {activeTab === "users" && <div id="admin-panel-users" role="tabpanel" aria-labelledby="admin-tab-users" className="space-y-2 rounded-lg p-2.5" style={{ backgroundColor: MIST }}>
        <p className="text-[11px] font-semibold" style={{ color: SLATE }}>Kelola user akses admin</p>
        <input aria-label="Username baru" value={userDraft.username} onChange={(event) => setUserDraft({ ...userDraft, username: event.target.value })} className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none" style={{ border: "1.5px solid " + MIST_DARK }} placeholder="Username baru" />
        <input aria-label="Password user baru" type="password" value={userDraft.password} onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })} className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none" style={{ border: "1.5px solid " + MIST_DARK }} placeholder="Password baru" />
        <PanelButton onClick={onAddUser} className="w-full" icon={Plus}>Tambah User</PanelButton>
        <div className="space-y-1.5">{users.map((user) => <div key={user.username} className="flex items-center gap-2 rounded-lg bg-white p-2"><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold" style={{ color: INK }}>{user.username}</p><p className="text-[9.5px]" style={{ color: SLATE }}>{user.hasActiveDevice ? "Device aktif" : "Belum aktif"}</p></div><button onClick={() => setUserDraft({ ...userDraft, resetUsername: user.username, resetPassword: "" })} className="flex min-h-11 items-center px-1 text-[10px] font-semibold" style={{ color: TEAL }}>Reset</button><button aria-label={'Hapus ' + user.username} onClick={() => onDeleteUser(user.username)} className="flex h-11 w-11 items-center justify-center"><Trash2 size={13} color={SLATE} /></button></div>)}{!users.length && <p className="text-[10.5px]" style={{ color: SLATE }}>Belum ada user.</p>}</div>
        {userDraft.resetUsername && <div className="space-y-2 rounded-lg bg-white p-2"><p className="text-[10.5px] font-semibold" style={{ color: SLATE }}>Reset password: {userDraft.resetUsername}</p><input aria-label={`Password baru untuk ${userDraft.resetUsername}`} type="password" value={userDraft.resetPassword} onChange={(event) => setUserDraft({ ...userDraft, resetPassword: event.target.value })} className="w-full rounded-lg px-3 py-2.5 text-[12px] outline-none" style={{ border: "1.5px solid " + MIST_DARK }} placeholder="Password baru" /><PanelButton onClick={onResetUser} className="w-full">Simpan Password</PanelButton></div>}
      </div>}

      {activeTab === "apikey" && <div id="admin-panel-apikey" role="tabpanel" aria-labelledby="admin-tab-apikey" className="space-y-2 rounded-lg p-2.5" style={{ backgroundColor: MIST }}>
        <p className="text-[11px] font-semibold" style={{ color: SLATE }}>Konfigurasi API key admin</p>
        <div><label className="text-[10.5px] font-semibold" style={{ color: SLATE }}>Provider</label><select value={draft.provider} onChange={(event) => { const provider = event.target.value; const meta = providers.find((item) => item.provider === provider); setDraft({ ...draft, provider, provider_label: provider === "custom" ? "" : (meta?.providerLabel || getAdminProviderLabel(provider)), base_url: meta?.baseUrl || "", model: meta?.model || (provider === "gemini" ? "gemini-2.0-flash" : draft.model), api_key: "" }); }} className="mt-1.5 w-full rounded-lg bg-white px-3 py-2.5 text-[12px] outline-none" style={{ border: "1.5px solid " + MIST_DARK }}>{ADMIN_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        {draft.provider === "custom" && <Field icon={Tag} label="Nama provider custom" value={draft.provider_label} onChange={(value) => setDraft({ ...draft, provider_label: value })} />}
        {draft.provider !== "gemini" && <Field icon={Server} label="Endpoint URL" value={draft.base_url} onChange={(value) => setDraft({ ...draft, base_url: value })} />}
        <Field icon={Bot} label="Model" value={draft.model} onChange={(value) => setDraft({ ...draft, model: value })} />
        <div><label className="flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: SLATE }}><KeyRound size={11} /> API key baru</label><div className="mt-1.5 flex items-center gap-2 rounded-lg bg-white px-3 py-2.5" style={{ border: "1.5px solid " + MIST_DARK }}><input aria-label="API key admin baru" type="password" value={draft.api_key} onChange={(event) => setDraft({ ...draft, api_key: event.target.value })} className="flex-1 bg-transparent font-mono text-[12px] outline-none" placeholder="Kosongkan untuk memakai key lama" /></div></div>
        <div className="grid grid-cols-2 gap-2"><PanelButton onClick={() => onSave(true)} icon={ShieldCheck}>Validasi & Simpan</PanelButton><PanelButton onClick={() => onSave(false)} variant="ghost">Simpan</PanelButton></div>
        <PanelButton onClick={onReset} variant="ghost" className="w-full" icon={Trash2}>Reset API Key</PanelButton>
      </div>}

      {status && <p role="status" className="mt-3 rounded-lg p-2 text-[10.5px]" style={{ color: SLATE, backgroundColor: MIST }}>{status}</p>}
    </div>
    {deleteTarget && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" role="alertdialog" aria-modal="true" aria-labelledby="admin-delete-title"><div className="w-full max-w-xs rounded-lg bg-white p-4 shadow-xl"><p id="admin-delete-title" className="text-[13px] font-semibold" style={{ color: INK }}>Hapus dari library bersama?</p><p className="mt-1 break-words text-[10.5px] leading-relaxed" style={{ color: SLATE }}>“{deleteTarget.label}” akan dihapus permanen dan tidak lagi tersedia untuk pengguna Claim Clarify.</p><div className="mt-4 grid grid-cols-2 gap-2"><PanelButton variant="ghost" onClick={() => setDeleteTarget(null)} autoFocus>Batal</PanelButton><PanelButton accent="#93000a" icon={Trash2} onClick={() => void onManage(deleteTarget.resourceType, "delete", { id: deleteTarget.id }).then(() => setDeleteTarget(null)).catch(() => undefined)}>Hapus</PanelButton></div></div></div>}
  </div>;
}

function AdminLibraryViewTabs({ active, pending, onChange }: { active: "library" | "pending"; pending: number; onChange: (view: "library" | "pending") => void }) {
  return <div className="flex border-b" style={{ borderColor: MIST_DARK }}><button type="button" onClick={() => onChange("library")} className="relative min-h-11 flex-1 text-[11px] font-semibold" style={{ color: active === "library" ? INK : SLATE }}>Library{active === "library" && <span className="absolute inset-x-3 bottom-0 h-0.5" style={{ backgroundColor: TEAL }} />}</button><button type="button" onClick={() => onChange("pending")} className="relative min-h-11 flex-1 text-[11px] font-semibold" style={{ color: active === "pending" ? INK : SLATE }}>Pengajuan {pending > 0 ? `(${pending})` : ""}{active === "pending" && <span className="absolute inset-x-3 bottom-0 h-0.5" style={{ backgroundColor: TEAL }} />}</button></div>;
}

function AdminLibraryRow({ label, detail, content, active, onEdit, onToggle, onDelete }: { label: string; detail: string; content: string; active: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return <div className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><div className="flex items-start gap-2"><details className="min-w-0 flex-1"><summary className="cursor-pointer list-none"><p className="truncate text-[11px] font-semibold" style={{ color: INK }}>{label}</p><p className="truncate text-[9.5px]" style={{ color: active ? TEAL : SLATE }}>{active ? "Aktif" : "Tidak aktif"} · {detail}</p></summary><p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap border-t pt-2 text-[10.5px] leading-relaxed" style={{ color: INK, borderColor: MIST_DARK }}>{content}</p></details><button type="button" aria-label={active ? `Nonaktifkan ${label}` : `Aktifkan ${label}`} title={active ? "Nonaktifkan" : "Aktifkan"} onClick={onToggle} className="flex h-11 w-9 shrink-0 items-center justify-center">{active ? <Eye size={14} color={TEAL} /> : <EyeOff size={14} color={SLATE} />}</button><button type="button" aria-label={`Edit ${label}`} title="Edit" onClick={onEdit} className="flex h-11 w-9 shrink-0 items-center justify-center"><Pencil size={14} color={SLATE} /></button><button type="button" aria-label={`Hapus ${label}`} title="Hapus" onClick={onDelete} className="flex h-11 w-9 shrink-0 items-center justify-center"><Trash2 size={14} color="#93000a" /></button></div></div>;
}

function AdminKnowledgeEditor({ item, onChange, onCancel, onSave }: { item: ClaimKnowledgeEntry; onChange: (item: ClaimKnowledgeEntry) => void; onCancel: () => void; onSave: () => void }) {
  const [keywordText, setKeywordText] = useState(item.keywords.join(", "));
  useEffect(() => setKeywordText(item.keywords.join(", ")), [item.id]);
  return <div className="space-y-2 border-y py-3" style={{ borderColor: MIST_DARK }}><p className="text-[11px] font-semibold" style={{ color: INK }}>{item.id ? "Edit knowledge" : "Tambah knowledge"}</p><input aria-label="Judul knowledge admin" value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} className="w-full rounded-lg px-3 py-2.5 text-[11px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Judul" /><div className="grid grid-cols-2 gap-2"><input aria-label="Kategori knowledge admin" value={item.category || ""} onChange={(event) => onChange({ ...item, category: event.target.value })} className="min-w-0 rounded-lg px-3 py-2.5 text-[11px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Kategori" /><input aria-label="Sumber knowledge admin" value={item.source_name || ""} onChange={(event) => onChange({ ...item, source_name: event.target.value })} className="min-w-0 rounded-lg px-3 py-2.5 text-[11px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Sumber" /></div><input aria-label="Keyword knowledge admin" value={keywordText} onChange={(event) => { setKeywordText(event.target.value); onChange({ ...item, keywords: parseKnowledgeKeywords(event.target.value) }); }} className="w-full rounded-lg px-3 py-2.5 text-[11px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Keyword, pisahkan dengan koma" /><textarea aria-label="Isi knowledge admin" value={item.content} onChange={(event) => onChange({ ...item, content: event.target.value })} rows={6} className="w-full resize-y rounded-lg px-3 py-2.5 text-[11px] leading-relaxed outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Isi knowledge" /><label className="flex min-h-11 items-center gap-2 text-[10.5px] font-semibold" style={{ color: SLATE }}><input type="checkbox" checked={item.active !== false} onChange={(event) => onChange({ ...item, active: event.target.checked })} />Langsung aktif untuk pengguna</label><div className="grid grid-cols-2 gap-2"><PanelButton variant="ghost" onClick={onCancel}>Batal</PanelButton><PanelButton onClick={onSave} disabled={!item.title.trim() || !item.content.trim()}>Simpan</PanelButton></div></div>;
}

function AdminTemplateEditor({ item, onChange, onCancel, onSave }: { item: ClaimTemplateEntry; onChange: (item: ClaimTemplateEntry) => void; onCancel: () => void; onSave: () => void }) {
  return <div className="space-y-2 border-y py-3" style={{ borderColor: MIST_DARK }}><p className="text-[11px] font-semibold" style={{ color: INK }}>{item.id ? "Edit template" : "Tambah template"}</p><input aria-label="Keyword template admin" value={item.keyword} onChange={(event) => onChange({ ...item, keyword: event.target.value })} className="w-full rounded-lg px-3 py-2.5 text-[11px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Keyword template" /><input aria-label="Catatan template admin" value={item.note || ""} onChange={(event) => onChange({ ...item, note: event.target.value })} className="w-full rounded-lg px-3 py-2.5 text-[11px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Catatan singkat" /><textarea aria-label="Instruksi template admin" value={item.instruction} onChange={(event) => onChange({ ...item, instruction: event.target.value })} rows={7} className="w-full resize-y rounded-lg px-3 py-2.5 text-[11px] leading-relaxed outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Instruksi template" /><label className="flex min-h-11 items-center gap-2 text-[10.5px] font-semibold" style={{ color: SLATE }}><input type="checkbox" checked={item.active !== false} onChange={(event) => onChange({ ...item, active: event.target.checked })} />Langsung aktif untuk pengguna</label><div className="grid grid-cols-2 gap-2"><PanelButton variant="ghost" onClick={onCancel}>Batal</PanelButton><PanelButton onClick={onSave} disabled={!item.keyword.trim() || !item.instruction.trim()}>Simpan</PanelButton></div></div>;
}

function ClaimReviewRow({ label, detail, content, onApprove, onReject }: { label: string; detail: string; content: string; onApprove: () => void; onReject: () => void }) {
  return <div className="rounded-lg bg-white p-2"><p className="truncate text-[11px] font-semibold" style={{ color: INK }}>{label}</p><p className="text-[9.5px]" style={{ color: SLATE }}>{detail}</p><details className="my-2"><summary className="cursor-pointer text-[10px] font-semibold" style={{ color: TEAL }}>Periksa isi</summary><p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-relaxed" style={{ color: INK }}>{content}</p></details><div className="grid grid-cols-2 gap-2"><PanelButton variant="ghost" onClick={onReject}>Tolak</PanelButton><PanelButton onClick={onApprove} accent={TEAL}>Setujui</PanelButton></div></div>;
}

function TemplateSaveScopeModal({ templateName, onCaseOnly, onPermanent, onClose }: { templateName: string; onCaseOnly: () => void; onPermanent: () => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="template-save-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}><div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"><div className="mb-2 flex items-start justify-between gap-3"><div><p id="template-save-title" className="text-[13px] font-semibold" style={{ color: INK }}>Simpan perubahan template?</p><p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: SLATE }}>Perubahan pada “{templateName}” dapat dipakai hanya untuk kasus ini atau mengganti template tersimpan.</p></div><button aria-label="Tutup" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-slate-100"><X size={15} color={SLATE} /></button></div><div className="mt-3 space-y-2"><PanelButton className="w-full" onClick={onCaseOnly} autoFocus>Hanya Kasus Ini</PanelButton><PanelButton className="w-full" variant="ghost" onClick={onPermanent}>Simpan Permanen</PanelButton></div></div></div>;
}

function DeleteKnowledgeModal({ label, all, onCancel, onConfirm }: { label: string; all: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="delete-knowledge-title" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}><div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"><div className="flex items-start gap-3"><div className="rounded-lg p-2" style={{ backgroundColor: "#ffdad6" }}><Trash2 size={17} color="#93000a" /></div><div className="min-w-0 flex-1"><p id="delete-knowledge-title" className="text-[13px] font-semibold" style={{ color: INK }}>{all ? "Hapus semua knowledge?" : "Hapus knowledge ini?"}</p><p className="mt-1 break-words text-[10.5px] leading-relaxed" style={{ color: SLATE }}>{all ? `${label} akan dihapus permanen dari perangkat ini.` : `“${label}” akan dihapus permanen dari perangkat ini.`}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><PanelButton variant="ghost" onClick={onCancel} autoFocus>Batal</PanelButton><PanelButton accent="#93000a" onClick={onConfirm} icon={Trash2}>Hapus</PanelButton></div></div></div>;
}

function DeleteTemplateModal({ templateName, onCancel, onConfirm }: { templateName: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="delete-template-title" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}><div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"><div className="flex items-start gap-3"><div className="rounded-lg p-2" style={{ backgroundColor: "#ffdad6" }}><Trash2 size={17} color="#93000a" /></div><div className="min-w-0 flex-1"><p id="delete-template-title" className="text-[13px] font-semibold" style={{ color: INK }}>Hapus template ini?</p><p className="mt-1 break-words text-[10.5px] leading-relaxed" style={{ color: SLATE }}>Template "{templateName}" akan dihapus permanen dari perangkat ini.</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><PanelButton variant="ghost" onClick={onCancel} autoFocus>Batal</PanelButton><PanelButton accent="#93000a" onClick={onConfirm} icon={Trash2}>Hapus</PanelButton></div></div></div>;
}

function TemplateModal({ draft, setDraft, onClose, onSave }: { draft: { keyword: string; instruction: string }; setDraft: (draft: { keyword: string; instruction: string }) => void; onClose: () => void; onSave: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-14"><div className="w-full max-w-sm rounded-xl bg-white p-3 shadow-xl"><div className="mb-2 flex items-center justify-between"><p className="text-[12px] font-semibold" style={{ color: INK }}>Tambah Template</p><button aria-label="Tutup modal" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100"><X size={15} color={SLATE} /></button></div><div className="space-y-2"><input value={draft.keyword} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} className="w-full rounded-lg px-3 py-2 text-[12px] outline-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Kata kunci" /><textarea value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} rows={5} className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none" style={{ border: `1.5px solid ${MIST_DARK}` }} placeholder="Instruksi format output" /></div><div className="mt-3 flex gap-2"><PanelButton variant="ghost" className="flex-1" onClick={onClose}>Batal</PanelButton><PanelButton className="flex-1" onClick={onSave}>Simpan</PanelButton></div></div></div>;
}

function ManualKnowledgeModal({ chunk, onChange, onReset, onClose, onSave }: { chunk: KnowledgeChunk; onChange: (patch: Partial<KnowledgeChunk>) => void; onReset: () => void; onClose: () => void; onSave: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-14"><div className="w-full max-w-sm rounded-xl bg-white p-3 shadow-xl"><div className="mb-2 flex items-center justify-between"><p className="text-[12px] font-semibold" style={{ color: INK }}>Tulis Knowledge Manual</p><button aria-label="Tutup modal" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100"><X size={15} color={SLATE} /></button></div><KnowledgeChunkEditor chunk={chunk} onChange={onChange} onRemove={onReset} /><div className="mt-3 flex gap-2"><PanelButton variant="ghost" className="flex-1" onClick={onClose}>Batal</PanelButton><PanelButton className="flex-1" onClick={onSave}>Simpan</PanelButton></div></div></div>;
}

function KnowledgeChunkCard({ chunk, onChange, onRemove, footer }: { chunk: KnowledgeChunk; onChange: (patch: Partial<KnowledgeChunk>) => void; onRemove: () => void; footer?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const preview = chunk.content.length > 92 ? chunk.content.slice(0, 92) + "..." : chunk.content;

  return <div className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 text-left"><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold" style={{ color: INK }}>{chunk.title || "Tanpa judul"}</p><p className="truncate text-[10px]" style={{ color: SLATE }}>{chunk.keywords.slice(0, 4).join(", ") || chunk.source}</p></div><ChevronDown size={13} color={SLATE} className={expanded ? "rotate-180" : ""} /></button>{!expanded && preview && <p className="mt-1 truncate text-[10.5px]" style={{ color: SLATE }}>{preview}</p>}{expanded && <div className="mt-2"><KnowledgeChunkEditor chunk={chunk} onChange={onChange} onRemove={onRemove} /></div>}{footer && <div className="mt-2 border-t pt-2" style={{ borderColor: MIST_DARK }}>{footer}</div>}</div>;
}

function KnowledgeChunkEditor({ chunk, onChange, onRemove }: { chunk: KnowledgeChunk; onChange: (patch: Partial<KnowledgeChunk>) => void; onRemove: () => void }) {
  const [keywordText, setKeywordText] = useState(chunk.keywords.join(", "));
  useEffect(() => setKeywordText(chunk.keywords.join(", ")), [chunk.id]);

  function updateKeywords(value: string) {
    setKeywordText(value);
    onChange({ keywords: parseKnowledgeKeywords(value) });
  }

  return <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: MIST }}><div className="flex items-center gap-2"><input value={chunk.title} onChange={(event) => onChange({ title: event.target.value })} className="flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold outline-none" style={{ color: INK }} placeholder="Judul chunk" /><label className="flex items-center gap-1 text-[10px]" style={{ color: SLATE }}><input type="checkbox" checked={chunk.active} onChange={(event) => onChange({ active: event.target.checked })} />Aktif</label><button aria-label="Hapus chunk" onClick={onRemove}><Trash2 size={13} color={SLATE} /></button></div><input value={chunk.source} onChange={(event) => onChange({ source: event.target.value })} className="w-full rounded-md px-2 py-1.5 text-[10.5px] outline-none" style={{ color: INK }} placeholder="Sumber/bab" /><textarea value={keywordText} onChange={(event) => updateKeywords(event.target.value)} rows={2} className="w-full rounded-md px-2 py-1.5 text-[10.5px] outline-none resize-none" style={{ color: INK }} placeholder="Keyword, pisahkan dengan koma / titik koma / baris baru" /><textarea value={chunk.content} onChange={(event) => onChange({ content: event.target.value })} rows={4} className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none resize-none" style={{ color: INK }} placeholder="Isi knowledge" /></div>;
}

function parseKnowledgeKeywords(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[,;\n]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      if (!keyword) return false;
      const key = keyword.toLocaleLowerCase("id-ID");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function BackupModal({ templates, knowledgeText, knowledgeChunks, history, aiConfig, onImport, onClose }: { templates: Template[]; knowledgeText: string; knowledgeChunks: KnowledgeChunk[]; history: AuditEntry[]; aiConfig: AIConfig; onImport: (file: File) => void; onClose: () => void }) {
  const exportedAiConfig = { source: aiConfig.source, provider: aiConfig.provider, endpoint: aiConfig.endpoint, model: aiConfig.model };
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-14"><div className="w-full max-w-sm rounded-xl bg-white p-3 shadow-xl"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><DatabaseBackup size={16} color={TEAL} /><p className="text-[12px] font-semibold" style={{ color: INK }}>Import / Export Data</p></div><button aria-label="Tutup modal" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100"><X size={15} color={SLATE} /></button></div><div className="space-y-2.5"><div className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><p className="text-[11px] font-semibold" style={{ color: INK }}>Export</p><p className="mb-2 text-[10.5px] leading-relaxed" style={{ color: SLATE }}>Simpan template, knowledge, chunk, riwayat, dan setting AI non-secret ke satu file. API key tidak ikut dibawa.</p><PanelButton className="w-full" icon={Download} onClick={() => downloadJson("claim-clarify-backup.json", { version: 1, exportedAt: new Date().toISOString(), templates, knowledgeText, knowledgeChunks, history, aiConfig: exportedAiConfig })}>Export Data</PanelButton></div><div className="rounded-lg p-2.5" style={{ backgroundColor: MIST }}><p className="text-[11px] font-semibold" style={{ color: INK }}>Import</p><p className="mb-2 text-[10.5px] leading-relaxed" style={{ color: SLATE }}>Pulihkan data dari file backup untuk pindah device. API key tetap perlu diisi/login ulang di device ini.</p><label><input type="file" accept="application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); }} /><span className="flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold px-3.5 py-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm" style={{ color: INK, border: "1.5px solid " + MIST_DARK }}><Upload size={14} />Import Data</span></label></div></div></div></div>;
}

function HistoryDetail({ entry, onBack }: { entry: AuditEntry; onBack: () => void }) {
  return <div className="space-y-3"><button onClick={onBack} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: SLATE }}><ArrowLeft size={12} /> Kembali</button><p className="text-[10px]" style={{ color: SLATE }}>{new Date(entry.timestamp).toLocaleString("id-ID")} · {WORKFLOWS[entry.workflow].label}</p><div className="rounded-lg p-3" style={{ backgroundColor: MIST }}><p className="text-[11px] font-semibold" style={{ color: SLATE }}>Input</p><p className="text-[12px] break-words" style={{ color: INK }}>{entry.inputReference}</p></div><div className="rounded-lg p-3" style={{ backgroundColor: MIST }}><p className="text-[11px] font-semibold" style={{ color: SLATE }}>Ringkasan Kasus</p><p className="text-[12px] leading-relaxed" style={{ color: INK }}>{entry.output.ringkasan}</p></div><div className="rounded-lg p-3" style={{ backgroundColor: "#fff", border: `1.5px solid ${WORKFLOWS[entry.workflow].accent}` }}><div className="flex items-center justify-between mb-1"><p className="text-[11px] font-semibold" style={{ color: SLATE }}>Jawaban Pending</p><button onClick={() => void navigator.clipboard?.writeText(entry.output.jawabanPending)} className="text-[10.5px] font-semibold" style={{ color: WORKFLOWS[entry.workflow].accent }}>Salin</button></div><p className="text-[12px] leading-relaxed" style={{ color: INK }}>{entry.output.jawabanPending}</p></div></div>;
}

function chunkMatches(chunk: KnowledgeChunk, query: string) {
  const wanted = query.trim().toLocaleLowerCase("id-ID");
  if (!wanted) return true;
  return `${chunk.title} ${chunk.source} ${chunk.keywords.join(" ")} ${chunk.content}`.toLocaleLowerCase("id-ID").includes(wanted);
}
function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function Field({ icon: Icon, label, value, onChange, hasChevron }: { icon: LucideIcon; label: string; value: string; onChange: (value: string) => void; hasChevron?: boolean }) {
  return <div><label className="text-[10.5px] font-semibold flex items-center gap-1" style={{ color: SLATE }}><Icon size={11} /> {label}</label><div className="flex items-center gap-2 mt-1.5 rounded-lg px-3 py-2.5" style={{ border: `1.5px solid ${MIST_DARK}` }}><input value={value} onChange={(event) => onChange(event.target.value)} className="text-[12px] flex-1 truncate outline-none bg-transparent" />{hasChevron && <ChevronDown size={14} color={SLATE} />}</div></div>;
}

function PanelButton({ children, onClick, variant = "primary", accent = TEAL, icon: Icon, className = "", disabled = false, autoFocus = false }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost"; accent?: string; icon?: LucideIcon; className?: string; disabled?: boolean; autoFocus?: boolean }) {
  const styles = variant === "primary" ? { backgroundColor: disabled ? MIST_DARK : accent, color: disabled ? SLATE : "#fff", border: "none" } : { backgroundColor: "transparent", color: disabled ? SLATE : INK, border: `1.5px solid ${MIST_DARK}` };
  return <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled} autoFocus={autoFocus} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold px-3.5 py-2.5 transition-all ${disabled ? "cursor-not-allowed" : "hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-[0.98]"} ${className}`} style={styles}>{Icon && <Icon size={14} />}{children}</button>;
}




async function parseActiveTabPdf() {
  if (typeof chrome === "undefined" || !chrome.tabs) throw new Error("Tab aktif hanya tersedia di Chrome Extension.");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error("URL tab aktif tidak terbaca. Reload extension setelah update, lalu pastikan tab PDF sedang aktif.");
  if (tab.url.startsWith("file:") && tab.id !== undefined) {
    try {
      return await parsePdfLink(tab.url);
    } catch (directError) {
      const capturedText = await captureActiveTabPdf(tab.id, tab.url);
      if (capturedText) return capturedText;
      throw directError;
    }
  }
  return parsePdfLink(tab.url);
}

async function parsePdfLink(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol === "file:") {
    await ensureFileUrlAccess();
    return parsePdfUrl(url);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Link harus http, https, atau file PDF lokal dari tab aktif.");
  const permission = { origins: [`${parsed.origin}/*`] };
  if (typeof chrome !== "undefined" && chrome.permissions && !(await chrome.permissions.contains(permission))) {
    const granted = await chrome.permissions.request(permission);
    if (!granted) throw new Error("Izin membaca link PDF ditolak.");
  }
  return parsePdfUrl(url);
}

async function ensureFileUrlAccess() {
  const extensionApi = typeof chrome !== "undefined" ? chrome.extension : undefined;
  if (!extensionApi?.isAllowedFileSchemeAccess) return;
  const allowed = await new Promise<boolean>((resolve) => extensionApi.isAllowedFileSchemeAccess(resolve));
  if (!allowed) throw new Error('Aktifkan "Allow access to file URLs" di chrome://extensions > Claim Clarify > Details, lalu coba lagi.');
}
function formatReadmisiAnalysis(analysis: { likely: boolean; reasons: string[] }) {
  return `Deteksi awal readmisi: ${analysis.likely ? "kemungkinan readmisi" : "perlu konfirmasi"}. Alasan: ${analysis.reasons.join("; ")}.`;
}















