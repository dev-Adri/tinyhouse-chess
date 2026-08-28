"""Tinyhouse position: board state, move generation, make/unmake.

Mirrors the TypeScript rules in `app/lib/tinyhouse/engine.ts`; the perft suite
in `tests/test_perft.py` pins the two implementations together.

Squares are 0..15 as `rank * 4 + file`, file 0 = "a", rank 0 = "1" (White's
home rank). Bitmasks use bit `sq`.
"""

from __future__ import annotations

import random
from typing import Iterator

from .values import FERZ, HAND_VALUE, HORSE, KING, PAWN, PIECE_SQUARE, WAZIR

WHITE, BLACK = 0, 1
EMPTY = 0

PIECE_LETTER = {KING: "K", PAWN: "P", WAZIR: "W", FERZ: "F", HORSE: "H"}
LETTER_PIECE = {v: k for k, v in PIECE_LETTER.items()}
DROPPABLE = (PAWN, WAZIR, FERZ, HORSE)
PROMOTIONS = (WAZIR, FERZ, HORSE)

FULL = 0xFFFF
FILES = "abcd"
RANKS = "1234"


def square_name(sq: int) -> str:
    return f"{FILES[sq & 3]}{RANKS[sq >> 2]}"


def parse_square(name: str) -> int:
    return (RANKS.index(name[1]) << 2) | FILES.index(name[0])


# --- precomputed move tables -------------------------------------------------


def _on_board(file: int, rank: int) -> bool:
    return 0 <= file < 4 and 0 <= rank < 4


def _steps(deltas):
    table = []
    for sq in range(16):
        file, rank = sq & 3, sq >> 2
        mask = 0
        for df, dr in deltas:
            f, r = file + df, rank + dr
            if _on_board(f, r):
                mask |= 1 << (r * 4 + f)
        table.append(mask)
    return table


KING_DELTAS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
ORTHO_DELTAS = ((1, 0), (-1, 0), (0, 1), (0, -1))
DIAG_DELTAS = ((1, 1), (1, -1), (-1, 1), (-1, -1))

KING_MASK = _steps(KING_DELTAS)
WAZIR_MASK = _steps(ORTHO_DELTAS)
FERZ_MASK = _steps(DIAG_DELTAS)

# Xiangqi horse: one orthogonal step (which must be empty), then one diagonal
# step outward. HORSE_MOVES[sq] -> tuple of (target, blocker) pairs.
HORSE_MOVES: list[tuple[tuple[int, int], ...]] = []
for _sq in range(16):
    _file, _rank = _sq & 3, _sq >> 2
    _entries = []
    for _df, _dr in ORTHO_DELTAS:
        _lf, _lr = _file + _df, _rank + _dr
        if not _on_board(_lf, _lr):
            continue
        _blocker = _lr * 4 + _lf
        if _df:
            _targets = ((_file + 2 * _df, _rank + 1), (_file + 2 * _df, _rank - 1))
        else:
            _targets = ((_file + 1, _rank + 2 * _dr), (_file - 1, _rank + 2 * _dr))
        for _tf, _tr in _targets:
            if _on_board(_tf, _tr):
                _entries.append((_tr * 4 + _tf, _blocker))
    HORSE_MOVES.append(tuple(_entries))

# Reverse view: from which square (with which blocker) can a horse reach `sq`?
HORSE_ATTACKERS: list[tuple[tuple[int, int], ...]] = [[] for _ in range(16)]
for _from, _entries in enumerate(HORSE_MOVES):
    for _to, _blocker in _entries:
        HORSE_ATTACKERS[_to].append((_from, _blocker))
HORSE_ATTACKERS = [tuple(entry) for entry in HORSE_ATTACKERS]

# Pawns: push target (or -1) and capture mask, per colour.
PAWN_PUSH = [[-1] * 16, [-1] * 16]
PAWN_CAPS = [[0] * 16, [0] * 16]
for _color, _dr in ((WHITE, 1), (BLACK, -1)):
    for _sq in range(16):
        _file, _rank = _sq & 3, _sq >> 2
        _r = _rank + _dr
        if not 0 <= _r < 4:
            continue
        PAWN_PUSH[_color][_sq] = _r * 4 + _file
        _mask = 0
        for _df in (-1, 1):
            _f = _file + _df
            if 0 <= _f < 4:
                _mask |= 1 << (_r * 4 + _f)
        PAWN_CAPS[_color][_sq] = _mask

PROMOTION_RANK = (3, 0)
BACK_RANKS_MASK = 0x000F | 0xF000  # ranks 1 and 4 — no pawn drops here

