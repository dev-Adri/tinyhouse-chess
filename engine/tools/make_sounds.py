#!/usr/bin/env python3
"""Generate the app's move sounds.

Standard library only, and deterministic: running it twice writes identical
files. Each sound is a short additive blend of sine partials under an
exponential decay, which is enough to read as "wooden click" or "thud" without
shipping sampled audio.

Usage: python3 engine/tools/make_sounds.py [--out DIR]
"""

from __future__ import annotations

import argparse
import math
import random
import struct
import wave
from pathlib import Path

RATE = 44_100
AMPLITUDE = 0.75


def render(
    partials: list[tuple[float, float]],
    ms: int,
    decay: float,
    noise: float = 0.0,
    sweep: float = 1.0,
) -> list[float]:
    """
    One percussive hit.

    `partials` are (frequency_hz, weight) pairs, `decay` is the exponential
    rate (higher is shorter), `noise` mixes in a decaying transient that gives
    an attack its bite, and `sweep` bends every partial's pitch over the hit.
    """
    count = int(RATE * ms / 1000)
    rng = random.Random(1)  # fixed, so the output is byte-identical each run
    weight = sum(w for _, w in partials) or 1.0
    samples: list[float] = []
    for index in range(count):
        t = index / RATE
        envelope = math.exp(-decay * t)
        bend = 1.0 + (sweep - 1.0) * (index / max(1, count - 1))
        value = sum(
            w * math.sin(2 * math.pi * freq * bend * t) for freq, w in partials
        ) / weight
        if noise:
            value += noise * (rng.random() * 2 - 1) * math.exp(-decay * 6 * t)
        # A short fade-out kills the click a hard cut would leave behind.
        tail = min(1.0, (count - index) / (RATE * 0.004))
        samples.append(value * envelope * tail)
    return samples


def sequence(hits: list[tuple[list[float], int]]) -> list[float]:
    """Lays hits onto one buffer at the given millisecond offsets."""
    length = max(int(RATE * at / 1000) + len(hit) for hit, at in hits)
    out = [0.0] * length
    for hit, at in hits:
        start = int(RATE * at / 1000)
        for index, value in enumerate(hit):
            out[start + index] += value
    return out


def write(path: Path, samples: list[float]) -> None:
    peak = max((abs(value) for value in samples), default=1.0) or 1.0
    scale = AMPLITUDE / peak
    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, value * scale)) * 32_767))
        for value in samples
    )
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(frames)


def sounds() -> dict[str, list[float]]:
    return {
        # Soft wooden click: low body, a hint of the second partial.
        "move": render([(180, 1.0), (430, 0.35), (900, 0.12)], 55, 42.0, noise=0.05),
        # Heavier and grittier, with a real transient.
        "capture": render([(120, 1.0), (240, 0.5), (700, 0.2)], 85, 30.0, noise=0.22),
        # Crisper and higher than a move, so a drop is audibly a different act.
        "drop": render([(320, 1.0), (780, 0.4), (1500, 0.15)], 40, 60.0, noise=0.08),
        # Two rising tones: an alert, not a thud.
        "check": sequence(
            [
                (render([(520, 1.0), (1040, 0.2)], 90, 26.0), 0),
                (render([(700, 1.0), (1400, 0.2)], 110, 24.0), 70),
            ]
        ),
        # Three falling tones to close the game.
        "end": sequence(
            [
                (render([(600, 1.0), (900, 0.25)], 130, 18.0), 0),
                (render([(480, 1.0), (720, 0.25)], 130, 18.0), 110),
                (render([(320, 1.0), (480, 0.3)], 220, 12.0), 220),
            ]
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "public" / "sounds",
        help="directory to write the .wav files into",
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, samples in sounds().items():
        path = args.out / f"{name}.wav"
        write(path, samples)
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
