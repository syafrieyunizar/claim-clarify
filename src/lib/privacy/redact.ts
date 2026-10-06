const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\bNIK\s*[:\-]?\s*\d{8,20}\b/gi, "NIK [disensor]"],
  [/\b(?:No\.?\s*)?SEP\s*[:\-]?\s*[A-Z0-9 .\/-]{6,}\b/gi, "SEP [disensor]"],
  [/\b(?:No\.?\s*RM|Nomor\s*RM|No\.?\s*Rekam\s*Medis|NORM|RM)\s*[:\-]?\s*[A-Z0-9 .\/-]{2,}\b/gi, "No RM [disensor]"],
  [/\b(?:No\.?\s*Kartu|Nomor\s*Kartu|Kartu\s*BPJS)\s*[:\-]?\s*[A-Z0-9 .\/-]{6,}\b/gi, "No Kartu [disensor]"],
  [/\b(?:Tanggal\s*Lahir|Tgl\.?\s*Lahir|TTL|DOB)\s*[:\-]?\s*[^,\n;]{4,40}/gi, "Tanggal lahir [disensor]"],
  [/\b(?:Alamat|Domisili)\s*[:\-]?\s*[^,\n;]{6,120}/gi, "Alamat [disensor]"],
  [/\b(?:No\.?\s*HP|HP|Telepon|Telp)\s*[:\-]?\s*(?:\+?62|0)\d[\d .-]{6,16}\b/gi, "Telepon [disensor]"],
  [/\b(?:atas nama|a\.n\.|nama pasien|Nama Pasien|Pasien)\s*[:\-]?\s*[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}/g, "pasien [disensor]"],
  [/\b(?:RSUD|RSUP|RSU|RSIA|RSP|RS|Rumah\s+Sakit|Klinik|Puskesmas)\s+[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,6}/g, "fasilitas kesehatan [disensor]"],
];

export function redactSensitiveData(text: string) {
  return SENSITIVE_PATTERNS.reduce((safe, [pattern, replacement]) => safe.replace(pattern, replacement), text);
}