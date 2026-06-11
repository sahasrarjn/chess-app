import type { PositionEval } from "../coach/classify";

/** Vertical eval bar. White's share fills from the bottom; hidden when eval is null. */
export class EvalBar {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "eval-bar hidden";
    this.el.setAttribute("aria-hidden", "true");

    this.fill = document.createElement("div");
    this.fill.className = "eval-bar-fill";

    this.label = document.createElement("div");
    this.label.className = "eval-bar-label";

    this.el.appendChild(this.fill);
    this.el.appendChild(this.label);
  }

  update(ev: PositionEval | null): void {
    if (ev == null) {
      this.el.classList.add("hidden");
      return;
    }
    this.el.classList.remove("hidden");

    let fraction: number;
    let labelText: string;

    if (ev.mateIn != null) {
      fraction = ev.mateIn > 0 ? 1 : 0;
      const n = Math.abs(ev.mateIn);
      labelText = ev.mateIn > 0 ? `M${n}` : `-M${n}`;
    } else {
      const cp = ev.cp ?? 0;
      fraction = 1 / (1 + Math.exp(-(cp) / 400));
      const sign = cp >= 0 ? "+" : "";
      labelText = `${sign}${(cp / 100).toFixed(1)}`;
    }

    // White's fill from the bottom: height = fraction * 100%
    this.fill.style.height = `${(fraction * 100).toFixed(1)}%`;
    this.label.textContent = labelText;
  }
}
