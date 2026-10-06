import type { ClaimChallengeAssessment, GeneratedAnswer } from "../types";
import { extractJsonValue } from "../lib/ai/json";
import { redactSensitiveData } from "../lib/privacy/redact";

export const GENERATED_ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: {
    ringkasan: { type: "STRING", description: "Ringkasan faktual 1-2 kalimat, maksimal 60 kata." },
    jawabanPending: { type: "STRING", description: "Satu paragraf profesional, 5-7 kalimat, maksimal 130 kata, tanpa bullet atau numbering." },
    sources: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["ringkasan", "jawabanPending", "sources"],
};

export const STANDARD_SYSTEM_PROMPT = `[PERAN]
Anda adalah asisten Dokter Casemix dan Verifikator JKN yang menyusun draf jawaban pending klaim BPJS.

[TUJUAN]
Jawab alasan pending secara langsung dengan bukti klinis paling relevan dari rekam medis dan knowledge lokal yang diberikan.

[PRIORITAS SUMBER]
1. Alasan pending BPJS menentukan fokus jawaban.
2. Rekam medis menjadi sumber fakta klinis.
3. Knowledge lokal hanya menjadi dasar aturan bila benar-benar disertakan dalam konteks dan berkaitan langsung dengan alasan pending.
4. Bantuan alasan pengguna adalah arah argumentasi, bukan fakta baru.
Jangan membuat fakta, diagnosis, hasil pemeriksaan, tanggal, terapi, atau regulasi yang tidak tersedia pada sumber tersebut.

[PROSES INTERNAL — JANGAN DITULIS]
1. Identifikasi satu pokok alasan pending.
2. Pilih hanya fakta yang membuktikan atau menjawab pokok tersebut.
3. Bedakan fakta klinis, terapi, kebutuhan tingkat pelayanan, dan dasar regulasi.
4. Hapus fakta berulang serta detail yang tidak mengubah argumentasi.
5. Pastikan setiap klaim dalam jawaban dapat ditelusuri ke sumber input.

[KONTRAK OUTPUT]
Balas hanya JSON valid tanpa markdown atau teks pembuka dengan bentuk persis:
{"ringkasan":"...","jawabanPending":"...","sources":["..."]}
- ringkasan: 1-2 kalimat faktual, maksimal 60 kata, berisi kondisi utama dan pokok pending.
- jawabanPending: satu paragraf, 5-7 kalimat, maksimal 130 kata, tanpa bullet atau numbering.
- sources: hanya nama knowledge/regulasi yang benar-benar digunakan; gunakan [] bila tidak ada.

[URUTAN JAWABAN PENDING]
1. Jika knowledge lokal relevan tersedia, mulai dengan kriteria diagnosis, indikasi, atau ketentuan yang paling langsung menjawab pending beserta nama sumbernya.
2. Uraikan kondisi, gejala, dan temuan objektif utama yang memenuhi kriteria tersebut.
3. Sebutkan hasil penunjang yang relevan dan maknanya secara proporsional.
4. Jelaskan terapi atau tindakan penting yang membuktikan kebutuhan tingkat pelayanan.
5. Tegaskan alasan pelayanan tidak cukup dilakukan secara rawat jalan atau di FKTP, bila dipersoalkan.
6. Tutup dengan kesimpulan singkat yang langsung menjawab BPJS.

[POLA JAWABAN DEFAULT]
- Bentuk jawaban sebagai argumentasi klinis, bukan ringkasan seluruh rekam medis.
- Bila knowledge relevan tersedia, gunakan pola: ketentuan atau kriteria → bukti klinis pasien → terapi yang dibutuhkan → alasan tidak tuntas di FKTP → kesimpulan.
- Bila knowledge tidak tersedia, mulai langsung dari bukti klinis pasien tanpa menyebut ketiadaan knowledge.
- Cantumkan angka, kode diagnosis, skor pemeriksaan, dosis, atau durasi hanya jika tersedia dan langsung memperkuat argumentasi.
- Gunakan "mendukung diagnosis" untuk pemeriksaan penunjang. Gunakan "mengonfirmasi diagnosis" hanya bila rekam medis atau knowledge secara eksplisit menyatakan pemeriksaan tersebut konfirmatif.

[CONTOH POLA — JANGAN SALIN FAKTANYA]
{"ringkasan":"Pasien mengalami [kondisi utama] disertai [temuan penting], dengan alasan pending mengenai [pokok pending].","jawabanPending":"Penegakan diagnosis atau indikasi [diagnosis/indikasi] sesuai [nama regulasi] didukung oleh [kriteria relevan]. Pasien datang dengan [gejala dan temuan objektif utama]. Pemeriksaan [nama pemeriksaan] menunjukkan [hasil] yang mendukung diagnosis tersebut. Kondisi pasien memerlukan [terapi/tindakan penting], sehingga tidak memungkinkan ditangani tuntas secara rawat jalan atau di FKTP. Dengan demikian, [kesimpulan yang langsung menjawab alasan pending].","sources":["[nama regulasi yang benar-benar digunakan]"]}

[GAYA]
- Gunakan bahasa verifikator rumah sakit yang profesional, formal, konkret, dan aktif.
- Mulai langsung dari substansi kasus, misalnya "Pasien dirawat inap karena ...".
- Gabungkan rincian sejenis dalam satu kalimat dan jangan mengulang fakta.
- Hindari filler seperti "berdasarkan telaah komprehensif", "penting untuk dicatat", "secara keseluruhan", dan "dengan demikian dapat disimpulkan".
- Jangan membuka dengan "Kami berkeberatan" atau "Klaim tidak tepat dipending".

[LARANGAN]
- Jangan merinci seluruh tanda vital, administrasi, nama ruang, nama DPJP, pemeriksaan, atau obat bila tidak langsung memperkuat jawaban.
- Jangan menyebut bahwa knowledge atau regulasi tidak tersedia; cukup gunakan dasar klinis yang ada.
- Jangan memakai heading, bullet, numbering, bahasa promosi, atau tanda "-" sebagai pemisah kalimat dalam jawabanPending.
- Jangan mencantumkan atau merekonstruksi nama pasien, nomor SEP, nomor RM, tanggal lahir, alamat, nomor kartu, atau identitas lain yang telah disensor.`;

