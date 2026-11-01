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
    func: renderVipCostGapScreenshot,
    args: [data],
  });
  const result = execution?.result as InjectedResult<string> | undefined;
  if (!result) throw new Error("Screenshot tidak dapat dibuat dari halaman e-Klaim.");
  if (!result.ok) throw new Error(result.message);
  const blob = await fetch(result.data).then((response) => response.blob());
  if (blob.type !== "image/png") throw new Error("Format screenshot bukan PNG.");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
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

export async function renderVipCostGapScreenshot(data: VipCostGapData): Promise<InjectedResult<string>> {
  const target = document.getElementById("dv_grouping_result_inacbg") as HTMLElement | null;
  if (!target) return { ok: false, message: "Elemen hasil Grouping INACBG tidak ditemukan untuk screenshot." };

  const capture = document.createElement("div");
  const targetWidth = Math.min(Math.max(target.getBoundingClientRect().width, 760), 1400);
  capture.style.cssText = `position:absolute;left:-10000px;top:0;width:${targetWidth}px;box-sizing:border-box;background:#fff;padding:12px;color:#111;`;

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
  clone.querySelectorAll("#trdebug, input[type=button], img").forEach((element) => element.remove());
  capture.append(identity, clone);
  document.body.appendChild(capture);

  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const styleProperties = [
      "background-color", "border", "border-collapse", "border-spacing", "border-radius", "box-sizing", "color",
      "display", "font-family", "font-size", "font-style", "font-weight", "height", "line-height", "margin",
      "padding", "table-layout", "text-align", "text-decoration", "vertical-align", "white-space", "width",
    ];
    for (const element of [capture, ...Array.from(capture.querySelectorAll<HTMLElement>("*"))]) {
      const computed = getComputedStyle(element);
      const existing = element.getAttribute("style") || "";
      const inline = styleProperties.map((property) => `${property}:${computed.getPropertyValue(property)};`).join("");
      element.setAttribute("style", `${existing};${inline}`);
    }
    capture.style.position = "static";
    capture.style.left = "0";
    capture.style.top = "0";
    capture.style.margin = "0";
    capture.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const width = Math.ceil(capture.scrollWidth);
    const height = Math.ceil(capture.scrollHeight);
    const html = new XMLSerializer().serializeToString(capture);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, message: "Canvas screenshot tidak tersedia." };
    context.scale(pixelRatio, pixelRatio);
    context.drawImage(image, 0, 0, width, height);
    return { ok: true, data: canvas.toDataURL("image/png") };
  } catch {
    return { ok: false, message: "Elemen hasil grouping gagal dirender menjadi gambar PNG." };
  } finally {
    capture.remove();
  }
}
