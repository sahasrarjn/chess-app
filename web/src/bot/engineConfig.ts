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

/** Base URL for engine API (empty = same origin). */
export function engineApiBase(): string {
  const custom = getEngineUrl();
  if (custom) return custom;
  return "";
}
