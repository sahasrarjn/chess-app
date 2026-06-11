import { fetchLeaderboard, winRateText, statLines, type LeaderboardMe, type LeaderboardEntry } from "../auth/leaderboardApi";
import { getSessionToken } from "../auth/session";
import { isAuthConfigured, ACCOUNTS_API_URL } from "../auth/config";

function resolveApiUrl(): string | undefined {
  try {
    return ACCOUNTS_API_URL;
  } catch {
    return undefined;
  }
}

export function renderLeaderboard(root: HTMLElement, onBack: () => void): () => void {
  const abort = new AbortController();
  let destroyed = false;

  root.innerHTML = "";
  const container = el("div", "leaderboard");

  // Header
  const header = el("div", "game-header");
  const backBtn = el("button", "back", "← Back");
  backBtn.onclick = () => onBack();
  header.appendChild(backBtn);
  header.appendChild(el("h2", "", "Leaderboard"));
  container.appendChild(header);

  const content = el("div", "leaderboard-content");
  container.appendChild(content);
  root.appendChild(container);

  const baseUrl = resolveApiUrl();

  if (!baseUrl) {
    content.appendChild(el("p", "leaderboard-note", "Leaderboard isn't available."));
    return () => {
      destroyed = true;
      abort.abort();
      root.innerHTML = "";
    };
  }

  // Show loading state
  content.appendChild(el("p", "leaderboard-note", "Loading…"));

  const token = isAuthConfigured ? getSessionToken() : null;

  void fetchLeaderboard(baseUrl, token, fetch, abort.signal)
    .then((data) => {
      if (destroyed) return;
      content.innerHTML = "";

      // "Your stats" section when signed in
      if (data.me !== null) {
        const lines = statLines(data.me.stats);
        if (lines.length > 0) {
          const statsSection = el("div", "your-stats");
          statsSection.appendChild(el("h3", "", "Your stats"));
          const grid = el("div", "lb-stats-grid");
          for (const line of lines) {
            const row = el("div", "lb-stats-row");
            row.appendChild(el("span", "lb-stats-label", line.label));
            const wld = el("span", "lb-stats-wld", `${line.w}W ${line.l}L ${line.d}D`);
            row.appendChild(wld);
            row.appendChild(el("span", "lb-stats-rate", winRateText(line.w, line.w + line.l + line.d)));
            grid.appendChild(row);
          }
          statsSection.appendChild(grid);
          content.appendChild(statsSection);
        }
      }

      if (data.entries.length === 0 && (data.me === null || data.me.games === 0)) {
        content.appendChild(
          el("p", "leaderboard-note", "No ranked players yet — win an online game!")
        );
        return;
      }

      // Table
      const table = el("div", "leaderboard-table");

      // Header row
      const headerRow = el("div", "leaderboard-row leaderboard-row--header");
      headerRow.appendChild(el("span", "lb-cell lb-rank", "#"));
      headerRow.appendChild(el("span", "lb-cell lb-player", "Player"));
      headerRow.appendChild(el("span", "lb-cell lb-wins", "W"));
      headerRow.appendChild(el("span", "lb-cell lb-games", "G"));
      headerRow.appendChild(el("span", "lb-cell lb-winrate", "Win %"));
      table.appendChild(headerRow);

      for (const entry of data.entries) {
        table.appendChild(buildEntryRow(entry, data.me));
      }

      content.appendChild(table);

      // Empty board note (entries exist but all filtered, unlikely; guard anyway)
      if (data.entries.length === 0) {
        content.appendChild(
          el("p", "leaderboard-note", "No ranked players yet — win an online game!")
        );
      }

      // Pinned "me" row below the table when outside the top 100
      if (data.me !== null && data.me.rank === null && data.me.games > 0) {
        content.appendChild(el("p", "leaderboard-note leaderboard-note--separator", "Your ranking"));
        content.appendChild(buildMePinnedRow(data.me));
      }
    })
    .catch((err: unknown) => {
      if ((err as { name?: string }).name === "AbortError") return;
      if (destroyed) return;
      content.innerHTML = "";
      content.appendChild(
        el("p", "leaderboard-note", "Couldn't load the leaderboard — try again later.")
      );
    });

  return () => {
    destroyed = true;
    abort.abort();
    root.innerHTML = "";
  };
}

function buildEntryRow(entry: LeaderboardEntry, me: LeaderboardMe | null): HTMLElement {
  const isMe = me !== null && me.rank !== null && entry.rank === me.rank;
  const row = el("div", isMe ? "leaderboard-row lb-me" : "leaderboard-row");
  row.appendChild(el("span", "lb-cell lb-rank", String(entry.rank)));
  row.appendChild(buildPlayerCell(entry.displayName, entry.avatarUrl));
  row.appendChild(el("span", "lb-cell lb-wins", String(entry.wins)));
  row.appendChild(el("span", "lb-cell lb-games", String(entry.games)));
  row.appendChild(el("span", "lb-cell lb-winrate", winRateText(entry.wins, entry.games)));
  return row;
}

function buildMePinnedRow(me: LeaderboardMe): HTMLElement {
  const row = el("div", "leaderboard-row lb-me");
  row.appendChild(el("span", "lb-cell lb-rank", "—"));
  row.appendChild(buildPlayerCell(me.displayName, me.avatarUrl));
  row.appendChild(el("span", "lb-cell lb-wins", String(me.wins)));
  row.appendChild(el("span", "lb-cell lb-games", String(me.games)));
  row.appendChild(el("span", "lb-cell lb-winrate", winRateText(me.wins, me.games)));
  return row;
}

function buildPlayerCell(displayName: string, avatarUrl: string | null): HTMLElement {
  const cell = el("span", "lb-cell lb-player");
  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "leaderboard-avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    cell.appendChild(img);
  }
  cell.appendChild(el("span", "lb-name", displayName));
  return cell;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  return node;
}
