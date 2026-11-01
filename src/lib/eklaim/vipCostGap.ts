export interface VipCostGapData {
  sep: string;
  medicalRecordNumber: string;
  patientName: string;
  gender: string;
  birthDate: string;
  admissionDate: string;
  dischargeDate: string;
  dpjp: string;
  insuranceClass: string;
  serviceClass: string;
  careType: string;
  group: string;
  totalClaim: string;
  costGap: string;
  costGapNote: string;
  payer: string;
  status: string;
}

type InjectedResult<T> = { ok: true; data: T } | { ok: false; message: string };

type CaptureBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

export async function readVipCostGap(): Promise<VipCostGapData> {
  const tab = await getActiveEklaimTab();
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: extractVipCostGapFromPage,
  });
  const result = execution?.result as InjectedResult<VipCostGapData> | undefined;
  if (!result) throw new Error("Data Selisih Biaya tidak dapat dibaca dari e-Klaim.");
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

export async function copyVipCostGapScreenshot(data: VipCostGapData): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Browser ini belum mendukung salin screenshot ke clipboard.");
  }
  const tab = await getActiveEklaimTab();
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: prepareVipCostGapCapture,
    args: [data],
  });
  const result = execution?.result as InjectedResult<CaptureBounds> | undefined;
  if (!result) throw new Error("Area screenshot tidak dapat disiapkan.");
  if (!result.ok) throw new Error(result.message);

  try {
    const imageUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const blob = await cropScreenshot(imageUrl, result.data);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: cleanupVipCostGapCapture,
    }).catch(() => undefined);
  }
}

export function formatVipCostGapText(data: VipCostGapData) {
  const dateOnly = (value: string) => value.trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, "") || "-";
  const amountOnly = (value: string) => value.trim().replace(/^Rp\.?\s*/i, "") || "-";
  return [
    `Tanggal Masuk : ${dateOnly(data.admissionDate)}`,
    `Tanggal Keluar : ${dateOnly(data.dischargeDate)}`,
    `Nomor SEP : ${data.sep || "-"}`,
    `DPJP : ${data.dpjp || "-"}`,
    `Nama : ${data.patientName || "-"}`,
    `Nomor RM : ${data.medicalRecordNumber || "-"}`,
    "",
    `Group INA-CBG: ${data.group || "-"}`,
    `Perkiraan Biaya klaim : ${amountOnly(data.totalClaim)}`,
    `Selisih Tarif : ${amountOnly(data.costGap)}`,
  ].join("\n");
}

async function getActiveEklaimTab(): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
    throw new Error("Selisih Biaya hanya tersedia di Chrome Extension.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url) || !/\/e-klaim(?:\/|$)/i.test(new URL(tab.url).pathname)) {
    throw new Error("Buka detail klaim pada tab e-Klaim terlebih dahulu.");
  }
  const permission = { origins: [`${new URL(tab.url).origin}/*`] };
  if (chrome.permissions && !(await chrome.permissions.contains(permission))) {
    const granted = await chrome.permissions.request(permission);
    if (!granted) throw new Error("Izin mengakses halaman e-Klaim ditolak.");
  }
  return tab as chrome.tabs.Tab & { id: number; url: string };
}

async function cropScreenshot(imageUrl: string, bounds: CaptureBounds) {
  const image = new Image();
  image.src = imageUrl;
  await image.decode();
  const scaleX = image.naturalWidth / bounds.viewportWidth;
  const scaleY = image.naturalHeight / bounds.viewportHeight;
  const sourceX = Math.max(0, Math.round(bounds.left * scaleX));
  const sourceY = Math.max(0, Math.round(bounds.top * scaleY));
  const sourceWidth = Math.min(image.naturalWidth - sourceX, Math.max(1, Math.round(bounds.width * scaleX)));
  const sourceHeight = Math.min(image.naturalHeight - sourceY, Math.max(1, Math.round(bounds.height * scaleY)));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Screenshot tidak dapat diproses.");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Screenshot tidak dapat dibuat.");
  return blob;
}

