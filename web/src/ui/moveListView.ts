import type { PieceColor } from "../engine/types";

export interface MoveListEntry {
  san: string;
  color: PieceColor;
  ply: number;
}

/** Scrollable move list with clickable entries; shared by offline + online. */
export class MoveListView {
  readonly el: HTMLDivElement;
  private lastLen = 0;

  constructor(private readonly onSelect: (ply: number) => void) {
    this.el = document.createElement("div");
    this.el.className = "move-list";
  }

  update(moves: MoveListEntry[], previewPly: number | null): void {
    if (moves.length < this.lastLen) {
      this.el.replaceChildren();
      this.lastLen = 0;
    }

    if (moves.length === 0 && this.lastLen === 0) {
      this.el.replaceChildren(span("", "No moves yet"));
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
      const ply = rec.ply + 1;
      entry.onclick = () => this.onSelect(ply);
      this.el.appendChild(entry);
    }

    this.lastLen = moves.length;
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
