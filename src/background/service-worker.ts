chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  disablePdfHandler();
});

chrome.runtime.onStartup.addListener(disablePdfHandler);

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isLocalPdfRequest(message)) return;
  void readLocalPdf(message.url)
    .then((base64) => sendResponse({ ok: true, base64 }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "PDF lokal gagal dibaca." }));
  return true;
});

function isLocalPdfRequest(message: unknown): message is { type: "claim-clarify:read-local-pdf"; url: string } {
  return typeof message === "object" && message !== null
    && "type" in message && message.type === "claim-clarify:read-local-pdf"
    && "url" in message && typeof message.url === "string";
}

async function readLocalPdf(value: string) {
  const url = new URL(value);
  if (url.protocol !== "file:") throw new Error("Hanya URL file lokal yang diizinkan.");
  const response = await fetch(url.toString());
  if (!response.ok && response.status !== 0) throw new Error(`Chrome gagal membaca PDF lokal (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("File PDF lokal kosong.");
  if (bytes.length > 40 * 1024 * 1024) throw new Error("PDF lokal lebih dari 40 MB. Gunakan metode Upload untuk file sebesar ini.");

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function disablePdfHandler() {
  const mimeHandler = (chrome as typeof chrome & { mimeHandler?: { setMimeHandlerOptions(mimeType: string, options: { enabled: boolean }): Promise<void> } }).mimeHandler;
  void mimeHandler?.setMimeHandlerOptions("application/pdf", { enabled: false }).catch(() => undefined);
}
