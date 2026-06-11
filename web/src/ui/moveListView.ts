import type { PieceColor } from "../engine/types";
import type { MoveClassification } from "../coach/classify";

export interface MoveListEntry {
  san: string;
  color: PieceColor;
  ply: number;
}

/** Scrollable move list with clickable entries; shared by offline + online. */
export class MoveListView {
  readonly el: HTMLDivElement;
  private lastLen = 0;
  private lastClassifications: (MoveClassification | undefined)[] | undefined;

  constructor(private readonly onSelect: (ply: number) => void) {
    this.el = document.createElement("div");
    this.el.className = "move-list";
  }

  /**
   * Update the move list. When `classifications` is provided each entry
   * gains a badge (`?!` / `?` / `??`) for inaccuracy/mistake/blunder; `ok`
   * renders nothing. The parameter is optional so all existing call sites
   * compile unchanged.
   */
  update(
    moves: MoveListEntry[],
    previewPly: number | null,
    classifications?: (MoveClassification | undefined)[]
  ): void {
    const classChanged =
      classifications !== this.lastClassifications &&
      JSON.stringify(classifications) !== JSON.stringify(this.lastClassifications);

    if (moves.length < this.lastLen || classChanged) {
      this.el.replaceChildren();
      this.lastLen = 0;
    }

    if (moves.length === 0 && this.lastLen === 0) {
      this.el.replaceChildren(span("", "No moves yet"));
      this.lastClassifications = classifications;
      return;
    }

    if (this.lastLen === 0 && moves.length > 0) {
      this.el.replaceChildren();
    }

    let moveNum = Math.floor(this.lastLen / 2) + 1;
    if (this.lastLen === 0) moveNum = 1;

    for (let i = this.lastLen; i < moves.length; i++) {
      const rec = moves[i];
      if (rec.color === "white") {
        this.el.appendChild(span("move-num", `${moveNum}.`));
        moveNum++;
      }
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "move-entry";
      entry.textContent = rec.san;

      // Add classification badge if provided
      const cls = classifications?.[i];
      if (cls && cls !== "ok") {
        const badge = document.createElement("span");
        badge.className = `coach-badge coach-badge--${cls}`;
        badge.textContent = cls === "inaccuracy" ? "?!" : cls === "mistake" ? "?" : "??";
        entry.appendChild(badge);
      }

      const ply = rec.ply + 1;
      entry.onclick = () => this.onSelect(ply);
      this.el.appendChild(entry);
    }

    this.lastLen = moves.length;
    this.lastClassifications = classifications;
    this.el.scrollTop = this.el.scrollHeight;

    const entries = this.el.querySelectorAll<HTMLButtonElement>("button.move-entry");
    entries.forEach((btn, idx) => {
      const rec = moves[idx];
      const active = previewPly === rec.ply + 1 || (previewPly == null && rec.ply === moves.length - 1);
      btn.classList.toggle("active", active);
    });

    const empty = this.el.querySelector("span:not(.move-num)");
    if (empty && moves.length > 0 && empty.textContent === "No moves yet") {
      empty.remove();
    }
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}
