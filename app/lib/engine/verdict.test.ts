import { describe, expect, it } from "vitest";
import { legalMoves, movesEqual, type GameState, type Move } from "@/app/lib/tinyhouse/engine";
import { moveFromUci } from "@/app/lib/tinyhouse/uci";
import { addMove, createTree, mainLine, positionAt, type MoveTree } from "@/app/lib/tinyhouse/variations";
import type { AnalysisLine, AnalysisResult, GameReview, PlyReview } from "./types";
import {
  GREAT_MARGIN,
  MAX_LOSS,
  classifyMove,
  seedVerdicts,
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

// --- seedVerdicts ----------------------------------------------------------

/** The move written as `uci`, asserted legal in `state`. */
function move(state: GameState, uci: string): Move {
  const wanted = moveFromUci(uci);
  const found = legalMoves(state).find((candidate) => movesEqual(candidate, wanted));
  if (!found) throw new Error(`${uci} is not legal here`);
  return found;
}

/** A tree holding one line of real moves played from the opening position. */
function lineTree(ucis: string[]): MoveTree {
  let tree = createTree();
  let nodeId = tree.root;
  for (const uci of ucis) {
    const result = addMove(tree, nodeId, move(positionAt(tree, nodeId), uci));
    tree = result.tree;
    nodeId = result.nodeId;
  }
  return tree;
}

/** SAN along the main line, skipping the root, which no move reached. */
const playedSan = (tree: MoveTree) =>
  mainLine(tree)
    .slice(1)
    .map((id) => tree.nodes[id].san);

function ply(index: number, san: string, overrides: Partial<PlyReview> = {}): PlyReview {
  return {
    ply: index,
    color: index % 2 === 0 ? "w" : "b",
    uci: "a2a3",
    san,
    eval_before: 0,
    eval_after: 10 * (index + 1),
    mate_before: null,
    mate_after: null,
    best_uci: "a2a3",
    best_san: "a3",
    best_pv: ["a2a3"],
    loss: 10 * index,
    classification: "good",
    accuracy: 90,
    alternatives: [],
    ...overrides,
  };
}

const report = (plies: PlyReview[]): GameReview => ({
  plies,
  accuracy: { w: 90, b: 90 },
  counts: { w: {}, b: {} } as GameReview["counts"],
  depth: 8,
  classifications: [],
});

describe("seedVerdicts", () => {
  it("maps each report ply to the node the move reached", () => {
    const tree = lineTree(["a2a3", "d3d2", "b1b2"]);
    const line = mainLine(tree);
    const san = playedSan(tree);
    const review = report(san.map((text, index) => ply(index, text)));

    const seeded = seedVerdicts(tree, review);

    // Ply i is line[i + 1]: the root itself is never graded.
    expect(Object.keys(seeded).sort()).toEqual(line.slice(1).sort());
    expect(seeded[line[0]]).toBeUndefined();
    for (let index = 0; index < san.length; index += 1) {
      expect(seeded[line[index + 1]].scoreWhite, `ply ${index}`).toBe(10 * (index + 1));
    }
  });

  it("stops at a SAN mismatch and leaves the later plies unseeded", () => {
    const tree = lineTree(["a2a3", "d3d2", "b1b2"]);
    const line = mainLine(tree);
    const san = playedSan(tree);
    const plies = san.map((text, index) => ply(index, text));
    plies[1] = ply(1, "Wd2xa5"); // a move this tree does not contain

    const seeded = seedVerdicts(tree, report(plies));

    expect(Object.keys(seeded)).toEqual([line[1]]);
  });

  it("stops cleanly when the tree is shorter than the report", () => {
    const tree = lineTree(["a2a3"]);
    const line = mainLine(tree);
    const full = lineTree(["a2a3", "d3d2", "b1b2"]);
    const review = report(playedSan(full).map((text, index) => ply(index, text)));

    const seeded = seedVerdicts(tree, review);

    expect(Object.keys(seeded)).toEqual([line[1]]);
  });

  it("yields an empty map for an empty report", () => {
    expect(seedVerdicts(lineTree(["a2a3"]), report([]))).toEqual({});
  });
});
