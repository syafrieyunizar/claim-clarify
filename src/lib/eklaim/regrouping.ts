export type RegroupingItemStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface RegroupingProgress {
  sep: string;
  index: number;
  total: number;
  status: RegroupingItemStatus;
  step: string;
  error?: string;
}

export interface RegroupingFailure {
  sep: string;
  step: string;
  error: string;
}

export interface RegroupingBatchResult {
  succeeded: string[];
  failed: RegroupingFailure[];
  pending: string[];
  stopped: boolean;
  fatalError?: string;
}

export interface RegroupingControls {
  isPauseRequested: () => boolean;
  isStopAfterCurrentRequested: () => boolean;
  onPauseChange?: (paused: boolean) => void;
}

type RegroupingAction =
  | "validate-home"
  | "open-patient"
  | "open-admission"
  | "edit-claim"
  | "confirm-edit"
  | "edit-idrg"
  | "wait-final-idrg"
  | "final-idrg"
  | "wait-inacbg-grouping"
  | "grouping"
  | "wait-final-inacbg"
  | "final-inacbg"
  | "final-claim"
  | "send-online"
  | "wait-sent"
  | "pause-lock"
  | "clear-lock";

type InjectedResult = { ok: boolean; retry?: boolean; message: string; marker?: string };

const BEFORE_GROUPING_STEPS: Array<{ action: RegroupingAction; label: string; timeout?: number }> = [
  { action: "open-patient", label: "Mencari SEP", timeout: 20_000 },
  { action: "open-admission", label: "Membuka admission", timeout: 30_000 },
  { action: "edit-claim", label: "Membuka edit ulang klaim" },
  { action: "confirm-edit", label: "Mengonfirmasi edit ulang" },
  { action: "edit-idrg", label: "Membuka Edit Ulang iDRG" },
];
const AFTER_INACBG_STEPS: Array<{ action: RegroupingAction; label: string; timeout?: number; delayAfter?: number }> = [
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

export function getEklaimHomeUrl(currentUrl: string) {
  return new URL("index.php?0=padm&slpat_ch=y", currentUrl).toString();
}

export async function openRegroupingSepForReview(sep: string) {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
    throw new Error("Pemeriksaan SEP hanya tersedia di Chrome Extension.");
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url) || !/\/e-klaim(?:\/|$)/i.test(new URL(tab.url).pathname)) {
    throw new Error("Buka tab e-Klaim terlebih dahulu.");
  }

  const originPermission = { origins: [`${new URL(tab.url).origin}/*`] };
  if (chrome.permissions && !(await chrome.permissions.contains(originPermission))) {
    const granted = await chrome.permissions.request(originPermission);
    if (!granted) throw new Error("Izin mengakses halaman e-Klaim ditolak.");
  }

  try {
    await chrome.tabs.update(tab.id, { url: getEklaimHomeUrl(tab.url) });
    await runStep(tab.id, "validate-home", sep, 30_000);
    await runStep(tab.id, "open-patient", sep, 20_000);
    await runStep(tab.id, "open-admission", sep, 30_000);
  } finally {
    await clearPageLock(tab.id);
  }
}