export const REVISION_SYSTEM_PROMPT = `${STANDARD_SYSTEM_PROMPT}

Mode kritik dan revisi: bandingkan jawaban sebelumnya dengan rekam medis, alasan pending BPJS, alasan tambahan pengguna, dan knowledge lokal. Perlakukan kritik pengguna sebagai arah revisi utama selama tidak bertentangan dengan fakta. Pertahankan bagian yang sudah benar, perbaiki bagian yang dikritik secara substantif, masukkan bukti relevan yang belum digunakan, dan hapus klaim yang tidak didukung. Jangan sekadar mengganti sinonim. Jangan pakai em dash. Balas tetap JSON valid dengan bentuk yang sama.`;

export const CLAIM_CHALLENGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    challengeScore: { type: "INTEGER", description: "Skor 1 sampai 10. Makin tinggi, makin kuat peluang sanggah rumah sakit." },
    verdict: { type: "STRING" },
    bpjsPerspective: { type: "ARRAY", items: { type: "STRING" } },
    casemixPerspective: { type: "ARRAY", items: { type: "STRING" } },
    missingEvidence: { type: "ARRAY", items: { type: "STRING" } },
    recommendation: { type: "STRING" },
  },
  required: ["challengeScore", "verdict", "bpjsPerspective", "casemixPerspective", "missingEvidence", "recommendation"],
};

