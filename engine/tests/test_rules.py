"""Rules and bookkeeping tests.

The perft numbers are the contract between this engine and the TypeScript
rules in `app/lib/tinyhouse/engine.ts` — both must produce these exact counts.
"""

from __future__ import annotations

import random
import unittest

from tinyhouse.perft import perft
from tinyhouse.position import (
    BLACK,
    DROPPABLE,
    Game,
    Position,
    WHITE,
    move_from_uci,
    move_to_uci,
    parse_square,
)
from tinyhouse.values import HAND_VALUE, PIECE_SQUARE

PERFT_START = [1, 6, 33, 241, 1855, 16021, 139141, 1355253]


class TestPerft(unittest.TestCase):
    def test_start_position_perft(self):
        pos = Position.start()
        for depth, expected in enumerate(PERFT_START):
            with self.subTest(depth=depth):
                self.assertEqual(perft(pos, depth), expected)

    def test_start_fen_roundtrip(self):
        pos = Position.start()
        self.assertEqual(pos.to_fen(), "fhwk/3p/P3/KWHF[] w")
        self.assertEqual(Position.from_fen(pos.to_fen()).key, pos.key)


class TestMovement(unittest.TestCase):
    def setUp(self):
        self.pos = Position.start()

    def targets(self, square: str) -> set[str]:
        sq = parse_square(square)
        return {
            move_to_uci(move)[2:4]
            for move in self.pos.generate_pseudo()
            if not move & (1 << 11) and (move & 0xF) == sq
        }

    def test_horse_is_hobbled_by_its_own_neighbours(self):
        # c1 horse: the b1 and d1 legs are blocked, only the c2 leg is free.
        self.assertEqual(self.targets("c1"), {"b3", "d3"})

    def test_wazir_moves_orthogonally(self):
        self.assertEqual(self.targets("b1"), {"b2"})

    def test_ferz_moves_diagonally(self):
        self.assertEqual(self.targets("d1"), {"c2"})

    def test_pawn_pushes_one_square(self):
        self.assertEqual(self.targets("a2"), {"a3"})

    def test_opening_move_count(self):
        self.assertEqual(len(self.pos.generate_legal()), 6)


class TestDrops(unittest.TestCase):
    def test_capture_banks_the_piece(self):
        game = Game.from_uci(["c1d3"])  # horse takes the d3 pawn
        self.assertEqual(game.position.hands[WHITE][2], 1)  # PAWN == 2
        self.assertEqual(game.position.hand_count[WHITE], 1)

    def test_promoted_piece_reverts_to_a_pawn_when_captured(self):
        pos = Position.from_fen("3k/4/4/K2F~[] b")
        self.assertEqual(pos.to_fen(), "3k/4/4/K2F~[] b")
        game = Game(Position.from_fen("2Fk/4/4/K3[] b"))
        game.position.promoted |= 1 << parse_square("c4")
        game.push(move_from_uci("d4c4"))  # king takes the promoted ferz
        self.assertEqual(game.position.hands[BLACK][2], 1, "banked as a pawn")
        self.assertEqual(game.position.hands[BLACK][4], 0, "not as a ferz")

    def test_pawns_cannot_be_dropped_on_the_back_ranks(self):
        pos = Position.from_fen("3k/4/4/K3[P] w")
        squares = {
            move_to_uci(move)[2:]
            for move in pos.generate_legal()
            if move & (1 << 11)
        }
        self.assertTrue(squares)
        self.assertFalse({sq for sq in squares if sq[1] in "14"})

    def test_drops_only_land_on_empty_squares(self):
        pos = Position.from_fen("3k/4/4/K3[W] w")
        for move in pos.generate_legal():
            if move & (1 << 11):
                self.assertEqual(pos.board[(move >> 4) & 0xF], 0)


class TestOutcomes(unittest.TestCase):
    def test_checkmate(self):
        # 1.Fc2 Hxc2+ 2.Kb2 F@a3#
        game = Game.from_uci(["d1c2", "b4c2", "a1b2", "F@a3"])
        self.assertEqual(game.outcome(), ("checkmate", BLACK))

    def test_stalemate(self):
        # Black king on a4 has a3, b3 and b4 all covered, and is not in check.
        pos = Position.from_fen("k1W1/2W1/1F2/3K[] b")
        game = Game(pos)
        self.assertFalse(pos.in_check())
        self.assertEqual(game.outcome()[0], "stalemate")

    def test_threefold_repetition(self):
        game = Game.from_uci(["a1b2", "d4c3", "b2a1", "c3d4"] * 2)
        self.assertEqual(game.outcome()[0], "repetition")


class TestIncrementalState(unittest.TestCase):
    """make/unmake must keep the hash and the evaluation totals exact."""

    @staticmethod
    def recompute(pos: Position) -> tuple[int, list[int], list[int]]:
        psq = [0, 0]
        for sq in range(16):
            piece = pos.board[sq]
            if piece:
                color, kind = piece >> 3, piece & 7
                psq[color] += PIECE_SQUARE[color][kind][sq]
        hand_value = [0, 0]
        hand_count = [0, 0]
        for color in (WHITE, BLACK):
            for kind in DROPPABLE:
                count = pos.hands[color][kind]
                hand_value[color] += count * HAND_VALUE[kind]
                hand_count[color] += count
        return pos._compute_key(), psq, hand_value, hand_count

    def test_random_playouts_stay_consistent(self):
        rng = random.Random(12345)
        for _ in range(40):
            game = Game()
            snapshots = []
            for _ply in range(30):
                moves = game.position.generate_legal()
                if not moves or game.outcome()[0] != "playing":
                    break
                snapshots.append(game.position.to_fen())
                game.push(rng.choice(moves))

                key, psq, hand_value, hand_count = self.recompute(game.position)
                self.assertEqual(game.position.key, key, "zobrist drifted")
                self.assertEqual(game.position.psq, psq, "piece-square total drifted")
                self.assertEqual(game.position.hand_value, hand_value)
                self.assertEqual(game.position.hand_count, hand_count)

            # Unwinding must restore every earlier position exactly.
            while snapshots:
                game.pop()
                self.assertEqual(game.position.to_fen(), snapshots.pop())


if __name__ == "__main__":
    unittest.main()
