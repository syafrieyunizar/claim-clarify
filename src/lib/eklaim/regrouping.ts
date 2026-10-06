export type RegroupingItemStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface RegroupingProgress {
  sep: string;
  index: number;
  total: number;
  status: RegroupingItemStatus;
  step: string;
  error?: string;
}

type RegroupingAction =
  | "validate-home"
  | "open-patient"
  | "open-admission"
  | "edit-claim"
  | "confirm-edit"
  | "edit-inacbg"
  | "read-grouping-marker"
  | "grouping"
  | "wait-grouping-change"
  | "final-inacbg"
  | "final-claim"
  | "send-online"
  | "wait-sent";

type InjectedResult = { ok: boolean; retry?: boolean; message: string; marker?: string };

const CANCELLED = "__CLAIM_CLARIFY_REGROUPING_CANCELLED__";
const BEFORE_GROUPING_STEPS: Array<{ action: RegroupingAction; label: string; timeout?: number }> = [
  { action: "open-patient", label: "Mencari SEP", timeout: 20_000 },
  { action: "open-admission", label: "Membuka admission", timeout: 30_000 },
  { action: "edit-claim", label: "Membuka edit ulang klaim" },
  { action: "confirm-edit", label: "Mengonfirmasi edit ulang" },
  { action: "edit-inacbg", label: "Membuka Edit Ulang INACBG" },
];
const AFTER_GROUPING_STEPS: Array<{ action: RegroupingAction; label: string; timeout?: number; delayAfter?: number }> = [
  { action: "final-inacbg", label: "Finalisasi INA-CBG", timeout: 45_000 },
  { action: "final-claim", label: "Finalisasi klaim", timeout: 45_000 },
  { action: "send-online", label: "Mengirim klaim online", timeout: 45_000, delayAfter: 1_500 },
  { action: "wait-sent", label: "Menunggu status terkirim", timeout: 60_000 },
];

export function parseSepInput(value: string) {
  const tokens = value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const unique = [...new Set(tokens)];
  return {
    seps: unique.filter(isLikelySep),
    invalid: unique.filter((token) => !isLikelySep(token)),
  };
}

function isLikelySep(value: string) {
  return /^[A-Z0-9]{10,30}$/.test(value) && /\d/.test(value);
}

export async function runRegroupingBatch(
  seps: string[],
  onProgress: (progress: RegroupingProgress) => void,
  isCancelled: () => boolean,
) {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
    throw new Error("Otomatisasi e-Klaim hanya tersedia di Chrome Extension.");
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url)) {
    throw new Error("Buka halaman awal e-Klaim pada tab aktif terlebih dahulu.");
  }

  const tabId = tab.id;
  const homeUrl = tab.url;
  const originPermission = { origins: [`${new URL(homeUrl).origin}/*`] };
  if (chrome.permissions && !(await chrome.permissions.contains(originPermission))) {
    const granted = await chrome.permissions.request(originPermission);
    if (!granted) throw new Error("Izin mengakses halaman e-Klaim ditolak.");
  }
  await runStep(tabId, "validate-home", "", 4_000, isCancelled);

  for (let index = 0; index < seps.length; index += 1) {
    const sep = seps[index];
    const base = { sep, index, total: seps.length };
    try {
      assertRunning(isCancelled);
      onProgress({ ...base, status: "running", step: "Memeriksa halaman awal" });
      await runStep(tabId, "validate-home", sep, 8_000, isCancelled);

      for (const step of BEFORE_GROUPING_STEPS) {
        assertRunning(isCancelled);
        onProgress({ ...base, status: "running", step: step.label });
        await runStep(tabId, step.action, sep, step.timeout ?? 30_000, isCancelled);
        await delay(350);
      }

      onProgress({ ...base, status: "running", step: "Membaca waktu grouping sebelumnya" });
      const groupingBefore = await runStep(tabId, "read-grouping-marker", sep, 15_000, isCancelled);
      onProgress({ ...base, status: "running", step: "Menjalankan grouping" });
      await runStep(tabId, "grouping", sep, 30_000, isCancelled);
      onProgress({ ...base, status: "running", step: "Menunggu hasil grouping berubah" });
      await runStep(tabId, "wait-grouping-change", sep, 60_000, isCancelled, groupingBefore.marker ?? "");

      for (const step of AFTER_GROUPING_STEPS) {
        assertRunning(isCancelled);
        onProgress({ ...base, status: "running", step: step.label });
        await runStep(tabId, step.action, sep, step.timeout ?? 30_000, isCancelled);
        await delay(step.delayAfter ?? 350);
      }

      onProgress({ ...base, status: "running", step: "Kembali ke halaman awal" });
      await chrome.tabs.update(tabId, { url: homeUrl });
      await runStep(tabId, "validate-home", sep, 30_000, isCancelled);
      onProgress({ ...base, status: "done", step: "Terkirim" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Re-grouping gagal.";
      if (message === CANCELLED) {
        onProgress({ ...base, status: "cancelled", step: "Dihentikan" });
        throw new Error("Proses dihentikan pengguna.");
      }
      onProgress({ ...base, status: "failed", step: "Gagal", error: message });
      throw new Error(`${sep}: ${message}`);
    }
  }
}

async function runStep(tabId: number, action: RegroupingAction, sep: string, timeout: number, isCancelled: () => boolean, context = "") {
  const deadline = Date.now() + timeout;
  let lastMessage = "Elemen e-Klaim belum siap.";

  while (Date.now() < deadline) {
    assertRunning(isCancelled);
    let result: InjectedResult | undefined;
    try {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: executeEklaimRegroupingStep,
        args: [action, sep, context],
      });
      result = execution?.result as InjectedResult | undefined;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : lastMessage;
      await delay(500);
      continue;
    }
    if (result?.ok) return result;
    lastMessage = result?.message || lastMessage;
    if (result && !result.retry) throw new Error(lastMessage);
    await delay(500);
  }

  if (action === "validate-home") {
    throw new Error("Halaman awal e-Klaim tidak ditemukan. Pastikan kolom pencarian pasien (#qpat) terlihat.");
  }
  throw new Error(lastMessage);
}

