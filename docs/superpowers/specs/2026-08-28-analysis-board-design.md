# Analysis board, branching variations, and move navigation

Date: 2026-08-28

## Goal

Three related capabilities the app is missing:

1. **An analysis board** — a mode where you play both sides freely to reach any
   position, with the engine evaluating continuously.
2. **Branching variations** — from any position in an analysis, play an
   alternative move and explore it without losing the line you came from.
3. **Move navigation in live games** — step back through a game in progress or
   just finished, the way chess.com does.

## Decisions

| Question | Decision |
| --- | --- |
| Entry point | "Analysis" as a third opponent mode, **and** "Analyse from here" from a finished game / review |
| Opening state | The analysis tab opens on a **position editor**: free placement, no turn order, illegal arrangements allowed. "Analyse" locks it in, after which only legal moves are playable |
| Engine behaviour | Auto-evaluate on every position change; show eval bar, best-move arrow, top 3 lines |
| Branch conflict | A differing move becomes a **new sibling variation**; the original stays the main line |
| Live rewind | View-only while the game runs; after it ends, moving from a rewound position opens analysis branching there |
| Persistence | Autosave live game and analysis tree to `localStorage`, restore behind a dismissible banner |
| Architecture | Separate tree layer; the existing linear live-game path is left intact |
| TS testing | `vitest`, covering `variations.ts` only |

## The position editor

Choosing the Analysis tab opens the board in edit mode rather than on a game.
Nothing is enforced while arranging: pieces of either colour go anywhere, in
any number, and there is no turn order.

- A palette picks the piece the next click puts down; an eraser empties a square.
- Dragging a piece **off the board** banks it the way capturing it would — into
  the *other* side's drawer, reverting a promoted piece to a pawn. Dropping it
  straight onto a drawer puts it in that one instead.
- Dragging out of a drawer onto the board places it; clicking a drawer slot adds
  one, or removes one with the eraser selected.
- Side to move is a toggle. "Start pos." and "Clear" reset the board.

`setupProblem()` reports what would stop the position being analysed, and the
Analyse button stays disabled until it returns null:

- exactly one king per side
- the side that is *not* to move may not be in check

That second rule is not pedantry. Without it the search can capture a king,
which is not a move the rules ever generate, and it dies inside `make()`. The
engine now rejects such a position with a 400 instead of a 500 — the guard sits
in `_build_game`, so `/bestmove` and `/review` are covered too.

"Analyse" hands the arrangement to `createTree(state)` as the tree root. An
"Edit" button in the analysis panel returns to the editor, seeded with whatever
position is on the board at that moment.

## Architecture

The tree is a new, pure layer. `GameState` and the live-game path in
`engine.ts` are not modified — that code carries the rules, repetition
detection and outcome logic, and it already works.

### `app/lib/tinyhouse/variations.ts` (new)

```ts
interface TreeNode {
  id: string;
  move: Move | null;      // null only at the root
  san: string;            // "" at the root
  parent: string | null;
  children: string[];     // children[0] IS the main continuation
}

interface MoveTree {
  root: string;
  nodes: Record<string, TreeNode>;
  start: GameState;       // the position the root represents
  nextId: number;         // ids are a monotonic counter, so they stay stable
}
```

`children[0]` being the main line means promotion is a reordering of that
array — no separate "is main line" flag to keep consistent.

All operations are pure and return a new tree:

- `createTree(start?)` — empty tree rooted at a position (default `createGame()`)
- `treeFromHistory(history, start?)` — linear history to a single-line tree; powers "Analyse from here"
- `addMove(tree, nodeId, move, san)` → `{ tree, nodeId }` — reuses an existing child when the move is equal (`movesEqual`), otherwise appends a sibling
- `promote(tree, nodeId)` — move a node to `children[0]` of its parent
- `promoteToMainLine(tree, nodeId)` — `promote` repeatedly up to the root
- `remove(tree, nodeId)` — delete the node and all descendants
- `pathTo(tree, nodeId)` → node ids from root to node
- `mainLine(tree)` → node ids following `children[0]`
- `positionAt(tree, nodeId)` → `GameState`, replayed with `applyMove` from `start`, cached in a `WeakMap` keyed by the tree object
- `serialize(tree)` / `deserialize(json)` — for `localStorage`

`start` holds the root position: the standard opening for an ordinary
analysis, or a hand-built position when one came from the editor. It travels
through storage and to the engine as a FEN, which needed a `fromFen()` parser
on the TypeScript side — only `toFen()` existed. Anything that fails to parse
or replay discards the payload rather than showing an impossible board.

### Engine: a new `/analyse` endpoint

```
POST /analyse  { moves, fen?, depth?, timeMs?, multipv? }
  -> { score, scoreWhite, mateIn, depth, nodes, timeMs,
       lines: [{ uci, san, score, scoreWhite, mateIn, pv }] }
  -> { gameOver: reason, lines: [] }   when the position is already decided
```