export function extractVipCostGapFromPage(): InjectedResult<VipCostGapData> {
  const documents: Document[] = [];
  const collectDocuments = (current: Document) => {
    if (documents.includes(current)) return;
    documents.push(current);
    for (const frame of Array.from(current.querySelectorAll<HTMLIFrameElement>("iframe, frame"))) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument);
      } catch {
        // Cross-origin frames are outside the active e-Klaim claim.
      }
    }
  };
  collectDocuments(document);
  const pageDocument = documents.find((current) => current.getElementById("dv_grouping_result_inacbg"));
  if (!pageDocument) return { ok: false, message: "Hasil Grouping INACBG belum ditemukan pada klaim yang sedang dibuka." };
  const resultRoot = pageDocument.getElementById("dv_grouping_result_inacbg") as HTMLElement;
  const normalize = (value: string | null | undefined) => String(value || "").replace(/[\s\u00a0]+/g, " ").trim();
  const rows = Array.from(resultRoot.querySelectorAll("tr"));
  const findRow = (label: string) => rows.find((row) => normalize(row.querySelector("td")?.textContent).toLocaleLowerCase("id-ID") === label.toLocaleLowerCase("id-ID"));
  const rowCells = (label: string) => Array.from(findRow(label)?.querySelectorAll(":scope > td") ?? []).map((cell) => normalize(cell.textContent));
  const rowValue = (label: string) => rowCells(label)[1] || "";

  const bodyText = normalize(pageDocument.body?.innerText);
  const identity = bodyText.match(/(\d{4,10})\s*(?:••|\*\*)\s*([^•*]+?)\s*(?:••|\*\*)\s*(LAKI-LAKI|PEREMPUAN)\s*(?:••|\*\*)\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/i);
  const sepInput = pageDocument.getElementById("no_sep") as HTMLInputElement | null;
  const sep = normalize(sepInput?.value) || bodyText.match(/\b\d{4}R\d{7}V\d{6}\b/i)?.[0] || "";

  const allRows = Array.from(pageDocument.querySelectorAll("tr"));
  const dateRowText = normalize(allRows.find((row) => /Tanggal Rawat/i.test(normalize(row.textContent)) && /Masuk/i.test(normalize(row.textContent)) && /Pulang/i.test(normalize(row.textContent)))?.textContent);
  const dateMatches = dateRowText.match(/\d{1,2}(?:\/\d{1,2}\/\d{4}|\s+[A-Za-z]{3,}\s+\d{4})(?:\s+\d{1,2}:\d{2})?/g) ?? [];
  const debugDates = normalize(pageDocument.getElementById("trdebug")?.textContent).match(/\b\d{2}\/\d{2}\/\d{4}\b/g) ?? [];
  const dpjpRow = allRows.find((row) => normalize(row.querySelector(":scope > td")?.textContent).toLocaleLowerCase("id-ID") === "dpjp");
  const dpjpControl = dpjpRow?.querySelector("select, input") as HTMLSelectElement | HTMLInputElement | null;
  const dpjp = dpjpControl?.tagName === "SELECT"
    ? normalize((dpjpControl as HTMLSelectElement).selectedOptions[0]?.textContent || dpjpControl.value)
    : normalize(dpjpControl?.value) || normalize(Array.from(dpjpRow?.querySelectorAll(":scope > td") ?? [])[1]?.textContent);
  const careOverviewCells = Array.from(allRows.find((row) => normalize(row.querySelector(":scope > td")?.textContent) === "Jenis Rawat")?.querySelectorAll(":scope > td") ?? []).map((cell) => normalize(cell.textContent));
  const serviceClassCells = Array.from(allRows.find((row) => normalize(row.querySelector(":scope > td")?.textContent).includes("Kelas Pelayanan"))?.querySelectorAll(":scope > td") ?? []).map((cell) => normalize(cell.textContent));

  const payerInput = resultRoot.querySelector<HTMLInputElement>('input[name="pembayar_selisih_biaya"]:checked');
  const payerLabel = payerInput ? resultRoot.querySelector<HTMLLabelElement>(`label[for="${payerInput.id}"]`) : null;
  const costGap = normalize(pageDocument.getElementById("td_add_payment_amt")?.textContent);
  if (!costGap) return { ok: false, message: "Nominal Selisih Biaya belum tersedia pada hasil grouping INACBG." };

  return { ok: true, data: {
    sep,
    medicalRecordNumber: normalize(identity?.[1]),
    patientName: normalize(identity?.[2]),
    gender: normalize(identity?.[3]),
    birthDate: normalize(identity?.[4]),
    admissionDate: dateMatches[0] || debugDates[0] || "",
    dischargeDate: dateMatches[1] || debugDates[1] || "",
    dpjp,
    insuranceClass: careOverviewCells[3] || "",
    serviceClass: serviceClassCells[1] || "",
    careType: rowValue("Jenis Rawat"),
    group: rowValue("Group"),
    totalClaim: rowCells("Total Klaim").at(-1) || "",
    costGap,
    costGapNote: rowCells("Tambahan Biaya")[1] || "",
    payer: normalize(payerLabel?.textContent) || normalize(payerInput?.value),
    status: rowValue("Status"),
  } };
}

