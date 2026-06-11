import { getSessionToken } from "../auth/session";
import { postGame } from "../auth/gamesApi";
import { AuthApiError } from "../auth/api";
import type { CompletedGameRecord } from "./gameHistory";

export const PENDING_UPLOADS_KEY = "chessborder.pendingGameUploads";
const MAX_PENDING = 10;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface UploadDeps {
  storage?: StorageLike;
  fetchImpl?: typeof fetch;
  /** Defaults to ACCOUNTS_API_URL env var (resolved lazily for test compat). */
  baseUrl?: string;
  getToken?: () => string | null;
}

function resolveBaseUrl(deps?: UploadDeps): string | undefined {
  if (deps?.baseUrl !== undefined) return deps.baseUrl;
  // Lazy access of import.meta.env so the module can be loaded in node:test
  // without crashing (import.meta.env is undefined outside Vite).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any).env as Record<string, string | undefined> | undefined;
    if (!env) return undefined;
    const raw = env.VITE_ACCOUNTS_API_URL;
    return raw?.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function readQueue(storage: StorageLike): CompletedGameRecord[] {
  try {
    const raw = storage.getItem(PENDING_UPLOADS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Invalid format — clear and start fresh
      storage.removeItem(PENDING_UPLOADS_KEY);
      return [];
    }
    return parsed as CompletedGameRecord[];
  } catch {
    // Corrupt JSON — clear and start fresh
    try { storage.removeItem(PENDING_UPLOADS_KEY); } catch { /* ignore */ }
    return [];
  }
}

function writeQueue(storage: StorageLike, queue: CompletedGameRecord[]): void {
  try {
    storage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(queue));
  } catch {
    // best-effort
  }
}

function enqueue(storage: StorageLike, record: CompletedGameRecord): void {
  const queue = readQueue(storage);
  queue.push(record);
  // Cap at MAX_PENDING, dropping oldest entries first
  const capped = queue.slice(-MAX_PENDING);
  writeQueue(storage, capped);
}

function dequeue(storage: StorageLike, index: number): void {
  const queue = readQueue(storage);
  queue.splice(index, 1);
  writeQueue(storage, queue);
}

/** Queue a finished game and try to flush. No-ops for guests, for online
 *  games (server-recorded), and when accounts aren't configured. Never throws. */
export async function uploadCompletedGame(
  record: CompletedGameRecord,
  deps?: UploadDeps
): Promise<void> {
  try {
    const storage = deps?.storage ?? localStorage;
    const getToken = deps?.getToken ?? getSessionToken;
    const baseUrl = resolveBaseUrl(deps);

    // Skip if no base URL configured
    if (!baseUrl) return;

    // Skip guests
    const token = getToken();
    if (!token) return;

    // Skip online games — server-recorded
    if (record.mode === "online") return;

    // Enqueue first, then flush
    enqueue(storage, record);
    await flushPendingUploads({ ...deps, storage, baseUrl, getToken });
  } catch {
    // Never throws — uploads are best-effort
  }
}

/** Drain the queue in order. Per entry: success or 400 (permanently invalid)
 *  → remove; 401 or network error → stop and keep the rest for the next
 *  boot/sign-in. Never throws. Call once at boot. */
export async function flushPendingUploads(deps?: UploadDeps): Promise<void> {
  try {
    const storage = deps?.storage ?? localStorage;
    const getToken = deps?.getToken ?? getSessionToken;
    const fetchImpl = deps?.fetchImpl;
    const baseUrl = resolveBaseUrl(deps);

    if (!baseUrl) return;

    const token = getToken();
    if (!token) return;

    // Process entries in order (oldest first) — re-read queue before each attempt
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentQueue = readQueue(storage);
      if (currentQueue.length === 0) break;
      const record = currentQueue[0];
      try {
        await postGame(baseUrl, token, record, fetchImpl);
        // Success: remove first entry
        dequeue(storage, 0);
      } catch (err) {
        if (err instanceof AuthApiError) {
          if (err.status === 400) {
            // Permanently invalid — drop it and continue
            dequeue(storage, 0);
          } else {
            // 401 or other — stop, keep remaining for next boot
            break;
          }
        } else {
          // Network error — stop, keep remaining
          break;
        }
      }
    }
  } catch {
    // Never throws
  }
}
