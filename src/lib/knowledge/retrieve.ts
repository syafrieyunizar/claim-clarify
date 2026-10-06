export function buildLocalContext(documents: string[]) {
  // ponytail: linear scan/context join is enough for MVP; replace with ranking when KB grows.
  return documents.filter(Boolean).map((text, index) => `Dokumen regulasi lokal ${index + 1}:\n${text}`);
}
