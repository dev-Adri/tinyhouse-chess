"""Command line entry point: `python -m tinyhouse <command>`."""

from __future__ import annotations

import argparse
import random
import time

from .analysis import review_game
from .perft import divide, perft
from .position import Game, Position, move_from_uci, move_to_uci
from .search import LEVELS, LEVEL_NAMES, Limits, Searcher, best_move
from .server import serve


def cmd_perft(args) -> None:
    pos = Position.from_fen(args.fen) if args.fen else Position.start()
    for depth in range(1, args.depth + 1):
        started = time.perf_counter()
        nodes = perft(pos, depth)
        elapsed = time.perf_counter() - started
        print(f"perft({depth}) = {nodes:>12,}  {elapsed:7.2f}s  {nodes / max(elapsed, 1e-9):>10,.0f} n/s")
    if args.divide:
        for move, nodes in divide(pos, args.depth):
            print(f"  {move:<6} {nodes:,}")


def cmd_bench(args) -> None:
    game = Game.from_uci(args.moves or [])
    searcher = Searcher()
    result = searcher.search(game, Limits(depth=args.depth, time_ms=args.time, exact_root=False))
    print(f"best  {result.best} ({result.root[0].san})")
    print(f"score {result.score}  depth {result.depth}  nodes {result.nodes:,}  {result.time_ms}ms")
    print(f"rate  {result.nodes / max(result.time_ms, 1) * 1000:,.0f} n/s")
    print("pv    " + " ".join(result.pv))


def cmd_play(args) -> None:
    """Self-play: one level against another."""
    wins = {"w": 0, "b": 0, "draw": 0}
    rng = random.Random(args.seed)
    for game_index in range(args.games):
        game = Game()
        levels = {0: args.white, 1: args.black}
        if args.swap and game_index % 2:
            levels = {0: args.black, 1: args.white}
        while game.outcome()[0] == "playing":
            move, _ = best_move(game, levels[game.position.stm], seed=rng.randrange(1 << 30))
            game.push(move_from_uci(move.uci))
        status, winner = game.outcome()
        key = "draw" if winner is None else ("w" if winner == 0 else "b")
        wins[key] += 1
        line = " ".join(move_to_uci(m) for m in game.moves)
        names = f"{LEVEL_NAMES[levels[0]]} vs {LEVEL_NAMES[levels[1]]}"
        print(f"game {game_index + 1} ({names}): {status} after {len(game.moves)} plies -> {key}")
        if args.verbose:
            print(f"  {line}")
    print(f"white {wins['w']}  black {wins['b']}  draws {wins['draw']}")


def cmd_review(args) -> None:
    report = review_game(args.moves, limits=Limits(depth=args.depth, time_ms=args.time))
    for ply in report.plies:
        marker = "" if ply.classification in ("best", "great", "forced") else "  <-- " + ply.classification
        print(f"{ply.ply:>3}. {ply.color} {ply.san:<10} {ply.eval_after:>7}  best {ply.best_san:<10}{marker}")
    print(f"accuracy: white {report.accuracy['w']}  black {report.accuracy['b']}")


def cmd_serve(args) -> None:
    serve(args.host, args.port)


def main() -> None:
    parser = argparse.ArgumentParser(prog="tinyhouse", description="Tinyhouse engine")
    subs = parser.add_subparsers(dest="command", required=True)

    p = subs.add_parser("perft", help="count leaf nodes")
    p.add_argument("depth", type=int, nargs="?", default=5)
    p.add_argument("--fen")
    p.add_argument("--divide", action="store_true")
    p.set_defaults(func=cmd_perft)

    p = subs.add_parser("bench", help="search a position")
    p.add_argument("moves", nargs="*")
    p.add_argument("--depth", type=int, default=24)
    p.add_argument("--time", type=int, default=3000)
    p.set_defaults(func=cmd_bench)

    p = subs.add_parser("play", help="play the engine against itself")
    p.add_argument("--white", type=int, default=6, choices=sorted(LEVELS))
    p.add_argument("--black", type=int, default=2, choices=sorted(LEVELS))
    p.add_argument("--games", type=int, default=4)
    p.add_argument("--swap", action="store_true", help="alternate colours")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--verbose", action="store_true")
    p.set_defaults(func=cmd_play)

    p = subs.add_parser("review", help="grade a game given as UCI moves")
    p.add_argument("moves", nargs="+")
    p.add_argument("--depth", type=int, default=8)
    p.add_argument("--time", type=int, default=400)
    p.set_defaults(func=cmd_review)

    p = subs.add_parser("serve", help="run the JSON API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
