# Analysis, match and presentation upgrades — design

Date: 2026-08-31
Branch: `analysis-board`

Nine changes, grouped into four areas that share no state and can land
independently. Written after the scope of an initially bounded request grew to
include a new play mode and engine controls.

## 1. One command starts everything

`dev.sh` already starts the Python engine and the Next.js app together, picks
free ports, and tears both down on Ctrl-C. It is simply not wired into npm.

- `package.json` scripts become:
  - `start`: `./dev.sh` — engine + `next dev`, hot reload, one Ctrl-C stops both.
  - `start:prod`: `./dev.sh --prod` — engine + `next build` + `next start`.
  - `next:start`: `next start` — what `dev.sh --prod` invokes internally.
  - `dev` stays `next dev` (frontend only), `build`, `lint`, `test` unchanged.
- `dev.sh` gains a preflight: if `python3` is missing, or `python3 -c "import
  tinyhouse"` fails from the `engine/` directory, print what to install and exit
  non-zero instead of failing 10 seconds later inside the port wait loop.
- `dev.sh --prod` calls `npm run next:start` so the two entry points cannot
  recurse into each other.

## 2. Sound

Sounds are generated, not sourced, so they are reproducible and carry no
licence questions.

- `engine/tools/make_sounds.py` — stdlib only (`wave`, `struct`, `math`). Writes
  five 16-bit mono 44.1 kHz files to `public/sounds/`, each a short
  exponentially-decaying blend of two or three sine partials, a few KB apiece:
  - `move.wav` — low soft wooden click (~180 Hz body, 40 ms).
  - `capture.wav` — sharper, louder thud with a noise transient (~120 Hz, 70 ms).
  - `drop.wav` — higher, crisper click than a move (~320 Hz, 35 ms), so a
    reserve drop is audibly a different act from a board move.
  - `check.wav` — two-tone rising alert (~520 → 700 Hz, 120 ms).
  - `end.wav` — three-note falling flourish (~180 ms).
  The script is committed and idempotent; regenerating is `python3
  engine/tools/make_sounds.py`. The generated `.wav` files are committed too, so
  a clone needs no build step.
- `app/lib/sound.ts` — a tiny player:
  - `SOUND_STORAGE_KEY = "tinyhouse:muted"`, read/write guarded like the theme key.
  - Lazily constructs one `Audio` element per kind on first play, resetting
    `currentTime` rather than allocating, so rapid stepping does not leak
    elements. Playback failures (autoplay policy before the first gesture) are
    swallowed — sound is a garnish, never an error.
  - `soundForSan(san)`: `#` → `end`, `+` → `check`, `x` → `capture`, `@` →
    `drop`, otherwise `move`. Precedence in that order, so a checkmating capture
    plays the end sound. Unit-tested — it is pure string work.
- `app/components/useMoveSound.ts` — an effect keyed on a signature of the
  *displayed* position (the SAN of the move that produced it plus a
  monotonically distinct key: live ply index, or analysis node id). When the
  signature changes and is not the initial mount, play `soundForSan`. Driving it
  from the displayed position means human moves, bot moves, engine-vs-engine
  moves, review stepping and analysis navigation all sound correct through one
  code path, with no call sites sprinkled through the move handlers.
- Mute toggle: a speaker button in the `TinyhouseGame` header, next to Flip.
  Unmuted by default. State lives in `TinyhouseGame` and is passed to the hook.

## 3. The Next.js warning

`next build` and `next dev` both print:

> Next.js ignored package-lock.json in /home/adri because it is outside the
> current Git repository (/home/adri/Documents/tinyhouse-chess). To use this
> directory, set `turbopack.root` in your Next.js config.

Next walks up looking for a lockfile and finds a stray one in the home
directory. Fix: pin the root in `next.config.ts`.

```ts
const nextConfig: NextConfig = {
  turbopack: { root: import.meta.dirname },
};
```

Verified by a `next build` with no warning in the output. Note that `AGENTS.md`
warns this Next version differs from training data — the exact config key is to
be confirmed against `node_modules/next/dist/docs/` before writing it.

## 4. Move grades on the analysis board

### The problem

Reviewing a game, every move carries a grade (Best, Inaccuracy, Blunder…) and a
"best was X". Branching off to try an alternative switches to analysis mode,
which shows only a bare evaluation — and stepping back onto the main line never
restores the grades. Two causes:

- `useAnalysis` keeps exactly one evaluation, the cursor's (`Evaluation` is
  tagged with a single node id), so nothing is available to compare a move
  against its alternative.
- `TinyhouseGame` keeps the `GameReview` in state when it opens analysis, but
  `AnalysisPanel` never receives it, so the work already done is invisible.

### Grading a move from two evaluations

`/analyse` is deterministic at a fixed depth, so a move's grade needs only the
evaluation of the position before it and after it. With both scores
side-to-move-relative (as the engine returns them):

