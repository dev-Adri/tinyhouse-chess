"""Static piece values and piece-square tables.

Kept apart from `evaluate` so `position` can maintain the material and
placement totals incrementally without importing the evaluator.
"""

from __future__ import annotations

KING, PAWN, WAZIR, FERZ, HORSE = 1, 2, 3, 4, 5

# The horse is the most mobile piece. The ferz is colour-bound — on a 4x4 board
# it only ever reaches eight squares — so it trails the wazir.
PIECE_VALUE = {KING: 0, PAWN: 100, WAZIR: 300, FERZ: 265, HORSE: 375}
# A piece in hand can land anywhere, which is worth a little more than the
# same piece committed to a square.
HAND_BONUS = {PAWN: 25, WAZIR: 30, FERZ: 25, HORSE: 40}
HAND_VALUE = {kind: PIECE_VALUE[kind] + HAND_BONUS[kind] for kind in HAND_BONUS}

# From White's point of view; Black mirrors with `sq ^ 12`.
_PST_PAWN = (
    0, 0, 0, 0,
    5, 5, 5, 5,
    45, 45, 45, 45,
    0, 0, 0, 0,
)
_PST_KING = (
    12, 8, 8, 12,
    2, -6, -6, 2,
    -4, -12, -12, -4,
    -10, -18, -18, -10,
)
_PST_MINOR = (
    -6, 0, 0, -6,
    0, 10, 10, 0,
    0, 10, 10, 0,
    -6, 0, 0, -6,
)
PST = {
    PAWN: _PST_PAWN,
    KING: _PST_KING,
    WAZIR: _PST_MINOR,
    FERZ: _PST_MINOR,
    HORSE: _PST_MINOR,
}

# Flat lookup: PIECE_SQUARE[color][kind][sq] = value + placement bonus.
PIECE_SQUARE = [
    [
        [0] * 16 if kind not in PST else [PIECE_VALUE[kind] + PST[kind][sq ^ flip] for sq in range(16)]
        for kind in range(6)
    ]
    for flip in (0, 12)
]
