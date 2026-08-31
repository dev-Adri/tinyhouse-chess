# Analysis, match and presentation upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command starts the whole app; moves make sound; the analysis board grades moves the way the review does; and the match panel gains depth control, more themes, an uncramped mode selector and an engine-vs-engine mode.

**Architecture:** Everything is additive to the existing shape. Grading reuses the fact that `/analyse` is deterministic at a fixed depth, so a move's grade is arithmetic over the evaluation before it and after it — no engine or API change. `useAnalysis` grows a per-node evaluation cache to make those pairs available, and the already-computed `GameReview` seeds the main line. Presentation changes are new leaf components (`ClassificationBadge`, `DepthStepper`, a dropdown `ThemePicker`) that existing panels adopt.

**Tech Stack:** Next.js 16.3.3 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, vitest (node environment), Python 3 stdlib for the engine and the sound generator.

**Spec:** `docs/superpowers/specs/2026-08-31-analysis-and-match-upgrades-design.md`

## Global Constraints

- **Read the docs first.** `AGENTS.md` states this Next.js differs from training data. Before writing any Next config or framework code, read the relevant guide under `node_modules/next/dist/docs/` (resolved from the repo root). The `turbopack.root` option used in Task 2 was confirmed at `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md`.
- **The AGENTS.md block in `CLAUDE.md`/`AGENTS.md` is written by `next dev`.** Do not try to remove it; commit it with the work if it shows up dirty.
- **No new dependencies.** Not one. The sound files are generated with the Python standard library (`wave`, `struct`, `math`); the UI uses Tailwind classes already in use.
- **Tests:** vitest, `npm run test`, files matching `app/**/*.test.ts` (see `vitest.config.mts`). Python tests are `unittest`, run from `engine/` with `python3 -m unittest discover -s tests -t .`.
- **Every score from the engine is side-to-move-relative** unless its name ends in `White` (`scoreWhite`) or it comes from a `PlyReview` (`eval_before`/`eval_after` are always White-relative). Getting this wrong is the single most likely defect in this plan.
- **Classification constants must match `engine/tinyhouse/analysis.py` exactly:** thresholds `(20, excellent), (50, good), (120, inaccuracy), (300, mistake)`, else `blunder`; `GREAT_MARGIN = 150`; `MAX_LOSS = 1500`; `alternatives <= 1` → `forced`.
- **Depth range for the UI:** 4–12, default 8. The engine clamps to 1–20 itself; the UI clamps to 4–12.
- **localStorage keys:** existing `tinyhouse:theme`, `tinyhouse:game`, `tinyhouse:analysis`; new `tinyhouse:muted` and `tinyhouse:depths`. Every read and write goes through a try/catch — storage may be unavailable.
- **Commit after every task** with the message given in the task's final step.

---

### Task 1: One command starts both processes