# --- move encoding -----------------------------------------------------------
# bits 0-3 from, 4-7 to, 8-10 promotion piece, 11 drop flag, 12-14 dropped piece

DROP_FLAG = 1 << 11


def make_move(frm: int, to: int, promotion: int = 0) -> int:
    return frm | (to << 4) | (promotion << 8)


def make_drop(piece: int, to: int) -> int:
    return DROP_FLAG | (to << 4) | (piece << 12)


def move_from(move: int) -> int:
    return move & 0xF


def move_to(move: int) -> int:
    return (move >> 4) & 0xF


def move_promotion(move: int) -> int:
    return (move >> 8) & 7


def move_is_drop(move: int) -> bool:
    return bool(move & DROP_FLAG)


def move_dropped(move: int) -> int:
    return (move >> 12) & 7


def move_to_uci(move: int) -> str:
    """`c1d3`, `a3a4h` (promotion), `P@b2` (drop)."""
    if move_is_drop(move):
        return f"{PIECE_LETTER[move_dropped(move)]}@{square_name(move_to(move))}"
    text = square_name(move_from(move)) + square_name(move_to(move))
    promo = move_promotion(move)
    return text + PIECE_LETTER[promo].lower() if promo else text


def move_from_uci(text: str) -> int:
    if "@" in text:
        piece, _, target = text.partition("@")
        return make_drop(LETTER_PIECE[piece.upper()], parse_square(target))
    frm = parse_square(text[0:2])
    to = parse_square(text[2:4])
    promo = LETTER_PIECE[text[4].upper()] if len(text) > 4 else 0
    return make_move(frm, to, promo)


# --- zobrist hashing ---------------------------------------------------------

_rng = random.Random(0x7175656E)
PIECE_KEYS = [[[_rng.getrandbits(64) for _ in range(16)] for _ in range(6)] for _ in range(2)]
PROMOTED_KEYS = [[_rng.getrandbits(64) for _ in range(16)] for _ in range(2)]
HAND_KEYS = [[[_rng.getrandbits(64) for _ in range(9)] for _ in range(6)] for _ in range(2)]
SIDE_KEY = _rng.getrandbits(64)

MAX_PLY = 300  # hard stop: with drops, material never runs out


