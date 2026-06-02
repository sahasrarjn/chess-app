#!/usr/bin/env python3
"""Generate Border Chess move sound effects.

These are ORIGINAL works, synthesized procedurally with the Python standard
library, and dedicated to the public domain (CC0). They emulate the wooden
"thock" feel of a physical chess set, in the spirit of chess.com's cues, but
share no audio data with any third party. See CREDITS.md.

Usage:
    python3 generate_sounds.py        # writes *.wav next to this script
    # then encode to mp3 (see build_mp3.sh)

Stdlib only — no numpy/scipy — so it runs anywhere.
"""

import math
import os
import random
import struct
import wave

SAMPLE_RATE = 44_100
HERE = os.path.dirname(os.path.abspath(__file__))

random.seed(1729)  # deterministic noise => reproducible builds


def _silence(seconds):
    return [0.0] * int(seconds * SAMPLE_RATE)


def _add(buf, samples, at=0.0, gain=1.0):
    start = int(at * SAMPLE_RATE)
    for i, s in enumerate(samples):
        idx = start + i
        if idx < len(buf):
            buf[idx] += s * gain


def _env(n, attack=0.004, decay=0.10, sustain=0.0, release=0.04):
    """ADSR-ish envelope of length n samples (sustain level 0..1)."""
    a = int(attack * SAMPLE_RATE)
    d = int(decay * SAMPLE_RATE)
    r = int(release * SAMPLE_RATE)
    out = []
    for i in range(n):
        if i < a:
            out.append(i / max(a, 1))
        elif i < a + d:
            t = (i - a) / max(d, 1)
            out.append(1.0 - (1.0 - sustain) * t)
        elif i < n - r:
            out.append(sustain)
        else:
            t = (i - (n - r)) / max(r, 1)
            out.append(sustain * (1.0 - t))
    return out


def tone(freq, seconds, env=None, partials=(1.0,), detune=0.0):
    n = int(seconds * SAMPLE_RATE)
    e = env if env is not None else _env(n)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        s = 0.0
        for k, amp in enumerate(partials, start=1):
            f = freq * k * (1.0 + detune * k)
            s += amp * math.sin(2 * math.pi * f * t)
        out.append(s * e[i])
    return out


def noise_burst(seconds, lowpass=0.5, env=None):
    """Lightly low-pass filtered white noise (one-pole) for woody texture."""
    n = int(seconds * SAMPLE_RATE)
    e = env if env is not None else _env(n, attack=0.001, decay=0.05, release=0.02)
    out = []
    prev = 0.0
    for i in range(n):
        white = random.uniform(-1.0, 1.0)
        prev = prev + lowpass * (white - prev)  # one-pole LPF
        out.append(prev * e[i])
    return out


def thock(base_freq=190.0, seconds=0.11, bright=1.0, body=1.0):
    """A wooden piece-on-board tap: pitched click + filtered noise body."""
    n = int(seconds * SAMPLE_RATE)
    buf = _silence(seconds)
    # Pitched component (fast decay) gives the "tok" pitch.
    pitch = tone(
        base_freq,
        seconds,
        env=_env(n, attack=0.001, decay=0.06, release=0.03),
        partials=(1.0, 0.5, 0.25),
    )
    _add(buf, pitch, gain=0.55 * body)
    # Noise transient gives the woody "click".
    nb = noise_burst(min(seconds, 0.05), lowpass=0.35 * bright,
                     env=_env(int(min(seconds, 0.05) * SAMPLE_RATE),
                              attack=0.0005, decay=0.03, release=0.01))
    _add(buf, nb, gain=0.45 * bright)
    return buf


def normalize(buf, peak=0.89):
    m = max((abs(s) for s in buf), default=0.0)
    if m == 0:
        return buf
    g = peak / m
    return [s * g for s in buf]


def write_wav(name, buf):
    buf = normalize(buf)
    path = os.path.join(HERE, name + ".wav")
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in buf:
            v = int(max(-1.0, min(1.0, s)) * 32767)
            frames += struct.pack("<h", v)
        w.writeframes(bytes(frames))
    print(f"wrote {path} ({len(buf) / SAMPLE_RATE:.3f}s)")


# ---- the eight cues -------------------------------------------------------

