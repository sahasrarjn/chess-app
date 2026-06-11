import type { Profile } from "./api";

const TOKEN_KEY = "bc_session_token";
const PROFILE_KEY = "bc_session_profile";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getSessionToken(storage: StorageLike = localStorage): string | null {
  return storage.getItem(TOKEN_KEY);
}

export function getCachedProfile(storage: StorageLike = localStorage): Profile | null {
  const raw = storage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function saveSession(
  token: string,
  profile: Profile,
  storage: StorageLike = localStorage
): void {
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearSession(storage: StorageLike = localStorage): void {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(PROFILE_KEY);
}
