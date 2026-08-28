"""Static evaluation, in centipawns, from the side-to-move's point of view.

Material alone is a weaker signal here than in chess: captures never remove a
piece from the game, they only change its owner. So the terms that matter are
ownership balance, how advanced the pawns are, control of the four centre
squares, and — the crazyhouse-specific one — how exposed a king is to a drop.
"""

from __future__ import annotations

from .position import (
    FERZ,
    FERZ_MASK,
    HORSE,
    HORSE_MOVES,
    KING,
    KING_MASK,
    PAWN,
    PAWN_CAPS,
    WAZIR,
    WAZIR_MASK,
    WHITE,
    Position,
)
from .values import HAND_BONUS, PIECE_VALUE, PST  # noqa: F401  (re-exported)

CENTRE = 0x0660  # b2, c2, b3, c3

TEMPO = 12
CENTRE_CONTROL = 6
KING_ZONE_ATTACK = 14
KING_DROP_HOLE = 11
MOBILITY = 3

MATE_VALUE = 30000


def attack_mask(pos: Position, color: int) -> int:
    """Union of every square the given side attacks."""
    bb = pos.bb[color]
    occ = pos.occ
    mask = 0

    pieces = bb[KING]
    while pieces:
        bit = pieces & -pieces
        pieces ^= bit
        mask |= KING_MASK[bit.bit_length() - 1]

    pieces = bb[WAZIR]
    while pieces:
        bit = pieces & -pieces
        pieces ^= bit
        mask |= WAZIR_MASK[bit.bit_length() - 1]

    pieces = bb[FERZ]
    while pieces:
        bit = pieces & -pieces
        pieces ^= bit
        mask |= FERZ_MASK[bit.bit_length() - 1]

    pieces = bb[PAWN]
    while pieces:
        bit = pieces & -pieces
        pieces ^= bit
        mask |= PAWN_CAPS[color][bit.bit_length() - 1]

    pieces = bb[HORSE]
    while pieces:
        bit = pieces & -pieces
        pieces ^= bit
        frm = bit.bit_length() - 1
        for to, blocker in HORSE_MOVES[frm]:
            if not (occ >> blocker) & 1:
                mask |= 1 << to

    return mask


def _side_score(pos: Position, color: int, attacks: int, opponent_has_hand: bool) -> int:
    """Material, placement and king safety for one side."""
    # Material and piece-square totals are maintained by make/unmake.
    score = pos.psq[color] + pos.hand_value[color]
    bb = pos.bb[color]

    score += MOBILITY * bin(attacks & ~pos.occ_color[color]).count("1")
    score += CENTRE_CONTROL * bin(attacks & CENTRE).count("1")

    king = bb[KING]
    if king:
        zone = KING_MASK[king.bit_length() - 1]
        if opponent_has_hand:
            # Empty squares next to the king are landing pads for a drop.
            score -= KING_DROP_HOLE * bin(zone & ~pos.occ).count("1")
    return score


def evaluate(pos: Position) -> int:
    us = pos.stm
    them = us ^ 1

    our_attacks = attack_mask(pos, us)
    their_attacks = attack_mask(pos, them)

    score = _side_score(pos, us, our_attacks, pos.has_hand_pieces(them))
    score -= _side_score(pos, them, their_attacks, pos.has_hand_pieces(us))

    our_king = pos.bb[us][KING]
    their_king = pos.bb[them][KING]
    if our_king:
        zone = KING_MASK[our_king.bit_length() - 1]
        score -= KING_ZONE_ATTACK * bin(zone & their_attacks).count("1")
    if their_king:
        zone = KING_MASK[their_king.bit_length() - 1]
        score += KING_ZONE_ATTACK * bin(zone & our_attacks).count("1")

    return score + TEMPO


def evaluate_white(pos: Position) -> int:
    """Same evaluation, always from White's point of view."""
    score = evaluate(pos)
    return score if pos.stm == WHITE else -score
