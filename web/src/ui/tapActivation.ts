const SYNTHETIC_CLICK_SUPPRESSION_MS = 500;
const TAP_SLOP_PX = 14;
const TAP_SLOP_SQ = TAP_SLOP_PX * TAP_SLOP_PX;

type PointerTapEvent = {
  pointerType: string;
  button: number;
  nowMs: number;
};

export function createTapActivation(onActivate: () => void): {
  handlePointerUp: (event: PointerTapEvent) => void;
  handleClick: (nowMs: number) => void;
} {
  let lastPointerActivationMs = Number.NEGATIVE_INFINITY;

  return {
    handlePointerUp(event) {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      lastPointerActivationMs = event.nowMs;
      onActivate();
    },
    handleClick(nowMs) {
      if (nowMs - lastPointerActivationMs < SYNTHETIC_CLICK_SUPPRESSION_MS) return;
      onActivate();
    },
  };
}

export function bindTap(target: HTMLElement, onTap: () => void): void {
  let start: { x: number; y: number } | null = null;
  let consumed = false;

  const reset = (): void => {
    start = null;
  };

  const withinSlop = (x: number, y: number): boolean => {
    if (!start) return false;
    const dx = x - start.x;
    const dy = y - start.y;
    return dx * dx + dy * dy <= TAP_SLOP_SQ;
  };

  const commitTap = (e: Event): void => {
    if (consumed) return;
    consumed = true;
    e.preventDefault();
    onTap();
  };

  const begin = (x: number, y: number): void => {
    start = { x, y };
    consumed = false;
  };

  // Touchscreens should react as soon as the finger lands; this avoids lost/canceled touchend events
  // on very small squares while still suppressing the browser's follow-up ghost click.
  target.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      const t = e.touches[0]!;
      begin(t.clientX, t.clientY);
      commitTap(e);
    },
    { passive: false }
  );

  target.addEventListener(
    "touchend",
    () => {
      reset();
    },
    { passive: true }
  );

  target.addEventListener("touchcancel", reset);

  // Mouse / pen (skip touch - handled above to avoid double-fire on iOS).
  target.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    if (!e.isPrimary) return;
    begin(e.clientX, e.clientY);
  });

  target.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return;
    if (!start || !withinSlop(e.clientX, e.clientY)) {
      reset();
      return;
    }
    reset();
    commitTap(e);
  });

  target.addEventListener("pointercancel", reset);

  target.addEventListener(
    "click",
    (e) => {
      if (consumed) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.detail === 0) return;
      onTap();
    },
    true
  );

  if (typeof HTMLButtonElement !== "undefined" && target instanceof HTMLButtonElement) {
    target.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onTap();
    });
  }
}
