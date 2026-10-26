import { extractJsonValue } from "../ai/json";

export const EKLAIM_COST_FIELDS = [
  { key: "procedure", inputId: "procedure_amt", label: "Prosedur Non Bedah" },
  { key: "surgical", inputId: "surgical_amt", label: "Prosedur Bedah" },
  { key: "consultation", inputId: "consul_amt", label: "Konsultasi" },
  { key: "expert", inputId: "expert_amt", label: "Tenaga Ahli" },
  { key: "nursing", inputId: "nursing_amt", label: "Keperawatan" },
  { key: "ancillary", inputId: "ancillary_amt", label: "Penunjang" },
  { key: "radiology", inputId: "radiology_amt", label: "Radiologi" },
  { key: "laboratory", inputId: "laboratory_amt", label: "Laboratorium" },
  { key: "blood", inputId: "blood_amt", label: "Pelayanan Darah" },
  { key: "rehabilitation", inputId: "rehab_amt", label: "Rehabilitasi" },
  { key: "room", inputId: "room_amt", label: "Kamar / Akomodasi" },
  { key: "intensive", inputId: "intensive_amt", label: "Rawat Intensif" },
  { key: "drug", inputId: "drug_amt", label: "Obat" },
  { key: "chronicDrug", inputId: "drug_chronic_amt", label: "Obat Kronis" },
  { key: "chemotherapyDrug", inputId: "drug_chemo_amt", label: "Obat Kemoterapi" },
  { key: "device", inputId: "device_amt", label: "Alkes" },
  { key: "consumable", inputId: "consumable_amt", label: "BMHP" },
  { key: "equipmentRental", inputId: "device_rent_amt", label: "Sewa Alat" },
] as const;

export type EklaimCostCategory = typeof EKLAIM_COST_FIELDS[number]["key"];

export interface HospitalCostLine {
  id: number;
  description: string;
  amount: number;
}

export interface ParsedHospitalCosts {
  lines: HospitalCostLine[];
  calculatedTotal: number;
  declaredTotal: number | null;
}

export interface HospitalCostMapping {
  lineId: number;
  category: EklaimCostCategory;
  reason: string;
}

export interface HospitalCostPlan {
  lines: HospitalCostLine[];
  mappings: HospitalCostMapping[];
  totals: Record<EklaimCostCategory, number>;
  total: number;
  declaredTotal: number | null;
}

export interface ApplyHospitalCostsResult {
  sep: string;
  total: number;
  updatedFields: number;
}

export const COST_MAPPING_SCHEMA = {
  type: "OBJECT",
  properties: {
    mappings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          lineId: { type: "INTEGER" },
          category: { type: "STRING", enum: EKLAIM_COST_FIELDS.map((field) => field.key) },
          reason: { type: "STRING" },
        },
        required: ["lineId", "category", "reason"],
      },
    },
  },
  required: ["mappings"],
};

export const COST_MAPPING_SYSTEM_PROMPT = `Anda memetakan rincian biaya rumah sakit ke kolom tarif resmi e-Klaim INA-CBG.

Balas hanya JSON valid tanpa markdown dengan bentuk persis: {"mappings":[{"lineId":1,"category":"room","reason":"Kamar/akomodasi"}]}.

Aturan wajib:
- Setiap lineId dari input harus muncul tepat satu kali dan tidak boleh ada lineId tambahan.
- Pilih tepat satu category untuk setiap baris. Jangan memecah satu nominal ke beberapa kategori dan jangan mengubah nominal.
- Gunakan arti layanan, bukan hanya kemiripan kata.
- "Tindakan Keperawatan" masuk nursing. Jika satu deskripsi berbunyi "Tindakan Keperawatan & Konsultasi IGD" tanpa rincian nominal terpisah, pilih nursing agar tidak mengarang pembagian biaya.
- Konsultasi, visite, atau pemeriksaan dokter masuk consultation. Konsul tenaga ahli non-dokter seperti nutrisionis atau fisioterapis masuk expert.
- Kamar/akomodasi masuk room. ICU/NICU/PICU/HCU masuk intensive.
- Radiologi dan laboratorium harus dipisahkan ke kategorinya masing-masing.
- Obat biasa, obat kronis, dan obat kemoterapi harus dibedakan bila deskripsinya jelas.
- BMHP adalah bahan medis habis pakai; alkes adalah alat kesehatan; sewa alat masuk equipmentRental.
- reason singkat, konkret, maksimal 8 kata.

Category yang diizinkan:
${EKLAIM_COST_FIELDS.map((field) => `- ${field.key}: ${field.label}`).join("\n")}`;

