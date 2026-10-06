const memoryStore = new Map<string, unknown>();

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  if (!hasChromeStorage()) return (memoryStore.get(key) as T | undefined) ?? fallback;
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

export async function setLocal<T>(key: string, value: T): Promise<void> {
  if (!hasChromeStorage()) {
    memoryStore.set(key, value);
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocal(key: string): Promise<void> {
  if (!hasChromeStorage()) {
    memoryStore.delete(key);
    return;
  }
  await chrome.storage.local.remove(key);
}
