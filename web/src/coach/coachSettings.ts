export const COACH_ENABLED_KEY = "chessborder.coachEnabled";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadCoachEnabled(storage: StorageLike = localStorage): boolean {
  try {
    return storage.getItem(COACH_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveCoachEnabled(enabled: boolean, storage: StorageLike = localStorage): void {
  try {
    if (enabled) storage.setItem(COACH_ENABLED_KEY, "1");
    else storage.removeItem(COACH_ENABLED_KEY);
  } catch {
    /* private browsing — coach stays session-local */
  }
}
