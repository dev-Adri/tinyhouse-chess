/**
 * Grading a single move.
 *
 * `/analyse` is deterministic at a fixed depth, so a move's grade needs only
 * the evaluation of the position before it and of the position after it. The
 * engine scores every position from the side to move's point of view, which is
 * why the loss below is a sum: the child's score belongs to the opponent.
 *
 * The thresholds mirror `classify()` in `engine/tinyhouse/analysis.py`. They
 * are duplicated rather than fetched so the board can grade a move you have
 * only just played, with no round trip; the tests pin them to the Python values.
 */

import { mainLine, type MoveTree } from "@/app/lib/tinyhouse/variations";
import { toWhiteRelative } from "./classification";
import type { AnalysisResult, Classification, GameReview, PlyReview } from "./types";

/** A move is "great" when it is the only one that holds the position. */
export const GREAT_MARGIN = 150;
/** Ceiling on reported loss, so a missed mate does not produce absurd numbers. */
export const MAX_LOSS = 1500;
/** Checked in order; anything past the last one is a blunder. */
export const LOSS_THRESHOLDS: readonly [number, Classification][] = [
  [20, "excellent"],
  [50, "good"],
  [120, "inaccuracy"],
  [300, "mistake"],
];

export interface MoveVerdict {
  classification: Classification;
  /** Centipawns given up against the engine's choice, 0..MAX_LOSS. */
  loss: number;
  bestUci: string;
  bestSan: string;
  /** Evaluation after the move, White-relative, for display. */
  scoreWhite: number;
  mateWhite: number | null;
}

export function classifyMove({
  loss,
  isBest,
  alternatives,
  margin,
}: {
  loss: number;
  isBest: boolean;
  alternatives: number;
  margin: number;
}): Classification {
  if (alternatives <= 1) return "forced";
  if (isBest) return margin >= GREAT_MARGIN ? "great" : "best";
  for (const [limit, label] of LOSS_THRESHOLDS) {
    if (loss <= limit) return label;
  }
  return "blunder";
}

/**
 * Grades the move that led from `parent`'s position to `child`'s.
 *
 * `alternatives` is the number of legal moves in the parent position, which
 * the caller has locally — the engine only returns its top few lines.
 */
export function verdictFrom(
  parent: AnalysisResult,
  child: AnalysisResult,
  playedUci: string,
  alternatives: number,
): MoveVerdict | null {
  const best = parent.lines[0];
  if (!best) return null;

  // Both scores are side-to-move-relative, and the two positions have opposite
  // sides to move — hence the sum.
  const raw = parent.score + child.score;
  const loss = Math.max(0, Math.min(MAX_LOSS, Math.round(raw)));
  const margin = parent.lines.length > 1 ? best.score - parent.lines[1].score : 0;
  const after = toWhiteRelative(child.stm, child.score, child.mateIn);

  return {
    classification: classifyMove({
      loss,
      isBest: best.uci === playedUci,
      alternatives,
      margin,
    }),
    loss,
    bestUci: best.uci,
    bestSan: best.san,
    scoreWhite: after.score,
    mateWhite: after.mateIn,
  };
}

/** The same shape out of a review report, so consumers never branch on source. */
export function verdictFromReview(ply: PlyReview): MoveVerdict {
  return {
    classification: ply.classification,
    loss: ply.loss,
    bestUci: ply.best_uci,
    bestSan: ply.best_san,
    scoreWhite: ply.eval_after,
    mateWhite: ply.mate_after,
  };
}

/**
 * Pins a review report's grades to the nodes of a tree, keyed by node id.
 *
 * The report describes the game as played, which `treeFromHistory` lays down
 * as the main line, so ply `i` is `mainLine(tree)[i + 1]` — the +1 skips the
 * root, which no move reached. The SAN check stops a report being pinned to a
 * tree it no longer describes: the walk ends at the first node that does not
 * match, leaving the rest of the report unseeded rather than mislabelling it.
 */
export function seedVerdicts(tree: MoveTree, review: GameReview): Record<string, MoveVerdict> {
  const line = mainLine(tree);
  const out: Record<string, MoveVerdict> = {};
  for (const ply of review.plies) {
    const id = line[ply.ply + 1];
    if (!id || tree.nodes[id].san !== ply.san) break;
    out[id] = verdictFromReview(ply);
  }
  return out;
}
