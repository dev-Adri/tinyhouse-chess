# Tinyhouse

A playable browser version of **Tinyhouse** — chess.com's 4×4 variant with
crazyhouse-style piece drops — plus a Python engine that plays it and reviews
your games.

## Running it

Two processes: the Next.js app, and the engine that backs bot play and game
review. The board itself works without the engine; only the bot and the review
need it.

```bash
npm run dev
```

```bash
cd engine && python -m tinyhouse serve
```

Then open <http://localhost:3000>. The app proxies to the engine through
`/api/engine/*`; set `ENGINE_URL` if it does not live on
`http://127.0.0.1:8000`.

## The game

A 4×4 board with five piece types per side:

| | Piece | Moves |
| --- | --- | --- |
| K | King | one step in any direction |
| P | Pawn | one step forward, captures diagonally, promotes on the far rank to W, F or H |
| W | Wazir | one step orthogonally |
| F | Ferz | one step diagonally |
| H | Hors | a knight's leap, but blocked if a piece sits on the first orthogonal step (a xiangqi horse) |

Captured pieces switch sides and go into the captor's reserve; instead of
moving, a player may drop one on any empty square. Pawns may not be dropped on
the 1st or 4th rank, and a promoted piece reverts to a pawn when captured.

Because captures never remove material from the game, two rules keep it finite:
**threefold repetition** and **300 plies** are draws. Both engines agree on
this.

## Layout

| Path | What it is |
| --- | --- |
| `app/lib/tinyhouse/engine.ts` | the rules, in the browser |
| `app/lib/tinyhouse/uci.ts` | the move format shared with Python |
| `app/components/` | board, reserves, promotion dialog, themes, review panel |
| `app/api/engine/[...path]/route.ts` | proxy to the Python engine |
| `engine/` | the Python engine, its API, and its tests — see [engine/README.md](engine/README.md) |

The two rule implementations are pinned to each other by perft: both count
exactly 1,355,253 leaf nodes at depth 7 from the starting position.

## Checks

```bash
npx tsc --noEmit && npx eslint . && npm run build
```

```bash
cd engine && python -m unittest discover -s tests -t .
```