**Files:**
- Modify: `package.json` (the `scripts` block)
- Modify: `dev.sh` (add a preflight; make `--prod` call `next:start`)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm start` (dev), `npm run start:prod` (production), `npm run next:start` (raw `next start`). Later tasks assume `npm run test`, `npm run build` and `npm run lint` are unchanged.

- [ ] **Step 1: Read the current scripts and script entry points**

Run: `sed -n '1,20p' package.json && grep -n 'npm run' dev.sh`

Note that `dev.sh --prod` currently calls `npm run start`. After this task `start` means "dev, both processes", so leaving that line alone would make `dev.sh --prod` recurse into itself. It must be repointed in the same commit.

- [ ] **Step 2: Rewrite the scripts block**

In `package.json`, replace the `scripts` object with:

```json
  "scripts": {
    "start": "./dev.sh",
    "start:prod": "./dev.sh --prod",
    "dev": "next dev",
    "next:start": "next start",
    "build": "next build",
    "lint": "eslint",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Repoint the production branch of dev.sh**

In `dev.sh`, in the `if [[ "$PROD" -eq 1 ]]` branch, change the app launch line from `npm run start` to `npm run next:start`:

```bash
  ENGINE_URL="http://${ENGINE_HOST}:${ENGINE_PORT}" npm run next:start -- -p "$APP_PORT" &
```

- [ ] **Step 4: Add the engine preflight**

In `dev.sh`, immediately after the `ENGINE_HOST=` assignment and before the port helpers, insert:

```bash
# Fail fast and legibly: without these the engine dies inside the port wait
# loop below, which reads as a timeout rather than a missing dependency.
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11 or newer, then run this again." >&2
  exit 1
fi
if ! (cd engine && python3 -c "import tinyhouse" >/dev/null 2>&1); then
  echo "Cannot import the 'tinyhouse' engine package from ./engine." >&2
  echo "Check that ./engine/tinyhouse/__init__.py exists and python3 can read it." >&2
  exit 1
fi
```

- [ ] **Step 5: Verify the preflight passes and the scripts resolve**

Run: `bash -n dev.sh && (cd engine && python3 -c "import tinyhouse; print('engine import ok')") && npm run next:start --help >/dev/null 2>&1; echo "scripts ok"`
Expected: `engine import ok` then `scripts ok`, and no syntax error from `bash -n`.

- [ ] **Step 6: Verify `npm start` brings up both processes**

Run: `timeout 45 npm start 2>&1 | tee /tmp/claude-1000/-home-adri-Documents-tinyhouse-chess/*/scratchpad/start.log | head -30`
Expected: `Engine is up (pid ...)`, then a Next.js dev banner, then the `App:` / `Engine:` URL lines. The timeout kills it; that is the expected way for this check to end.

If port 3000 or 8000 is already busy, `dev.sh` picks the next free port — that is correct behaviour, not a failure.

- [ ] **Step 7: Commit**

```bash
git add package.json dev.sh
git commit -m "Start the engine and the app together from npm start"
```

---

### Task 2: Silence the Turbopack root warning

**Files:**
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks import. Later tasks rely on `npm run build` being warning-free so a new warning stands out.

- [ ] **Step 1: Reproduce the warning**

Run: `npm run build 2>&1 | head -12`
Expected: a line reading `⚠ Warning: Next.js ignored package-lock.json in /home/adri because it is outside the current Git repository ... set 'turbopack.root' in your Next.js config.`

- [ ] **Step 2: Read the documented option**

Run: `sed -n '95,125p' node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopack.md`
Confirm: the option is `turbopack.root`, it "should be an absolute path", and Next finds the root by searching upwards for a lockfile — which is how it reached `/home/adri`.

- [ ] **Step 3: Pin the root**

Replace the contents of `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js finds the project root by searching upwards for a lockfile, which
  // walks past this repo to a stray one in the home directory. Pinning the
  // root keeps resolution — and the filesystem watcher — inside the project.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
```

`import.meta.dirname` needs Node 20.11+; this repo runs Node 22.

- [ ] **Step 4: Verify the warning is gone and the build still passes**

Run: `npm run build 2>&1 | tail -25`
Expected: `✓ Compiled successfully`, the route table, and **no** `⚠ Warning` line anywhere in the output. Also run `npm run build 2>&1 | grep -c '⚠'` and expect `0`.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts
git commit -m "Pin the Turbopack root so Next stops finding a stray lockfile"
```

---

### Task 3: Generate the sound files and the player

**Files:**
- Create: `engine/tools/make_sounds.py`
- Create: `public/sounds/move.wav`, `capture.wav`, `drop.wav`, `check.wav`, `end.wav` (generated by the script, committed)
- Create: `app/lib/tinyhouse/sound.ts`
- Create: `app/lib/tinyhouse/sound.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SoundKind = "move" | "capture" | "drop" | "check" | "end"`
  - `soundForSan(san: string): SoundKind`
  - `playSound(kind: SoundKind): void`
  - `readMuted(): boolean`, `writeMuted(muted: boolean): void`
  - `SOUND_STORAGE_KEY = "tinyhouse:muted"`

- [ ] **Step 1: Write the failing test for SAN → sound mapping**

Create `app/lib/tinyhouse/sound.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { soundForSan } from "./sound";

describe("soundForSan", () => {
  it("plays the move sound for a quiet move", () => {
    expect(soundForSan("Fc2")).toBe("move");
    expect(soundForSan("a3")).toBe("move");
  });

  it("plays the capture sound for a capture", () => {
    expect(soundForSan("Hxc2")).toBe("capture");
  });

  it("plays the drop sound for a reserve drop", () => {
    expect(soundForSan("F@a3")).toBe("drop");
    expect(soundForSan("P@b2")).toBe("drop");
  });

  it("plays the check sound when the move gives check", () => {
    expect(soundForSan("Fc2+")).toBe("check");
  });

  it("prefers check over capture and drop, since check is the louder fact", () => {
    expect(soundForSan("Hxc2+")).toBe("check");
    expect(soundForSan("F@a3+")).toBe("check");
  });

  it("plays the end sound for mate, whatever else the move did", () => {
    expect(soundForSan("F@a3#")).toBe("end");
    expect(soundForSan("Hxc2#")).toBe("end");
  });

  it("falls back to the move sound for an empty or odd SAN", () => {
    expect(soundForSan("")).toBe("move");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- app/lib/tinyhouse/sound.test.ts`
Expected: FAIL — cannot resolve `./sound`.

- [ ] **Step 3: Write the player module**

Create `app/lib/tinyhouse/sound.ts`:

```ts
/**
 * Move sounds.
 *
 * Which sound a move makes is decided from its SAN, because SAN already
 * records everything that matters: `@` is a drop, `x` a capture, `+` a check,
 * `#` a mate. That keeps the decision a pure function — testable, and with no
 * call sites scattered through the move handlers.
 */

export type SoundKind = "move" | "capture" | "drop" | "check" | "end";

export const SOUND_STORAGE_KEY = "tinyhouse:muted";

const FILES: Record<SoundKind, string> = {
  move: "/sounds/move.wav",
  capture: "/sounds/capture.wav",
  drop: "/sounds/drop.wav",
  check: "/sounds/check.wav",
  end: "/sounds/end.wav",
};

/** Loudest fact first: a mating capture is an ending, not a capture. */
export function soundForSan(san: string): SoundKind {
  if (san.includes("#")) return "end";
  if (san.includes("+")) return "check";
  if (san.includes("x")) return "capture";
  if (san.includes("@")) return "drop";
  return "move";
}

/** One element per sound, reused: stepping quickly must not leak elements. */
const players = new Map<SoundKind, HTMLAudioElement>();

export function playSound(kind: SoundKind): void {
  if (typeof window === "undefined") return;
  try {
    let player = players.get(kind);
    if (!player) {
      player = new Audio(FILES[kind]);
      player.preload = "auto";
      player.volume = 0.55;
      players.set(kind, player);
    }
    player.currentTime = 0;
    // Rejects until the page has had a user gesture. Sound is a garnish, so a
    // refusal is swallowed rather than surfaced.
    void player.play().catch(() => {});
  } catch {
    // No Audio support — the app is otherwise unaffected.
  }
}

export function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- app/lib/tinyhouse/sound.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the sound generator**

Create `engine/tools/make_sounds.py`:

```python
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
```

- [ ] **Step 6: Generate the files and verify they are real, small WAVs**

Run:
```bash
python3 engine/tools/make_sounds.py
ls -l public/sounds/
python3 - <<'PY'
import wave, pathlib
for path in sorted(pathlib.Path("public/sounds").glob("*.wav")):
    with wave.open(str(path)) as handle:
        ms = 1000 * handle.getnframes() / handle.getframerate()
        print(path.name, handle.getnchannels(), "ch", handle.getframerate(), "Hz",
              f"{ms:.0f}ms", handle.getsampwidth() * 8, "bit")
PY
```
Expected: five files, each 1 channel / 44100 Hz / 16 bit, between 35 ms and 450 ms, and each well under 100 KB.

- [ ] **Step 7: Verify the generator is deterministic**

Run: `md5sum public/sounds/*.wav > /tmp/claude-1000/-home-adri-Documents-tinyhouse-chess/*/scratchpad/before.md5 && python3 engine/tools/make_sounds.py >/dev/null && md5sum -c /tmp/claude-1000/-home-adri-Documents-tinyhouse-chess/*/scratchpad/before.md5`
Expected: five `OK` lines. If any differ, the generator has unseeded randomness — fix it rather than committing noise.

- [ ] **Step 8: Commit**

```bash
git add engine/tools/make_sounds.py public/sounds app/lib/tinyhouse/sound.ts app/lib/tinyhouse/sound.test.ts
git commit -m "Generate move sounds and add the sound player"
```

---

### Task 4: Play the sounds, with a mute toggle

**Files:**
- Create: `app/components/useMoveSound.ts`
- Modify: `app/components/TinyhouseGame.tsx` (header controls; call the hook)

**Interfaces:**
- Consumes: `soundForSan`, `playSound`, `readMuted`, `writeMuted` from `@/app/lib/tinyhouse/sound` (Task 3).
- Produces: `useMoveSound({ san, key, muted }: { san: string | null; key: string; muted: boolean }): void`.

The hook is driven by the *displayed* position rather than by the move handlers. One effect then covers human moves, bot moves, engine-vs-engine moves, review stepping and analysis navigation.

- [ ] **Step 1: Write the hook**

Create `app/components/useMoveSound.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import { playSound, soundForSan } from "@/app/lib/tinyhouse/sound";

/**
 * Plays a sound whenever the move shown on the board changes.
 *
 * `key` identifies the position being shown — the live ply index, or the
 * analysis node id — so stepping between two moves that happen to share a SAN
 * still sounds. The first render is silent: arriving on a page mid-game should
 * not replay the last move.
 */
export function useMoveSound({
  san,
  key,
  muted,
}: {
  san: string | null;
  key: string;
  muted: boolean;
}): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const signature = `${key}:${san ?? ""}`;
    const first = previous.current === null;
    const changed = previous.current !== signature;
    previous.current = signature;
    if (first || !changed || muted || !san) return;
    playSound(soundForSan(san));
    // `muted` is deliberately absent from the deps: muting is not a move, and
    // toggling it should neither play nor swallow a sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [san, key]);
}
```

- [ ] **Step 2: Wire the hook into TinyhouseGame**

In `app/components/TinyhouseGame.tsx`, add the imports:

```ts
import { readMuted, writeMuted } from "@/app/lib/tinyhouse/sound";
import { useMoveSound } from "./useMoveSound";
```

Add state next to `flipBoard`:

```ts
  /** Sound is on by default; the choice is remembered across sessions. */
  const [muted, setMuted] = useState(false);
```

In the existing hydration effect (the one that calls `loadAnalysis()`), add as its first line:

```ts
    setMuted(readMuted());
```

Add a callback next to `selectTheme`:

```ts
  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      writeMuted(!current);
      return !current;
    });
  }, []);
```

- [ ] **Step 3: Call the hook from the presentation section**

In `TinyhouseGame.tsx`, immediately after `const displayed = analysisMode ? analysis.state : displayedLive;`, add:

```ts
  // The move the board is currently showing, which is what should sound.
  const displayedSan = analysisMode
    ? (analysis.tree.nodes[analysis.cursor]?.san || null)
    : (displayedLive.history[displayedLive.history.length - 1]?.san ?? null);

  useMoveSound({
    san: displayedSan,
    key: analysisMode ? `analysis:${analysis.cursor}` : `live:${viewPly}`,
    muted,
  });
```

- [ ] **Step 4: Add the mute button to the header**

In the header's right-hand control group in `TinyhouseGame.tsx` — the `<div className="flex items-center gap-2">` that holds the Flip button — insert before the Flip button:

```tsx
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={muted}
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            title={muted ? "Unmute sounds" : "Mute sounds"}
            className="rounded-full px-3 py-1 text-xs font-bold"
            style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
          >
            {muted ? "🔇" : "🔊"}
          </button>
```

- [ ] **Step 5: Verify it builds and lints**

Run: `npm run lint && npm run build 2>&1 | tail -12`
Expected: no eslint output, `✓ Compiled successfully`, no warnings.

- [ ] **Step 6: Verify by ear**

Run: `npm start` in one terminal, open the app, and check: a quiet move clicks, a capture thuds, a reserve drop is crisper, a checking move alerts, mate plays the flourish, stepping back and forth through the move list sounds each move, and the speaker button silences all of it and stays silenced after a refresh.

- [ ] **Step 7: Commit**

```bash
git add app/components/useMoveSound.ts app/components/TinyhouseGame.tsx
git commit -m "Play a sound for every move shown, with a mute toggle"
```

---

### Task 5: A badge whose glyph scales with its circle

**Files:**
- Create: `app/components/ClassificationBadge.tsx`
- Modify: `app/components/ReviewPanel.tsx` (two badge sites: the selected-move block and the move list)

`MoveTreeList` gets badges in Task 8, not here.

**Interfaces:**
- Consumes: `CLASSIFICATION_STYLE` from `@/app/lib/engine/classification`, `Classification` from `@/app/lib/engine/types`.
- Produces: `<ClassificationBadge classification={...} className={...} title={...} />`.

The circle is currently sized in CSS (`h-5 w-5`) while the glyph is a fixed pixel font size (`text-[10px]`), so on a large screen the glyph floats tiny inside its circle. Rendering the badge as an SVG with a fixed `viewBox` makes the glyph scale exactly with whatever size CSS gives the box.

- [ ] **Step 1: Write the component**

Create `app/components/ClassificationBadge.tsx`:

```tsx
"use client";

import { CLASSIFICATION_STYLE } from "@/app/lib/engine/classification";
import type { Classification } from "@/app/lib/engine/types";

interface ClassificationBadgeProps {
  classification: Classification;
  /** Sizes the badge. The glyph follows, because the box is an SVG viewBox. */
  className?: string;
  /** Defaults to the classification's label. */
  title?: string;
}

/**
 * The coloured circle with a glyph in it (★, ?!, ??…).
 *
 * Drawn as an SVG rather than a div with a font size: a viewBox scales its
 * contents, so one component reads correctly at 16px in a move list and at
 * 32px in a panel on a large screen, with nothing to keep in sync.
 */
export default function ClassificationBadge({
  classification,
  className = "h-5 w-5",
  title,
}: ClassificationBadgeProps) {
  const style = CLASSIFICATION_STYLE[classification];
  // Two-character glyphs (?!, ??) need to sit smaller inside the same circle.
  const fontSize = style.glyph.length > 1 ? 11 : 14;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={title ?? style.label}
    >
      <title>{title ?? style.label}</title>
      <circle cx="12" cy="12" r="12" fill={style.color} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight="900"
        fill="#ffffff"
      >
        {style.glyph}
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Adopt it in the selected-move block of ReviewPanel**

In `app/components/ReviewPanel.tsx`, add the import:

```ts
import ClassificationBadge from "./ClassificationBadge";
```

Replace the badge `<span>` inside the selected-move block — the one with `className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white"` — with:

```tsx
              <ClassificationBadge
                classification={selected.classification}
                className="h-5 w-5 xl:h-6 xl:w-6"
              />
```

- [ ] **Step 3: Adopt it in the move list of ReviewPanel**

In the same file, in the move-list `map`, replace the badge `<span>` with `className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white"` with:

```tsx
              <ClassificationBadge
                classification={ply.classification}
                className="h-4 w-4 xl:h-5 xl:w-5"
                title={style.label}
              />
```

Leave the `const style = CLASSIFICATION_STYLE[ply.classification];` line in place — the summary counts below still use `CLASSIFICATION_STYLE`, and `style.label` is now the badge's title.

- [ ] **Step 4: Verify nothing broke**

Run: `npm run lint && npm run test && npm run build 2>&1 | tail -8`
Expected: eslint silent, all existing tests pass, build clean.

- [ ] **Step 5: Verify by eye**

With the app running, review a game and confirm the glyphs sit centred and proportionate in their circles, in both the selected-move block and the move list, and that they grow at the `xl` breakpoint instead of staying tiny.

- [ ] **Step 6: Commit**

```bash
git add app/components/ClassificationBadge.tsx app/components/ReviewPanel.tsx
git commit -m "Draw classification badges as SVG so the glyph scales with the circle"
```

---

### Task 6: Grade a move from two evaluations

**Files:**
- Create: `app/lib/engine/verdict.ts`
- Create: `app/lib/engine/verdict.test.ts`

**Interfaces:**
- Consumes: `Classification`, `AnalysisResult`, `PlyReview` from `@/app/lib/engine/types`; `toWhiteRelative` from `@/app/lib/engine/classification`.
- Produces:
  - `interface MoveVerdict { classification: Classification; loss: number; bestUci: string; bestSan: string; scoreWhite: number; mateWhite: number | null }`
  - `classifyMove(input: { loss: number; isBest: boolean; alternatives: number; margin: number }): Classification`
  - `verdictFrom(parent: AnalysisResult, child: AnalysisResult, playedUci: string, alternatives: number): MoveVerdict | null`
  - `verdictFromReview(ply: PlyReview): MoveVerdict`
  - `GREAT_MARGIN`, `MAX_LOSS`, `LOSS_THRESHOLDS`

**Why this works:** `/analyse` is deterministic at a fixed depth (`handle_analyse` sets `randomness=0, blunder_chance=0.0`). The engine returns scores from the side to move's point of view. So for a move played from position P reaching position C: the best the mover could have had is `parent.score`; what they actually got is `-child.score` (C is scored for the *opponent*). Centipawn loss is therefore `parent.score + child.score` — the sign flip *is* the plus. Nothing else is needed, and no API change is required.

- [ ] **Step 1: Read the reference implementation being mirrored**

Run: `sed -n '26,60p' engine/tinyhouse/analysis.py`
Confirm the constants and the order of checks in `classify()`. The TypeScript must agree exactly, or the analysis board will disagree with the review about the same move.

- [ ] **Step 2: Write the failing tests**

Create `app/lib/engine/verdict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AnalysisLine, AnalysisResult, PlyReview } from "./types";
import {
  GREAT_MARGIN,
  MAX_LOSS,
  classifyMove,
  verdictFrom,
  verdictFromReview,
} from "./verdict";

const line = (uci: string, score: number): AnalysisLine => ({
  uci,
  san: uci,
  score,
  scoreWhite: score,
  mateIn: null,
  pv: [uci],
});

/** An /analyse reply. `score` mirrors the first line, as the engine's does. */
function result(
  stm: "w" | "b",
  lines: AnalysisLine[],
  overrides: Partial<AnalysisResult> = {},
): AnalysisResult {
  return {
    gameOver: null,
    winner: null,
    score: lines[0]?.score ?? 0,
    scoreWhite: stm === "w" ? (lines[0]?.score ?? 0) : -(lines[0]?.score ?? 0),
    mateIn: null,
    depth: 8,
    nodes: 1000,
    timeMs: 100,
    stm,
    lines,
    ...overrides,
  };
}

describe("classifyMove", () => {
  it("calls a position with one legal move forced, whatever the loss", () => {
    expect(classifyMove({ loss: 0, isBest: true, alternatives: 1, margin: 0 })).toBe("forced");
    expect(classifyMove({ loss: 900, isBest: false, alternatives: 1, margin: 0 })).toBe("forced");
  });

  it("calls the engine's own move best", () => {
    expect(classifyMove({ loss: 0, isBest: true, alternatives: 5, margin: 10 })).toBe("best");
  });

  it("calls it great when it is the only move that holds the position", () => {
    expect(
      classifyMove({ loss: 0, isBest: true, alternatives: 5, margin: GREAT_MARGIN }),
    ).toBe("great");
    expect(
      classifyMove({ loss: 0, isBest: true, alternatives: 5, margin: GREAT_MARGIN - 1 }),
    ).toBe("best");
  });

  it("grades the loss on the same thresholds as the review", () => {
    const grade = (loss: number) =>
      classifyMove({ loss, isBest: false, alternatives: 5, margin: 0 });
    expect(grade(0)).toBe("excellent");
    expect(grade(20)).toBe("excellent");
    expect(grade(21)).toBe("good");
    expect(grade(50)).toBe("good");
    expect(grade(51)).toBe("inaccuracy");
    expect(grade(120)).toBe("inaccuracy");
    expect(grade(121)).toBe("mistake");
    expect(grade(300)).toBe("mistake");
    expect(grade(301)).toBe("blunder");
    expect(grade(5000)).toBe("blunder");
  });
});

describe("verdictFrom", () => {
  it("reads a loss of zero when the played move is the engine's own", () => {
    // White to move, best is +80. Black then sees -80, i.e. score -80 for the
    // side to move at the child. Loss = 80 + (-80) = 0.
    const parent = result("w", [line("a2a3", 80), line("b2b3", 20)]);
    const child = result("b", [line("b4b3", -80)]);

    const verdict = verdictFrom(parent, child, "a2a3", 6);

    expect(verdict).not.toBeNull();
    expect(verdict!.loss).toBe(0);
    // Margin is 60, below GREAT_MARGIN, so this is "best" and not "great".
    expect(verdict!.classification).toBe("best");
  });

  it("is great when the played move is the only one that holds the position", () => {
    // Margin 180 >= GREAT_MARGIN: the second-best move throws the position away.
    const parent = result("w", [line("a2a3", 80), line("b2b3", -100)]);
    const child = result("b", [line("b4b3", -80)]);

    expect(verdictFrom(parent, child, "a2a3", 6)!.classification).toBe("great");
  });

  it("measures the loss of a move that was not the best one", () => {
    // Best was +80; the move played leaves the opponent at +40, i.e. -40 for
    // the mover. Loss = 80 + 40 = 120 → inaccuracy.
    const parent = result("w", [line("a2a3", 80), line("b2b3", 20)]);
    const child = result("b", [line("b4b3", 40)]);

    const verdict = verdictFrom(parent, child, "b2b3", 6);

    expect(verdict!.loss).toBe(120);
    expect(verdict!.classification).toBe("inaccuracy");
    expect(verdict!.bestUci).toBe("a2a3");
  });

  it("works identically with Black to move", () => {
    // Black to move, best is +80 for Black. The move played leaves White at
    // +40 for White's own point of view. Loss = 80 + 40 = 120.
    const parent = result("b", [line("b4b3", 80), line("c4c3", 20)]);
    const child = result("w", [line("a2a3", 40)]);

    expect(verdictFrom(parent, child, "c4c3", 6)!.loss).toBe(120);
  });

  it("never reports a negative loss", () => {
    // A deeper search at the child can beat the parent's own estimate; that is
    // an artefact of the search, not a gain from a bad move.
    const parent = result("w", [line("a2a3", 20), line("b2b3", 10)]);
    const child = result("b", [line("b4b3", -200)]);

    expect(verdictFrom(parent, child, "a2a3", 6)!.loss).toBe(0);
  });

  it("clamps an enormous loss, so a missed mate is not absurd", () => {
    const parent = result("w", [line("a2a3", 9000), line("b2b3", 10)]);
    const child = result("b", [line("b4b3", 500)]);

    expect(verdictFrom(parent, child, "b2b3", 6)!.loss).toBe(MAX_LOSS);
  });

  it("reports the score after the move from White's point of view", () => {
    const parent = result("w", [line("a2a3", 80)]);
    const child = result("b", [line("b4b3", 60)], { scoreWhite: -60, mateIn: 3 });

    const verdict = verdictFrom(parent, child, "a2a3", 6);

    expect(verdict!.scoreWhite).toBe(-60);
    expect(verdict!.mateWhite).toBe(-3); // mate for Black is negative to White
  });

  it("treats a single line as no margin rather than an infinite one", () => {
    const parent = result("w", [line("a2a3", 80)]);
    const child = result("b", [line("b4b3", -80)]);

    expect(verdictFrom(parent, child, "a2a3", 6)!.classification).toBe("best");
  });

  it("returns null when the parent has no lines to compare against", () => {
    const parent = result("w", [], { gameOver: "checkmate" });
    const child = result("b", [line("b4b3", 0)]);

    expect(verdictFrom(parent, child, "a2a3", 0)).toBeNull();
  });
});

describe("verdictFromReview", () => {
  it("carries a review ply across unchanged", () => {
    const ply: PlyReview = {
      ply: 3,
      color: "b",
      uci: "b4c2",
      san: "Hxc2",
      eval_before: 40,
      eval_after: -260,
      mate_before: null,
      mate_after: null,
      best_uci: "b4b3",
      best_san: "Hb3",
      best_pv: ["b4b3"],
      loss: 300,
      classification: "mistake",
      accuracy: 61.2,
      alternatives: [],
    };

    expect(verdictFromReview(ply)).toEqual({
      classification: "mistake",
      loss: 300,
      bestUci: "b4b3",
      bestSan: "Hb3",
      scoreWhite: -260,
      mateWhite: null,
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- app/lib/engine/verdict.test.ts`
Expected: FAIL — cannot resolve `./verdict`.

- [ ] **Step 4: Write the implementation**

Create `app/lib/engine/verdict.ts`:

```ts
/**
 * Grading a single move.
 *
 * `/analyse` is deterministic at a fixed depth, so a move's grade needs only
 * the evaluation of the position before it and of the position after it. The
 * engine scores every position from the side to move's point of view, which is
 * why the loss below is a sum: the child's score belongs to the opponent.
 *
 * The thresholds mirror `classify()` in `engine/tinyhouse/analysis.py`. They
 * are duplicated rather than fetched so the board can grade a move you have
 * only just played, with no round trip; the tests pin them to the Python values.
 */

import { toWhiteRelative } from "./classification";
import type { AnalysisResult, Classification, PlyReview } from "./types";

/** A move is "great" when it is the only one that holds the position. */
export const GREAT_MARGIN = 150;
/** Ceiling on reported loss, so a missed mate does not produce absurd numbers. */
export const MAX_LOSS = 1500;
/** Checked in order; anything past the last one is a blunder. */
export const LOSS_THRESHOLDS: readonly [number, Classification][] = [
  [20, "excellent"],
  [50, "good"],
  [120, "inaccuracy"],
  [300, "mistake"],
];

export interface MoveVerdict {
  classification: Classification;
  /** Centipawns given up against the engine's choice, 0..MAX_LOSS. */
  loss: number;
  bestUci: string;
  bestSan: string;
  /** Evaluation after the move, White-relative, for display. */
  scoreWhite: number;
  mateWhite: number | null;
}

export function classifyMove({
  loss,
  isBest,
  alternatives,
  margin,
}: {
  loss: number;
  isBest: boolean;
  alternatives: number;
  margin: number;
}): Classification {
  if (alternatives <= 1) return "forced";
  if (isBest) return margin >= GREAT_MARGIN ? "great" : "best";
  for (const [limit, label] of LOSS_THRESHOLDS) {
    if (loss <= limit) return label;
  }
  return "blunder";
}

/**
 * Grades the move that led from `parent`'s position to `child`'s.
 *
 * `alternatives` is the number of legal moves in the parent position, which
 * the caller has locally — the engine only returns its top few lines.
 */
export function verdictFrom(
  parent: AnalysisResult,
  child: AnalysisResult,
  playedUci: string,
  alternatives: number,
): MoveVerdict | null {
  const best = parent.lines[0];
  if (!best) return null;

  // Both scores are side-to-move-relative, and the two positions have opposite
  // sides to move — hence the sum.
  const raw = parent.score + child.score;
  const loss = Math.max(0, Math.min(MAX_LOSS, Math.round(raw)));
  const margin = parent.lines.length > 1 ? best.score - parent.lines[1].score : 0;
  const after = toWhiteRelative(child.stm, child.score, child.mateIn);

  return {
    classification: classifyMove({
      loss,
      isBest: best.uci === playedUci,
      alternatives,
      margin,
    }),
    loss,
    bestUci: best.uci,
    bestSan: best.san,
    scoreWhite: after.score,
    mateWhite: after.mateIn,
  };
}

/** The same shape out of a review report, so consumers never branch on source. */
export function verdictFromReview(ply: PlyReview): MoveVerdict {
  return {
    classification: ply.classification,
    loss: ply.loss,
    bestUci: ply.best_uci,
    bestSan: ply.best_san,
    scoreWhite: ply.eval_after,
    mateWhite: ply.mate_after,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- app/lib/engine/verdict.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Cross-check the constants against Python mechanically**

Run:
```bash
grep -n "THRESHOLDS\|GREAT_MARGIN\|MAX_LOSS" engine/tinyhouse/analysis.py
grep -n "GREAT_MARGIN\|MAX_LOSS\|LOSS_THRESHOLDS" -A6 app/lib/engine/verdict.ts | head -20
```
Expected: 20/50/120/300, 150 and 1500 on both sides. Any mismatch is a bug in this task.

- [ ] **Step 7: Commit**

```bash
git add app/lib/engine/verdict.ts app/lib/engine/verdict.test.ts
git commit -m "Grade a move from the evaluations before and after it"
```

---

### Task 7: Cache evaluations per node and expose verdicts

**Files:**
- Modify: `app/components/useAnalysis.ts` (the `Evaluation` type, the engine effect, the return value, the signature)
- Modify: `app/components/TinyhouseGame.tsx` (the `useAnalysis(...)` call site only)

**Interfaces:**
- Consumes: `verdictFrom`, `verdictFromReview`, `MoveVerdict` (Task 6); `GameReview` from `@/app/lib/engine/types`; `legalMoves`, `positionAt`, `mainLine`, `moveToUci` (all already imported or trivially added).
- Produces: `useAnalysis(enabled: boolean, options: { depth: number; review: GameReview | null })` returning everything it returns today plus `verdicts: Record<string, MoveVerdict>`.

Passing the `GameReview` **into** the hook — rather than computing a seed map outside it — is deliberate: the seed has to be keyed by node id, the hook owns the tree, and computing it outside would make the hook's input depend on its own output.

- [ ] **Step 1: Read the current hook end to end**

Run: `cat app/components/useAnalysis.ts`
Note three things that change: the single `Evaluation` record becomes a map, `analysing`/`analysis`/`analysisError` are derived from that map, and the effect gains a second request for the parent.

- [ ] **Step 2: Replace the imports and the evaluation type**

In `app/components/useAnalysis.ts`, extend the existing imports and replace the `Evaluation` interface:

```ts
import { fetchAnalysis } from "@/app/lib/engine/client";
import type { AnalysisResult, GameReview } from "@/app/lib/engine/types";
import { verdictFrom, verdictFromReview, type MoveVerdict } from "@/app/lib/engine/verdict";
```

```ts
/**
 * Evaluations, keyed by node id. Node ids are stable within a tree and a
 * node's position never changes, so this cache cannot go stale — a new tree
 * (or a new depth) simply gets a new one.
 */
type Evaluations = Record<string, AnalysisResult>;

/** An error is tied to the node it happened on, so it clears by navigating. */
interface EvalError {
  cursor: string;
  message: string;
}

const NO_VERDICTS: Record<string, MoveVerdict> = {};
```

- [ ] **Step 3: Change the signature and the state**

Replace the `export function useAnalysis(...)` line and its first three `useState` calls with:

```ts
export function useAnalysis(
  enabled: boolean,
  options: { depth: number; review: GameReview | null; initial?: AnalysisState },
) {
  const { depth, review, initial } = options;
  const [tree, setTree] = useState<MoveTree>(() => initial?.tree ?? createTree());
  const [cursor, setCursor] = useState<string>(() => initial?.cursor ?? tree.root);
  const [evals, setEvals] = useState<Evaluations>({});
  const [error, setError] = useState<EvalError | null>(null);
```

- [ ] **Step 4: Clear the cache when the tree or the depth changes**

In the same file, inside `load`, add `setEvals({})` and `setError(null)` before the branches:

```ts
  const load = useCallback((next: MoveTree, nodeId?: string, then?: Move) => {
    // A different tree means different node ids; a stale cache would attach
    // one line's evaluations to another's moves.
    setEvals({});
    setError(null);
    const at = nodeId ?? next.root;
    if (then) {
      const result = addMove(next, at, then);
      setTree(result.tree);
      setCursor(result.nodeId);
      return;
    }
    setTree(next);
    setCursor(at);
  }, []);
```

And add an effect immediately above the engine effect:

```ts
  // Evaluations are only comparable at one depth, so changing it starts over.
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => {
    setEvals({});
    setError(null);
  }, [depth]);
```

- [ ] **Step 5: Replace the engine effect**

Replace the whole `// --- engine ---` effect with:

```ts
  // --- engine ---------------------------------------------------------------

  const parentId = tree.nodes[cursor]?.parent ?? null;
  const haveCursor = Boolean(evals[cursor]);
  const haveParent = parentId === null || Boolean(evals[parentId]);

  useEffect(() => {
    if (!enabled || outcome.over) return;
    if (haveCursor && haveParent) return;

    const controller = new AbortController();
    let cancelled = false;

    // Fired from the timer rather than the effect body, so stepping quickly
    // through a line cancels before anything is sent.
    const timer = setTimeout(() => {
      const wanted: { id: string; path: string[] }[] = [];
      if (!haveCursor) wanted.push({ id: cursor, path: uciPath });
      // The parent is what turns an evaluation into a grade for the move
      // played. Normally already cached — you arrive at a node from its parent
      // — so this second request is the exception, not the rule.
      if (!haveParent && parentId) wanted.push({ id: parentId, path: uciPath.slice(0, -1) });

      for (const { id, path } of wanted) {
        fetchAnalysis(path, { fen: startFen, depth }, controller.signal)
          .then((result) => {
            if (cancelled) return;
            setEvals((current) => ({ ...current, [id]: result }));
            setError(null);
          })
          .catch((failure: Error) => {
            if (cancelled || failure.name === "AbortError") return;
            setError({ cursor, message: failure.message });
          });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    enabled,
    cursor,
    parentId,
    haveCursor,
    haveParent,
    uciPath,
    startFen,
    depth,
    outcome.over,
  ]);
```

- [ ] **Step 6: Derive the verdicts and the return value**

Replace the `const settled = ...` line and the `return { ... }` block's analysis fields with:

```ts
  /**
   * Grades taken from a review report, keyed by node. The report describes the
   * game as played, which `treeFromHistory` lays down as the main line, so ply
   * i is `mainLine(tree)[i + 1]`. The SAN check stops a report being pinned to
   * a tree it no longer describes.
   */
  const seeded = useMemo(() => {
    if (!review) return NO_VERDICTS;
    const line = mainLine(tree);
    const out: Record<string, MoveVerdict> = {};
    for (const ply of review.plies) {
      const id = line[ply.ply + 1];
      if (!id || tree.nodes[id].san !== ply.san) break;
      out[id] = verdictFromReview(ply);
    }
    return out;
  }, [review, tree]);

  /**
   * A grade for every node whose own and whose parent's evaluation are both
   * cached, which is every node you have walked through. Seeded grades win:
   * they come from the review's own search, which is at least as deep.
   */
  const verdicts = useMemo(() => {
    const out: Record<string, MoveVerdict> = { ...seeded };
    for (const [id, child] of Object.entries(evals)) {
      if (out[id]) continue;
      const node = tree.nodes[id];
      if (!node || node.parent === null || !node.move) continue;
      const parent = evals[node.parent];
      if (!parent) continue;
      const alternatives = legalMoves(positionAt(tree, node.parent)).length;
      const verdict = verdictFrom(parent, child, moveToUci(node.move), alternatives);
      if (verdict) out[id] = verdict;
    }
    return out;
  }, [seeded, evals, tree]);

  const live = enabled && !outcome.over;
  const current = evals[cursor] ?? null;
  const currentError = error && error.cursor === cursor ? error.message : null;
```

Then in the returned object, replace the three analysis fields with:

```ts
    analysis: live ? current : null,
    analysisError: live ? currentError : null,
    analysing: live && !current && !currentError,
    verdicts,
```

`mainLine` is already imported; add `legalMoves` to the `engine` import if it is not already there (it is) and confirm `positionAt` and `moveToUci` are imported (both are).

- [ ] **Step 7: Update the call site**

In `app/components/TinyhouseGame.tsx`, replace:

```ts
  const analysis = useAnalysis(analysisMode);
```

with:

```ts
  const analysis = useAnalysis(analysisMode, { depth: analysisDepth, review });
```

…and, so this task compiles on its own, add a module-level constant near the top of the file, beside the other module constants. Task 9 replaces it with persisted state:

```ts
/** Search depth for the analysis board. Task 9 makes this a stored setting. */
const analysisDepth = 8;
```

A constant rather than `useState` here on purpose: a setter nothing calls yet would fail lint.

`review` is declared above this line already; if TypeScript complains about use before declaration, move the `useAnalysis` call below the `review` state declaration — it has no other ordering constraint.

- [ ] **Step 8: Verify types, lint and existing tests**

Run: `npm run lint && npm run test && npm run build 2>&1 | tail -8`
Expected: eslint silent, tests pass, build clean.

- [ ] **Step 9: Verify against the engine**

With the app running, open the analysis board, play three or four moves, and check the browser network tab: stepping forward sends one `/analyse` per new node (not two), and stepping back sends none, because both evaluations are already cached.

- [ ] **Step 10: Commit**

```bash
git add app/components/useAnalysis.ts app/components/TinyhouseGame.tsx
git commit -m "Cache analysis evaluations per node and derive a grade per move"
```

---

### Task 8: Show the grades on the analysis board

**Files:**
- Modify: `app/components/MoveTreeList.tsx` (optional `verdicts` prop, badge after each SAN)
- Modify: `app/components/AnalysisPanel.tsx` (verdict block, badges in the list, "Back to review")
- Modify: `app/components/TinyhouseGame.tsx` (pass `verdicts`, remember the mode analysis was opened from, `backToReview`)

**Interfaces:**
- Consumes: `MoveVerdict` (Task 6), `analysis.verdicts` (Task 7), `ClassificationBadge` (Task 5).
- Produces: `MoveTreeList` accepts `verdicts?: Record<string, MoveVerdict>`; `AnalysisPanel` accepts `verdicts`, `onBackToReview?: () => void`, `reviewDepth?: number`.

- [ ] **Step 1: Add badges to the move list**

In `app/components/MoveTreeList.tsx`, add the imports and the prop:

```ts
import type { MoveVerdict } from "@/app/lib/engine/verdict";
import ClassificationBadge from "./ClassificationBadge";
```

```ts
  /** Grades per node, when they are known. Absent in a live game. */
  verdicts?: Record<string, MoveVerdict>;
```

Destructure `verdicts` in the component's parameter list (default `{}`), then in `moveButton`, replace the closing of the button's children — the `{node.san}` line — with:

```tsx
        {node.san}
        {verdicts[nodeId] && (
          <ClassificationBadge
            classification={verdicts[nodeId].classification}
            className="ml-0.5 inline-block h-3 w-3 align-middle xl:h-4 xl:w-4"
          />
        )}
```

- [ ] **Step 2: Add the verdict block to AnalysisPanel**

In `app/components/AnalysisPanel.tsx`, add the imports:

```ts
import { CLASSIFICATION_STYLE } from "@/app/lib/engine/classification";
import type { MoveVerdict } from "@/app/lib/engine/verdict";
import { pathTo } from "@/app/lib/tinyhouse/variations";
import ClassificationBadge from "./ClassificationBadge";
```

Add to `AnalysisPanelProps`:

```ts
  /** Grades per node: from the review where there is one, else from the engine. */
  verdicts: Record<string, MoveVerdict>;
  /** Present when a game review is being held, so it can be returned to. */
  onBackToReview?: () => void;
```

Destructure both, then above the `return`, work out what the move on the board was:

```ts
  // The move that reached this position, and where it sits in the game.
  const depth = pathTo(tree, cursor).length - 1;
  const verdict = verdicts[cursor] ?? null;
  const node = tree.nodes[cursor];
  const label =
    depth > 0 && node?.san
      ? `${Math.floor((depth - 1) / 2) + 1}${(depth - 1) % 2 === 0 ? "." : "…"} ${node.san}`
      : null;
  const showBest =
    verdict !== null &&
    verdict.classification !== "best" &&
    verdict.classification !== "great" &&
    verdict.classification !== "forced";
```

Then insert this block between the header row and the engine-verdict block:

```tsx
      {/* How the move that reached this position rated — the same verdict the
          game review gives, so branching off no longer loses it. */}
      {label && (
        <div
          className="shrink-0 rounded-lg px-2 py-1.5 text-xs sm:min-h-[3.25rem]"
          style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-2">
            {verdict ? (
              <ClassificationBadge
                classification={verdict.classification}
                className="h-5 w-5 xl:h-6 xl:w-6"
              />
            ) : (
              <span className="h-5 w-5 rounded-full xl:h-6 xl:w-6" style={{ backgroundColor: "rgba(255,255,255,0.12)" }} />
            )}
            <span className="font-bold">{label}</span>
            <span className="opacity-70">
              {verdict ? CLASSIFICATION_STYLE[verdict.classification].label : "grading…"}
            </span>
          </div>
          {showBest && (
            <div className="mt-1 opacity-80">
              Best was{" "}
              <button
                type="button"
                onClick={() => onPlayLine(verdict!.bestUci)}
                title="Play this move instead — opens an alternate line"
                className="rounded px-1 font-bold underline decoration-dotted underline-offset-2 transition hover:brightness-125"
                style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
              >
                {verdict!.bestSan}
              </button>
              {verdict!.loss > 0 && <> — lost {(verdict!.loss / 100).toFixed(1)}</>}
            </div>
          )}
        </div>
      )}
```

The move numbering follows the same root-relative convention as `MoveTreeList`: a hand-built start position with Black to move will number from White, which is a pre-existing quirk of the move list and out of scope here.

- [ ] **Step 3: Pass verdicts to the list inside AnalysisPanel and add the button**

In the same file, add `verdicts={verdicts}` to the `<MoveTreeList ... />` call. Then in the header's button group, before the Edit button:

```tsx
          {onBackToReview && (
            <button
              type="button"
              onClick={onBackToReview}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide opacity-70 hover:opacity-100"
              style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            >
              Back to review
            </button>
          )}
```

- [ ] **Step 4: Remember the mode analysis was opened from**

In `app/components/TinyhouseGame.tsx`, add state next to `review`:

```ts
  /** Where "Back to review" returns to; null when analysis was entered directly. */
  const [returnMode, setReturnMode] = useState<OpponentMode | null>(null);
```

In `openAnalysis`, before `setMode("analysis")`:

```ts
      // Entering analysis from analysis must not forget the original mode.
      setReturnMode((current) => (mode === "analysis" ? current : mode));
```

and add `mode` to `openAnalysis`'s dependency array.

- [ ] **Step 5: Add the return path**

In `TinyhouseGame.tsx`, next to `playAnalysisLine`, add:

```ts
  /**
   * Back to the game review from the analysis board. The cursor's place on the
   * main line is the ply the review should open at, so the board does not jump.
   */
  const backToReview = useCallback(() => {
    if (!review) return;
    const line = mainLine(analysis.tree);
    const index = line.indexOf(analysis.cursor);
    if (index >= 0) setViewPly(Math.min(index, review.plies.length));
    setMode(returnMode ?? "human");
    setEditing(false);
  }, [review, analysis.tree, analysis.cursor, returnMode, setViewPly]);
```

- [ ] **Step 6: Wire the panel**

In the `<AnalysisPanel ... />` call, add:

```tsx
              verdicts={analysis.verdicts}
              onBackToReview={review ? backToReview : undefined}
```

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run test && npm run build 2>&1 | tail -8`
Expected: clean.

- [ ] **Step 8: Verify the whole loop by hand**

With the app running: play a short game against the bot, review it, click a graded move, then click a "Best was …" suggestion to branch. Confirm that (a) every main-line move in the analysis move list carries its badge immediately, with no stepping, (b) the block above the engine lines names the move and its grade, (c) the branch you played gets its own grade once the engine has evaluated it and its parent, (d) stepping back onto the main line shows the review's grades again, and (e) "Back to review" returns to the review at the same ply.

- [ ] **Step 9: Commit**

```bash
git add app/components/MoveTreeList.tsx app/components/AnalysisPanel.tsx app/components/TinyhouseGame.tsx
git commit -m "Show move grades and the best move on the analysis board"
```

---

### Task 9: Depth controls for analysis and review

**Files:**
- Create: `app/components/DepthStepper.tsx`
- Modify: `app/lib/tinyhouse/storage.ts` (`loadDepths`, `saveDepths`)
- Create: `app/lib/tinyhouse/depths.test.ts`
- Modify: `app/components/AnalysisPanel.tsx` (stepper in the header)
- Modify: `app/components/ReviewPanel.tsx` (stepper in the header)
- Modify: `app/components/TinyhouseGame.tsx` (own both values, persist them, re-run review)
- Modify: `engine/tests/test_server.py` (assert depth is honoured)

**Interfaces:**
- Consumes: nothing from earlier tasks except the `analysisDepth` state added in Task 7.
- Produces:
  - `MIN_DEPTH = 4`, `MAX_DEPTH = 12`, `DEFAULT_DEPTH = 8`, `clampDepth(value: unknown): number`, `loadDepths(): { analysis: number; review: number }`, `saveDepths(depths: { analysis: number; review: number }): void` — all from `@/app/lib/tinyhouse/storage`.
  - `<DepthStepper value onChange label disabled />`.

- [ ] **Step 1: Write the failing test for depth clamping**

Create `app/lib/tinyhouse/depths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH, clampDepth } from "./storage";

describe("clampDepth", () => {
  it("keeps a value in range", () => {
    expect(clampDepth(4)).toBe(4);
    expect(clampDepth(8)).toBe(8);
    expect(clampDepth(12)).toBe(12);
  });

  it("clamps out-of-range values to the ends", () => {
    expect(clampDepth(1)).toBe(MIN_DEPTH);
    expect(clampDepth(99)).toBe(MAX_DEPTH);
  });

  it("rounds a fractional value", () => {
    expect(clampDepth(7.6)).toBe(8);
  });

  it("falls back to the default for anything that is not a number", () => {
    expect(clampDepth("deep")).toBe(DEFAULT_DEPTH);
    expect(clampDepth(undefined)).toBe(DEFAULT_DEPTH);
    expect(clampDepth(null)).toBe(DEFAULT_DEPTH);
    expect(clampDepth(Number.NaN)).toBe(DEFAULT_DEPTH);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- app/lib/tinyhouse/depths.test.ts`
Expected: FAIL — `clampDepth` is not exported from `./storage`.

- [ ] **Step 3: Add depth storage**

In `app/lib/tinyhouse/storage.ts`, add near the other keys:

```ts
const DEPTHS_KEY = "tinyhouse:depths";

/** The UI's search-depth range. The engine itself clamps to 1..20. */
export const MIN_DEPTH = 4;
export const MAX_DEPTH = 12;
export const DEFAULT_DEPTH = 8;

export interface StoredDepths {
  analysis: number;
  review: number;
}

export function clampDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DEPTH;
  return Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, Math.round(value)));
}

export function loadDepths(): StoredDepths {
  const text = read(DEPTHS_KEY);
  if (!text) return { analysis: DEFAULT_DEPTH, review: DEFAULT_DEPTH };
  try {
    const payload = JSON.parse(text) as { analysis?: unknown; review?: unknown };
    return { analysis: clampDepth(payload?.analysis), review: clampDepth(payload?.review) };
  } catch {
    return { analysis: DEFAULT_DEPTH, review: DEFAULT_DEPTH };
  }
}

export function saveDepths(depths: StoredDepths): void {
  write(DEPTHS_KEY, JSON.stringify({ analysis: depths.analysis, review: depths.review }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- app/lib/tinyhouse/depths.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the stepper**

Create `app/components/DepthStepper.tsx`:

```tsx
"use client";

import { MAX_DEPTH, MIN_DEPTH } from "@/app/lib/tinyhouse/storage";

interface DepthStepperProps {
  value: number;
  onChange: (depth: number) => void;
  /** Shown before the number; keep it to a word. */
  label?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * A stepper rather than a slider: each click is one committed change, and a
 * search per step is expensive enough that a dragged slider would fire a
 * dozen of them.
 */
export default function DepthStepper({
  value,
  onChange,
  label = "Depth",
  disabled = false,
  title,
}: DepthStepperProps) {
  const button = (delta: number, glyph: string, name: string) => (
    <button
      type="button"
      aria-label={name}
      title={name}
      disabled={disabled || value + delta < MIN_DEPTH || value + delta > MAX_DEPTH}
      onClick={() => onChange(value + delta)}
      className="h-5 w-5 rounded text-[11px] font-black leading-none transition hover:brightness-125 disabled:opacity-30"
      style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
    >
      {glyph}
    </button>
  );

  return (
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" title={title}>
      <span className="opacity-60">{label}</span>
      {button(-1, "−", "Decrease depth")}
      <span className="w-4 text-center tabular-nums opacity-90">{value}</span>
      {button(1, "+", "Increase depth")}
    </span>
  );
}
```

- [ ] **Step 6: Put the stepper in AnalysisPanel**

In `app/components/AnalysisPanel.tsx`, add `import DepthStepper from "./DepthStepper";`, add to the props interface:

```ts
  depth: number;
  onDepthChange: (depth: number) => void;
```

destructure them, and place the stepper in the header's button group, before "Back to review":

```tsx
          <DepthStepper
            value={depth}
            onChange={onDepthChange}
            title="Engine search depth for this board"
          />
```

- [ ] **Step 7: Put the stepper in ReviewPanel**

In `app/components/ReviewPanel.tsx`, add `import DepthStepper from "./DepthStepper";`, add to the props interface:

```ts
  depth: number;
  /** Changing the depth re-runs the whole review, so this is a commit. */
  onDepthChange: (depth: number) => void;
  reviewing: boolean;
```

destructure them, and in the header row — the one holding `<h2>Game review</h2>` and the Close button — insert before the Close button:

```tsx
        <DepthStepper
          value={depth}
          onChange={onDepthChange}
          disabled={reviewing}
          title="Re-runs the review at this depth"
        />
```

- [ ] **Step 8: Own both values in TinyhouseGame and persist them**

In `app/components/TinyhouseGame.tsx`, replace the `analysisDepth` state added in Task 7 with both values, and import the storage helpers:

```ts
import { DEFAULT_DEPTH, clampDepth, loadDepths, saveDepths } from "@/app/lib/tinyhouse/storage";
```

```ts
  /** Search depth, kept separately per surface: deep review, fast analysis. */
  const [analysisDepth, setAnalysisDepth] = useState(DEFAULT_DEPTH);
  const [reviewDepth, setReviewDepth] = useState(DEFAULT_DEPTH);
```

In the hydration effect, alongside `setMuted(readMuted())`:

```ts
    const depths = loadDepths();
    setAnalysisDepth(depths.analysis);
    setReviewDepth(depths.review);
```

And add a persistence effect next to the others:

```ts
  useEffect(() => {
    if (!hydrated.current) return;
    saveDepths({ analysis: analysisDepth, review: reviewDepth });
  }, [analysisDepth, reviewDepth]);
```

- [ ] **Step 9: Make the review honour its depth, and re-run on change**

In `TinyhouseGame.tsx`, change `startReview` to take an explicit depth so a change does not read stale state:

```ts
  const startReview = useCallback(
    async (depth: number = reviewDepth) => {
      if (!uciMoves.length || reviewing) return;
      setReviewing(true);
      setEngineError(null);
      try {
        const report = await fetchReview(uciMoves, { depth });
        setReview(report);
        setViewPly(report.plies.length);
        interaction.clear();
      } catch (error) {
        setEngineError((error as Error).message);
      } finally {
        setReviewing(false);
      }
    },
    [uciMoves, reviewing, interaction, setViewPly, reviewDepth],
  );

  /** Changing the review depth re-runs it: the grades are depth-dependent. */
  const changeReviewDepth = useCallback(
    (depth: number) => {
      const next = clampDepth(depth);
      setReviewDepth(next);
      if (review) void startReview(next);
    },
    [review, startReview],
  );
```

Every existing `onClick={startReview}` and `onClick={() => startReview()}` must call it with no argument — check the two overlay buttons and `MatchPanel`'s `onReview`, and change any bare `onClick={startReview}` to `onClick={() => startReview()}` so React's event object is never passed as the depth.

- [ ] **Step 10: Wire both panels**

`<AnalysisPanel ... />` gains:

```tsx
              depth={analysisDepth}
              onDepthChange={(next) => setAnalysisDepth(clampDepth(next))}
```

`<ReviewPanel ... />` gains:

```tsx
              depth={reviewDepth}
              onDepthChange={changeReviewDepth}
              reviewing={reviewing}
```

- [ ] **Step 11: Add the Python test that depth is honoured**

Append to `engine/tests/test_server.py`, inside the `TestAnalyse` class:

```python
    def test_depth_is_honoured_and_clamped(self):
        shallow = handle_analyse({"moves": [], "depth": 2, "timeMs": 2000})
        deeper = handle_analyse({"moves": [], "depth": 6, "timeMs": 5000})

        self.assertLessEqual(shallow["depth"], 2)
        self.assertGreater(deeper["depth"], shallow["depth"])
        # Absurd values clamp rather than raising.
        self.assertLessEqual(handle_analyse({"moves": [], "depth": 999, "timeMs": 200})["depth"], 20)
```

- [ ] **Step 12: Run everything**

Run:
```bash
npm run lint && npm run test
(cd engine && python3 -m unittest discover -s tests -t . -v 2>&1 | tail -15)
npm run build 2>&1 | tail -8
```
Expected: all green. If `test_depth_is_honoured_and_clamped` fails because a shallow search still reports a deeper `depth`, read `Searcher.search` to see what `result.depth` reports (iterative deepening may complete a deeper iteration inside the time budget) and assert on the relationship that actually holds rather than weakening the test to nothing.

- [ ] **Step 13: Verify by hand**

With the app running: raise the analysis depth and watch the `depth N · Nk nodes` line change and the evaluation firm up; lower it and confirm it responds. In a review, change the depth and confirm the whole review re-runs ("Analysing…") and the grades update. Refresh and confirm both values came back.

- [ ] **Step 14: Commit**

```bash
git add app/components/DepthStepper.tsx app/lib/tinyhouse/storage.ts app/lib/tinyhouse/depths.test.ts app/components/AnalysisPanel.tsx app/components/ReviewPanel.tsx app/components/TinyhouseGame.tsx engine/tests/test_server.py
git commit -m "Let the search depth be chosen for analysis and review"
```

---

### Task 10: Six more themes, behind a dropdown

**Files:**
- Modify: `app/lib/tinyhouse/themes.ts` (add `group` to `BoardTheme` and to the six existing themes; add six new themes)
- Create: `app/lib/tinyhouse/themes.test.ts`
- Modify: `app/components/ThemePicker.tsx` (rewrite as a dropdown)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BoardTheme.group: "dark" | "light"`; `THEMES` with twelve entries; `ThemePicker` unchanged in props (`theme`, `onSelect`).

A wrapping row of twelve swatches would eat the settings panel, which is why this becomes a dropdown.

- [ ] **Step 1: Write the failing test**

Create `app/lib/tinyhouse/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEMES, getTheme, type BoardTheme } from "./themes";

const COLOUR_FIELDS = [
  "light",
  "dark",
  "frame",
  "backdrop",
  "label",
  "surface",
  "surfaceText",
  "whitePiece",
  "whiteOutline",
  "blackPiece",
  "blackOutline",
  "selected",
  "lastMove",
  "target",
  "accent",
] as const satisfies readonly (keyof BoardTheme)[];

describe("THEMES", () => {
  it("offers twelve themes", () => {
    expect(THEMES).toHaveLength(12);
  });

  it("has unique ids", () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
  });

  it("is split evenly between dark and light", () => {
    const dark = THEMES.filter((theme) => theme.group === "dark");
    const light = THEMES.filter((theme) => theme.group === "light");
    expect(dark).toHaveLength(6);
    expect(light).toHaveLength(6);
  });

  it("gives every theme a name and a complete palette", () => {
    for (const theme of THEMES) {
      expect(theme.name.length, `${theme.id} name`).toBeGreaterThan(0);
      for (const field of COLOUR_FIELDS) {
        expect(theme[field], `${theme.id}.${field}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("resolves an unknown id to the default theme", () => {
    expect(getTheme("no-such-theme").id).toBe(DEFAULT_THEME_ID);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- app/lib/tinyhouse/themes.test.ts`
Expected: FAIL — six themes, no `group` field. (If `DEFAULT_THEME_ID` is not exported from `themes.ts`, check its actual export name with `grep -n "DEFAULT_THEME" app/lib/tinyhouse/themes.ts` and use that.)

- [ ] **Step 3: Add the grouping field**

In `app/lib/tinyhouse/themes.ts`, add to the `BoardTheme` interface after `name`:

```ts
  /** Which half of the picker the theme belongs in. */
  group: "dark" | "light";
```

Then add `group: "dark",` immediately after the `name:` line of each of the six existing themes (`wood`, `slate`, `emerald`, `midnight`, `coral`, `amethyst`).

Verify: `grep -c 'group: "dark"' app/lib/tinyhouse/themes.ts` → `6`.

- [ ] **Step 4: Add the six new themes**

Append these to the `THEMES` array, after `amethyst`:

```ts
  {
    id: "marble",
    name: "Marble",
    group: "light",
    light: "#f7f6f2",
    dark: "#b6bcc4",
    frame: "#8f959d",
    backdrop: "#e6e4de",
    label: "#3a3d42",
    surface: "#ffffff",
    surfaceText: "#2c2f34",
    whitePiece: "#ffffff",
    whiteOutline: "#6c7178",
    blackPiece: "#3a3d42",
    blackOutline: "#14161a",
    selected: "#f0c14b",
    lastMove: "#dcd08a",
    target: "#5f9e5f",
    accent: "#c2762c",
  },
  {
    id: "sandstone",
    name: "Sandstone",
    group: "light",
    light: "#faeed6",
    dark: "#cfae82",
    frame: "#a8814f",
    backdrop: "#ece0c8",
    label: "#4b3a26",
    surface: "#fff7e8",
    surfaceText: "#3d2f1e",
    whitePiece: "#fffdf7",
    whiteOutline: "#8a6a42",
    blackPiece: "#4a3826",
    blackOutline: "#241a10",
    selected: "#e8a13c",
    lastMove: "#e0c184",
    target: "#5d8f4f",
    accent: "#c9752a",
  },
  {
    id: "ice",
    name: "Ice",
    group: "light",
    light: "#f0f7fc",
    dark: "#a7c6de",
    frame: "#7396ad",
    backdrop: "#dce9f2",
    label: "#24404f",
    surface: "#ffffff",
    surfaceText: "#1d3644",
    whitePiece: "#ffffff",
    whiteOutline: "#5b7f96",
    blackPiece: "#27404d",
    blackOutline: "#0e1c24",
    selected: "#f2c14e",
    lastMove: "#bcd8ea",
    target: "#4f9c86",
    accent: "#2f7fb0",
  },
  {
    id: "rose",
    name: "Rose",
    group: "dark",
    light: "#f6dfe3",
    dark: "#b3707f",
    frame: "#7d3d4c",
    backdrop: "#2a1218",
    label: "#f0cdd4",
    surface: "#3d1c25",
    surfaceText: "#f8e3e7",
    whitePiece: "#fff6f7",
    whiteOutline: "#7d4351",
    blackPiece: "#31161d",
    blackOutline: "#150609",
    selected: "#f4c15c",
    lastMove: "#d98fa0",
    target: "#4f8f5f",
    accent: "#e0657f",
  },
  {
    id: "forest",
    name: "Forest",
    group: "dark",
    light: "#e4e8cf",
    dark: "#7a8f5c",
    frame: "#4b5c37",
    backdrop: "#141a10",
    label: "#cddab5",
    surface: "#1f2a17",
    surfaceText: "#e6ecd6",
    whitePiece: "#f8fbef",
    whiteOutline: "#4d5c38",
    blackPiece: "#1e2416",
    blackOutline: "#0a0d06",
    selected: "#e8c14e",
    lastMove: "#b6c184",
    target: "#3f8f6a",
    accent: "#8fbf4a",
  },
  {
    id: "mono",
    name: "Mono",
    group: "dark",
    light: "#e8e8e8",
    dark: "#6b6b6b",
    frame: "#2a2a2a",
    backdrop: "#0d0d0d",
    label: "#dcdcdc",
    surface: "#1c1c1c",
    surfaceText: "#f2f2f2",
    whitePiece: "#ffffff",
    whiteOutline: "#000000",
    blackPiece: "#000000",
    blackOutline: "#ffffff",
    selected: "#ffd400",
    lastMove: "#8c8c8c",
    target: "#00b36b",
    accent: "#f2f2f2",
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- app/lib/tinyhouse/themes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Rewrite ThemePicker as a dropdown**

Replace the whole of `app/components/ThemePicker.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, type BoardTheme } from "@/app/lib/tinyhouse/themes";

interface ThemePickerProps {
  theme: BoardTheme;
  onSelect: (id: string) => void;
}

const GROUPS: { group: BoardTheme["group"]; label: string }[] = [
  { group: "dark", label: "Dark" },
  { group: "light", label: "Light" },
];

/** The four-square board preview shown beside a theme's name. */
function Swatch({ theme, className = "h-5 w-5" }: { theme: BoardTheme; className?: string }) {
  return (
    <span
      className={`overflow-hidden rounded-full border ${className}`}
      style={{ borderColor: theme.frame }}
    >
      <span className="grid h-full w-full grid-cols-2">
        <span style={{ backgroundColor: theme.light }} />
        <span style={{ backgroundColor: theme.dark }} />
        <span style={{ backgroundColor: theme.dark }} />
        <span style={{ backgroundColor: theme.light }} />
      </span>
    </span>
  );
}

/**
 * A dropdown rather than a row of chips: twelve swatches wrapped across a
 * narrow settings panel pushed everything else off the screen.
 */
export default function ThemePicker({ theme, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    // A list anchored to the button is meaningless once the layout moves.
    const onResize = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="relative" ref={container}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs font-bold transition hover:brightness-125"
        style={{ backgroundColor: "rgba(255,255,255,0.1)", color: theme.surfaceText }}
      >
        <Swatch theme={theme} />
        <span className="flex-1 text-left">{theme.name}</span>
        <span className="opacity-60">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Board theme"
          className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full min-w-40 overflow-y-auto rounded-lg py-1 shadow-2xl"
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        >
          {GROUPS.map(({ group, label }) => (
            <div key={group} role="group" aria-label={label}>
              <div className="px-2 py-1 text-[10px] font-black uppercase tracking-wide opacity-50">
                {label}
              </div>
              {THEMES.filter((option) => option.group === group).map((option) => {
                const active = option.id === theme.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(option.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-semibold transition hover:brightness-125"
                    style={{ backgroundColor: active ? "rgba(255,255,255,0.16)" : "transparent" }}
                  >
                    <Swatch theme={option} />
                    <span className="flex-1">{option.name}</span>
                    {active && <span aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

The list opens **upwards** (`bottom-full`) because the picker sits at the bottom of the settings panel.

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run test && npm run build 2>&1 | tail -8`
Expected: clean, and the new theme test passing.

- [ ] **Step 8: Verify by eye and by keyboard**

With the app running: open the theme dropdown, confirm the Dark and Light groups, pick each of the six new themes and check the board, pieces, panels, eval bar and badges all stay legible — the light themes are the risky ones. Confirm Tab reaches the button, Enter opens it, Escape closes it and returns focus, and that a click outside closes it.

- [ ] **Step 9: Commit**

```bash
git add app/lib/tinyhouse/themes.ts app/lib/tinyhouse/themes.test.ts app/components/ThemePicker.tsx
git commit -m "Add six board themes and move the picker into a dropdown"
```

---

### Task 11: Uncramp the mode buttons

**Files:**
- Modify: `app/components/MatchPanel.tsx` (the opponent selector only)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change. Task 12 adds a fourth cell to the grid this task builds.

The selector is one row of three buttons at `text-[11px]` in a `w-52` panel — already tight, and Task 12 adds a fourth mode.

- [ ] **Step 1: Replace the segmented bar with a grid**

In `app/components/MatchPanel.tsx`, replace the whole opponent `<div ... role="group" aria-label="Opponent">` block with:

```tsx
        <div className="grid grid-cols-2 gap-1" role="group" aria-label="Opponent">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              disabled={locked}
              onClick={() => onModeChange(option.mode)}
              className="h-9 rounded-lg px-1.5 text-[11px] font-bold uppercase tracking-wide transition disabled:cursor-default"
              style={{
                ...chip(mode === option.mode),
                opacity: locked && mode !== option.mode ? 0.35 : 1,
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
```

- [ ] **Step 2: Add the option table**

Above the `export default function MatchPanel`, add:

```tsx
/** Kept beside the type so a new mode cannot be added without a label. */
const MODE_OPTIONS: { mode: OpponentMode; label: string }[] = [
  { mode: "human", label: "2 players" },
  { mode: "bot", label: "vs Bot" },
  { mode: "analysis", label: "Analysis" },
];
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build 2>&1 | tail -8`
Expected: clean.

- [ ] **Step 4: Verify by eye**

With the app running, check the settings panel at the `md` width (the 52-unit sidebar) and on a phone-width viewport: each label fits on one line inside its chip, and the selected chip is obvious.

- [ ] **Step 5: Commit**

```bash
git add app/components/MatchPanel.tsx
git commit -m "Lay the opponent buttons out as a grid instead of one cramped row"
```

---

### Task 12: Engine vs engine

**Files:**
- Modify: `app/lib/engine/client.ts` (`fetchBestMove` takes a seed)
- Modify: `app/lib/tinyhouse/storage.ts` (`MODES` gains `"engines"`)
- Modify: `app/components/MatchPanel.tsx` (`OpponentMode`, the fourth mode option, the engine settings, playback controls)
- Modify: `app/components/TinyhouseGame.tsx` (state, the generalised engine effect, locking, hydration)

**Interfaces:**
- Consumes: everything as it stands after Task 11.
- Produces:
  - `OpponentMode = "human" | "bot" | "engines" | "analysis"`
  - `fetchBestMove(moves: string[], level: number, options?: { seed?: number }, signal?: AbortSignal)`
  - `MatchPanel` props: `engineLevels: Record<Color, number>`, `moveDelayMs: number`, `paused: boolean`, `onEngineLevelChange: (color: Color, level: number) => void`, `onDelayChange: (ms: number) => void`, `onTogglePause: () => void`, `onStep: () => void`

- [ ] **Step 1: Let a best-move request carry a seed**

In `app/lib/engine/client.ts`, replace `fetchBestMove` with:

```ts
export function fetchBestMove(
  moves: string[],
  level: number,
  options: { seed?: number } = {},
  signal?: AbortSignal,
): Promise<BestMoveResponse> {
  return call<BestMoveResponse>("bestmove", {
    method: "POST",
    // A seed makes one engine's choice reproducible; a fresh seed per move is
    // what stops two engines at the same level replaying the same game.
    body: JSON.stringify({ moves, level, ...(options.seed !== undefined ? { seed: options.seed } : {}) }),
    signal,
  });
}
```

Confirm the engine accepts it: `grep -n "seed" engine/tinyhouse/server.py` — `handle_bestmove` reads `payload.get("seed")` and builds `random.Random(seed)`.

- [ ] **Step 2: Add the mode to the type and to persistence**

In `app/components/MatchPanel.tsx`:

```ts
export type OpponentMode = "human" | "bot" | "engines" | "analysis";
```

and add the fourth entry to `MODE_OPTIONS`, ordered so the grid reads sensibly:

```ts
const MODE_OPTIONS: { mode: OpponentMode; label: string }[] = [
  { mode: "human", label: "2 players" },
  { mode: "bot", label: "vs Bot" },
  { mode: "engines", label: "Bot vs Bot" },
  { mode: "analysis", label: "Analysis" },
];
```

In `app/lib/tinyhouse/storage.ts`:

```ts
const MODES = ["human", "bot", "engines", "analysis"] as const;
```

- [ ] **Step 3: Add the engine-vs-engine settings to MatchPanel**

Add to `MatchPanelProps`:

```ts
  /** Levels for the two machine players, used in `engines` mode. */
  engineLevels: Record<Color, number>;
  /** Floor on the interval between machine moves, in milliseconds. */
  moveDelayMs: number;
  paused: boolean;
  onEngineLevelChange: (color: Color, level: number) => void;
  onDelayChange: (ms: number) => void;
  onTogglePause: () => void;
  onStep: () => void;
```

Destructure them, and add next to `botControlsActive`:

```ts
  const enginesMode = mode === "engines";
  const engineControlsActive = enginesMode && !locked;
```

Then, immediately after the existing bot-settings block, add:

```tsx
        {/* Machine-versus-machine settings. Mounted only in that mode: unlike
            the bot block there is nothing here to keep the layout steady for. */}
        {enginesMode && (
          <div className="flex w-full flex-col gap-2">
            {(["w", "b"] as const).map((color) => (
              <label
                key={color}
                className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide"
              >
                <span className="flex items-center gap-1.5 opacity-70">
                  <span
                    className="h-3 w-3 rounded-full border"
                    style={{
                      backgroundColor: color === "w" ? theme.whitePiece : theme.blackPiece,
                      borderColor: theme.surfaceText,
                    }}
                  />
                  {color === "w" ? "White" : "Black"}
                </span>
                <select
                  aria-label={`${color === "w" ? "White" : "Black"} engine level`}
                  value={engineLevels[color]}
                  disabled={!engineControlsActive}
                  onChange={(event) => onEngineLevelChange(color, Number(event.target.value))}
                  className="h-8 w-28 rounded-lg px-2 text-xs font-bold"
                  style={{ backgroundColor: "rgba(255,255,255,0.1)", color: theme.surfaceText }}
                >
                  {levels.map((option) => (
                    <option key={option.level} value={option.level}>
                      {option.level}. {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide">
              <span className="flex items-center justify-between">
                <span className="opacity-70">Move every</span>
                <span className="tabular-nums opacity-90">{(moveDelayMs / 1000).toFixed(1)}s</span>
              </span>
              <input
                type="range"
                min={200}
                max={10000}
                step={100}
                value={moveDelayMs}
                disabled={!engineControlsActive}
                onChange={(event) => onDelayChange(Number(event.target.value))}
                aria-label="Seconds between engine moves"
                className="w-full"
                style={{ accentColor: theme.accent }}
              />
            </label>

            {/* Playback, available only once the machines are actually playing. */}
            {started && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={onTogglePause}
                  className="h-8 flex-1 rounded-lg text-[11px] font-bold uppercase tracking-wide transition hover:brightness-110"
                  style={{ backgroundColor: "rgba(255,255,255,0.1)", color: theme.surfaceText }}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={onStep}
                  disabled={!paused}
                  title="Play a single move"
                  className="h-8 flex-1 rounded-lg text-[11px] font-bold uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40"
                  style={{ backgroundColor: "rgba(255,255,255,0.1)", color: theme.surfaceText }}
                >
                  Step
                </button>
              </div>
            )}
          </div>
        )}
```

Also extend the phone bar's summary label — the expression ending `: analysing ? "Analysis" : "2 players"` — to name this mode:

```tsx
          {mode === "bot"
            ? levelName
            : enginesMode
              ? "Bot vs Bot"
              : analysing
                ? "Analysis"
                : "2 players"}
```

- [ ] **Step 4: Add the state to TinyhouseGame**

In `app/components/TinyhouseGame.tsx`, next to the other opponent state:

```ts
  /** Machine-versus-machine: a level per side, a pacing floor, and playback. */
  const [engineLevels, setEngineLevels] = useState<Record<Color, number>>({ w: 3, b: 3 });
  const [moveDelayMs, setMoveDelayMs] = useState(1000);
  const [paused, setPaused] = useState(false);
  /** Moves the machines may play while paused; Step sets it to one. */
  const [steps, setSteps] = useState(0);
```

- [ ] **Step 5: Work out whose turn the engine has**

Below `botToMove`, add:

```ts
  const enginesMode = mode === "engines";
  /** True while the machines are free to move: paused holds them, Step lets one through. */
  const enginesRunning = enginesMode && started && !outcome.over && (!paused || steps > 0);

  /**
   * The colour the engine is to move for, or null when no engine should be
   * thinking. One value covers both machine modes, so there is a single place
   * where "is it the computer's turn" is decided.
   */
  const engineTurn: Color | null =
    interaction.promotion || inReview
      ? null
      : botToMove
        ? game.turn
        : enginesRunning
          ? game.turn
          : null;
```

`interaction` is declared below this point in the file; move these three declarations to just after the `const interaction = useBoardInteraction({...})` call, which is where `botToMove`'s consumers already live. Keep `botToMove` itself where it is.

- [ ] **Step 6: Generalise the engine effect**

Replace the whole `// --- engine: the bot's move ---` effect with:

```ts
  // --- engine: the machine's move -------------------------------------------

  // One effect drives both machine modes. In `engines` mode the reply is held
  // until `moveDelayMs` has passed since the request went out, so the delay is
  // a floor on the interval between moves rather than an addition to the
  // engine's own thinking time.
  useEffect(() => {
    if (engineTurn === null) return;

    const controller = new AbortController();
    const requestedAt = Date.now();
    const askedLevel = enginesMode ? engineLevels[engineTurn] : level;
    const delay = enginesMode ? moveDelayMs : 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    fetchBestMove(uciMoves, askedLevel, { seed: Math.floor(Math.random() * 2 ** 31) }, controller.signal)
      .then((response) => {
        if (cancelled) return;
        const move = moveFromUci(response.move);
        timer = setTimeout(
          () => {
            if (cancelled) return;
            // Guard against a stale reply landing on a position that moved on.
            setGame((current) => (current === game ? applyMove(current, move) : current));
            // A stepped move is spent once it has been played.
            if (enginesMode && paused) setSteps((current) => Math.max(0, current - 1));
          },
          Math.max(0, delay - (Date.now() - requestedAt)),
        );
      })
      .catch((error: Error) => {
        if (!cancelled && error.name !== "AbortError") setEngineError(error.message);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [
    engineTurn,
    enginesMode,
    engineLevels,
    moveDelayMs,
    paused,
    uciMoves,
    level,
    game,
    retryToken,
  ]);
```

- [ ] **Step 7: Keep the board read-only and the indicator honest**

In `TinyhouseGame.tsx`:

```ts
  const locked = !analysisMode && !branching && (enginesMode || !started || botToMove || rewound);
```

```ts
  /** A request is in flight for exactly as long as a machine is to move. */
  const thinking = engineTurn !== null && !engineError;
```

(The old `thinking` already excluded a promotion dialog and a review; `engineTurn` folds both in.)

Add the auto-pause on rewinding, next to the other effects:

```ts
  // Watching from a rewound board would fight the live game for the display.
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => {
    if (enginesMode && rewound) setPaused(true);
  }, [enginesMode, rewound]);
```

And in the hydration effect, after `setStarted(stored.started)`:

```ts
      // A restored machine game waits for a deliberate Resume rather than
      // firing off a search the moment the page loads.
      if (stored.mode === "engines") setPaused(true);
```

- [ ] **Step 8: Reset playback state when a match starts or ends**

In `startMatch`, after `resetBoard()`:

```ts
    setPaused(false);
    setSteps(0);
```

- [ ] **Step 9: Wire MatchPanel**

Add to the `<MatchPanel ... />` call:

```tsx
          engineLevels={engineLevels}
          moveDelayMs={moveDelayMs}
          paused={paused}
          onEngineLevelChange={(color, next) =>
            setEngineLevels((current) => ({ ...current, [color]: next }))
          }
          onDelayChange={setMoveDelayMs}
          onTogglePause={() => setPaused((current) => !current)}
          onStep={() => setSteps(1)}
```

Also confirm `onModeChange` still resets the setup editor only for `analysis` — the `engines` mode needs no editor.

- [ ] **Step 10: Verify types, lint, tests, build**

Run: `npm run lint && npm run test && npm run build 2>&1 | tail -8`
Expected: clean. A TypeScript error about `OpponentMode` not being assignable somewhere means a `switch` or a ternary needs the fourth case — fix the exhaustiveness rather than casting.

- [ ] **Step 11: Verify the mode by hand**

With the app running: choose Bot vs Bot, set White to level 1 and Black to level 5, set the delay to about 2 seconds, and Start. Confirm that moves arrive roughly every 2 seconds and are not merely the engine's think time plus 2 seconds; that the board cannot be moved by hand; that Pause stops the game and Step advances exactly one move; that rewinding through the move list pauses it automatically; that each move plays its sound; that the game ends with the usual overlay and Review works on the finished machine game; and that reloading mid-game restores it paused.

- [ ] **Step 12: Commit**

```bash
git add app/lib/engine/client.ts app/lib/tinyhouse/storage.ts app/components/MatchPanel.tsx app/components/TinyhouseGame.tsx
git commit -m "Add an engine-versus-engine mode with pacing and playback controls"
```

---

## Final verification

- [ ] **Whole suite**

```bash
npm run lint
npm run test
(cd engine && python3 -m unittest discover -s tests -t . 2>&1 | tail -5)
npm run build 2>&1 | tail -20
npm run build 2>&1 | grep -c '⚠' # expect 0
```

- [ ] **One manual pass with `npm start`**, exercising each of the nine items: one command starts both processes; sounds fire and mute; no build warning; grades show on the analysis board and survive branching; badge glyphs scale; depth changes take effect in both places; themes list in a dropdown and the new ones are legible; the mode buttons fit; and two engines play a watchable game.

- [ ] **Report honestly.** If any step above did not pass, say which and why rather than reporting the plan complete.

---

## Notes for the executor

- **The sign convention is the trap.** If grades look inverted or nonsensical, re-read Task 6's explanation before changing anything: `loss = parent.score + child.score` is correct precisely because the two positions have opposite sides to move.
- **`useAnalysis`'s effect depends on `evals` indirectly** through `haveCursor`/`haveParent`. That is deliberate: those are booleans, so a cache write re-runs the effect once, finds nothing wanted, and stops. Do not add `evals` itself to the dependency array.
- **`react-hooks/set-state-in-effect`** is enforced in this repo. The two places this plan sets state in an effect (the depth reset in Task 7, the auto-pause in Task 12) carry a disable comment with the reason; do not add more without one.
- **Do not remove the `AGENTS.md` block** from `CLAUDE.md`/`AGENTS.md`; `next dev` rewrites it.
