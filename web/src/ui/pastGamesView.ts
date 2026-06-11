import {
  loadGameHistory,
  resultLabel,
  type CompletedGameRecord,
} from "../game/gameHistory";
import { listGames } from "../auth/gamesApi";
import { getSessionToken } from "../auth/session";
import { isAuthConfigured, ACCOUNTS_API_URL } from "../auth/config";

function resolveApiUrl(): string | undefined {
  try {
    return ACCOUNTS_API_URL;
  } catch {
    return undefined;
  }
}

export function renderPastGames(
  root: HTMLElement,
  onBack: () => void,
  onOpenReplay: (record: CompletedGameRecord) => void
): () => void {
  const abort = new AbortController();
  let destroyed = false;

  root.innerHTML = "";
  const container = el("div", "past-games");

  // Header
  const header = el("div", "game-header");
  const backBtn = el("button", "back", "← Back");
  backBtn.onclick = () => onBack();
  header.appendChild(backBtn);
  header.appendChild(el("h2", "", "Past Games"));
  container.appendChild(header);

  const content = el("div", "past-games-content");
  container.appendChild(content);
  root.appendChild(container);

  // Render function (called after data loads)
  function render(
    cloudGames: CompletedGameRecord[] | null,
    cloudError: string | null,
    nextCursor: string | null,
    loadMore: (() => void) | null
  ): void {
    if (destroyed) return;
    content.innerHTML = "";

    const localGames = loadGameHistory();
    const hasCloud = cloudGames !== null && cloudGames.length > 0;
    const hasLocal = localGames.length > 0;

    if (cloudError) {
      const note = el("p", "past-games-note", cloudError);
      content.appendChild(note);
    }

    if (hasCloud) {
      const section = el("div", "past-games-section");
      section.appendChild(el("h3", "past-games-section-title", "Your games"));
      const list = el("div", "past-games-list");
      for (const record of cloudGames!) {
        list.appendChild(buildRow(record, onOpenReplay));
      }
      section.appendChild(list);

      if (loadMore && nextCursor) {
        const btn = el("button", "past-games-load-more", "Load more") as HTMLButtonElement;
        btn.onclick = () => {
          btn.disabled = true;
          btn.textContent = "Loading…";
          loadMore();
        };
        section.appendChild(btn);
      }

      content.appendChild(section);
    }

    if (hasLocal) {
      const section = el("div", "past-games-section");
      section.appendChild(el("h3", "past-games-section-title", "On this device"));
      const list = el("div", "past-games-list");
      for (const record of localGames) {
        list.appendChild(buildRow(record, onOpenReplay));
      }
      section.appendChild(list);
      content.appendChild(section);
    }

    if (!hasCloud && !hasLocal && !cloudError) {
      content.appendChild(
        el("p", "past-games-note", "No finished games yet — play one!")
      );
    } else if (!hasCloud && !hasLocal) {
      // cloudError already shown; show empty local message too
      content.appendChild(
        el("p", "past-games-note", "No finished games on this device yet.")
      );
    }
  }

  // Initial render — local only, then load cloud if signed in
  const token = isAuthConfigured ? getSessionToken() : null;
  const baseUrl = resolveApiUrl();

  if (token && baseUrl) {
    // Show local games immediately while fetching
    render(null, null, null, null);

    let cursor: string | null = null;
    let allCloudGames: CompletedGameRecord[] = [];

    async function loadCloudPage(): Promise<void> {
      if (destroyed) return;
      try {
        const page = await listGames(baseUrl!, token!, cursor || undefined, fetch, abort.signal);
        if (destroyed) return;
        allCloudGames = [...allCloudGames, ...page.games];
        cursor = page.nextCursor;
        render(
          allCloudGames,
          null,
          cursor,
          cursor ? loadCloudPage : null
        );
      } catch (err) {
        // Silently ignore aborted requests
        if ((err as { name?: string }).name === "AbortError") return;
        if (destroyed) return;
        render(
          allCloudGames.length > 0 ? allCloudGames : null,
          "Couldn't load cloud games — showing this device only.",
          null,
          null
        );
      }
    }

    void loadCloudPage();
  } else {
    // Guest or unconfigured: show local only
    render(null, null, null, null);
  }

  return () => {
    destroyed = true;
    abort.abort();
    root.innerHTML = "";
  };
}

function buildRow(
  record: CompletedGameRecord,
  onOpenReplay: (record: CompletedGameRecord) => void
): HTMLElement {
  const row = el("button", "past-game-row");

  const label = resultLabel(record);
  const badge = el("span", `result-badge ${label.kind}`, label.text);
  row.appendChild(badge);

  const info = el("div", "past-game-info");
  const topLine = el("div", "past-game-top");
  let opponentText = record.opponent;
  if (record.mode === "vsBot" && record.difficulty) {
    opponentText += ` · ${record.difficulty}`;
  }
  topLine.appendChild(el("span", "past-game-opponent", opponentText));
  info.appendChild(topLine);

  const meta = el("div", "past-game-meta");
  const dateText = new Date(record.endedAt).toLocaleDateString();
  const movesText = `${record.moves.length} moves`;
  meta.textContent = `${dateText} · ${movesText}`;
  info.appendChild(meta);

  row.appendChild(info);
  row.onclick = () => onOpenReplay(record);
  return row;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  return node;
}