export function parseHospitalCostText(text: string): ParsedHospitalCosts {
  const lines: HospitalCostLine[] = [];
  const unrecognized: string[] = [];
  let declaredTotal: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^no\s+deskripsi\s+layanan\s+total$/i.test(line)) continue;
    if (/^(?:semua\s+)?total(?:\s+biaya\s+pelayanan)?\b/i.test(line)) {
      const amount = parseRupiah(lastAmountToken(line));
      if (amount === null) unrecognized.push(line);
      else declaredTotal = amount;
      continue;
    }

    const amountToken = lastAmountToken(line);
    const amount = parseRupiah(amountToken);
    if (!amountToken || amount === null) {
      unrecognized.push(line);
      continue;
    }
    const beforeAmount = line.slice(0, line.lastIndexOf(amountToken)).replace(/\s*(?:Rp\.?\s*)$/i, "").trim();
    const description = beforeAmount.replace(/^\d+\s*[.)-]?\s*/, "").trim();
    if (!description) {
      unrecognized.push(line);
      continue;
    }
    lines.push({ id: lines.length + 1, description, amount });
  }

  if (unrecognized.length) throw new Error(`Baris biaya tidak dikenali: ${unrecognized.join(" | ")}`);
  if (!lines.length) throw new Error("Belum ada rincian biaya yang dapat dibaca.");
  if (declaredTotal === null) throw new Error("Tambahkan baris Semua Total Biaya Pelayanan agar nominal dapat diverifikasi.");
  const calculatedTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  if (declaredTotal !== null && declaredTotal !== calculatedTotal) {
    throw new Error(`Total rincian ${formatRupiah(calculatedTotal)} tidak sama dengan total pelayanan ${formatRupiah(declaredTotal)}.`);
  }
  return { lines, calculatedTotal, declaredTotal };
}

export function buildCostMappingUserMessage(lines: HospitalCostLine[]) {
  return `Petakan setiap baris berikut ke satu category e-Klaim. Nominal hanya referensi dan tidak boleh diubah.\n${lines
    .map((line) => `${line.id}. ${line.description} | ${line.amount}`)
    .join("\n")}`;
}

export function parseCostMappingResponse(text: string, parsed: ParsedHospitalCosts): HospitalCostPlan {
  const value = JSON.parse(extractJsonValue(text)) as { mappings?: Array<Partial<HospitalCostMapping>> };
  if (!Array.isArray(value.mappings)) throw new Error("AI tidak menghasilkan pemetaan biaya yang lengkap.");
  const allowed = new Set<string>(EKLAIM_COST_FIELDS.map((field) => field.key));
  const mappings = value.mappings.map((mapping) => ({
    lineId: Number(mapping.lineId),
    category: String(mapping.category ?? "") as EklaimCostCategory,
    reason: String(mapping.reason ?? "").trim(),
  }));
  const expectedIds = parsed.lines.map((line) => line.id);
  const actualIds = mappings.map((mapping) => mapping.lineId);
  if (mappings.length !== expectedIds.length || new Set(actualIds).size !== actualIds.length || expectedIds.some((id) => !actualIds.includes(id))) {
    throw new Error("AI harus memetakan setiap baris biaya tepat satu kali.");
  }
  if (mappings.some((mapping) => !allowed.has(mapping.category))) throw new Error("AI menghasilkan kategori biaya yang tidak tersedia di e-Klaim.");

  const totals = Object.fromEntries(EKLAIM_COST_FIELDS.map((field) => [field.key, 0])) as Record<EklaimCostCategory, number>;
  for (const mapping of mappings) {
    const source = parsed.lines.find((line) => line.id === mapping.lineId);
    if (!source) throw new Error("AI menghasilkan referensi baris biaya yang tidak valid.");
    totals[mapping.category] += source.amount;
  }
  const total = Object.values(totals).reduce((sum, amount) => sum + amount, 0);
  if (total !== parsed.calculatedTotal) throw new Error("Total hasil pemetaan AI berubah dari rincian asli.");
  return { lines: parsed.lines, mappings, totals, total, declaredTotal: parsed.declaredTotal };
}

export function formatRupiah(amount: number) {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

export async function applyHospitalCosts(plan: HospitalCostPlan): Promise<ApplyHospitalCostsResult> {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
    throw new Error("Perbaikan Biaya hanya tersedia di Chrome Extension.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url) || !/\/e-klaim(?:\/|$)/i.test(new URL(tab.url).pathname)) {
    throw new Error("Buka klaim tujuan di tab e-Klaim terlebih dahulu.");
  }
  const permission = { origins: [`${new URL(tab.url).origin}/*`] };
  if (chrome.permissions && !(await chrome.permissions.contains(permission))) {
    const granted = await chrome.permissions.request(permission);
    if (!granted) throw new Error("Izin mengakses halaman e-Klaim ditolak.");
  }

  const values = EKLAIM_COST_FIELDS.map((field) => ({ inputId: field.inputId, label: field.label, amount: plan.totals[field.key] }));
  await runCostStep(tab.id, "prepare", values, 20_000);
  const result = await runCostStep(tab.id, "apply", values, 8_000);
  return { sep: result.sep || "SEP aktif", total: plan.total, updatedFields: values.filter((item) => item.amount > 0).length };
}

function lastAmountToken(line: string) {
  return line.match(/[0-9][0-9.,]*\s*$/)?.[0].trim() ?? "";
}

function parseRupiah(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

type CostStepResult = { ok: boolean; retry?: boolean; message: string; sep?: string };

type EklaimCostValue = { inputId: string; label: string; amount: number };

async function runCostStep(tabId: number, action: "prepare" | "apply", values: EklaimCostValue[], timeout: number) {
  const deadline = Date.now() + timeout;
  let lastMessage = "Form biaya e-Klaim belum siap.";
  while (Date.now() < deadline) {
    let result: CostStepResult | undefined;
    try {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: executeEklaimCostStep,
        args: [action, values],
      });
      result = execution?.result as CostStepResult | undefined;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : lastMessage;
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 400));
      continue;
    }
    if (result?.ok) return result;
    lastMessage = result?.message || lastMessage;
    if (result && !result.retry) throw new Error(lastMessage);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 400));
  }
  throw new Error(lastMessage);
}