```
loss    = parent.score + child.score      // mover's POV; the sign flip is the +
isBest  = playedUci === parent.lines[0].uci
margin  = parent.lines[0].score - parent.lines[1].score   // 0 when only one line
alternatives = legalMoves(parentPosition).length          // computed locally
```

`alternatives` and the position itself come from the local rules engine, so no
API change is needed. The three thresholds tables live in
`engine/tinyhouse/analysis.py`; the client mirrors them.

### Changes

- `app/lib/engine/verdict.ts` (new)
  - `interface MoveVerdict { classification: Classification; loss: number;
    bestUci: string; bestSan: string; scoreWhite: number; mateWhite: number | null }`
  - `classifyMove({ loss, isBest, alternatives, margin }): Classification` —
    a direct mirror of `classify()` in `analysis.py`: `alternatives <= 1` →
    `forced`; `isBest` → `great` when `margin >= 150` else `best`; then
    20/50/120/300 → excellent/good/inaccuracy/mistake; else `blunder`.
    Constants are named and exported so a test can assert them against the
    Python values.
  - `verdictFrom(parent: AnalysisResult, child: AnalysisResult, playedUci,
    alternatives): MoveVerdict` — the arithmetic above, with `loss` clamped to
    `[0, 1500]` like `MAX_LOSS`.
  - `verdictFromReview(ply: PlyReview): MoveVerdict` — the same shape out of a
    review report, so consumers never branch on where a grade came from.
- `app/components/useAnalysis.ts`
  - Replaces the single `Evaluation` with `evals: Record<string, AnalysisResult>`
    keyed by node id. Node ids are stable within a tree and a node's position
    never changes, so the cache cannot go stale; `load()` (a new tree) and a
    depth change both clear it.
  - The engine effect requests the cursor's evaluation, and then the parent's if
    it is missing — normally already cached, since you arrive at a node from its
    parent. Both requests share the abort controller and the existing 250 ms
    debounce.
  - Takes `depth` and an optional `seedVerdicts: Record<string, MoveVerdict>`.
  - Exposes `verdicts: Record<string, MoveVerdict>`, computed as: seeded
    verdicts first, then a live verdict for every node whose own and parent's
    evaluations are both cached. Live wins only where no seed exists, so a
    reviewed move keeps the deeper review's grade.
- `TinyhouseGame` seeds from the report. `openAnalysis` builds the tree with
  `treeFromHistory(game.history)`, whose main line is ply-for-ply the reviewed
  game, so `mainLine(tree)[i + 1]` is the node for `review.plies[i]`. The seed
  map is memoised and only built while the tree still starts from the reviewed
  game's opening position. Result: opening analysis from a review shows every
  grade immediately, with no stepping.
- `AnalysisPanel` gains a verdict block directly above the engine lines, in
  `ReviewPanel`'s wording: badge, `12… Nf3`, the label, and — when the move was
  neither best nor forced — `Best was Qb3 (+0.4)` as a clickable button that
  branches onto that move. Absent (block reserves its height) when the cursor is
  at the root or the grade is not yet known.
- `MoveTreeList` takes an optional `verdicts` map and renders the badge after
  each SAN, main line and variations alike.
- Getting back: `TinyhouseGame` records the mode analysis was opened from, and
  `AnalysisPanel` shows a "Back to review" button whenever a report exists.
  It restores that mode and, if the cursor sits on the main line, sets `viewPly`
  to the cursor's depth so the board does not jump.

## 5. Classification badge sizing

The badges are `h-5 w-5` with `text-[10px]` (and `h-4 w-4`/`text-[9px]` in the
move list): the circle is set in one place and the glyph in another, so on a
large screen the glyph floats tiny inside its circle.

`app/components/ClassificationBadge.tsx` (new) renders the badge as an inline
SVG — a `<circle>` plus a `<text>` centred in a fixed `viewBox` with
`dominant-baseline="central"` and `text-anchor="middle"`. The glyph then scales
exactly with the box, whatever size CSS gives it. The component takes
`classification`, an optional `title`, and a `className` for sizing;
`ReviewPanel`, `MoveTreeList` and `AnalysisPanel` all use it with responsive
classes (`h-5 w-5 xl:h-6 xl:w-6`), so the badges grow with the panel instead of
staying pinned to a pixel size. Multi-character glyphs (`?!`, `??`) get a
slightly smaller font size inside the same viewBox, chosen from the glyph
length, so they do not overflow the circle.

## 6. Engine depth controls

Both surfaces get their own depth, remembered separately.

- `app/lib/tinyhouse/storage.ts` gains `loadDepths()` / `saveDepths()` over a
  `tinyhouse:depths` key holding `{ analysis: number; review: number }`, with
  the same guarded read/write and range clamping as the rest of the module.
