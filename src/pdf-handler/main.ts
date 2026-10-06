import { parsePdfBuffer, PDF_CAPTURE_REQUEST_KEY, pdfCaptureKey } from "../lib/pdf/parse";

type MimeHandlerApi = {
  getStreamInfo(): Promise<{ originalUrl: string; streamUrl: string; tabId: number }>;
  setMimeHandlerOptions(mimeType: string, options: { enabled: boolean }): Promise<void>;
  abortAndFallbackToNativeHandler(): Promise<void>;
};

const mimeHandler = (chrome as typeof chrome & { mimeHandler: MimeHandlerApi }).mimeHandler;

async function capturePdf() {
  const stream = await mimeHandler.getStreamInfo();
  const stored = await chrome.storage.session.get(PDF_CAPTURE_REQUEST_KEY);
  const request = stored[PDF_CAPTURE_REQUEST_KEY] as { tabId?: number; url?: string } | undefined;

  if (request?.tabId !== stream.tabId || request.url !== stream.originalUrl) {
    await mimeHandler.abortAndFallbackToNativeHandler();
    return;
  }

  const key = pdfCaptureKey(stream.tabId);
  try {
    const response = await fetch(stream.streamUrl);
    if (!response.ok) throw new Error(`Stream PDF gagal dibaca (${response.status}).`);
    const text = await parsePdfBuffer(await response.arrayBuffer());
    await chrome.storage.session.set({ [key]: { originalUrl: stream.originalUrl, text } });
  } catch (error) {
    await chrome.storage.session.set({
      [key]: {
        originalUrl: stream.originalUrl,
        error: error instanceof Error ? error.message : "PDF lokal gagal diproses.",
      },
    });
  } finally {
    await mimeHandler.setMimeHandlerOptions("application/pdf", { enabled: false }).catch(() => undefined);
    await mimeHandler.abortAndFallbackToNativeHandler();
  }
}

void capturePdf();
