import { describe, expect, it } from "vitest";
import type { AnalysisLine, AnalysisResult, PlyReview } from "./types";
import {
  GREAT_MARGIN,
  MAX_LOSS,
  classifyMove,
  verdictFrom,
  verdictFromReview,
} from "./verdict";

const line = (uci: string, score: number): AnalysisLine => ({
  uci,
  san: uci,
  score,
  scoreWhite: score,
  mateIn: null,
  pv: [uci],
});

/** An /analyse reply. `score` mirrors the first line, as the engine's does. */
function result(
  stm: "w" | "b",
  lines: AnalysisLine[],
  overrides: Partial<AnalysisResult> = {},
): AnalysisResult {
  return {
    gameOver: null,
    winner: null,
    score: lines[0]?.score ?? 0,
    scoreWhite: stm === "w" ? (lines[0]?.score ?? 0) : -(lines[0]?.score ?? 0),
    mateIn: null,
    depth: 8,
    nodes: 1000,
    timeMs: 100,
    stm,
    lines,
    ...overrides,
  };
}

describe("classifyMove", () => {
  it("calls a position with one legal move forced, whatever the loss", () => {
    expect(classifyMove({ loss: 0, isBest: true, alternatives: 1, margin: 0 })).toBe("forced");
    expect(classifyMove({ loss: 900, isBest: false, alternatives: 1, margin: 0 })).toBe("forced");
  });

  it("calls the engine's own move best", () => {
    expect(classifyMove({ loss: 0, isBest: true, alternatives: 5, margin: 10 })).toBe("best");
  });

  it("calls it great when it is the only move that holds the position", () => {
    expect(
      classifyMove({ loss: 0, isBest: true, alternatives: 5, margin: GREAT_MARGIN }),
    ).toBe("great");
    expect(
      classifyMove({ loss: 0, isBest: true, alternatives: 5, margin: GREAT_MARGIN - 1 }),
    ).toBe("best");
  });

  it("grades the loss on the same thresholds as the review", () => {
    const grade = (loss: number) =>
      classifyMove({ loss, isBest: false, alternatives: 5, margin: 0 });
    expect(grade(0)).toBe("excellent");
    expect(grade(20)).toBe("excellent");
    expect(grade(21)).toBe("good");
    expect(grade(50)).toBe("good");
    expect(grade(51)).toBe("inaccuracy");
    expect(grade(120)).toBe("inaccuracy");
    expect(grade(121)).toBe("mistake");
    expect(grade(300)).toBe("mistake");
    expect(grade(301)).toBe("blunder");
    expect(grade(5000)).toBe("blunder");
  });
});

describe("verdictFrom", () => {
  it("reads a loss of zero when the played move is the engine's own", () => {
    // White to move, best is +80. Black then sees -80, i.e. score -80 for the
    // side to move at the child. Loss = 80 + (-80) = 0.
    const parent = result("w", [line("a2a3", 80), line("b2b3", 20)]);
    const child = result("b", [line("b4b3", -80)]);

    const verdict = verdictFrom(parent, child, "a2a3", 6);

    expect(verdict).not.toBeNull();
    expect(verdict!.loss).toBe(0);
    // Margin is 60, below GREAT_MARGIN, so this is "best" and not "great".
    expect(verdict!.classification).toBe("best");
  });

  it("is great when the played move is the only one that holds the position", () => {
    // Margin 180 >= GREAT_MARGIN: the second-best move throws the position away.
    const parent = result("w", [line("a2a3", 80), line("b2b3", -100)]);
    const child = result("b", [line("b4b3", -80)]);

    expect(verdictFrom(parent, child, "a2a3", 6)!.classification).toBe("great");
  });

  it("measures the loss of a move that was not the best one", () => {
    // Best was +80; the move played leaves the opponent at +40, i.e. -40 for
    // the mover. Loss = 80 + 40 = 120 → inaccuracy.
    const parent = result("w", [line("a2a3", 80), line("b2b3", 20)]);
    const child = result("b", [line("b4b3", 40)]);

    const verdict = verdictFrom(parent, child, "b2b3", 6);

    expect(verdict!.loss).toBe(120);
    expect(verdict!.classification).toBe("inaccuracy");
    expect(verdict!.bestUci).toBe("a2a3");
  });

  it("works identically with Black to move", () => {
    // Black to move, best is +80 for Black. The move played leaves White at
    // +40 for White's own point of view. Loss = 80 + 40 = 120.
    const parent = result("b", [line("b4b3", 80), line("c4c3", 20)]);
    const child = result("w", [line("a2a3", 40)]);

    expect(verdictFrom(parent, child, "c4c3", 6)!.loss).toBe(120);
  });

  it("never reports a negative loss", () => {
    // A deeper search at the child can beat the parent's own estimate; that is
    // an artefact of the search, not a gain from a bad move.
    const parent = result("w", [line("a2a3", 20), line("b2b3", 10)]);
    const child = result("b", [line("b4b3", -200)]);

    expect(verdictFrom(parent, child, "a2a3", 6)!.loss).toBe(0);
  });

  it("clamps an enormous loss, so a missed mate is not absurd", () => {
    const parent = result("w", [line("a2a3", 9000), line("b2b3", 10)]);
    const child = result("b", [line("b4b3", 500)]);

    expect(verdictFrom(parent, child, "b2b3", 6)!.loss).toBe(MAX_LOSS);
  });

  it("reports the score after the move from White's point of view", () => {
    const parent = result("w", [line("a2a3", 80)]);
    const child = result("b", [line("b4b3", 60)], { scoreWhite: -60, mateIn: 3 });

    const verdict = verdictFrom(parent, child, "a2a3", 6);

    expect(verdict!.scoreWhite).toBe(-60);
    expect(verdict!.mateWhite).toBe(-3); // mate for Black is negative to White
  });

  it("treats a single line as no margin rather than an infinite one", () => {
    const parent = result("w", [line("a2a3", 80)]);
    const child = result("b", [line("b4b3", -80)]);

    expect(verdictFrom(parent, child, "a2a3", 6)!.classification).toBe("best");
  });

  it("returns null when the parent has no lines to compare against", () => {
    const parent = result("w", [], { gameOver: "checkmate" });
    const child = result("b", [line("b4b3", 0)]);

    expect(verdictFrom(parent, child, "a2a3", 0)).toBeNull();
  });
});

describe("verdictFromReview", () => {
  it("carries a review ply across unchanged", () => {
    const ply: PlyReview = {
      ply: 3,
      color: "b",
      uci: "b4c2",
      san: "Hxc2",
      eval_before: 40,
      eval_after: -260,
      mate_before: null,
      mate_after: null,
      best_uci: "b4b3",
      best_san: "Hb3",
      best_pv: ["b4b3"],
      loss: 300,
      classification: "mistake",
      accuracy: 61.2,
      alternatives: [],
    };

    expect(verdictFromReview(ply)).toEqual({
      classification: "mistake",
      loss: 300,
      bestUci: "b4b3",
      bestSan: "Hb3",
      scoreWhite: -260,
      mateWhite: null,
    });
  });
});