class Position:
    __slots__ = (
        "board",
        "promoted",
        "bb",
        "occ_color",
        "occ",
        "hands",
        "stm",
        "key",
        "psq",
        "hand_value",
        "hand_count",
        "_undo",
    )

    def __init__(self) -> None:
        self.board = [EMPTY] * 16
        self.promoted = 0
        self.bb = [[0] * 6, [0] * 6]
        self.occ_color = [0, 0]
        self.occ = 0
        self.hands = [[0] * 6, [0] * 6]
        self.stm = WHITE
        self.key = 0
        # Material and placement totals, kept up to date by make/unmake.
        self.psq = [0, 0]
        self.hand_value = [0, 0]
        self.hand_count = [0, 0]
        self._undo: list[tuple] = []

    # -- construction ---------------------------------------------------------

    @staticmethod
    def start() -> "Position":
        return Position.from_fen("fhwk/3p/P3/KWHF[] w")

    @staticmethod
    def from_fen(fen: str) -> "Position":
        pos = Position()
        board_part, _, rest = fen.partition("[")
        hands_part, _, tail = rest.partition("]")
        stm = tail.strip().split(" ")[0] if tail.strip() else "w"

        ranks = board_part.strip().split("/")
        if len(ranks) != 4:
            raise ValueError(f"bad board in FEN: {fen!r}")
        for row, text in enumerate(ranks):
            rank = 3 - row  # FEN lists rank 4 first
            file = 0
            index = 0
            while index < len(text):
                ch = text[index]
                index += 1
                if ch.isdigit():
                    file += int(ch)
                    continue
                piece = LETTER_PIECE[ch.upper()]
                color = WHITE if ch.isupper() else BLACK
                promoted = index < len(text) and text[index] == "~"
                if promoted:
                    index += 1
                pos._add_piece(color, piece, rank * 4 + file, promoted)
                file += 1

        for ch in hands_part:
            if ch.isspace():
                continue
            piece = LETTER_PIECE[ch.upper()]
            color = WHITE if ch.isupper() else BLACK
            pos.hands[color][piece] += 1
            pos.hand_value[color] += HAND_VALUE[piece]
            pos.hand_count[color] += 1

        pos.stm = WHITE if stm == "w" else BLACK
        pos.key = pos._compute_key()
        return pos

    def to_fen(self) -> str:
        rows = []
        for rank in range(3, -1, -1):
            row = ""
            gap = 0
            for file in range(4):
                piece = self.board[rank * 4 + file]
                if not piece:
                    gap += 1
                    continue
                if gap:
                    row += str(gap)
                    gap = 0
                color, kind = piece >> 3, piece & 7
                letter = PIECE_LETTER[kind]
                row += letter if color == WHITE else letter.lower()
                if (self.promoted >> (rank * 4 + file)) & 1:
                    row += "~"
            if gap:
                row += str(gap)
            rows.append(row or "4")
        hands = ""
        for piece in DROPPABLE:
            hands += PIECE_LETTER[piece] * self.hands[WHITE][piece]
        for piece in DROPPABLE:
            hands += PIECE_LETTER[piece].lower() * self.hands[BLACK][piece]
        return f"{'/'.join(rows)}[{hands}] {'w' if self.stm == WHITE else 'b'}"

    def copy(self) -> "Position":
        clone = Position()
        clone.board = self.board[:]
        clone.promoted = self.promoted
        clone.bb = [self.bb[0][:], self.bb[1][:]]
        clone.occ_color = self.occ_color[:]
        clone.occ = self.occ
        clone.hands = [self.hands[0][:], self.hands[1][:]]
        clone.stm = self.stm
        clone.key = self.key
        clone.psq = self.psq[:]
        clone.hand_value = self.hand_value[:]
        clone.hand_count = self.hand_count[:]
        return clone

    # -- piece bookkeeping ----------------------------------------------------

    def _add_piece(self, color: int, piece: int, sq: int, promoted: bool = False) -> None:
        self.board[sq] = (color << 3) | piece
        bit = 1 << sq
        self.bb[color][piece] |= bit
        self.occ_color[color] |= bit
        self.occ |= bit
        self.psq[color] += PIECE_SQUARE[color][piece][sq]
        if promoted:
            self.promoted |= bit

    def _remove_piece(self, sq: int) -> None:
        piece = self.board[sq]
        color, kind = piece >> 3, piece & 7
        bit = 1 << sq
        self.board[sq] = EMPTY
        self.bb[color][kind] &= ~bit
        self.occ_color[color] &= ~bit
        self.occ &= ~bit
        self.promoted &= ~bit
        self.psq[color] -= PIECE_SQUARE[color][kind][sq]

    def _compute_key(self) -> int:
        key = 0
        for sq in range(16):
            piece = self.board[sq]
            if piece:
                color, kind = piece >> 3, piece & 7
                key ^= PIECE_KEYS[color][kind][sq]
                if (self.promoted >> sq) & 1:
                    key ^= PROMOTED_KEYS[color][sq]
        for color in (WHITE, BLACK):
            for piece in DROPPABLE:
                key ^= HAND_KEYS[color][piece][self.hands[color][piece]]
        if self.stm == BLACK:
            key ^= SIDE_KEY
        return key

    # -- queries --------------------------------------------------------------

    def king_square(self, color: int) -> int:
        bb = self.bb[color][KING]
        return (bb & -bb).bit_length() - 1 if bb else -1

    def is_attacked(self, sq: int, by: int) -> bool:
        bb = self.bb[by]
        if KING_MASK[sq] & bb[KING]:
            return True
        if WAZIR_MASK[sq] & bb[WAZIR]:
            return True
        if FERZ_MASK[sq] & bb[FERZ]:
            return True
        # A `by` pawn attacks `sq` from exactly the squares the opposite
        # colour's pawn on `sq` would attack.
        if PAWN_CAPS[by ^ 1][sq] & bb[PAWN]:
            return True
        horses = bb[HORSE]
        if horses:
            occ = self.occ
            for frm, blocker in HORSE_ATTACKERS[sq]:
                if (horses >> frm) & 1 and not (occ >> blocker) & 1:
                    return True
        return False

    def in_check(self, color: int | None = None) -> bool:
        color = self.stm if color is None else color
        king = self.king_square(color)
        return king >= 0 and self.is_attacked(king, color ^ 1)

    def has_hand_pieces(self, color: int) -> bool:
        return self.hand_count[color] > 0

    # -- move generation ------------------------------------------------------

    def generate_pseudo(self) -> list[int]:
        moves: list[int] = []
        append = moves.append
        us = self.stm
        own = self.occ_color[us]
        opp = self.occ_color[us ^ 1]
        occ = self.occ
        bb = self.bb[us]
        promo_rank = PROMOTION_RANK[us]

        def emit(frm: int, targets: int) -> None:
            while targets:
                bit = targets & -targets
                targets ^= bit
                append(frm | ((bit.bit_length() - 1) << 4))

        for kind, table in ((KING, KING_MASK), (WAZIR, WAZIR_MASK), (FERZ, FERZ_MASK)):
            pieces = bb[kind]
            while pieces:
                bit = pieces & -pieces
                pieces ^= bit
                frm = bit.bit_length() - 1
                emit(frm, table[frm] & ~own)

        horses = bb[HORSE]
        while horses:
            bit = horses & -horses
            horses ^= bit
            frm = bit.bit_length() - 1
            for to, blocker in HORSE_MOVES[frm]:
                if (occ >> blocker) & 1 or (own >> to) & 1:
                    continue
                append(frm | (to << 4))

        pawns = bb[PAWN]
        while pawns:
            bit = pawns & -pawns
            pawns ^= bit
            frm = bit.bit_length() - 1
            targets = 0
            push = PAWN_PUSH[us][frm]
            if push >= 0 and not (occ >> push) & 1:
                targets |= 1 << push
            targets |= PAWN_CAPS[us][frm] & opp
            while targets:
                tbit = targets & -targets
                targets ^= tbit
                to = tbit.bit_length() - 1
                if to >> 2 == promo_rank:
                    for promo in PROMOTIONS:
                        append(frm | (to << 4) | (promo << 8))
                else:
                    append(frm | (to << 4))

        hand = self.hands[us]
        if any(hand[piece] for piece in DROPPABLE):
            empties = FULL & ~occ
            pawn_empties = empties & ~BACK_RANKS_MASK
            for piece in DROPPABLE:
                if not hand[piece]:
                    continue
                squares = pawn_empties if piece == PAWN else empties
                while squares:
                    bit = squares & -squares
                    squares ^= bit
                    append(DROP_FLAG | ((bit.bit_length() - 1) << 4) | (piece << 12))

        return moves

    def generate_legal(self) -> list[int]:
        legal = []
        us = self.stm
        for move in self.generate_pseudo():
            self.make(move)
            if not self.is_attacked(self.king_square(us), us ^ 1):
                legal.append(move)
            self.unmake()
        return legal

    def is_legal(self, move: int) -> bool:
        us = self.stm
        self.make(move)
        ok = not self.is_attacked(self.king_square(us), us ^ 1)
        self.unmake()
        return ok

    # -- make / unmake --------------------------------------------------------

    def make(self, move: int) -> None:
        us = self.stm
        them = us ^ 1
        to = (move >> 4) & 0xF
        key = self.key

        if move & DROP_FLAG:
            piece = (move >> 12) & 7
            count = self.hands[us][piece]
            key ^= HAND_KEYS[us][piece][count] ^ HAND_KEYS[us][piece][count - 1]
            self.hands[us][piece] = count - 1
            self.hand_value[us] -= HAND_VALUE[piece]
            self.hand_count[us] -= 1
            self._add_piece(us, piece, to)
            key ^= PIECE_KEYS[us][piece][to]
            self._undo.append((move, EMPTY, False))
        else:
            frm = move & 0xF
            promo = (move >> 8) & 7
            moving = self.board[frm]
            kind = moving & 7
            was_promoted = bool((self.promoted >> frm) & 1)
            captured = self.board[to]
            captured_promoted = bool((self.promoted >> to) & 1)

            if captured:
                cap_kind = captured & 7
                key ^= PIECE_KEYS[them][cap_kind][to]
                if captured_promoted:
                    key ^= PROMOTED_KEYS[them][to]
                banked = PAWN if captured_promoted else cap_kind
                count = self.hands[us][banked]
                key ^= HAND_KEYS[us][banked][count] ^ HAND_KEYS[us][banked][count + 1]
                self.hands[us][banked] = count + 1
                self.hand_value[us] += HAND_VALUE[banked]
                self.hand_count[us] += 1
                self._remove_piece(to)

            self._remove_piece(frm)
            key ^= PIECE_KEYS[us][kind][frm]
            if was_promoted:
                key ^= PROMOTED_KEYS[us][frm]

            if promo:
                self._add_piece(us, promo, to, True)
                key ^= PIECE_KEYS[us][promo][to] ^ PROMOTED_KEYS[us][to]
            else:
                self._add_piece(us, kind, to, was_promoted)
                key ^= PIECE_KEYS[us][kind][to]
                if was_promoted:
                    key ^= PROMOTED_KEYS[us][to]

            self._undo.append((move, captured, captured_promoted))

        self.stm = them
        self.key = key ^ SIDE_KEY

    def unmake(self) -> None:
        move, captured, captured_promoted = self._undo.pop()
        them = self.stm
        us = them ^ 1
        to = (move >> 4) & 0xF

        if move & DROP_FLAG:
            piece = (move >> 12) & 7
            self._remove_piece(to)
            self.hands[us][piece] += 1
            self.hand_value[us] += HAND_VALUE[piece]
            self.hand_count[us] += 1
            key = self.key ^ PIECE_KEYS[us][piece][to]
            count = self.hands[us][piece]
            key ^= HAND_KEYS[us][piece][count] ^ HAND_KEYS[us][piece][count - 1]
        else:
            frm = move & 0xF
            promo = (move >> 8) & 7
            was_promoted = bool((self.promoted >> to) & 1)
            kind = self.board[to] & 7
            key = self.key ^ PIECE_KEYS[us][kind][to]
            if was_promoted:
                key ^= PROMOTED_KEYS[us][to]
            self._remove_piece(to)

            if promo:
                self._add_piece(us, PAWN, frm)
                key ^= PIECE_KEYS[us][PAWN][frm]
            else:
                self._add_piece(us, kind, frm, was_promoted)
                key ^= PIECE_KEYS[us][kind][frm]
                if was_promoted:
                    key ^= PROMOTED_KEYS[us][frm]

            if captured:
                cap_kind = captured & 7
                self._add_piece(them, cap_kind, to, captured_promoted)
                key ^= PIECE_KEYS[them][cap_kind][to]
                if captured_promoted:
                    key ^= PROMOTED_KEYS[them][to]
                banked = PAWN if captured_promoted else cap_kind
                count = self.hands[us][banked]
                key ^= HAND_KEYS[us][banked][count] ^ HAND_KEYS[us][banked][count - 1]
                self.hands[us][banked] = count - 1
                self.hand_value[us] -= HAND_VALUE[banked]
                self.hand_count[us] -= 1

        self.stm = us
        self.key = key ^ SIDE_KEY

    # -- convenience ----------------------------------------------------------

    def make_uci(self, text: str) -> int:
        move = move_from_uci(text)
        legal = self.generate_legal()
        if move not in legal:
            raise ValueError(f"illegal move {text!r} in {self.to_fen()!r}")
        self.make(move)
        return move

    def san(self, move: int) -> str:
        """Notation matching the frontend: `Hxd3`, `axb4=H`, `W@c3`, `+`/`#`."""
        target = square_name((move >> 4) & 0xF)
        if move & DROP_FLAG:
            text = f"{PIECE_LETTER[(move >> 12) & 7]}@{target}"
        else:
            frm = move & 0xF
            kind = self.board[frm] & 7
            captured = bool(self.board[(move >> 4) & 0xF])
            promo = (move >> 8) & 7
            suffix = f"={PIECE_LETTER[promo]}" if promo else ""
            if kind == PAWN:
                prefix = f"{FILES[frm & 3]}x" if captured else ""
                text = f"{prefix}{target}{suffix}"
            else:
                text = f"{PIECE_LETTER[kind]}{'x' if captured else ''}{target}{suffix}"
        self.make(move)
        if self.in_check():
            text += "#" if not self.generate_legal() else "+"
        self.unmake()
        return text


