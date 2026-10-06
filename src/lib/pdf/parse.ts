import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const PDF_CAPTURE_REQUEST_KEY = "claimClarify.activePdfRequest";
export const pdfCaptureKey = (tabId: number) => `claimClarify.activePdf.${tabId}`;

type MimeHandlerApi = {
  setMimeHandlerOptions(mimeType: string, options: { enabled: boolean }): Promise<void>;
};

type CapturedPdf = {
  originalUrl: string;
  text?: string;
  error?: string;
};

export async function parsePdfFile(file: File): Promise<string> {
  return parsePdfBuffer(await file.arrayBuffer());
}

export async function parsePdfUrl(url: string): Promise<string> {
  const buffer = url.startsWith("file:") ? await readLocalFileUrl(url) : await fetchPdfBuffer(url);
  return parsePdfBuffer(buffer);
}

export async function captureActiveTabPdf(tabId: number, url: string): Promise<string | null> {
  const mimeHandler = (chrome as typeof chrome & { mimeHandler?: MimeHandlerApi }).mimeHandler;
  if (!mimeHandler || !chrome.storage?.session) return null;

  const captureKey = pdfCaptureKey(tabId);
  await chrome.storage.session.remove(captureKey);
  await chrome.storage.session.set({ [PDF_CAPTURE_REQUEST_KEY]: { tabId, url } });
  await mimeHandler.setMimeHandlerOptions("application/pdf", { enabled: true });

  try {
    await chrome.tabs.reload(tabId);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const stored = await chrome.storage.session.get(captureKey);
      const capture = stored[captureKey] as CapturedPdf | undefined;
      if (capture) {
        if (capture.originalUrl !== url) throw new Error("PDF yang ditangkap tidak sama dengan tab aktif.");
        if (capture.error) throw new Error(capture.error);
        if (!capture.text) throw new Error("Teks PDF lokal tidak ditemukan.");
        return capture.text;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Brave tidak memberikan stream PDF dalam 30 detik. Muat ulang extension lalu coba lagi.");
  } finally {
    await mimeHandler.setMimeHandlerOptions("application/pdf", { enabled: false }).catch(() => undefined);
    await chrome.storage.session.remove([PDF_CAPTURE_REQUEST_KEY, captureKey]);
  }
}

async function fetchPdfBuffer(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`PDF gagal diunduh (${response.status}).`);
    return response.arrayBuffer();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PDF gagal")) throw error;
    throw new Error("PDF gagal dibaca dari URL. Periksa izin akses, CORS, atau koneksi.");
  }
}

export async function readLocalFileUrl(url: string): Promise<ArrayBuffer> {
  const directResult = await readLocalFileDirectly(url).catch((error) => error instanceof Error ? error.message : "Side panel gagal membaca file.");
  if (directResult instanceof ArrayBuffer) return directResult;

  const backgroundError = await readLocalFileInBackground(url).catch((error) => error instanceof Error ? error.message : "Service worker gagal membaca file.");
  if (backgroundError instanceof ArrayBuffer) return backgroundError;

  try {
    return await readLocalFileWithXhr(url);
  } catch {
    throw new Error(`PDF lokal tidak dapat dibaca meski izin file aktif. Pastikan file belum dipindahkan dan tab masih menampilkan PDF asli. Detail: ${directResult}; ${backgroundError}`);
  }
}

async function readLocalFileDirectly(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch langsung gagal (${response.status}).`);
  return response.arrayBuffer();
}

async function readLocalFileInBackground(url: string) {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) throw new Error("Service worker ekstensi tidak tersedia.");
  const response = await chrome.runtime.sendMessage({ type: "claim-clarify:read-local-pdf", url }) as { ok?: boolean; base64?: string; error?: string };
  if (!response?.ok || !response.base64) throw new Error(response?.error || "Service worker tidak mengembalikan data PDF.");
  const binary = atob(response.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function readLocalFileWithXhr(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    request.responseType = "arraybuffer";
    request.onload = () => request.status === 0 || request.status === 200
      ? resolve(request.response)
      : reject(new Error(`PDF lokal gagal dibaca (${request.status}).`));
    request.onerror = () => reject(new Error("XHR gagal membaca PDF lokal."));
    request.send();
  });
}

export async function parsePdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const text = pages.join("\n\n").trim();
  if (!text) throw new Error("PDF tidak memiliki layer teks. Silakan tempel teks rekam medis manual.");
  return text;
}
