/** Shapes returned by the Python engine API. */

export type Classification =
  | "best"
  | "great"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "forced";

export interface EngineLevel {
  level: number;
  name: string;
  depth: number;
  timeMs: number;
}

export interface EngineHealth {
  ok: boolean;
  engine: string;
  levels: EngineLevel[];
}

export interface EngineLine {
  uci: string;
  san: string;
  score: number;
  scoreWhite: number;
  mateIn: number | null;
}

export interface BestMoveResponse {
  move: string;
  san: string;
  score: number;
  scoreWhite: number;
  mateIn: number | null;
  isBest: boolean;
  best: string;
  bestScoreWhite: number;
  depth: number;
  nodes: number;
  timeMs: number;
  pv: string[];
  level: number;
  levelName: string;
  top: EngineLine[];
}

/** One candidate move from /analyse, with the line the engine expects after it. */
export interface AnalysisLine {
  uci: string;
  san: string;
  score: number;
  scoreWhite: number;
  mateIn: number | null;
  pv: string[];
}

export interface AnalysisResult {
  /** Set when the position is already decided; `lines` is then empty. */
  gameOver: "checkmate" | "stalemate" | "repetition" | "ply-limit" | null;
  winner: "w" | "b" | null;
  /** Centipawns from the side to move's point of view. */
  score: number;
  scoreWhite: number;
  mateIn: number | null;
  depth: number;
  nodes: number;
  timeMs: number;
  stm: "w" | "b";
  lines: AnalysisLine[];
}

export interface PlyReview {
  ply: number;
  color: "w" | "b";
  uci: string;
  san: string;
  /** Centipawns, always from White's point of view. */
  eval_before: number;
  eval_after: number;
  mate_before: number | null;
  mate_after: number | null;
  best_uci: string;
  best_san: string;
  best_pv: string[];
  loss: number;
  classification: Classification;
  accuracy: number;
  alternatives: { uci: string; san: string; score: number; mateIn: number | null }[];
}

export interface GameReview {
  plies: PlyReview[];
  accuracy: Record<"w" | "b", number>;
  counts: Record<"w" | "b", Record<Classification, number>>;
  depth: number;
  classifications: Classification[];
}