class Game:
    """A position plus the move history, so repetitions can be detected."""

    __slots__ = ("position", "moves", "keys")

    def __init__(self, position: Position | None = None) -> None:
        self.position = position or Position.start()
        self.moves: list[int] = []
        self.keys: list[int] = [self.position.key]

    @staticmethod
    def from_uci(moves: list[str], fen: str | None = None) -> "Game":
        game = Game(Position.from_fen(fen) if fen else None)
        for text in moves:
            game.push(move_from_uci(text))
        return game

    def push(self, move: int) -> None:
        self.position.make(move)
        self.moves.append(move)
        self.keys.append(self.position.key)

    def pop(self) -> int:
        move = self.moves.pop()
        self.keys.pop()
        self.position.unmake()
        return move

    def repetition_count(self) -> int:
        return self.keys.count(self.position.key)

    def outcome(self) -> tuple[str, int | None]:
        """('playing'|'checkmate'|'stalemate'|'repetition'|'ply-limit', winner)."""
        pos = self.position
        if not pos.generate_legal():
            if pos.in_check():
                return "checkmate", pos.stm ^ 1
            return "stalemate", None
        if self.repetition_count() >= 3:
            return "repetition", None
        if len(self.moves) >= MAX_PLY:
            return "ply-limit", None
        return "playing", None

    def legal_uci(self) -> Iterator[str]:
        return (move_to_uci(move) for move in self.position.generate_legal())