export async function executeEklaimCostStep(
  action: "prepare" | "apply",
  values: EklaimCostValue[],
): Promise<CostStepResult> {
  const documents: Document[] = [];
  const collectDocuments = (current: Document) => {
    if (documents.includes(current)) return;
    documents.push(current);
    for (const frame of Array.from(current.querySelectorAll<HTMLIFrameElement>("iframe, frame"))) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument);
      } catch {
        // Cross-origin frames are outside the active e-Klaim document.
      }
    }
  };
  collectDocuments(document);
  const visible = (element: Element) => {
    const node = element as HTMLElement;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style?.display !== "none" && style?.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const labelOf = (element: Element) => String((element as HTMLInputElement).value || element.textContent || "")
    .replace(/[\s\u00a0]+/g, " ").trim().toLocaleLowerCase("id-ID");
  const elements = documents.flatMap((current) => Array.from(current.querySelectorAll<HTMLElement>('button, a, input[type="button"], input[type="submit"], [role="button"]')))
    .filter((element) => visible(element) && !(element as HTMLButtonElement).disabled);
  const findButton = (labels: string[]) => elements.find((element) => labels.includes(labelOf(element)));
  const inputs = values.map((value) => documents.map((current) => current.getElementById(value.inputId) as HTMLInputElement | null).find(Boolean) ?? null);
  if (inputs.some((input) => !input)) return { ok: false, retry: false, message: "Kolom tarif rumah sakit tidak lengkap pada klaim yang sedang dibuka." };

  if (action === "prepare") {
    if (inputs.every((input) => input && !input.disabled)) return { ok: true, message: "Form biaya siap." };
    const confirm = findButton(["ya (edit ulang)", "ya edit ulang", "ya, edit ulang"]);
    const edit = findButton(["edit ulang klaim"]);
    const button = confirm ?? edit;
    if (!button) {
      return { ok: false, retry: true, message: "Kolom biaya masih terkunci. Pastikan klaim berstatus Terkirim/final dan tombol Edit Ulang Klaim tersedia." };
    }
    button.scrollIntoView({ block: "center" });
    const ownerWindow = button.ownerDocument.defaultView ?? window;
    const originalConfirm = ownerWindow.confirm;
    ownerWindow.confirm = () => true;
    try {
      button.click();
    } finally {
      ownerWindow.confirm = originalConfirm;
    }
    return { ok: false, retry: true, message: "Membuka form Edit Ulang Klaim..." };
  }

  if (inputs.some((input) => input?.disabled)) return { ok: false, retry: true, message: "Menunggu kolom biaya dapat diedit." };
  for (let index = 0; index < values.length; index += 1) {
    const input = inputs[index] as HTMLInputElement;
    const ownerWindow = input.ownerDocument.defaultView ?? window;
    const autoNumeric = (input as HTMLInputElement & { autonumeric?: { set(value: number): void; get(): string } }).autonumeric;
    if (autoNumeric) autoNumeric.set(values[index].amount);
    else input.value = String(values[index].amount);
    input.dispatchEvent(new ownerWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new ownerWindow.Event("change", { bubbles: true }));
    input.dispatchEvent(new ownerWindow.Event("blur", { bubbles: true }));
  }
  const mainDocument = inputs[0]?.ownerDocument ?? document;
  const ownerWindow = mainDocument.defaultView ?? window;
  const recalculate = (ownerWindow as typeof ownerWindow & { recalc_billing?: () => void }).recalc_billing;
  if (typeof recalculate === "function") recalculate();
  const failedLabels = inputs.flatMap((input, index) => {
    const resolvedInput = input as HTMLInputElement & { autonumeric?: { get(): string } };
    const current = Number(String(resolvedInput.autonumeric ? resolvedInput.autonumeric.get() : resolvedInput.value).replace(/\D/g, ""));
    return current === values[index].amount ? [] : [values[index].label];
  });
  if (failedLabels.length) return { ok: false, retry: false, message: `Kolom gagal diisi: ${failedLabels.join(", ")}.` };
  const sep = String((mainDocument.getElementById("no_sep") as HTMLInputElement | null)?.value || "").trim();
  return { ok: true, message: "Biaya sudah dipetakan ke form e-Klaim.", sep };
}
