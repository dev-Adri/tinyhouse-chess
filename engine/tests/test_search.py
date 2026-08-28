"""Search and review behaviour."""

from __future__ import annotations

import random
import unittest

from tinyhouse.analysis import review_game
from tinyhouse.position import Game, move_from_uci
from tinyhouse.search import (
    LEVELS,
    MATE_THRESHOLD,
    Limits,
    Searcher,
    best_move,
    choose_move,
)

FAST = Limits(depth=6, time_ms=4000, exact_root=True)


class TestSearch(unittest.TestCase):
    def test_finds_mate_in_one(self):
        # 1.Fc2 Hxc2+ 2.Kb2 and Black mates with a ferz drop.
        game = Game.from_uci(["d1c2", "b4c2", "a1b2"])
        result = Searcher().search(game, FAST)
        self.assertGreater(result.score, MATE_THRESHOLD)
        self.assertEqual(result.root[0].mate_in, 1)
        self.assertIn(result.best, {"F@a3", "F@c3"})

    def test_avoids_being_mated(self):
        game = Game.from_uci(["d1c2", "b4c2"])
        result = Searcher().search(game, FAST)
        # Kb2 walks into mate; the engine must pick the other move.
        self.assertEqual(result.best, "b1b2")
        losing = next(entry for entry in result.root if entry.uci == "a1b2")
        self.assertLess(losing.score, -MATE_THRESHOLD)

    def test_position_survives_a_timeout(self):
        """A search cut short must leave the position exactly as it found it."""
        game = Game.from_uci(["c1d3", "a4b3", "a2a3", "b3c2"])
        before = game.position.to_fen()
        depth = len(game.position._undo)
        searcher = Searcher()
        for time_ms in (1, 3, 10, 50, 200):
            searcher.search(game, Limits(depth=20, time_ms=time_ms))
            self.assertEqual(game.position.to_fen(), before)
            self.assertEqual(len(game.position._undo), depth)

    def test_every_level_returns_a_legal_move(self):
        game = Game.from_uci(["c1d3", "a4b3"])
        legal = set(game.legal_uci())
        for level in sorted(LEVELS):
            with self.subTest(level=level):
                played, _ = best_move(game, level, seed=level)
                self.assertIn(played.uci, legal)

    def test_stronger_level_beats_the_weakest(self):
        """Level 4 against level 1, from both sides."""
        rng = random.Random(4)
        wins = 0
        for game_index in range(2):
            game = Game()
            levels = {0: 4, 1: 1} if game_index == 0 else {0: 1, 1: 4}
            strong = 0 if game_index == 0 else 1
            while game.outcome()[0] == "playing":
                move, _ = best_move(
                    game, levels[game.position.stm], seed=rng.randrange(1 << 30)
                )
                game.push(move_from_uci(move.uci))
            _, winner = game.outcome()
            if winner == strong:
                wins += 1
        self.assertEqual(wins, 2, "the stronger level should win both games")

    def test_randomness_stays_within_its_slack(self):
        game = Game()
        result = Searcher().search(game, Limits(depth=4, time_ms=3000, exact_root=True))
        limits = Limits(randomness=100)
        rng = random.Random(0)
        best = result.root[0].score
        for _ in range(25):
            picked = choose_move(result, limits, rng)
            self.assertLessEqual(best - picked.score, 100)


class TestReview(unittest.TestCase):
    def test_grades_a_short_game(self):
        report = review_game(
            ["d1c2", "b4c2", "a1b2", "F@a3"],
            limits=Limits(depth=5, time_ms=500, exact_root=True),
        )
        self.assertEqual(len(report.plies), 4)

        first, second, third, fourth = report.plies
        self.assertEqual(first.color, "w")
        self.assertEqual(first.classification, "blunder")
        self.assertGreater(first.loss, 300)
        self.assertEqual(second.classification, "best")
        self.assertEqual(third.classification, "blunder", "Kb2 walks into mate")
        self.assertEqual(fourth.classification, "best")
        self.assertEqual(fourth.san, "F@a3#")

        # Black played perfectly, White did not.
        self.assertEqual(report.accuracy["b"], 100.0)
        self.assertLess(report.accuracy["w"], 80)
        self.assertEqual(report.counts["b"]["best"], 2)

    def test_evaluations_are_from_whites_point_of_view(self):
        report = review_game(
            ["d1c2", "b4c2", "a1b2", "F@a3"],
            limits=Limits(depth=4, time_ms=300, exact_root=True),
        )
        # The game ends in mate for Black, so the final evaluation is very negative.
        self.assertLess(report.plies[-1].eval_after, -MATE_THRESHOLD)
        self.assertEqual(report.plies[-1].mate_after, -1)

    def test_empty_game_is_handled(self):
        report = review_game([], limits=Limits(depth=2, time_ms=100))
        self.assertEqual(report.plies, [])
        self.assertEqual(report.accuracy, {"w": 100.0, "b": 100.0})


if __name__ == "__main__":
    unittest.main()
