import type { GeneratedAnswer, Template, WorkflowId } from "../types";
import { extractJsonValue } from "../lib/ai/json";
import { normalizePendingParagraph, scrubIdentity, validateGeneratedAnswer } from "./standard";

const PLACEHOLDER_START = /^(?:jelaskan|isi|isikan|uraikan|sebutkan|tambahkan|tuliskan|masukkan|sesuaikan|jabarkan|cantumkan|lengkapi|paparkan|terangkan|buat|bandingkan)\b/i;
const PARENTHESIS_PATTERN = /\(([^()]*)\)/g;

export const STRICT_TEMPLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ringkasan: { type: "STRING", description: "Ringkasan faktual 1-2 kalimat, maksimal 60 kata." },
    fills: { type: "ARRAY", items: { type: "STRING" }, description: "Isi setiap placeholder sesuai urutan sebagai paragraf profesional 5-7 kalimat, maksimal 130 kata, tanpa menyalin teks tetap template." },
    sources: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["ringkasan", "fills", "sources"],
};

function isInstructionPlaceholder(template: string, index: number, content: string) {
  return PLACEHOLDER_START.test(content.trim()) || /(?:\.{2,}|…+)\s*$/.test(template.slice(0, index));
}

export function extractTemplatePlaceholders(template: string) {
  const placeholders: string[] = [];
  for (const match of template.matchAll(PARENTHESIS_PATTERN)) {
    if (match.index !== undefined && isInstructionPlaceholder(template, match.index, match[1])) placeholders.push(match[1].trim());
  }
  return placeholders;
}

export function hasStrictTemplatePlaceholders(template: string) {
  return extractTemplatePlaceholders(template).length > 0;
}