export async function prepareVipCostGapCapture(data: VipCostGapData): Promise<InjectedResult<CaptureBounds>> {
  document.getElementById("claim-clarify-vip-capture")?.remove();
  const target = document.getElementById("dv_grouping_result_inacbg") as HTMLElement | null;
  if (!target) return { ok: false, message: "Elemen hasil Grouping INACBG tidak ditemukan untuk screenshot." };

  const overlay = document.createElement("div");
  overlay.id = "claim-clarify-vip-capture";
  const targetWidth = Math.min(Math.max(target.getBoundingClientRect().width, 760), window.innerWidth - 24);
  overlay.style.cssText = `position:fixed;left:12px;top:12px;width:${targetWidth}px;box-sizing:border-box;background:#fff;padding:12px;z-index:2147483647;box-shadow:0 0 0 2px #176f67;pointer-events:none;color:#111;`;

  const identity = document.createElement("div");
  identity.style.cssText = "margin:0 0 8px;padding:10px 12px;background:#f2f4f5;border:1px solid #c8d1d4;font:bold 14px Arial,sans-serif;line-height:1.45;";
  identity.textContent = [data.medicalRecordNumber, data.patientName, data.gender, data.birthDate].filter(Boolean).join(" •• ") || `SEP ${data.sep || "-"}`;
  const details = document.createElement("div");
  details.style.cssText = "margin-top:3px;font:12px Arial,sans-serif;font-weight:normal;";
  details.textContent = `SEP ${data.sep || "-"} • Masuk ${data.admissionDate || "-"} • Pulang ${data.dischargeDate || "-"} • DPJP ${data.dpjp || "-"} • ${data.insuranceClass || "-"} → ${data.serviceClass || "-"}`;
  identity.appendChild(details);

  const clone = target.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.style.cssText += ";position:static!important;width:100%!important;margin:0!important;";
  clone.querySelectorAll("#trdebug, input[type=button]").forEach((element) => element.remove());
  overlay.append(identity, clone);
  document.body.appendChild(overlay);

  const scale = Math.min(1, (window.innerWidth - 24) / overlay.scrollWidth, (window.innerHeight - 24) / overlay.scrollHeight);
  overlay.style.transformOrigin = "top left";
  overlay.style.transform = `scale(${scale})`;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const rect = overlay.getBoundingClientRect();
  return { ok: true, data: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight } };
}

export function cleanupVipCostGapCapture() {
  document.getElementById("claim-clarify-vip-capture")?.remove();
}