export async function runRegroupingBatch(
  seps: string[],
  onProgress: (progress: RegroupingProgress) => void,
  controls: RegroupingControls,
): Promise<RegroupingBatchResult> {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
    throw new Error("Otomatisasi e-Klaim hanya tersedia di Chrome Extension.");
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url)) {
    throw new Error("Buka halaman awal e-Klaim pada tab aktif terlebih dahulu.");
  }

  const tabId = tab.id;
  const homeUrl = getEklaimHomeUrl(tab.url);
  const originPermission = { origins: [`${new URL(tab.url).origin}/*`] };
  if (chrome.permissions && !(await chrome.permissions.contains(originPermission))) {
    const granted = await chrome.permissions.request(originPermission);
    if (!granted) throw new Error("Izin mengakses halaman e-Klaim ditolak.");
  }

  const succeeded: string[] = [];
  const failed: RegroupingFailure[] = [];
  let stopped = false;
  let fatalError: string | undefined;

  try {
    await runStep(tabId, "validate-home", "", 8_000);
    for (let index = 0; index < seps.length; index += 1) {
      if (controls.isStopAfterCurrentRequested()) {
        stopped = true;
        break;
      }
      const sep = seps[index];
      const base = { sep, index, total: seps.length };
      let currentStep = "Memeriksa halaman awal";
      let sendAttempted = false;
      let sent = false;
      const execute = async (action: RegroupingAction, label: string, timeout = 30_000, context = "") => {
        await waitWhilePaused(tabId, controls);
        currentStep = label;
        onProgress({ ...base, status: "running", step: label });
        const result = await runStep(tabId, action, sep, timeout, context);
        await delay(350);
        return result;
      };

      try {
        await execute("validate-home", "Memeriksa halaman awal", 8_000);
        for (const step of BEFORE_GROUPING_STEPS) {
          await execute(step.action, step.label, step.timeout);
        }

        await execute("grouping", "Grouping iDRG", 45_000);
        await execute("wait-final-idrg", "Menunggu hasil grouping iDRG", 60_000);
        await execute("final-idrg", "Finalisasi iDRG", 45_000);
        await execute("wait-inacbg-grouping", "Menunggu Grouping INA-CBG", 45_000);

        await execute("grouping", "Grouping INA-CBG", 45_000);
        await execute("wait-final-inacbg", "Menunggu hasil grouping INA-CBG", 60_000);

        for (const step of AFTER_INACBG_STEPS) {
          await execute(step.action, step.label, step.timeout);
          if (step.action === "send-online") sendAttempted = true;
          if (step.delayAfter) await delay(step.delayAfter);
        }

        sent = true;
        succeeded.push(sep);
        onProgress({ ...base, status: "done", step: "Terkirim" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Re-grouping gagal.";
        if (sendAttempted) {
          try {
            await runStep(tabId, "wait-sent", sep, 5_000);
            sent = true;
            succeeded.push(sep);
            onProgress({ ...base, status: "done", step: "Terkirim" });
          } catch {
            // Keep the original failure when the sent status cannot be verified.
          }
        }
        if (!sent) {
          const failure = { sep, step: currentStep, error: message };
          failed.push(failure);
          onProgress({ ...base, status: "failed", step: currentStep, error: message });
        }
      }

      try {
        await returnToHome(tabId, homeUrl, sep);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gagal kembali ke halaman awal e-Klaim.";
        fatalError = sent
          ? `${sep} sudah berhasil dikirim online, tetapi gagal kembali ke halaman awal. ${message}`
          : `${sep} gagal diproses dan halaman awal e-Klaim tidak dapat dibuka. ${message}`;
        break;
      }

      if (controls.isStopAfterCurrentRequested()) {
        stopped = true;
        break;
      }
    }
  } finally {
    controls.onPauseChange?.(false);
    await clearPageLock(tabId);
  }

  const finished = new Set([...succeeded, ...failed.map((item) => item.sep)]);
  return {
    succeeded,
    failed,
    pending: seps.filter((sep) => !finished.has(sep)),
    stopped,
    ...(fatalError ? { fatalError } : {}),
  };
}

async function returnToHome(
  tabId: number,
  homeUrl: string,
  sep: string,
) {
  await chrome.tabs.update(tabId, { url: homeUrl });
  await runStep(tabId, "validate-home", sep, 30_000);
}

async function waitWhilePaused(tabId: number, controls: RegroupingControls) {
  if (!controls.isPauseRequested() || controls.isStopAfterCurrentRequested()) return;
  controls.onPauseChange?.(true);
  await runStep(tabId, "pause-lock", "", 5_000);
  while (controls.isPauseRequested() && !controls.isStopAfterCurrentRequested()) await delay(200);
  controls.onPauseChange?.(false);
}

async function clearPageLock(tabId: number) {
  try {
    await runStep(tabId, "clear-lock", "", 2_000);
  } catch {
    // The tab may have been closed or navigated away; cleanup is best effort.
  }
}

async function runStep(tabId: number, action: RegroupingAction, sep: string, timeout: number, context = "") {
  const deadline = Date.now() + timeout;
  let lastMessage = "Elemen e-Klaim belum siap.";

  while (Date.now() < deadline) {
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export async function executeEklaimRegroupingStep(action: RegroupingAction, sep: string, _context = ""): Promise<InjectedResult> {
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
  const lockId = "claim-clarify-regrouping-lock";
  const setPageLock = (paused: boolean) => {
    let overlay = document.getElementById(lockId) as HTMLDivElement | null;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = lockId;
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "rgba(15, 23, 42, 0.58)",
        cursor: "not-allowed",
        pointerEvents: "auto",
      });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = "";
    const notice = document.createElement("div");
    Object.assign(notice.style, {
      maxWidth: "420px",
      borderRadius: "14px",
      padding: "20px 22px",
      background: "#ffffff",
      color: "#102a43",
      boxShadow: "0 18px 55px rgba(15, 23, 42, 0.3)",
      fontFamily: "Arial, sans-serif",
      textAlign: "center",
      lineHeight: "1.5",
    });
    const title = document.createElement("strong");
    title.style.display = "block";
    title.style.marginBottom = "6px";
    title.style.fontSize = "16px";
    title.textContent = paused ? "Re-grouping sedang dijeda" : "Re-grouping sedang berjalan";
    const detail = document.createElement("span");
    detail.style.fontSize = "13px";
    detail.textContent = paused
      ? "Interaksi pada halaman e-Klaim sementara dikunci. Klik Lanjutkan di Claim Clarify untuk meneruskan."
      : "Interaksi pada halaman e-Klaim sementara dikunci untuk menjaga urutan proses.";
    notice.append(title, detail);
    overlay.appendChild(notice);
  };
  if (action === "clear-lock") {
    document.getElementById(lockId)?.remove();
    return { ok: true, message: "Kunci halaman dilepas." };
  }
  if (action === "pause-lock") {
    setPageLock(true);
    return { ok: true, message: "Halaman dikunci saat proses dijeda." };
  }
  setPageLock(false);
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
    if (hasButton(["ya (edit ulang)", "edit ulang idrg"])) return { ok: true, message: "Edit ulang sudah terbuka." };
    return clickButton(["edit ulang klaim"], "Tombol Edit Ulang Klaim belum ditemukan.");
  }

  if (action === "confirm-edit") {
    if (hasButton(["edit ulang idrg"])) return { ok: true, message: "Konfirmasi edit ulang selesai." };
    return clickButton(["ya (edit ulang)", "ya edit ulang", "ya, edit ulang"], "Tombol Ya (edit ulang) belum ditemukan.");
  }

  if (action === "edit-idrg") {
    if (hasButton(["grouping"])) return { ok: true, message: "Halaman iDRG sudah terbuka." };
    return clickButton(["edit ulang idrg"], "Tombol Edit Ulang iDRG belum ditemukan.");
  }

  if (action === "wait-final-idrg") {
    return hasButton(["final idrg"])
      ? { ok: true, message: "Hasil grouping iDRG siap difinalkan." }
      : { ok: false, retry: true, message: "Menunggu tombol Final iDRG." };
  }

  if (action === "final-idrg") {
    return clickButton(["final idrg"], "Tombol Final iDRG belum ditemukan.");
  }

  if (action === "wait-inacbg-grouping") {
    return hasButton(["grouping"])
      ? { ok: true, message: "Grouping INA-CBG siap dijalankan." }
      : { ok: false, retry: true, message: "Menunggu tombol Grouping INA-CBG." };
  }

  if (action === "grouping") {
    return clickButton(["grouping"], "Tombol Grouping belum ditemukan.");
  }

  if (action === "wait-final-inacbg") {
    return hasButton(["final inacbg", "final ina-cbg"])
      ? { ok: true, message: "Hasil grouping INA-CBG siap difinalkan." }
      : { ok: false, retry: true, message: "Menunggu tombol Final INA-CBG." };
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