Implemented with `Searcher().search()` under
`Limits(exact_root=True, randomness=0, blunder_chance=0)`, returning
`result.root[:multipv]` directly. It deliberately does **not** call
`choose_move`, which is what injects randomness and deliberate blunders at the
lower levels — analysis must be deterministic.

Clamps: depth 1–20, `timeMs` 20–5000, `multipv` 1–5.

A decided position returns `gameOver` with a 200, not a 400. Analysis walks
into mates constantly and a 400 would flash the error banner each time.

Also required: `"analyse"` added to `ALLOWED` in
`app/api/engine/[...path]/route.ts` (the proxy allowlists endpoints),
`fetchAnalysis()` in `app/lib/engine/client.ts`, and an `AnalysisResult` type
in `app/lib/engine/types.ts`.

### React structure

`TinyhouseGame.tsx` is 712 lines before this work and would pass 1000. It is
split along the seams this feature needs:

- **`useMatch`** — the existing live-game state moved as-is (game, started,
  mode, level, humanSide, levels, engineError, retryToken, the bot effect,
  review), plus the new `viewPly` cursor.
- **`useAnalysis`** — tree, cursor node id, latest analysis result, and a
  debounced (~250 ms) auto-eval effect with `AbortController`.
- **`useBoardInteraction`** — the ~120-line pointer/drag/selection/promotion
  block lifted out unchanged, parameterised by which position it is acting on
  and what to do with the move it produces, so the live board and the analysis
  board share one implementation.
- **`MoveTreeList.tsx`** — recursive renderer: main line inline, variations
  indented under their parent, click to jump, context menu for promote and
  delete. The live game uses it too; a tree with no branches renders the same
  as today's flat list.
- **`AnalysisPanel.tsx`** — eval bar, top-3 candidate lines (clicking one plays
  it), depth/node counters, and the tree list.
- **`useGameStorage`** — debounced `localStorage` reads and writes.

`OpponentMode` gains `"analysis"`. In that mode both colours are movable, the
bot effect never runs, and a flip button replaces automatic orientation.

### Live rewind

`viewPly` ranges over `0..history.length` and `displayed = positions[viewPly]`,
reusing the `positions` array `TinyhouseGame` already computes. The board is
locked whenever `viewPly < history.length`, and any new move — the player's or
the bot's — snaps `viewPly` back to the end so a bot reply is never missed.

Controls: `⏮ ◀ ▶ ⏭`, a `LIVE` button, and the ←/→ keys, extending the keydown
effect that currently only fires during review.

After the game is over, playing a move while rewound calls
`startAnalysisFrom(viewPly)`: build a tree from the full history, place the
cursor at that ply, switch to analysis mode, and apply the move as a branch.
The game as played survives as the main line.

## Persistence

Two new keys alongside the existing `tinyhouse:theme`:

- `tinyhouse:game` — live game moves plus mode, level and side
- `tinyhouse:analysis` — the serialized tree and cursor

Writes are debounced. Payloads are versioned (`{ v: 1, ... }`). On load the
state is restored behind a banner — "Resumed your game (12 moves) · Discard" —
so a stale game is never silently forced on the player.

## Error handling

- **Engine offline in analysis** — the eval area reads "Engine offline — moves
  still work"; the tree and navigation stay fully usable. The existing error
  banner and Retry button are unchanged.
- **Stale analysis responses** — dropped by comparing the response's node id
  against the current cursor, in addition to `AbortController`.
- **Rapid stepping** — the ~250 ms debounce keeps clicking through a line from
  queueing a search per position.
- **`localStorage` unavailable or full** — writes are skipped silently, the way
  the theme code already handles it.
- **Corrupt or old saved payload** — a version mismatch or parse failure
  discards the payload and starts fresh.

## Testing

`vitest` as a devDependency with an `npm test` script.
`app/lib/tinyhouse/variations.test.ts` covers:

- adding a move; adding an equal move reuses the existing child
- a differing move becomes a sibling, and the main line does not change
- `promote` reorders, `promoteToMainLine` reorders up to the root
- `remove` deletes descendants; the cursor falls back to the parent
- `positionAt` replay matches `applyMove` applied by hand
- `serialize`/`deserialize` round-trips

`engine/tests/test_server.py` covers `/analyse`: lines ordered by score,
`multipv` respected, two identical calls return identical results, `gameOver`
reported at a mate, bad depth rejected.

`app/lib/tinyhouse/setup.test.ts` covers `fromFen` round-trips (reserves,
promoted pieces, side to move) and its rejection of malformed input,
`setupProblem`'s king and check rules, and a hand-built position surviving a
save and reload with its start intact.

`engine/tests/test_server.py` additionally covers a FEN-rooted analysis, moves
played on top of one, and the two illegal-position rejections.

Manual verification: rewind during a bot game, branch after a game ends,
arrange a position and analyse it, and reload to confirm the restore banner.

## Out of scope

- Playing the bot from inside a variation ("play from here")
- Typing or pasting a FEN by hand, and PGN import/export
- Persisting a half-finished arrangement; the editor's contents reach storage
  only once "Analyse" has been pressed
- Engine analysis of a whole tree — review still analyses one line