def build_move():
    return thock(base_freq=190.0, seconds=0.11, bright=1.0, body=1.0)


def build_capture():
    # Two quick wooden impacts: piece lands, captured piece knocked aside.
    buf = _silence(0.16)
    _add(buf, thock(base_freq=150.0, seconds=0.12, bright=1.4, body=1.1), at=0.0)
    _add(buf, thock(base_freq=230.0, seconds=0.07, bright=1.2, body=0.6), at=0.035, gain=0.7)
    return buf


def build_check():
    # Bright two-note alert (ascending), bell-ish.
    buf = _silence(0.30)
    n1 = int(0.16 * SAMPLE_RATE)
    n2 = int(0.20 * SAMPLE_RATE)
    _add(buf, tone(740.0, 0.16, env=_env(n1, attack=0.002, decay=0.12, release=0.04),
                   partials=(1.0, 0.4, 0.2)), at=0.0, gain=0.7)
    _add(buf, tone(1108.0, 0.20, env=_env(n2, attack=0.002, decay=0.16, release=0.05),
                   partials=(1.0, 0.4, 0.15)), at=0.09, gain=0.7)
    return buf


def build_castle():
    # Soft double shuffle (king then rook sliding into place).
    buf = _silence(0.22)
    _add(buf, thock(base_freq=170.0, seconds=0.10, bright=0.7, body=1.0), at=0.0, gain=0.85)
    _add(buf, thock(base_freq=200.0, seconds=0.10, bright=0.7, body=0.9), at=0.085, gain=0.85)
    return buf


def build_promote():
    # Rising sparkle (ascending arpeggio) — something special happened.
    buf = _silence(0.40)
    notes = [(523.25, 0.0), (659.25, 0.07), (783.99, 0.14), (1046.50, 0.21)]
    for freq, at in notes:
        n = int(0.18 * SAMPLE_RATE)
        _add(buf, tone(freq, 0.18, env=_env(n, attack=0.003, decay=0.14, release=0.04),
                       partials=(1.0, 0.35, 0.15)), at=at, gain=0.5)
    return buf


def build_game_start():
    # Gentle "ready" two-note rise.
    buf = _silence(0.34)
    n1 = int(0.18 * SAMPLE_RATE)
    n2 = int(0.22 * SAMPLE_RATE)
    _add(buf, tone(440.0, 0.18, env=_env(n1, attack=0.004, decay=0.14, release=0.05),
                   partials=(1.0, 0.4, 0.2)), at=0.0, gain=0.6)
    _add(buf, tone(659.25, 0.22, env=_env(n2, attack=0.004, decay=0.17, release=0.06),
                   partials=(1.0, 0.4, 0.18)), at=0.10, gain=0.6)
    return buf


def build_game_end():
    # Resolved low cadence with longer decay.
    buf = _silence(0.60)
    chord = [(392.00, 0.0), (311.13, 0.10), (261.63, 0.20)]
    for freq, at in chord:
        n = int(0.40 * SAMPLE_RATE)
        _add(buf, tone(freq, 0.40, env=_env(n, attack=0.005, decay=0.30, sustain=0.12, release=0.12),
                       partials=(1.0, 0.5, 0.25, 0.12)), at=at, gain=0.45)
    return buf


def build_illegal():
    # Dull low buzz/thud — "no".
    buf = _silence(0.16)
    n = int(0.13 * SAMPLE_RATE)
    # Slightly detuned low tone for a buzzy, unpleasant-but-soft feel.
    _add(buf, tone(120.0, 0.13, env=_env(n, attack=0.002, decay=0.09, release=0.03),
                   partials=(1.0, 0.6, 0.3), detune=0.004), at=0.0, gain=0.7)
    _add(buf, noise_burst(0.04, lowpass=0.2,
                          env=_env(int(0.04 * SAMPLE_RATE), attack=0.001, decay=0.025, release=0.01)),
         at=0.0, gain=0.25)
    return buf


BUILDERS = {
    "move": build_move,
    "capture": build_capture,
    "check": build_check,
    "castle": build_castle,
    "promote": build_promote,
    "game-start": build_game_start,
    "game-end": build_game_end,
    "illegal": build_illegal,
}


def main():
    for name, fn in BUILDERS.items():
        write_wav(name, fn())


if __name__ == "__main__":
    main()
