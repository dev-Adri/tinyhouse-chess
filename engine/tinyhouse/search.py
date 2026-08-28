"""Alpha-beta search: iterative deepening, transposition table, quiescence.

The branching factor here is small (about 7 in the opening, 20-40 once both
sides hold pieces), so ordinary alpha-beta reaches depths that would be
unthinkable in chess. Difficulty levels weaken it deliberately, by capping the
depth and by picking among near-best root moves instead of always the best.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

from .evaluate import MATE_VALUE, PIECE_VALUE, evaluate
from .position import DROP_FLAG, Game, Position, move_to_uci

EXACT, LOWER, UPPER = 0, 1, 2
INFINITY = 1 << 20
MATE_THRESHOLD = MATE_VALUE - 100


class TimeUp(Exception):
    pass


@dataclass
class Limits:
    depth: int = 64
    time_ms: int = 1000
    #: Score every root move exactly (no alpha-beta cutoffs at the root).
    exact_root: bool = True
    #: Centipawn slack when choosing among root moves; 0 always plays the best.
    randomness: int = 0
    #: Probability of ignoring the search entirely and playing a random move.
    blunder_chance: float = 0.0


@dataclass
class RootMove:
    uci: str
    san: str
    score: int
    pv: list[str] = field(default_factory=list)

    @property
    def mate_in(self) -> int | None:
        """Positive: this side mates in N. Negative: this side gets mated."""
        if abs(self.score) < MATE_THRESHOLD:
            return None
        plies = MATE_VALUE - abs(self.score)
        moves = (plies + 1) // 2
        return moves if self.score > 0 else -moves


@dataclass
class SearchResult:
    best: str
    score: int
    depth: int
    nodes: int
    time_ms: int
    pv: list[str]
    root: list[RootMove]

    @property
    def mate_in(self) -> int | None:
        return self.root[0].mate_in if self.root else None


LEVELS: dict[int, Limits] = {
    1: Limits(depth=1, time_ms=100, randomness=300, blunder_chance=0.35),
    2: Limits(depth=2, time_ms=200, randomness=180, blunder_chance=0.18),
    3: Limits(depth=3, time_ms=400, randomness=100, blunder_chance=0.06),
    4: Limits(depth=5, time_ms=900, randomness=45),
    5: Limits(depth=7, time_ms=1800, randomness=15),
    6: Limits(depth=24, time_ms=3500, randomness=0, exact_root=False),
}
LEVEL_NAMES = {
    1: "Beginner",
    2: "Easy",
    3: "Casual",
    4: "Intermediate",
    5: "Advanced",
    6: "Master",
}

REVIEW_LIMITS = Limits(depth=8, time_ms=400, exact_root=True)


class Searcher:
    def __init__(self) -> None:
        self.tt: dict[int, tuple[int, int, int, int]] = {}
        self.nodes = 0
        self.deadline = 0.0
        self.killers: list[list[int]] = []
        self.history: dict[int, int] = {}
        #: Position keys on the current path, plus the ones already played.
        self.seen: dict[int, int] = {}

    # -- helpers --------------------------------------------------------------

    def _check_time(self) -> None:
        if not self.nodes & 2047 and time.perf_counter() > self.deadline:
            raise TimeUp

    def _order(self, pos: Position, moves: list[int], tt_move: int, ply: int) -> list[int]:
        board = pos.board
        killers = self.killers[ply] if ply < len(self.killers) else (0, 0)
        history = self.history
        scored = []
        for move in moves:
            if move == tt_move:
                scored.append((1 << 24, move))
                continue
            score = 0
            if move & DROP_FLAG:
                score = history.get(move, 0)
            else:
                victim = board[(move >> 4) & 0xF]
                if victim:
                    attacker = board[move & 0xF] & 7
                    score = 100_000 + PIECE_VALUE[victim & 7] * 10 - PIECE_VALUE[attacker]
                else:
                    score = history.get(move, 0)
                promo = (move >> 8) & 7
                if promo:
                    score += 50_000 + PIECE_VALUE[promo]
            if score < 100_000:
                if move == killers[0]:
                    score += 9_000
                elif move == killers[1]:
                    score += 8_000
            scored.append((score, move))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [move for _, move in scored]

    # -- quiescence -----------------------------------------------------------

    def _quiesce(self, pos: Position, alpha: int, beta: int, ply: int) -> int:
        self.nodes += 1
        self._check_time()

        stand_pat = evaluate(pos)
        if stand_pat >= beta:
            return stand_pat
        if stand_pat > alpha:
            alpha = stand_pat

        us = pos.stm
        board = pos.board
        captures = [
            move
            for move in pos.generate_pseudo()
            if not move & DROP_FLAG and board[(move >> 4) & 0xF]
        ]

        for move in self._order(pos, captures, 0, ply):
            pos.make(move)
            if pos.is_attacked(pos.king_square(us), us ^ 1):
                pos.unmake()
                continue
            score = -self._quiesce(pos, -beta, -alpha, ply + 1)
            pos.unmake()
            if score >= beta:
                return score
            if score > alpha:
                alpha = score
        return alpha

    # -- main search ----------------------------------------------------------

    def _negamax(self, pos: Position, depth: int, alpha: int, beta: int, ply: int) -> int:
        self.nodes += 1
        self._check_time()

        key = pos.key
        # Reaching a position for the second time on this path is a draw: with
        # drops there is no material progress to force one side to deviate.
        if ply and self.seen.get(key, 0):
            return 0

        alpha_original = alpha
        entry = self.tt.get(key)
        tt_move = 0
        if entry is not None:
            e_depth, e_flag, e_score, e_move = entry
            tt_move = e_move
            if ply and e_depth >= depth:
                score = e_score
                if score > MATE_THRESHOLD:
                    score -= ply
                elif score < -MATE_THRESHOLD:
                    score += ply
                if e_flag == EXACT:
                    return score
                if e_flag == LOWER and score > alpha:
                    alpha = score
                elif e_flag == UPPER and score < beta:
                    beta = score
                if alpha >= beta:
                    return score

        in_check = pos.in_check()
        if in_check:
            depth += 1  # never leave the search hanging in the middle of a check
        if depth <= 0:
            return self._quiesce(pos, alpha, beta, ply)

        while len(self.killers) <= ply:
            self.killers.append([0, 0])

        us = pos.stm
        best_score = -INFINITY
        best_move = 0
        legal = 0
        self.seen[key] = self.seen.get(key, 0) + 1

        try:
            for move in self._order(pos, pos.generate_pseudo(), tt_move, ply):
                pos.make(move)
                if pos.is_attacked(pos.king_square(us), us ^ 1):
                    pos.unmake()
                    continue
                legal += 1
                if legal == 1:
                    score = -self._negamax(pos, depth - 1, -beta, -alpha, ply + 1)
                else:
                    # Principal variation search: assume the first move is best
                    # and prove the rest worse with a null window.
                    score = -self._negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1)
                    if alpha < score < beta:
                        score = -self._negamax(pos, depth - 1, -beta, -alpha, ply + 1)
                pos.unmake()
                # After unmake the target square holds whatever was captured.
                was_capture = not move & DROP_FLAG and bool(pos.board[(move >> 4) & 0xF])

                if score > best_score:
                    best_score = score
                    best_move = move
                if score > alpha:
                    alpha = score
                if alpha >= beta:
                    if not was_capture:
                        killers = self.killers[ply]
                        if killers[0] != move:
                            killers[1] = killers[0]
                            killers[0] = move
                        self.history[move] = self.history.get(move, 0) + depth * depth
                    break
        finally:
            count = self.seen[key] - 1
            if count:
                self.seen[key] = count
            else:
                del self.seen[key]

        if not legal:
            return -MATE_VALUE + ply if in_check else 0

        if best_score <= alpha_original:
            flag = UPPER
        elif best_score >= beta:
            flag = LOWER
        else:
            flag = EXACT
        stored = best_score
        if stored > MATE_THRESHOLD:
            stored += ply
        elif stored < -MATE_THRESHOLD:
            stored -= ply
        self.tt[key] = (depth, flag, stored, best_move)
        return best_score

    def _principal_variation(self, pos: Position, first: int, limit: int = 8) -> list[str]:
        pv = [move_to_uci(first)]
        pos.make(first)
        pushed = 1
        try:
            while len(pv) < limit:
                entry = self.tt.get(pos.key)
                if entry is None or not entry[3]:
                    break
                move = entry[3]
                if move not in pos.generate_legal():
                    break
                pv.append(move_to_uci(move))
                pos.make(move)
                pushed += 1
        finally:
            for _ in range(pushed):
                pos.unmake()
        return pv

    # -- root -----------------------------------------------------------------

    def search(self, game: Game, limits: Limits) -> SearchResult:
        started = time.perf_counter()
        self.deadline = started + limits.time_ms / 1000
        self.nodes = 0
        self.killers = []
        self.history = {}
        if len(self.tt) > 400_000:
            self.tt.clear()

        pos = game.position
        # Everything already played counts towards repetition draws.
        self.seen = {}
        for key in game.keys:
            self.seen[key] = self.seen.get(key, 0) + 1

        root_moves = pos.generate_legal()
        if not root_moves:
            return SearchResult("", 0, 0, 0, 0, [], [])

        names = {move: pos.san(move) for move in root_moves}
        order = list(root_moves)
        scored = [RootMove(move_to_uci(m), names[m], 0) for m in order]
        completed = 0
        # Running out of time unwinds through the recursion without unmaking;
        # this is the depth the position must be restored to afterwards.
        base = len(pos._undo)

        try:
            for depth in range(1, limits.depth + 1):
                alpha = -INFINITY
                results: list[tuple[int, int]] = []
                for move in order:
                    pos.make(move)
                    # An exact root scores every move with an open window;
                    # otherwise the usual alpha-beta narrowing applies.
                    beta = INFINITY if limits.exact_root else -alpha
                    score = -self._negamax(pos, depth - 1, -INFINITY, beta, 1)
                    pos.unmake()
                    if score > alpha:
                        alpha = score
                    results.append((move, score))

                results.sort(key=lambda item: item[1], reverse=True)
                order = [move for move, _ in results]
                scored = [
                    RootMove(move_to_uci(move), names[move], score, self._principal_variation(pos, move))
                    for move, score in results
                ]
                completed = depth
                if abs(results[0][1]) > MATE_THRESHOLD:
                    break  # a forced mate is as good as it gets
                if time.perf_counter() > self.deadline:
                    break
        except TimeUp:
            while len(pos._undo) > base:
                pos.unmake()

        elapsed = int((time.perf_counter() - started) * 1000)
        best = scored[0]
        return SearchResult(
            best=best.uci,
            score=best.score,
            depth=max(completed, 1),
            nodes=self.nodes,
            time_ms=elapsed,
            pv=best.pv or [best.uci],
            root=scored,
        )


def choose_move(result: SearchResult, limits: Limits, rng: random.Random) -> RootMove:
    """Pick what the bot actually plays, applying the level's imperfection."""
    if not result.root:
        raise ValueError("no legal moves")

    if limits.blunder_chance and rng.random() < limits.blunder_chance:
        return rng.choice(result.root)

    best = result.root[0].score
    if limits.randomness <= 0:
        return result.root[0]

    pool = [move for move in result.root if best - move.score <= limits.randomness]
    if len(pool) == 1:
        return pool[0]
    temperature = max(limits.randomness / 3.0, 1.0)
    weights = [math.exp((move.score - best) / temperature) for move in pool]
    return rng.choices(pool, weights=weights, k=1)[0]


def best_move(game: Game, level: int = 6, seed: int | None = None) -> tuple[RootMove, SearchResult]:
    limits = LEVELS.get(level, LEVELS[6])
    result = Searcher().search(game, limits)
    rng = random.Random(seed) if seed is not None else random.Random()
    return choose_move(result, limits, rng), result
