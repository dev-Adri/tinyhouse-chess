"""The JSON API handlers, exercised directly rather than over HTTP."""

from __future__ import annotations

import unittest

from tinyhouse.server import EngineError, handle_analyse

# 1.Fc2 Hxc2+ 2.Kb2 F@a3#  — a short forced mate, used for the decided-position case.
MATE_LINE = ["d1c2", "b4c2", "a1b2", "F@a3"]

FAST = {"depth": 3, "timeMs": 300}


class TestAnalyse(unittest.TestCase):
    def test_reports_lines_for_the_start_position(self):
        result = handle_analyse({"moves": [], **FAST})

        self.assertIsNone(result["gameOver"])
        self.assertEqual(result["stm"], "w")
        self.assertTrue(result["lines"])
        self.assertIn("uci", result["lines"][0])
        self.assertIn("san", result["lines"][0])
        self.assertIn("pv", result["lines"][0])

    def test_lines_are_ordered_best_first(self):
        result = handle_analyse({"moves": [], "multipv": 5, **FAST})
        scores = [line["score"] for line in result["lines"]]

        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(result["lines"][0]["score"], result["score"])

    def test_multipv_bounds_the_line_count(self):
        self.assertEqual(len(handle_analyse({"moves": [], "multipv": 1, **FAST})["lines"]), 1)
        self.assertEqual(len(handle_analyse({"moves": [], "multipv": 3, **FAST})["lines"]), 3)
        # Out-of-range values clamp instead of failing.
        self.assertLessEqual(len(handle_analyse({"moves": [], "multipv": 99, **FAST})["lines"]), 5)
        self.assertEqual(len(handle_analyse({"moves": [], "multipv": 0, **FAST})["lines"]), 1)

    def test_is_deterministic(self):
        first = handle_analyse({"moves": [], "multipv": 3, **FAST})
        second = handle_analyse({"moves": [], "multipv": 3, **FAST})

        self.assertEqual(
            [(line["uci"], line["score"]) for line in first["lines"]],
            [(line["uci"], line["score"]) for line in second["lines"]],
        )

    def test_score_is_mirrored_for_white(self):
        result = handle_analyse({"moves": ["a2a3"], **FAST})

        self.assertEqual(result["stm"], "b")
        self.assertEqual(result["scoreWhite"], -result["score"])

    def test_a_decided_position_is_reported_not_raised(self):
        result = handle_analyse({"moves": MATE_LINE, **FAST})

        self.assertEqual(result["gameOver"], "checkmate")
        self.assertEqual(result["winner"], "b")
        self.assertEqual(result["lines"], [])

    def test_sees_the_mate(self):
        result = handle_analyse({"moves": MATE_LINE[:-1], "depth": 4, "timeMs": 2000})

        self.assertEqual(result["lines"][0]["uci"], "F@a3")
        self.assertEqual(result["lines"][0]["mateIn"], 1)

    def test_rejects_an_illegal_move(self):
        with self.assertRaises(EngineError):
            handle_analyse({"moves": ["a2a4"], **FAST})

    def test_accepts_a_hand_built_position(self):
        # White king a1, black king d4, white wazir b2 — a legal arrangement.
        result = handle_analyse({"fen": "3k/4/1W2/K3[] w", "moves": [], **FAST})

        self.assertIsNone(result["gameOver"])
        self.assertTrue(result["lines"])

    def test_accepts_reserves_and_promoted_pieces_in_a_fen(self):
        result = handle_analyse({"fen": "3k/4/2F~1/K3[Pff] w", "moves": [], **FAST})

        self.assertIsNone(result["gameOver"])
        self.assertTrue(result["lines"])

    def test_plays_moves_on_top_of_a_hand_built_position(self):
        result = handle_analyse({"fen": "3k/4/1W2/K3[] w", "moves": ["b2b3"], **FAST})

        self.assertEqual(result["stm"], "b")
        self.assertTrue(result["lines"])

    def test_rejects_a_position_with_the_waiting_side_in_check(self):
        # The white ferz on c3 attacks the black king, but it is White to move,
        # so the search could capture a king. That must be a 400, not a crash.
        with self.assertRaises(EngineError) as caught:
            handle_analyse({"fen": "3k/2F~1/4/K3[] w", "moves": [], **FAST})
        self.assertIn("not their move", str(caught.exception))

    def test_rejects_a_position_with_a_missing_king(self):
        with self.assertRaises(EngineError) as caught:
            handle_analyse({"fen": "3k/4/1W2/4[] w", "moves": [], **FAST})
        self.assertIn("no king", str(caught.exception))

    def test_clamps_an_absurd_depth(self):
        # Would run forever if the clamp were missing; the time limit still applies.
        result = handle_analyse({"moves": [], "depth": 9999, "timeMs": 200})

        self.assertLessEqual(result["depth"], 20)
        self.assertTrue(result["lines"])


if __name__ == "__main__":
    unittest.main()