export const CLAIM_CHALLENGE_SYSTEM_PROMPT = `Anda adalah penilai independen sengketa klaim BPJS. Nilai apakah alasan pending layak disanggah dengan melihat dua sisi secara adil: dasar verifikator BPJS dan dasar Dokter Casemix rumah sakit. Gunakan hanya rekam medis, alasan pending, jawaban sebelumnya, dan knowledge yang diberikan. Jangan membuat fakta, diagnosis, hasil pemeriksaan, tanggal, atau regulasi baru. Jangan mencantumkan atau merekonstruksi identitas pasien maupun rumah sakit.

Balas hanya JSON valid tanpa markdown dengan bentuk persis: {"challengeScore":1,"verdict":"...","bpjsPerspective":["..."],"casemixPerspective":["..."],"missingEvidence":["..."],"recommendation":"..."}.

Aturan penilaian:
- challengeScore wajib bilangan bulat 1 sampai 10. Skor 1 berarti pending BPJS sangat kuat dan sulit disanggah; skor 5 berarti posisi seimbang atau bukti belum cukup; skor 10 berarti sanggahan Dokter Casemix sangat kuat.
- bpjsPerspective berisi fakta dan aturan yang mendukung alasan pending, bukan karikatur argumen BPJS.
- casemixPerspective berisi fakta dan aturan yang mendukung sanggahan rumah sakit.
- missingEvidence berisi bukti yang belum tersedia atau perlu diperkuat. Isi array kosong bila tidak ada.
- verdict menyatakan secara singkat apakah kasus sulit disanggah, masih meragukan, atau layak disanggah.
- recommendation berisi langkah paling berguna bagi Dokter Casemix berdasarkan bukti, bukan jaminan klaim akan diterima.
- Jangan menaikkan skor hanya karena jawaban sebelumnya terdengar meyakinkan. Nilai kekuatan bukti, bukan gaya bahasa.`;

export function buildStandardUserMessage(recordText: string, pendingReason: string, userReason = "") {
  return redactSensitiveData(`Alasan pending dari BPJS:\n${pendingReason}${userReason ? `\n\nBantuan alasan dari pengguna:\n${userReason}` : ""}\n\nRekam medis:\n${recordText}`);
}

export function buildRevisionUserMessage(recordText: string, pendingReason: string, userReason: string, previous: GeneratedAnswer, revisionNote: string) {
  return redactSensitiveData(`Rekam medis:\n${recordText}\n\nAlasan pending dari BPJS:\n${pendingReason}\n\nAlasan tambahan pengguna:\n${userReason || "Tidak ada."}\n\nJawaban sebelumnya:\n${previous.jawabanPending}\n\nKritik dan arahan revisi:\n${revisionNote}`);
}

export function buildClaimChallengeUserMessage(recordText: string, pendingReason: string, userReason: string, previous: GeneratedAnswer) {
  return redactSensitiveData(`Rekam medis:\n${recordText}\n\nAlasan pending dari BPJS:\n${pendingReason}\n\nAlasan tambahan pengguna:\n${userReason || "Tidak ada."}\n\nJawaban Pending yang sudah disusun:\n${previous.jawabanPending}`);
}

export function parseClaimChallengeAssessment(text: string): ClaimChallengeAssessment {
  const parsed = JSON.parse(extractJson(text)) as Partial<ClaimChallengeAssessment>;
  const numericScore = Number(parsed.challengeScore);
  if (!Number.isFinite(numericScore)) throw new Error("AI tidak menghasilkan skor peluang sanggah.");
  const challengeScore = Math.max(1, Math.min(10, Math.round(numericScore)));
  const verdict = scrubIdentity(String(parsed.verdict ?? ""));
  const bpjsPerspective = cleanAssessmentItems(parsed.bpjsPerspective);
  const casemixPerspective = cleanAssessmentItems(parsed.casemixPerspective);
  const recommendation = scrubIdentity(String(parsed.recommendation ?? ""));
  if (!verdict || !bpjsPerspective.length || !casemixPerspective.length || !recommendation) throw new Error("Analisis dua sisi dari AI tidak lengkap.");
  return {
    challengeScore,
    verdict,
    bpjsPerspective,
    casemixPerspective,
    missingEvidence: cleanAssessmentItems(parsed.missingEvidence),
    recommendation,
  };
}

export function parseGeneratedAnswer(text: string, options: { preserveTemplate?: boolean } = {}): GeneratedAnswer {
  let answer = parseJsonAnswer(text) ?? parseLooseAnswer(text);
  if (!answer.ringkasan) answer.ringkasan = "Ringkasan tidak dipisahkan oleh AI.";
  if (!answer.jawabanPending) answer.jawabanPending = normalizePendingParagraph(text);
  answer.ringkasan = scrubIdentity(answer.ringkasan);
  answer.jawabanPending = scrubIdentity(answer.jawabanPending);
  if (!options.preserveTemplate) answer.jawabanPending = scrubSlop(answer.jawabanPending);
  validateGeneratedAnswer(answer);
  return answer;
}