export function buildStrictTemplateSystemPrompt(template: string, revisionNote = "") {
  const placeholders = extractTemplatePlaceholders(template);
  if (!placeholders.length) throw new Error("Template strict belum memiliki placeholder instruksi dalam tanda kurung.");
  const instructions = placeholders.map((instruction, index) => `${index + 1}. ${instruction}`).join("\n");
  return `[PERAN]
Anda adalah asisten Dokter Casemix dan Verifikator JKN yang menyusun draf jawaban pending klaim BPJS.

[TUJUAN]
Isi setiap placeholder template dengan argumentasi yang langsung menjawab alasan pending, menggunakan bukti klinis paling relevan dari rekam medis dan knowledge lokal yang diberikan.

[MODE TEMPLATE STRICT]
Teks tetap template dikunci oleh aplikasi dan tidak boleh ditulis ulang, diparafrasekan, diringkas, dikoreksi, atau dilengkapi.
Tugas Anda hanya menghasilkan isi untuk setiap placeholder instruksi.
Jangan menyalin teks tetap template ke dalam fills.
Jangan mengulang kriteria, regulasi, diagnosis, atau kalimat yang sudah tercantum pada teks tetap.
Setiap fill harus menyambung secara alami dan gramatikal dengan teks sebelum dan sesudah placeholder.
Bila teks tetap berakhir dengan kata "Pasien", mulai fill dengan kelanjutan seperti "dirawat inap karena..." atau "datang dengan...", bukan dengan mengulang kata "Pasien".

[PRIORITAS SUMBER]
1. Alasan pending BPJS menentukan fokus isi placeholder.
2. Rekam medis menjadi sumber fakta klinis.
3. Knowledge lokal hanya menjadi dasar aturan bila benar-benar disertakan dalam konteks dan berkaitan langsung dengan alasan pending.
4. Bantuan alasan pengguna adalah arah argumentasi, bukan fakta baru.
5. Teks tetap template menentukan susunan akhir, tetapi bukan sumber fakta klinis baru.
Jangan membuat fakta, diagnosis, hasil pemeriksaan, tanggal, terapi, atau regulasi yang tidak tersedia pada sumber tersebut.

[PROSES INTERNAL — JANGAN DITULIS]
1. Identifikasi satu pokok alasan pending.
2. Pahami fungsi setiap placeholder berdasarkan teks tetap di sekitarnya.
3. Tandai informasi yang sudah tertulis pada template agar tidak diulang dalam fill.
4. Pilih hanya fakta yang membuktikan atau menjawab pokok pending.
5. Bedakan fakta klinis, terapi, kebutuhan tingkat pelayanan, dan dasar regulasi.
6. Hapus fakta berulang serta detail yang tidak mengubah argumentasi.
7. Pastikan setiap klaim dalam fill dapat ditelusuri ke sumber input.
8. Periksa kembali jumlah, urutan, dan kesinambungan gramatikal seluruh fills.

[KONTRAK OUTPUT]
Balas hanya JSON valid tanpa markdown atau teks pembuka dengan bentuk persis:
{"ringkasan":"...","fills":["..."],"sources":["..."]}
- ringkasan: 1-2 kalimat faktual, maksimal 60 kata, berisi kondisi utama dan pokok pending.
- Jumlah fills wajib tepat ${placeholders.length} dan urutannya wajib sama dengan daftar placeholder.
- Setiap fill berupa satu paragraf, 5-7 kalimat, maksimal 130 kata, tanpa bullet atau numbering.
- Isi fill hanya materi yang diperlukan untuk melengkapi placeholder, bukan salinan teks tetap.
- sources: hanya nama knowledge atau regulasi yang benar-benar digunakan; gunakan [] bila tidak ada.

[TEMPLATE ASLI — HANYA KONTEKS]
${template}

[PLACEHOLDER YANG DIISI]
${instructions}

[URUTAN ISI FILL]
Karena kriteria diagnosis dan regulasi yang sudah berada pada teks tetap tidak boleh diulang, sesuaikan urutan berikut dengan konteks setiap placeholder.
1. Mulai dengan kondisi, gejala, dan temuan objektif utama yang menjawab alasan pending.
2. Sebutkan hasil penunjang yang relevan dan maknanya secara proporsional.
3. Jelaskan terapi atau tindakan penting, termasuk antibiotik intravena bila benar-benar tercatat.
4. Tegaskan kebutuhan pemantauan atau tingkat pelayanan yang tidak dapat dituntaskan secara rawat jalan atau di FKTP, bila dipersoalkan.
5. Tutup dengan kesimpulan singkat yang langsung mendukung jawaban klaim.

[POLA ISI DEFAULT]
- Bentuk fill sebagai argumentasi klinis, bukan ringkasan seluruh rekam medis.
- Gunakan pola: bukti klinis pasien → pemeriksaan penunjang → terapi yang dibutuhkan → alasan tidak tuntas di FKTP → kesimpulan.
- Jangan membuka fill dengan regulasi atau kriteria yang sudah tertulis pada template.
- Cantumkan angka, kode diagnosis, skor pemeriksaan, dosis, atau durasi hanya jika tersedia dan langsung memperkuat argumentasi.
- Gunakan "mendukung diagnosis" untuk pemeriksaan penunjang.
- Gunakan "mengonfirmasi diagnosis" hanya bila rekam medis atau knowledge secara eksplisit menyatakan pemeriksaan tersebut konfirmatif.
- Jika data antibiotik intravena tidak tersedia, jangan membuat atau menduganya.
- Jika alasan tidak dapat ditangani di FKTP tidak dinyatakan secara eksplisit, jelaskan hanya berdasarkan kebutuhan terapi, pemantauan, atau kondisi klinis yang benar-benar tercatat.

[GAYA]
- Gunakan bahasa verifikator rumah sakit yang profesional, formal, konkret, dan aktif.
- Sambungkan fill secara alami dengan teks tetap di sekitar placeholder.
- Gabungkan rincian sejenis dalam satu kalimat dan jangan mengulang fakta.
- Hindari filler seperti "berdasarkan telaah komprehensif", "penting untuk dicatat", "secara keseluruhan", dan "dengan demikian dapat disimpulkan".
- Jangan membuka dengan "Kami berkeberatan" atau "Klaim tidak tepat dipending".

[LARANGAN]
- Jangan mengubah atau mengoreksi teks tetap template, termasuk ejaan, kode, nama regulasi, dan tanda bacanya.
- Jangan mengulang kalimat pembuka, kriteria, kode diagnosis, atau nama regulasi yang sudah tertulis pada template.
- Jangan merinci seluruh tanda vital, administrasi, nama ruang, nama DPJP, pemeriksaan, atau obat bila tidak langsung memperkuat jawaban.
- Jangan menyebut bahwa knowledge atau regulasi tidak tersedia; cukup gunakan dasar klinis yang ada.
- Jangan memakai heading, bullet, numbering, bahasa promosi, atau tanda "-" sebagai pemisah kalimat di dalam fills.
- Jangan mencantumkan atau merekonstruksi nama pasien, nomor SEP, nomor RM, tanggal lahir, alamat, nomor kartu, atau identitas lain yang telah disensor.${revisionNote ? `

[ARAHAN REVISI]
${revisionNote}` : ""}`;
}