- Range 4–12, default 8 (today's hard-coded value in `client.ts`). The engine
  caps nothing itself, so the client clamps.
- `AnalysisPanel`: a compact depth stepper beside the `depth N · Nk nodes`
  line. Changing it clears the evaluation cache and re-evaluates the cursor;
  live verdicts are then recomputed at the new depth. Seeded review verdicts are
  left alone — they came from the review's own depth, which the panel labels.
- `ReviewPanel`: the same stepper in the header. Changing it re-runs the review
  through the existing `startReview` path, showing its "Analysing…" state. Fired
  on commit (change, not drag), because a review is a search per ply.
- `TinyhouseGame` owns both values and passes them down; `fetchAnalysis` and
  `fetchReview` already accept `depth`, so no engine or route change is needed.

## 7. Themes: a dropdown, and six more

- `app/lib/tinyhouse/themes.ts` gains a `light: boolean`-style grouping field —
  concretely `group: "dark" | "light"` — on `BoardTheme`, and six themes:
  Marble (light), Sandstone (light), Ice (light), Rose (dark), Forest (dark),
  Mono (high-contrast dark). Twelve in total, six of each group, so the app
  finally has genuine light boards. Every field of `BoardTheme` is filled for
  each; contrast between `whitePiece`/`blackPiece` and both square colours is
  checked by eye against a real board.
- `ThemePicker` becomes a dropdown: a button showing the current theme's swatch
  and name, opening a popover list grouped under "Dark" and "Light" headings,
  each row a swatch plus name, the active row marked. Keyboard support:
  Enter/Space opens, arrows move, Enter selects, Escape closes, focus returns to
  the button. Closes on outside pointerdown and on resize, following the pattern
  already used by `MoveTreeList`'s context menu. This replaces a wrapping row of
  twelve chips that would otherwise eat the settings panel.

## 8. Mode buttons: four, uncramped

The opponent selector is a single row of three buttons at `text-[11px]` in a
`w-52` panel, already tight; a fourth would be unreadable. It becomes a 2×2
grid (`grid grid-cols-2 gap-1`) of `h-9` buttons with `text-[11px]`, each a
rounded chip rather than a segment of one bar:

```
[ 2 players ] [ vs Bot   ]
[ Bot vs Bot ] [ Analysis ]
```

The phone bar's summary label learns the fourth mode. `aria-pressed` and the
`locked` behaviour carry over unchanged.

## 9. Engine vs engine

A fourth mode where both sides are played by the engine and the game unfolds on
screen.

- `OpponentMode` gains `"engines"`; `storage.ts`'s `MODES` list gains it too, so
  the mode survives a refresh.
- State in `TinyhouseGame`: `engineLevels: Record<Color, number>` (defaults 3/3),
  `moveDelayMs` (default 1000, range 200–10000), and `paused` (false).
- `MatchPanel`, when the mode is `engines` and no match is running, shows two
  level selects — White and Black, reusing the existing `levels` list — and a
  delay slider labelled in seconds. Both are locked once the match starts, like
  the existing bot settings.
- The bot effect generalises. Today it fires on `mode === "bot" && botToMove`;
  it becomes: an `engineToMove` colour, which is `botSide` in `bot` mode and
  `game.turn` in `engines` mode, null when the game is over, the mode is
  neither, a promotion dialog is open, a review is showing, or `paused`. The
  level asked for is `engineLevels[engineToMove]` in `engines` mode and `level`
  in `bot` mode. The request carries a fresh random `seed` (already supported by
  `/bestmove`), so two engines at the same level do not replay one game.
- Pacing: the move is applied after `max(0, moveDelayMs - elapsed)`, measured
  from when the request was sent, so the delay is a floor on the interval rather
  than an addition to the engine's own thinking time. The timer is cleared by
  the effect's cleanup, so pausing or unmounting drops a move in flight.
- Playback controls, shown in `MatchPanel` while an `engines` match runs:
  Pause/Resume, and Step (plays exactly one move while paused, by arming a
  one-shot flag the effect consumes). Rewinding with the existing board
  navigation pauses automatically — watching from a rewound board would fight
  the live game for the display.
- The board stays read-only throughout: `locked` includes `mode === "engines"`.
  When the game ends, the existing overlay appears with Review, Analyse and
  Rematch, so a watched game flows into the same review the played ones do.
- `canReview` already keys off the move count rather than the mode, so
  reviewing a machine game needs no change.

## Testing

- Unit (vitest): `classifyMove` against the Python thresholds; `verdictFrom`'s
  sign convention (the easy thing to get subtly wrong — a case per side to move,
  and a mate score); `verdictFromReview`; `soundForSan`; the review-to-node seed
  mapping; theme completeness (every `BoardTheme` field present and non-empty
  for all twelve).
- Python: a case in `engine/tests/test_server.py` asserting the depth parameter
  is honoured by `/analyse` and `/review`.
- Whole-app: `npm run build` clean and warning-free, `npm run lint` clean, and a
  manual pass with the engine up — play a game, review it, branch from a graded
  move and step back onto the main line, watch a bot-vs-bot game with pause and
  step, switch themes, mute and unmute.

## Out of scope

Grading moves the engine has not been asked about (no speculative background
sweep of a whole variation tree), engine strength or search changes, and any
change to the `/api/engine` route's shape.
