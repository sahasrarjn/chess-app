const TOKEN_KEY = "bc_player_token";
const NAME_KEY = "bc_guest_name";

const ADJECTIVES = [
  "Brave", "Swift", "Clever", "Bold", "Calm", "Sly", "Quick", "Wise",
  "Lucky", "Noble", "Sharp", "Daring", "Steady", "Fierce", "Royal",
];
const NOUNS = [
  "Knight", "Bishop", "Rook", "Pawn", "Castle", "Gambit", "Tactician",
  "Strategist", "Champion", "Challenger", "Player", "Rival",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${100 + Math.floor(Math.random() * 900)}`;
}

/** Stable per-browser id that owns a seat (enables reconnect). Never shown. */
export function getPlayerToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

export function getGuestName(): string {
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = randomName();
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

/** Extract a room id from a pasted share link or a bare code. */
export function roomIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const room = new URL(trimmed, location.origin).searchParams.get("room");
    if (room) return room;
  } catch {
    // not a URL — fall through to bare-code handling
  }
  const code = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  return code || null;
}

/** Unguessable room id for share links. */
export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

export function setGuestName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 24) || "Guest";
  localStorage.setItem(NAME_KEY, cleaned);
  return cleaned;
}
