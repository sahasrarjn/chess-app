const URL_KEY = "chessborder.engineUrl";
const API_KEY_KEY = "chessborder.apiKey";

export function getEngineUrl(): string {
  const stored = localStorage.getItem(URL_KEY)?.trim();
  if (stored) return stored.replace(/\/$/, "");
  return "";
}

export function setEngineUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) localStorage.setItem(URL_KEY, trimmed.replace(/\/$/, ""));
  else localStorage.removeItem(URL_KEY);
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_KEY)?.trim() ?? "";
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(API_KEY_KEY, trimmed);
  else localStorage.removeItem(API_KEY_KEY);
}

export function isEngineConfigured(): boolean {
  return getEngineUrl().length > 0;
}

/**
 * API base URL for bot requests.
 * Browsers must call the same origin (Cloudflare worker); direct App Runner URLs
 * fail with "Failed to fetch" due to CORS.
 */
export function engineApiBase(): string {
  if (typeof window === "undefined") return "";
  const pageOrigin = window.location.origin;
  const stored = getEngineUrl();
  if (!stored) return pageOrigin;
  try {
    const storedOrigin = new URL(stored).origin;
    if (storedOrigin === pageOrigin) return stored;
  } catch {
    return pageOrigin;
  }
  return pageOrigin;
}
