import type { SoundEvent } from "./classifyMoveSound";

const SOUND_EVENTS: SoundEvent[] = [
  "move",
  "capture",
  "check",
  "castle",
  "promote",
  "game-start",
  "game-end",
  "illegal",
];

const MUTE_KEY = "bc_sound_muted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore: private mode / disabled storage */
  }
}

/**
 * Low-latency move sounds via the Web Audio API.
 *
 * Decodes each cue into an AudioBuffer once, then plays from a shared
 * AudioContext. The context is created lazily on the first user gesture
 * (browser autoplay policy) — call `unlock()` from a pointer/key handler.
 * Every failure path is swallowed: sound must never break the game.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<SoundEvent, AudioBuffer>();
  private muted = readMuted();
  private loadStarted = false;
  private readonly base: string;

  constructor(base = "/sounds") {
    this.base = base;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    writeMuted(muted);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Create the AudioContext (if allowed) and begin preloading. Idempotent. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    void this.preload();
  }

  private async preload(): Promise<void> {
    if (this.loadStarted || !this.ctx) return;
    this.loadStarted = true;
    await Promise.all(
      SOUND_EVENTS.map(async (event) => {
        try {
          const res = await fetch(`${this.base}/${event}.mp3`);
          if (!res.ok) return;
          const data = await res.arrayBuffer();
          const buffer = await this.ctx!.decodeAudioData(data);
          this.buffers.set(event, buffer);
        } catch {
          /* ignore: missing/undecodable file just stays silent */
        }
      })
    );
  }

  play(event: SoundEvent): void {
    if (this.muted || !this.ctx) return;
    const buffer = this.buffers.get(event);
    if (!buffer) return;
    try {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start();
    } catch {
      /* ignore: transient audio errors must not interrupt play */
    }
  }
}
