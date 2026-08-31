# Tinyhouse

A playable browser version of **Tinyhouse** — chess.com's 4×4 variant with
crazyhouse-style piece drops — plus a Python engine that plays it and reviews
your games.

## Running it

One command starts both the app and the engine:

```bash
npm start
```

It picks free ports — 3000 and 8000 if they are available, otherwise the next
ones up — tells the app where the engine landed, streams both logs with a
prefix, and stops both on Ctrl+C.

```
[tinyhouse] engine ready
[tinyhouse] app on http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm start` | app + engine, development mode |
| `npm run start:prod` | same, but builds first and serves the production output |
| `npm run web` | app only (no bot play or review) |
| `npm run dev` | plain `next dev`, if you want to run the engine yourself |

Options: `--web-port n`, `--engine-port n`, `--python <cmd>`, `--no-engine`,
`--build`. The board is fully playable without the engine — only bot play and
game review need it, and the app says so if it is missing.

To run the two halves separately, start `cd engine && python -m tinyhouse serve`
and point the app at it with `ENGINE_URL`; requests go through `/api/engine/*`.

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
| `scripts/dev.mjs` | the launcher that starts both halves on free ports |

The two rule implementations are pinned to each other by perft: both count
exactly 1,355,253 leaf nodes at depth 7 from the starting position.

## Checks

```bash
npx tsc --noEmit && npx eslint . && npm run build
```

```bash
cd engine && python -m unittest discover -s tests -t .
```