function assertRunning(isCancelled: () => boolean) {
  if (isCancelled()) throw new Error(CANCELLED);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function executeEklaimRegroupingStep(action: RegroupingAction, sep: string, context = ""): Promise<InjectedResult> {
  const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, "").toUpperCase();
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
  const labelOf = (element: Element) => {
    const inputValue = element.tagName === "INPUT" ? (element as HTMLInputElement).value : "";
    return String(inputValue || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "")
      .replace(/[\s\u00a0]+/g, " ")
      .trim()
      .toLocaleLowerCase("id-ID");
  };
  const findButton = (labels: string[], scope?: ParentNode) => {
    const wanted = labels.map((label) => label.toLocaleLowerCase("id-ID"));
    const roots: ParentNode[] = scope ? [scope] : documents;
    const elements = roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>('button, a, input[type="button"], input[type="submit"], [role="button"]')))
      .filter((element) => visible(element) && !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true");
    return elements.find((element) => wanted.includes(labelOf(element)));
  };
  const hasButton = (labels: string[]) => Boolean(findButton(labels));
  const clickButton = (labels: string[], missing: string, scope?: ParentNode): InjectedResult => {
    const button = findButton(labels, scope);
    if (!button) return { ok: false, retry: true, message: missing };
    button.scrollIntoView({ block: "center" });
    const ownerWindow = button.ownerDocument.defaultView ?? window;
    const originalConfirm = ownerWindow.confirm;
    ownerWindow.confirm = () => true;
    try {
      button.click();
    } finally {
      ownerWindow.confirm = originalConfirm;
    }
    return { ok: true, message: labels[0] };
  };
  const findInput = (selector: string) => documents.map((current) => current.querySelector<HTMLInputElement>(selector)).find(Boolean) ?? null;
  const allStatusElements = () => documents.flatMap((current) => Array.from(current.querySelectorAll<HTMLElement>("td, span, div, p, strong, label")));
  const hasSentStatus = () => allStatusElements()
    .some((element) => {
      if (!visible(element)) return false;
      const label = labelOf(element);
      return label === "terkirim" || label === "status terkirim" || label.includes("status klaim terkirim");
    });
  const groupingMarker = () => {
    for (const current of documents) {
      const rows = Array.from(current.querySelectorAll<HTMLTableRowElement>("tr"));
      const row = rows.find((candidate) => {
        const cells = candidate.querySelectorAll("th, td");
        return cells.length > 1 && labelOf(cells[0]) === "info" && labelOf(candidate.closest("table") ?? candidate).includes("hasil grouping inacbg");
      });
      if (row?.textContent?.trim()) return row.textContent.replace(/[\s\u00a0]+/g, " ").trim();
    }
    return "";
  };

  if (action === "validate-home") {
    const input = findInput("#qpat");
    return input && visible(input) && !input.disabled
      ? { ok: true, message: "Halaman awal e-Klaim siap." }
      : { ok: false, retry: true, message: "Kolom pencarian pasien e-Klaim (#qpat) tidak ditemukan." };
  }

  if (action === "open-patient") {
    const input = findInput("#qpat");
    if (!input) return { ok: false, retry: false, message: "Kolom pencarian pasien e-Klaim (#qpat) tidak ditemukan." };
    const ownerWindow = input.ownerDocument.defaultView ?? window;
    const setter = Object.getOwnPropertyDescriptor(ownerWindow.HTMLInputElement.prototype, "value")?.set;
    const setValue = (value: string) => setter ? setter.call(input, value) : (input.value = value);
    input.scrollIntoView({ block: "center" });
    input.focus();
    setValue("");
    input.dispatchEvent(new ownerWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new ownerWindow.Event("change", { bubbles: true }));
    for (const character of sep) {
      const keyCode = character.charCodeAt(0);
      input.dispatchEvent(new ownerWindow.KeyboardEvent("keydown", { key: character, keyCode, which: keyCode, bubbles: true }));
      input.dispatchEvent(new ownerWindow.KeyboardEvent("keypress", { key: character, keyCode, which: keyCode, bubbles: true }));
      setValue(input.value + character);
      input.dispatchEvent(new ownerWindow.Event("input", { bubbles: true }));
      input.dispatchEvent(new ownerWindow.KeyboardEvent("keyup", { key: character, keyCode, which: keyCode, bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    }
    input.dispatchEvent(new ownerWindow.Event("change", { bubbles: true }));
    if (normalize(input.value) !== normalize(sep)) {
      return { ok: false, retry: false, message: "Nomor SEP gagal ditulis ke kolom pencarian pasien." };
    }
    input.dispatchEvent(new ownerWindow.KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    input.dispatchEvent(new ownerWindow.KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    input.dispatchEvent(new ownerWindow.KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const dropdown = input.ownerDocument.getElementById(`${input.id}_subres`);
      const first = dropdown && visible(dropdown) ? Array.from(dropdown.children).find(visible) as HTMLElement | undefined : undefined;
      if (first) {
        first.click();
        return { ok: true, message: "Hasil pasien dipilih." };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return { ok: false, retry: false, message: "Pasien dengan SEP tersebut tidak ditemukan." };
  }

  if (action === "open-admission") {
    const expected = normalize(sep);
    const sepCell = documents.flatMap((current) => Array.from(current.querySelectorAll<HTMLElement>('td[id^="tdsep_"]')))
      .find((cell) => normalize(cell.textContent) === expected);
    const admissionId = sepCell?.id.replace(/^tdsep_/, "");
    const dateLink = admissionId ? sepCell?.ownerDocument.getElementById(`spadmdttm_${admissionId}`) : null;
    if (!dateLink) return { ok: false, retry: true, message: "SEP belum ditemukan di daftar admission e-Klaim." };
    dateLink.scrollIntoView({ block: "center" });
    dateLink.click();
    return { ok: true, message: "Admission dibuka." };
  }

  if (action === "edit-claim") {
    for (const current of documents) current.defaultView?.scrollTo(0, current.documentElement.scrollHeight);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (hasButton(["ya (edit ulang)", "edit ulang inacbg", "edit ulang ina-cbg"])) return { ok: true, message: "Edit ulang sudah terbuka." };
    return clickButton(["edit ulang klaim"], "Tombol Edit Ulang Klaim belum ditemukan.");
  }

  if (action === "confirm-edit") {
    if (hasButton(["edit ulang inacbg", "edit ulang ina-cbg"])) return { ok: true, message: "Konfirmasi edit ulang selesai." };
    return clickButton(["ya (edit ulang)", "ya edit ulang", "ya, edit ulang"], "Tombol Ya (edit ulang) belum ditemukan.");
  }

  if (action === "edit-inacbg") {
    if (hasButton(["grouping"])) return { ok: true, message: "Halaman INA-CBG sudah terbuka." };
    return clickButton(["edit ulang inacbg", "edit ulang ina-cbg", "edit inacbg", "edit ina-cbg"], "Tombol Edit Ulang INACBG belum ditemukan.");
  }

  if (action === "read-grouping-marker") {
    const marker = groupingMarker();
    return marker
      ? { ok: true, message: "Waktu grouping sebelumnya terbaca.", marker }
      : { ok: false, retry: true, message: "Informasi waktu hasil grouping belum terbaca." };
  }

  if (action === "grouping") {
    return clickButton(["grouping"], "Tombol Grouping belum ditemukan.");
  }

  if (action === "wait-grouping-change") {
    const marker = groupingMarker();
    return marker && marker !== context
      ? { ok: true, message: "Waktu hasil grouping sudah berubah.", marker }
      : { ok: false, retry: true, message: "Menunggu waktu hasil grouping berubah." };
  }

  if (action === "final-inacbg") {
    if (hasButton(["final klaim"])) return { ok: true, message: "INA-CBG sudah difinalkan." };
    const explicit = findButton(["final inacbg", "final ina-cbg"]);
    if (explicit) return clickButton(["final inacbg", "final ina-cbg"], "Tombol Final INA-CBG belum ditemukan.");
    if (documents.some((current) => current.body?.textContent?.toLocaleLowerCase("id-ID").includes("ina-cbg"))) {
      return clickButton(["final"], "Tombol Final INA-CBG belum ditemukan.");
    }
    return { ok: false, retry: true, message: "Tombol Final INA-CBG belum ditemukan." };
  }

  if (action === "final-claim") {
    if (hasButton(["kirim klaim online", "kirim online"])) return { ok: true, message: "Klaim sudah difinalkan." };
    return clickButton(["final klaim"], "Tombol Final Klaim belum ditemukan.");
  }

  if (action === "send-online") {
    return clickButton(["kirim klaim online", "kirim online"], "Tombol Kirim Klaim Online belum ditemukan.");
  }

  return hasSentStatus()
    ? { ok: true, message: "Status klaim terkirim." }
    : { ok: false, retry: true, message: "Status terkirim belum muncul." };
}
