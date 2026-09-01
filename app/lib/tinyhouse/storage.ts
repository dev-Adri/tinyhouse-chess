/**
 * Keeps the current game and analysis in localStorage, so a refresh — or a
 * closed tab — no longer throws the position away.
 *
 * Games are stored as UCI moves and replayed through the rules on the way
 * back in. Anything that fails to replay is discarded rather than patched up:
 * a position that cannot legally exist is worse than a fresh board.
 */

import { applyMove, createGame, legalMoves, movesEqual, type Color, type GameState } from "./engine";
import { moveFromUci, moveToUci } from "./uci";
import { deserialize, serialize, type MoveTree } from "./variations";

export const THEME_STORAGE_KEY = "tinyhouse:theme";
const GAME_KEY = "tinyhouse:game";
const ANALYSIS_KEY = "tinyhouse:analysis";
const DEPTHS_KEY = "tinyhouse:depths";
const VERSION = 1;

/** The UI's search-depth range. The engine itself clamps to 1..20. */
export const MIN_DEPTH = 4;
export const MAX_DEPTH = 12;
export const DEFAULT_DEPTH = 8;

/** Mirrors OpponentMode, kept local so this module stays under the components. */
const MODES = ["human", "bot", "engines", "analysis"] as const;
type PersistedMode = (typeof MODES)[number];

export interface StoredGame {
  game: GameState;
  mode: PersistedMode;
  level: number;
  humanSide: Color;
  started: boolean;
}

export interface StoredAnalysis {
  tree: MoveTree;
  cursor: string;
}

export interface StoredDepths {
  analysis: number;
  review: number;
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable or full — the session simply is not persisted.
  }
}

export function clearStored(key: "game" | "analysis"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key === "game" ? GAME_KEY : ANALYSIS_KEY);
  } catch {
    // nothing to do
  }
}

export function saveGame(state: StoredGame): void {
  write(
    GAME_KEY,
    JSON.stringify({
      v: VERSION,
      moves: state.game.history.map((entry) => moveToUci(entry.move)),
      mode: state.mode,
      level: state.level,
      humanSide: state.humanSide,
      started: state.started,
    }),
  );
}

export function loadGame(): StoredGame | null {
  const text = read(GAME_KEY);
  if (!text) return null;

  let payload: {
    v?: number;
    moves?: unknown;
    mode?: unknown;
    level?: unknown;
    humanSide?: unknown;
    started?: unknown;
  };
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload?.v !== VERSION || !Array.isArray(payload.moves)) return null;

  const mode = MODES.includes(payload.mode as PersistedMode)
    ? (payload.mode as PersistedMode)
    : "human";
  const humanSide: Color = payload.humanSide === "b" ? "b" : "w";
  const level = typeof payload.level === "number" && payload.level >= 1 && payload.level <= 6
    ? payload.level
    : 3;

  let game = createGame();
  for (const uci of payload.moves) {
    if (typeof uci !== "string") return null;
    let move;
    try {
      move = moveFromUci(uci);
    } catch {
      return null;
    }
    const legal = legalMoves(game).find((candidate) => movesEqual(candidate, move));
    if (!legal) return null;
    game = applyMove(game, legal);
  }

  return { game, mode, level, humanSide, started: payload.started === true };
}

export function saveAnalysis(tree: MoveTree, cursor: string): void {
  write(ANALYSIS_KEY, JSON.stringify({ v: VERSION, cursor, tree: serialize(tree) }));
}

export function loadAnalysis(): StoredAnalysis | null {
  const text = read(ANALYSIS_KEY);
  if (!text) return null;

  let payload: { v?: number; cursor?: unknown; tree?: unknown };
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload?.v !== VERSION || typeof payload.tree !== "string") return null;

  const tree = deserialize(payload.tree);
  if (!tree) return null;

  const cursor = typeof payload.cursor === "string" && tree.nodes[payload.cursor]
    ? payload.cursor
    : tree.root;
  return { tree, cursor };
}

export function clampDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DEPTH;
  return Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, Math.round(value)));
}

export function loadDepths(): StoredDepths {
  const text = read(DEPTHS_KEY);
  if (!text) return { analysis: DEFAULT_DEPTH, review: DEFAULT_DEPTH };
  try {
    const payload = JSON.parse(text) as { analysis?: unknown; review?: unknown };
    return { analysis: clampDepth(payload?.analysis), review: clampDepth(payload?.review) };
  } catch {
    return { analysis: DEFAULT_DEPTH, review: DEFAULT_DEPTH };
  }
}

export function saveDepths(depths: StoredDepths): void {
  write(DEPTHS_KEY, JSON.stringify({ analysis: depths.analysis, review: depths.review }));
}