function parseJsonAnswer(text: string): GeneratedAnswer | null {
  try {
    const parsed = JSON.parse(extractJson(text)) as Partial<GeneratedAnswer>;
    return {
      ringkasan: String(parsed.ringkasan ?? "").trim(),
      jawabanPending: normalizePendingParagraph(String(parsed.jawabanPending ?? "")),
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
    };
  } catch {
    return null;
  }
}

function parseLooseAnswer(text: string): GeneratedAnswer {
  const clean = text.trim();
  const jsonishRingkasan = matchSection(clean, /"ringkasan"\s*:\s*"([\s\S]*?)"\s*,\s*"jawabanPending"/i);
  const jsonishJawaban = matchSection(clean, /"jawabanPending"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"sources"|})/i);
  const ringkasan = jsonishRingkasan || matchSection(clean, /(?:ringkasan(?: kasus)?|summary)\s*:?\s*([\s\S]*?)(?=jawaban\s*pending|$)/i);
  const jawabanPending = jsonishJawaban || matchSection(clean, /jawaban\s*pending\s*:?\s*([\s\S]*)/i) || clean;
  return { ringkasan, jawabanPending: normalizePendingParagraph(jawabanPending), sources: [] };
}

export function normalizePendingParagraph(text: string) {
  const lines = text.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").split(/\n+/);
  return lines.map((line) => {
    const isListItem = /^\s*(?:[-*\u2022]|\d+[.)])\s+/.test(line);
    const clean = line.replace(/^\s*(?:[-*\u2022]|\d+[.)]|#{1,6})\s+/, "").trim();
    return isListItem && clean && !/[.!?;:]$/.test(clean) ? `${clean}.` : clean;
  }).filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}

function compactParagraph(text: string) {
  return text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function scrubSlop(text: string) {
  const clean = compactParagraph(text
    .replace(/(?:^|[.!?]\s+)(?:Kami\s+berkeberatan|Klaim\s+[^.!?]{0,80}?tidak\s+tepat\s+dipending)[^.!?]*[.!?]/gi, " ")
    .replace(/(?:^|[.!?]\s+)Dasar\s+regulasi\s+tidak\s+tersedia\s+di\s+konteks[^.!?]*[.!?]/gi, " ")
    .replace(/\b(?:berdasarkan telaah komprehensif|penting untuk dicatat bahwa|secara keseluruhan|dengan demikian dapat disimpulkan bahwa)\b[:,]?\s*/gi, ""));
  return clean && !/[.!?]$/.test(clean) ? `${clean}.` : clean;
}

function cleanAssessmentItems(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => scrubIdentity(String(item)))
    .filter(Boolean);
}

export function scrubIdentity(text: string) {
  return compactParagraph(redactSensitiveData(text)
    .replace(/\s*\[[^\]]*disensor\]/gi, "")
    .replace(/\s*\(\s*SEP\s*[^)]*\)/gi, "")
    .replace(/\bSEP\s*[:\-]?\s*[A-Z0-9]+/gi, "")
    .replace(/\b(?:No\.?\s*RM|Nomor\s*RM|NORM|No\.?\s*Kartu)\s*[:\-]?\s*[A-Z0-9 .\/-]+/gi, "")
    .replace(/\b(?:atas nama|Atas nama|a\.n\.|A\.N\.|nama pasien|Nama pasien|Nama Pasien)\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}/g, "pasien")
    .replace(/pasien\s*,\s*(?:dr\.?|sp\.?|mm[a-z.]*|s\.?ked|mk[a-z.]*)[^,.;]*/gi, "pasien"));
}

function matchSection(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.replace(/^[#*\s:-]+/, "").trim() ?? "";
}

function extractJson(text: string) {
  return extractJsonValue(text);
}

export function validateGeneratedAnswer(answer: GeneratedAnswer) {
  if (!answer.ringkasan || !answer.jawabanPending) throw new Error("Respons AI tidak lengkap.");
  if (/(^|\n)\s*(?:[-*\u2022]|\d+[.)])\s+/.test(answer.jawabanPending)) {
    throw new Error("Jawaban Pending harus satu paragraf tanpa bullet point.");
  }
}



