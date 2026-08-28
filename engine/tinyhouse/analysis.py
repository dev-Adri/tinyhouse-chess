"""Post-game review: grade every move against what the engine would have played.

One search per ply does the whole job. Because the review search scores *every*
root move exactly, the move actually played and the engine's choice are compared
at the same depth, which is what makes the centipawn loss meaningful.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

from .position import Game, Position, move_from_uci, move_to_uci
from .search import MATE_THRESHOLD, Limits, RootMove, Searcher

# Ordered from best to worst; the frontend renders a badge per label.
BEST = "best"
GREAT = "great"
EXCELLENT = "excellent"
GOOD = "good"
INACCURACY = "inaccuracy"
MISTAKE = "mistake"
BLUNDER = "blunder"
FORCED = "forced"

CLASSIFICATIONS = [BEST, GREAT, EXCELLENT, GOOD, INACCURACY, MISTAKE, BLUNDER, FORCED]

#: Centipawn loss thresholds, checked in order.
THRESHOLDS = ((20, EXCELLENT), (50, GOOD), (120, INACCURACY), (300, MISTAKE))
#: A move is "great" when it is the only one that holds the position.
GREAT_MARGIN = 150
#: Ceiling for reported loss, so a missed mate does not produce absurd numbers.
MAX_LOSS = 1500
EVAL_CLAMP = 2000


def win_percent(cp: int) -> float:
    """Centipawns to an expected-score percentage for the side to move."""
    cp = max(-EVAL_CLAMP, min(EVAL_CLAMP, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def move_accuracy(before: float, after: float) -> float:
    """Lichess' accuracy curve over the drop in win percentage."""
    drop = max(0.0, before - after)
    value = 103.1668 * math.exp(-0.04354 * drop) - 3.1669
    return max(0.0, min(100.0, value))


def classify(loss: int, is_best: bool, alternatives: int, margin: int) -> str:
    if alternatives <= 1:
        return FORCED
    if is_best:
        return GREAT if margin >= GREAT_MARGIN else BEST
    for limit, label in THRESHOLDS:
        if loss <= limit:
            return label
    return BLUNDER


@dataclass
class PlyReview:
    ply: int
    color: str
    uci: str
    san: str
    #: Evaluation in centipawns from White's point of view.
    eval_before: int
    eval_after: int
    mate_before: int | None
    mate_after: int | None
    best_uci: str
    best_san: str
    best_pv: list[str]
    loss: int
    classification: str
    accuracy: float
    alternatives: list[dict] = field(default_factory=list)


@dataclass
class GameReview:
    plies: list[PlyReview]
    accuracy: dict[str, float]
    counts: dict[str, dict[str, int]]
    depth: int

    def to_json(self) -> dict:
        return {
            "plies": [asdict(ply) for ply in self.plies],
            "accuracy": self.accuracy,
            "counts": self.counts,
            "depth": self.depth,
        }


def _white_pov(score: int, stm: int) -> int:
    return score if stm == 0 else -score


def _mate_for(move: RootMove) -> int | None:
    return move.mate_in


def review_game(
    moves: list[str],
    fen: str | None = None,
    limits: Limits | None = None,
    top_moves: int = 3,
) -> GameReview:
    """Replay the given moves, searching each position along the way once."""
    limits = limits or Limits(depth=8, time_ms=400, exact_root=True)
    searcher = Searcher()  # one table across the whole game: later plies are cheap

    replay = Game(Position.from_fen(fen) if fen else None)
    plies: list[PlyReview] = []
    depth_reached = 0

    for index, move in enumerate(move_from_uci(text) for text in moves):
        pos = replay.position
        stm = pos.stm
        uci = move_to_uci(move)
        san = pos.san(move)

        result = searcher.search(replay, limits)
        depth_reached = max(depth_reached, result.depth)
        by_uci = {entry.uci: entry for entry in result.root}
        played = by_uci.get(uci)
        best = result.root[0]

        if played is None:  # should not happen, but never crash a review
            replay.push(move)
            continue

        loss = min(MAX_LOSS, max(0, best.score - played.score))
        margin = best.score - (result.root[1].score if len(result.root) > 1 else best.score)
        label = classify(loss, played.uci == best.uci, len(result.root), margin)

        eval_before = _white_pov(best.score, stm)
        eval_after = _white_pov(played.score, stm)
        before_wp = win_percent(best.score)
        after_wp = win_percent(played.score)

        plies.append(
            PlyReview(
                ply=index,
                color="w" if stm == 0 else "b",
                uci=uci,
                san=san,
                eval_before=eval_before,
                eval_after=eval_after,
                mate_before=_mate_for(best) if stm == 0 else _negate(_mate_for(best)),
                mate_after=_mate_for(played) if stm == 0 else _negate(_mate_for(played)),
                best_uci=best.uci,
                best_san=best.san,
                best_pv=best.pv,
                loss=loss,
                classification=label,
                accuracy=round(move_accuracy(before_wp, after_wp), 1),
                alternatives=[
                    {
                        "uci": entry.uci,
                        "san": entry.san,
                        "score": _white_pov(entry.score, stm),
                        "mateIn": _mate_for(entry) if stm == 0 else _negate(_mate_for(entry)),
                    }
                    for entry in result.root[:top_moves]
                ],
            )
        )
        replay.push(move)

    accuracy = {}
    counts: dict[str, dict[str, int]] = {}
    for color in ("w", "b"):
        own = [ply for ply in plies if ply.color == color]
        scored = [ply.accuracy for ply in own if ply.classification != FORCED]
        accuracy[color] = round(sum(scored) / len(scored), 1) if scored else 100.0
        counts[color] = {label: 0 for label in CLASSIFICATIONS}
        for ply in own:
            counts[color][ply.classification] += 1

    return GameReview(plies=plies, accuracy=accuracy, counts=counts, depth=depth_reached)


def _negate(value: int | None) -> int | None:
    return None if value is None else -value
