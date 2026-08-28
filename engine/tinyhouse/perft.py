"""Move-generation counting, used to pin the Python rules to the TypeScript ones."""

from __future__ import annotations

from .position import Position, move_to_uci


def perft(pos: Position, depth: int) -> int:
    if depth == 0:
        return 1
    total = 0
    us = pos.stm
    for move in pos.generate_pseudo():
        pos.make(move)
        if not pos.is_attacked(pos.king_square(us), us ^ 1):
            total += 1 if depth == 1 else perft(pos, depth - 1)
        pos.unmake()
    return total


def divide(pos: Position, depth: int) -> list[tuple[str, int]]:
    out = []
    for move in pos.generate_legal():
        pos.make(move)
        out.append((move_to_uci(move), perft(pos, depth - 1)))
        pos.unmake()
    return sorted(out)


if __name__ == "__main__":
    import sys
    import time

    max_depth = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    position = Position.start()
    for d in range(1, max_depth + 1):
        started = time.perf_counter()
        nodes = perft(position, d)
        elapsed = time.perf_counter() - started
        rate = nodes / elapsed if elapsed else 0
        print(f"perft({d}) = {nodes:>12,}  {elapsed:7.2f}s  {rate:>12,.0f} n/s")
