import type { GeneratedAnswer, Template, WorkflowId } from "../types";
import { extractJsonValue } from "../lib/ai/json";
import { normalizePendingParagraph, scrubIdentity, validateGeneratedAnswer } from "./standard";

const PLACEHOLDER_START = /^(?:jelaskan|isi|isikan|uraikan|sebutkan|tambahkan|tuliskan|masukkan|sesuaikan|jabarkan|cantumkan|lengkapi|paparkan|terangkan|buat|bandingkan)\b/i;
const PARENTHESIS_PATTERN = /\(([^()]*)\)/g;

export const STRICT_TEMPLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ringkasan: { type: "STRING", description: "Ringkasan faktual 1-2 kalimat, maksimal 60 kata." },
    fills: { type: "ARRAY", items: { type: "STRING" }, description: "Isi setiap placeholder instruksi sesuai urutan, tanpa menyalin teks tetap template." },
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
  return `[PERAN]\nAnda adalah asisten Dokter Casemix dan Verifikator JKN.\n\n[MODE TEMPLATE STRICT]\nTeks tetap template dikunci oleh aplikasi dan tidak boleh ditulis ulang, diparafrasekan, diringkas, dikoreksi, atau dilengkapi. Tugas Anda hanya menghasilkan isi untuk setiap placeholder instruksi. Jangan menyalin teks tetap template ke dalam fills. Jangan mengulang kata terakhir sebelum placeholder; bila teks tetap berakhir dengan \"Pasien\", mulai isi dengan kelanjutan seperti \"datang...\" atau \"dirawat...\". Gunakan hanya fakta dari rekam medis, alasan pending, bantuan pengguna, dan knowledge yang diberikan. Jangan membuat fakta atau regulasi baru.\n\n[KONTRAK OUTPUT]\nBalas hanya JSON valid tanpa markdown dengan bentuk persis: {\"ringkasan\":\"...\",\"fills\":[\"...\"],\"sources\":[\"...\"]}. Jumlah fills wajib tepat ${placeholders.length} dan urutannya wajib sama dengan daftar placeholder. Setiap fill berupa teks profesional tanpa bullet atau numbering. sources hanya memuat knowledge atau regulasi yang benar-benar digunakan.\n\n[TEMPLATE ASLI — HANYA KONTEKS]\n${template}\n\n[PLACEHOLDER YANG DIISI]\n${instructions}${revisionNote ? `\n\n[ARAHAN REVISI]\n${revisionNote}` : ""}`;
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
