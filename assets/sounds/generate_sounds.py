#!/usr/bin/env python3
"""Generate Border Chess move sound effects.

ORIGINAL works, synthesized procedurally with the Python standard library
and dedicated to the public domain (CC0). They share no audio data with any
third party. See CREDITS.md.

Approach (for a natural, non-fatiguing result):
- Piece taps (move/capture/castle/illegal) use *modal synthesis*: a short
  noise excitation rung through a few resonant band-pass filters. That's how
  real wood/percussion sounds — far warmer than a pure sine "beep" or a raw
  noise burst.
- Musical cues (check/promote/game-start/game-end) are warm additive bells
  with a hint of detune ("chorus") and light early reflections for space.
- Everything is kept at a modest, consistent loudness with a soft-clip
  limiter, and has smooth attacks + end-fades so there are never clicks.

Usage:
    python3 generate_sounds.py     # writes *.wav next to this script
    # then encode to mp3 (see build_mp3.sh)
"""

import math
import os
import random
import struct
import wave

SR = 44_100
HERE = os.path.dirname(os.path.abspath(__file__))
TWO_PI = 2 * math.pi
random.seed(20260603)  # deterministic builds


def silence(seconds):
    return [0.0] * int(seconds * SR)


def add(buf, samples, at=0.0, gain=1.0):
    start = int(at * SR)
    for i, s in enumerate(samples):
        j = start + i
        if 0 <= j < len(buf):
            buf[j] += s * gain


# ---- DSP primitives -------------------------------------------------------

def biquad_bandpass(x, freq, q):
    """RBJ band-pass (constant 0 dB peak gain) applied to signal x."""
    w0 = TWO_PI * freq / SR
    alpha = math.sin(w0) / (2.0 * q)
    cosw = math.cos(w0)
    b0, b1, b2 = alpha, 0.0, -alpha
    a0, a1, a2 = 1.0 + alpha, -2.0 * cosw, 1.0 - alpha
    b0, b1, b2 = b0 / a0, b1 / a0, b2 / a0
    a1, a2 = a1 / a0, a2 / a0
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    for n, xn in enumerate(x):
        yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[n] = yn
        x2, x1 = x1, xn
        y2, y1 = y1, yn
    return y


def one_pole_lp(x, cutoff):
    a = math.exp(-TWO_PI * cutoff / SR)
    y = [0.0] * len(x)
    prev = 0.0
    for n, xn in enumerate(x):
        prev = (1 - a) * xn + a * prev
        y[n] = prev
    return y


def end_fade(buf, fade=0.012):
    f = max(int(fade * SR), 1)
    n = len(buf)
    for i in range(max(0, n - f), n):
        buf[i] *= 0.5 - 0.5 * math.cos(math.pi * (n - i) / f)
    return buf


def wood_knock(modes, seconds, exc_ms=5.0, exc_lp=6000.0):
    """Modal 'tok': noise excitation through resonant band-passes.

    modes: list of (freq, q, gain).
    """
    n = int(seconds * SR)
    e = int(exc_ms / 1000.0 * SR)
    exc = [0.0] * n
    for i in range(e):
        env = math.exp(-i / (e * 0.5))           # sharp contact transient
        exc[i] = random.uniform(-1.0, 1.0) * env
    exc = one_pole_lp(exc, exc_lp)               # tame fizz
    out = [0.0] * n
    for freq, q, gain in modes:
        band = biquad_bandpass(exc, freq, q)
        for i in range(n):
            out[i] += band[i] * gain
    # soft attack (first 1.5 ms) to avoid any edge click
    a = max(int(0.0015 * SR), 1)
    for i in range(a):
        out[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    return end_fade(out)


def bell(freq, seconds, tau, partials=((1.0, 1.0), (2.0, 0.14), (2.76, 0.06)),
         detune=0.004, attack=0.005):
    """Warm additive bell with two slightly detuned voices (subtle chorus)."""
    n = int(seconds * SR)
    a = max(int(attack * SR), 1)
    out = [0.0] * n
    for voice, dt in ((0, 1.0 - detune), (1, 1.0 + detune)):
        for ratio, amp in partials:
            f = freq * ratio * dt
            for i in range(n):
                t = i / SR
                env = math.exp(-i / (tau * SR))
                out[i] += amp * 0.5 * math.sin(TWO_PI * f * t) * env
    for i in range(a):
        out[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    return end_fade(out, 0.02)


def reflections(buf, taps=((0.011, 0.25), (0.023, 0.14), (0.037, 0.08))):
    """Light early reflections for a touch of room (less 'dry/cheap')."""
    out = list(buf)
    for delay, g in taps:
        d = int(delay * SR)
        for i in range(d, len(buf)):
            out[i] += buf[i - d] * g
    return out


def normalize(buf, peak):
    m = max((abs(s) for s in buf), default=0.0)
    if m == 0:
        return buf
    g = peak / m
    return [math.tanh(s * g) for s in buf]


def write_wav(name, buf, peak):
    buf = normalize(buf, peak)
    path = os.path.join(HERE, name + ".wav")
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for s in buf:
            v = int(max(-1.0, min(1.0, s)) * 32767)
            frames += struct.pack("<h", v)
        w.writeframes(bytes(frames))
    print(f"wrote {path} ({len(buf) / SR:.3f}s, peak {peak})")


# ---- the eight cues -------------------------------------------------------

MOVE_MODES = [(225, 7, 1.0), (560, 12, 0.55), (1150, 16, 0.32), (2450, 18, 0.16)]
HEAVY_MODES = [(180, 6, 1.0), (470, 11, 0.6), (980, 15, 0.34), (2050, 17, 0.16)]
SOFT_MODES = [(200, 6, 1.0), (430, 10, 0.5), (820, 13, 0.26)]


def build_move():
    return reflections(wood_knock(MOVE_MODES, 0.13)), 0.52


def build_capture():
    buf = silence(0.20)
    add(buf, wood_knock(HEAVY_MODES, 0.14), at=0.0)
    add(buf, wood_knock(MOVE_MODES, 0.10, exc_ms=4.0), at=0.05, gain=0.7)
    return reflections(buf), 0.6


def build_castle():
    buf = silence(0.26)
    add(buf, wood_knock(SOFT_MODES, 0.12), at=0.0)
    add(buf, wood_knock(SOFT_MODES, 0.12), at=0.10, gain=0.92)
    return reflections(buf), 0.5


def build_illegal():
    # Dull, quiet low thunk — a soft "no", never piercing.
    return reflections(wood_knock([(150, 5, 1.0), (300, 8, 0.4)], 0.16, exc_lp=2200.0)), 0.4


def build_check():
    return reflections(bell(600.0, 0.42, tau=0.16)), 0.44


def build_promote():
    buf = silence(0.52)
    for freq, at in [(523.25, 0.0), (659.25, 0.085), (783.99, 0.17)]:
        add(buf, bell(freq, 0.26, tau=0.13), at=at)
    return reflections(buf), 0.44


def build_game_start():
    buf = silence(0.42)
    add(buf, bell(440.0, 0.24, tau=0.14), at=0.0)
    add(buf, bell(659.25, 0.30, tau=0.17), at=0.11)
    return reflections(buf), 0.44


def build_game_end():
    buf = silence(0.75)
    for freq, at in [(392.0, 0.0), (329.63, 0.13), (261.63, 0.26)]:
        add(buf, bell(freq, 0.46, tau=0.28), at=at)
    return reflections(buf), 0.5


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
        buf, peak = fn()
        write_wav(name, buf, peak)


if __name__ == "__main__":
    main()