export function renderStrictTemplate(template: string, fills: string[]) {
  let cursor = 0;
  let fillIndex = 0;
  let output = "";
  for (const match of template.matchAll(PARENTHESIS_PATTERN)) {
    if (match.index === undefined || !isInstructionPlaceholder(template, match.index, match[1])) continue;
    let fixedText = template.slice(cursor, match.index);
    const hasEllipsisMarker = /(?:\.{2,}|…+)\s*$/.test(fixedText);
    if (hasEllipsisMarker) fixedText = fixedText.replace(/(?:\.{2,}|…+)\s*$/, "");
    const fill = String(fills[fillIndex] ?? "").trim();
    output += fixedText;
    if (hasEllipsisMarker && fill && output && !/\s$/.test(output)) output += " ";
    output += fill;
    cursor = match.index + match[0].length;
    fillIndex += 1;
  }
  output += template.slice(cursor);
  return output;
}

export function parseStrictTemplateAnswer(text: string, template: string): GeneratedAnswer {
  const placeholderCount = extractTemplatePlaceholders(template).length;
  let parsed: { ringkasan?: unknown; fills?: unknown; sources?: unknown };
  try {
    parsed = JSON.parse(extractJsonValue(text)) as typeof parsed;
  } catch {
    throw new Error("AI tidak menghasilkan JSON template yang valid.");
  }
  const rawFills = Array.isArray(parsed.fills) ? parsed.fills : [];
  if (rawFills.length !== placeholderCount) throw new Error(`AI harus mengisi tepat ${placeholderCount} placeholder template.`);
  const fills = rawFills.map((fill) => scrubIdentity(normalizePendingParagraph(String(fill))));
  if (fills.some((fill) => !fill)) throw new Error("AI menghasilkan placeholder template yang kosong.");
  const answer: GeneratedAnswer = {
    ringkasan: scrubIdentity(String(parsed.ringkasan ?? "")) || "Ringkasan tidak dipisahkan oleh AI.",
    jawabanPending: renderStrictTemplate(template, fills),
    sources: Array.isArray(parsed.sources) ? parsed.sources.map((source) => String(source).trim()).filter(Boolean) : [],
  };
  validateGeneratedAnswer(answer);
  return answer;
}

export function matchTemplate(keyword: string, templates: Template[]) {
  const wanted = keyword.trim().toLocaleLowerCase("id-ID");
  return templates.find((template) => template.keyword.trim().toLocaleLowerCase("id-ID") === wanted) ?? null;
}

export function resolveTemplateSelection(input: { enabled: boolean; keyword: string; workflow: WorkflowId | null; templates: Template[] }) {
  if (!input.enabled) return { template: null, error: "" };
  const keyword = input.workflow === "readmisi" && !input.keyword.trim() ? "readmisi" : input.keyword.trim();
  if (!keyword) return { template: null, error: "keyword template tidak boleh kosong" };
  const template = matchTemplate(keyword, input.templates);
  return template ? { template, error: "" } : { template: null, error: "keyword template yang kamu tulis belum diatur" };
}
