const URL_KEY = "chessborder.engineUrl";

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

export function isEngineConfigured(): boolean {
  return getEngineUrl().length > 0;
}

/**
 * API base URL for bot requests.
 * Browsers call the same origin (Cloudflare worker). The worker adds the backend
 * API key server-side; clients never need a secret.
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
