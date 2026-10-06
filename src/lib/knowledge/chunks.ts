import type { KnowledgeChunk } from "../../types";
import { extractJsonValue } from "../ai/json";
import { redactSensitiveData } from "../privacy/redact";

const IGNORED_KEYWORDS = new Set(["bpjs", "jkn", "kasus", "klaim", "pasien", "rekam medis", "rumah sakit"]);

export const KNOWLEDGE_CHUNK_SYSTEM_PROMPT = `Anda membantu menyusun knowledge base klaim BPJS. Pecah dokumen menjadi chunk berdasarkan bab, subbab, topik klinis, indikasi, kriteria, angka penting, pengecualian, atau aturan klaim. Jangan membuat aturan baru. Pertahankan angka, batas nilai, durasi, diagnosis, kode, syarat, dan pengecualian apa adanya. Balas hanya JSON valid: {"chunks":[{"title":"...","source":"...","keywords":["..."],"content":"..."}]}. Tiap chunk harus punya 3-8 keyword yang bisa dipakai untuk mencari kasus terkait.`;

export function buildKnowledgeChunkUserMessage(sourceName: string, documentText: string) {
  return redactSensitiveData(`Nama dokumen: ${sourceName}\n\nIsi dokumen:\n${documentText}`);
}

export function parseKnowledgeChunks(text: string, fallbackSource: string): KnowledgeChunk[] {
  const parsed = JSON.parse(extractJson(text)) as { chunks?: Array<Partial<KnowledgeChunk>> } | Array<Partial<KnowledgeChunk>>;
  const chunks = Array.isArray(parsed) ? parsed : parsed.chunks ?? [];
  return chunks
    .map((chunk, index) => ({
      id: chunk.id || crypto.randomUUID(),
      title: String(chunk.title || `Knowledge ${index + 1}`).trim(),
      source: String(chunk.source || fallbackSource).trim(),
      keywords: cleanKeywords(chunk.keywords),
      content: String(chunk.content || "").trim(),
      active: chunk.active ?? true,
    }))
    .filter((chunk) => chunk.content && chunk.keywords.length);
}

export function retrieveKnowledgeChunks(chunks: KnowledgeChunk[], query: string, limit = 6) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const seen = new Set<string>();

  return chunks
    .filter((chunk) => chunk.active)
    .filter((chunk) => {
      const key = [chunk.title, chunk.source, chunk.content].map(normalizeSearchText).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}

export function formatKnowledgeContext(chunks: KnowledgeChunk[]) {
  return `Knowledge lokal relevan:\n${chunks
    .map((chunk, index) => `${index + 1}. ${chunk.title}\nSumber: ${chunk.source}\nKeyword: ${chunk.keywords.join(", ")}\nIsi: ${chunk.content}`)
    .join("\n\n")}`;
}

function scoreChunk(chunk: KnowledgeChunk, normalizedQuery: string) {
  const searchableQuery = ` ${normalizedQuery} `;
  return chunk.keywords
    .map(normalizeSearchText)
    .filter(isUsefulKeyword)
    .reduce((score, keyword) => searchableQuery.includes(` ${keyword} `) ? score + keyword.split(" ").length : score, 0);
}

function cleanKeywords(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]+/) : [];
  return [...new Set(raw.map((item) => String(item).trim()).filter((item) => isUsefulKeyword(normalizeSearchText(item))))].slice(0, 8);
}

function isUsefulKeyword(keyword: string) {
  return keyword.length >= 2 && !IGNORED_KEYWORDS.has(keyword);
}

function normalizeSearchText(text: string) {
  return text.toLocaleLowerCase("id-ID").normalize("NFKC").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractJson(text: string) {
  return extractJsonValue(text);
}
