export type Provider = "google" | "apple";

export interface Profile {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string; // ISO 8601
}

export interface LoginRequest {
  provider: Provider;
  idToken: string;
  /** Display-name hint. Apple sends the user's name only client-side on
   *  FIRST authorization; clients forward it here. Used only at creation. */
  name?: string;
}

export interface LoginResponse {
  token: string;
  profile: Profile;
}

export interface MeResponse {
  profile: Profile;
}

export interface UpdateMeRequest {
  displayName: string;
}

export interface ErrorResponse {
  error: string;
}

const MAX_ID_TOKEN_LENGTH = 4096;

export function parseLoginRequest(raw: string | undefined | null): LoginRequest | null {
  const m = parseObject(raw);
  if (!m) return null;
  if (m.provider !== "google" && m.provider !== "apple") return null;
  if (typeof m.idToken !== "string" || m.idToken.length === 0 || m.idToken.length > MAX_ID_TOKEN_LENGTH) {
    return null;
  }
  const req: LoginRequest = { provider: m.provider, idToken: m.idToken };
  if (typeof m.name === "string" && m.name.trim().length > 0) {
    req.name = m.name;
  }
  return req;
}

export function parseUpdateMeRequest(raw: string | undefined | null): UpdateMeRequest | null {
  const m = parseObject(raw);
  if (!m || typeof m.displayName !== "string") return null;
  return { displayName: m.displayName };
}

/** Trim + collapse whitespace; valid at 1–30 chars, else null. */
export function validateDisplayName(name: string): string | null {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length < 1 || cleaned.length > 30) return null;
  return cleaned;
}

function parseObject(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}
