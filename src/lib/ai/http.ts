export async function prepareAiEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error("Endpoint URL tidak valid.");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Endpoint AI harus memakai HTTP atau HTTPS.");
  if (url.username || url.password) throw new Error("Endpoint AI tidak boleh memuat username atau password.");

  if (typeof chrome !== "undefined" && chrome.permissions?.contains) {
    const origins = [`${url.protocol}//${url.host}/*`];
    const hasAccess = await chrome.permissions.contains({ origins });
    if (!hasAccess) {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) throw new Error("Izin akses ke domain endpoint ditolak. Klik Uji Koneksi lalu izinkan akses domain.");
    }
  }
  return url.toString();
}

export function aiHttpError(provider: string, status: number) {
  const detail = status === 401
    ? "API key ditolak atau akses API dari browser belum diizinkan oleh akun provider."
    : status === 403
      ? "API key tidak memiliki izin untuk endpoint atau model ini."
      : status === 404
        ? "Endpoint atau model tidak ditemukan."
        : status === 429
          ? "Kuota atau batas permintaan API tercapai."
          : status >= 500
            ? "Layanan provider sedang bermasalah."
            : "Periksa endpoint, model, dan API key.";
  return `${provider} gagal merespons (${status}). ${detail}`;
}

export function aiNetworkError(error: unknown) {
  if (error instanceof Error && !error.message.toLocaleLowerCase("id-ID").includes("fetch")) return error;
  return new Error("Endpoint tidak dapat diakses. Periksa koneksi dan izinkan domain endpoint saat Uji Koneksi.");
}
