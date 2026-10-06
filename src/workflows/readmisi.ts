export interface ReadmisiAnalysis {
  likely: boolean;
  reasons: string[];
}

export function hasMinimumReadmisiFiles(files: File[]) {
  return files.length >= 2;
}

export function analyzeReadmisiTexts(texts: string[]): ReadmisiAnalysis {
  if (texts.length < 2) return { likely: false, reasons: ["Dokumen kurang dari 2 episode."] };
  const normalized = texts.map((text) => text.toLocaleLowerCase("id-ID"));
  const reasons: string[] = [];
  if (hasRepeatedPattern(normalized, /(?:no\.?\s*rm|norm|rekam medis)\s*[:\-]?\s*([a-z0-9.\-]+)/i)) reasons.push("Nomor rekam medis tampak sama.");
  if (hasRepeatedPattern(normalized, /(?:nama(?: pasien)?|pasien)\s*[:\-]?\s*([a-z][a-z '\-.]{2,})/i)) reasons.push("Nama pasien tampak sama.");
  if (hasRepeatedPattern(normalized, /(?:diagnosis|diagnosa|dx)\s*[:\-]?\s*([^\n.;]{3,80})/i)) reasons.push("Diagnosis antar episode tampak beririsan.");
  if (normalized.some((text) => /readmisi|rawat ulang|masuk kembali/.test(text))) reasons.push("Ada istilah readmisi/rawat ulang di dokumen.");
  return { likely: reasons.length >= 2, reasons: reasons.length ? reasons : ["Belum cukup bukti otomatis; tetap perlu konfirmasi user."] };
}

function hasRepeatedPattern(texts: string[], pattern: RegExp) {
  const values = texts.map((text) => text.match(pattern)?.[1]?.trim()).filter(Boolean);
  return new Set(values).size === 1 && values.length >= 2;
}
