# Tinyhouse engine

An alpha-beta engine for the 4×4 drop variant, plus a small JSON API the
Next.js app talks to. Pure standard library — Python 3.10+, nothing to install.

```bash
cd engine
python -m tinyhouse serve          # http://127.0.0.1:8000
```

## Is Tinyhouse solvable?

No — not by brute force, despite the board being sixteen squares.

Captured pieces come back as drops, so material is conserved: the multiset
`{K,K,P,P,W,W,F,F,H,H}` never shrinks. Endgame tablebases in chess work because
every capture moves the game into a strictly smaller sub-game, giving a DAG you
can solve backwards. Here there is no such progress measure — the reachable
state space (roughly 10⁹–10¹¹ positions once reserves, promotion flags and side
to move are counted) is one enormous cyclic graph. That is the same reason
crazyhouse and shogi resist solving.

What *is* easy is search. The branching factor is about 7 in the opening and
20–40 once both sides hold pieces, so plain alpha-beta reaches depths that would
be hopeless in chess, and play at the top level is very close to perfect.

Because material never runs out, two extra rules keep games finite, and the
TypeScript rules in `app/lib/tinyhouse/engine.ts` match:

- threefold repetition is a draw
- 300 plies is a draw

## Layout

| File | Contents |
| --- | --- |
| `tinyhouse/position.py` | board, bitboard move generation, make/unmake, Zobrist hashing, FEN |
| `tinyhouse/values.py` | piece values and piece-square tables |
| `tinyhouse/evaluate.py` | static evaluation |
| `tinyhouse/search.py` | iterative deepening, alpha-beta with PVS, transposition table, quiescence, difficulty levels |
| `tinyhouse/analysis.py` | per-move grading and accuracy for the game review |
| `tinyhouse/server.py` | the JSON API |
| `tinyhouse/perft.py` | move-generation counting |

### Notation

Moves on the wire are UCI-like: `c1d3` for a board move, `a3a4h` for a
promotion, `P@b2` for a drop. Positions use a crazyhouse-style FEN, rank 4
first, reserves in brackets: the starting position is `fhwk/3p/P3/KWHF[] w`.

## Correctness

The perft numbers are the contract between this engine and the browser's rules;
both implementations produce these exact counts from the starting position:

| depth | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nodes | 6 | 33 | 241 | 1,855 | 16,021 | 139,141 | 1,355,253 |

```bash
python -m unittest discover -s tests -t .
python -m tinyhouse perft 7
```

## Difficulty levels

| Level | Name | Depth cap | Time | Imperfection |
| --- | --- | --- | --- | --- |
| 1 | Beginner | 1 | 100 ms | 35% random moves, wide slack |
| 2 | Easy | 2 | 200 ms | 18% random moves |
| 3 | Casual | 3 | 400 ms | 6% random moves |
| 4 | Intermediate | 5 | 900 ms | picks within 45cp of best |
| 5 | Advanced | 7 | 1.8 s | picks within 15cp of best |
| 6 | Master | 24 | 3.5 s | always the best move |

Weak levels are weak on purpose: they search shallowly and then sample among
the near-best root moves, rather than playing a strong move badly.

## API

```
GET  /health     -> {ok, engine, levels[]}
POST /bestmove   {moves[], level, fen?, seed?, timeMs?}
POST /review     {moves[], fen?, depth?, timeMs?}
```

`moves` is the game so far, from the starting position, so the engine sees the
same repetition history the player does.

```bash
curl -s localhost:8000/bestmove -H 'Content-Type: application/json' \
  -d '{"moves":["c1d3"],"level":5}'
```

`/review` returns one entry per ply — the evaluation before and after (always
from White's point of view), the engine's preferred move, the centipawn loss, a
classification (`best`, `great`, `excellent`, `good`, `inaccuracy`, `mistake`,
`blunder`, `forced`) and an accuracy percentage, plus per-player accuracy
totals.

## Other commands

```bash
python -m tinyhouse bench c1d3 a4b3 --time 3000   # search a position
python -m tinyhouse play --white 5 --black 2 --games 4 --swap
python -m tinyhouse review d1c2 b4c2 a1b2 F@a3
```
