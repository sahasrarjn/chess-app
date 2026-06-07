import type { SoundPlayer } from "../audio/soundPlayer";

const SPEAKER_ON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.2a9 9 0 0 1 0 13.6"/></svg>';

const SPEAKER_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';

/** Shared speaker-toggle button used by every game screen. Self-updates on tap. */
export class MuteButton {
  readonly el: HTMLButtonElement;

  constructor(private readonly sound: SoundPlayer) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "sound-toggle icon-btn";
    this.el.onclick = () => {
      this.sound.unlock();
      this.sound.toggleMuted();
      this.update();
    };
    this.update();
  }

  update(): void {
    const muted = this.sound.isMuted;
    this.el.innerHTML = muted ? SPEAKER_OFF_SVG : SPEAKER_ON_SVG;
    this.el.classList.toggle("muted", muted);
    this.el.setAttribute("aria-pressed", muted ? "true" : "false");
    this.el.title = muted ? "Sound off" : "Sound on";
    this.el.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
  }
}
