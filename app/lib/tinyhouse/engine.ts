/**
 * Tinyhouse — a 4x4 chess variant with crazyhouse-style piece drops.
 *
 * Squares are indexed 0..15 as `rank * 4 + file`, where file 0 = "a" and
 * rank 0 = "1" (White's base rank). Rank 3 ("4") is Black's base rank.
 */

export type Color = "w" | "b";
export type PieceType = "K" | "P" | "W" | "F" | "H";
/** Everything that can end up in a reserve (kings are never captured). */
export type DropType = Exclude<PieceType, "K">;
/** A pawn may promote to any of these. */
export type PromotionType = Exclude<PieceType, "K" | "P">;

export interface Piece {
  type: PieceType;
  color: Color;
  /** True for a promoted pawn — it reverts to a pawn when captured. */
  promoted?: boolean;
}

export type Board = (Piece | null)[];
export type Reserve = Record<DropType, number>;

export type Move =
  | { kind: "move"; from: number; to: number; promotion?: PromotionType }
  | { kind: "drop"; piece: DropType; to: number };

export interface HistoryEntry {
  san: string;
  color: Color;
  move: Move;
}

export interface GameState {
  board: Board;
  turn: Color;
  reserves: Record<Color, Reserve>;
  lastMove: Move | null;
  history: HistoryEntry[];
}

export type GameOutcome =
  | { over: false; inCheck: boolean }
  | { over: true; reason: "checkmate"; winner: Color; inCheck: true }
  | { over: true; reason: "stalemate"; winner: null; inCheck: false };

export const FILES = ["a", "b", "c", "d"] as const;
export const RANKS = ["1", "2", "3", "4"] as const;
export const SQUARE_COUNT = 16;
export const DROP_TYPES: DropType[] = ["P", "W", "F", "H"];
export const PROMOTION_TYPES: PromotionType[] = ["W", "F", "H"];

export const PIECE_NAMES: Record<PieceType, string> = {
  K: "King",
  P: "Pawn",
  W: "Wazir",
  F: "Ferz",
  H: "Hors",
};

export const fileOf = (sq: number) => sq % 4;
export const rankOf = (sq: number) => Math.floor(sq / 4);
export const idx = (file: number, rank: number) => rank * 4 + file;
export const onBoard = (file: number, rank: number) =>
  file >= 0 && file < 4 && rank >= 0 && rank < 4;
export const squareName = (sq: number) => `${FILES[fileOf(sq)]}${RANKS[rankOf(sq)]}`;

export function parseSquare(name: string): number {
  const file = FILES.indexOf(name[0] as (typeof FILES)[number]);
  const rank = RANKS.indexOf(name[1] as (typeof RANKS)[number]);
  return idx(file, rank);
}

const KING_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const ORTHO_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIAG_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

const emptyReserve = (): Reserve => ({ P: 0, W: 0, F: 0, H: 0 });

export function createInitialBoard(): Board {
  const board: Board = Array(SQUARE_COUNT).fill(null);
  const put = (square: string, type: PieceType, color: Color) => {
    board[parseSquare(square)] = { type, color };
  };
  // White
  put("a1", "K", "w");
  put("b1", "W", "w");
  put("c1", "H", "w");
  put("d1", "F", "w");
  put("a2", "P", "w");
  // Black
  put("a4", "F", "b");
  put("b4", "H", "b");
  put("c4", "W", "b");
  put("d4", "K", "b");
  put("d3", "P", "b");
  return board;
}

export function createGame(): GameState {
  return {
    board: createInitialBoard(),
    turn: "w",
    reserves: { w: emptyReserve(), b: emptyReserve() },
    lastMove: null,
    history: [],
  };
}

export const pawnDirection = (color: Color) => (color === "w" ? 1 : -1);
export const promotionRank = (color: Color) => (color === "w" ? 3 : 0);

/**
 * Squares a piece may move to. With `attacksOnly`, pawns report only their
 * capture squares (used for check detection).
 */
export function pieceTargets(board: Board, from: number, attacksOnly = false): number[] {
  const piece = board[from];
  if (!piece) return [];

  const file = fileOf(from);
  const rank = rankOf(from);
  const targets: number[] = [];

  const push = (f: number, r: number) => {
    if (!onBoard(f, r)) return;
    const to = idx(f, r);
    const occupant = board[to];
    if (!occupant || occupant.color !== piece.color) targets.push(to);
  };

  switch (piece.type) {
    case "K":
      for (const [df, dr] of KING_DIRS) push(file + df, rank + dr);
      break;
    case "W":
      for (const [df, dr] of ORTHO_DIRS) push(file + df, rank + dr);
      break;
    case "F":
      for (const [df, dr] of DIAG_DIRS) push(file + df, rank + dr);
      break;
    case "H":
      // Xiangqi horse: one orthogonal step, then one diagonal step outward.
      // The orthogonal step may not pass through an occupied square.
      for (const [df, dr] of ORTHO_DIRS) {
        const legFile = file + df;
        const legRank = rank + dr;
        if (!onBoard(legFile, legRank)) continue;
        if (board[idx(legFile, legRank)]) continue; // hobbled
        if (df !== 0) {
          push(file + 2 * df, rank + 1);
          push(file + 2 * df, rank - 1);
        } else {
          push(file + 1, rank + 2 * dr);
          push(file - 1, rank + 2 * dr);
        }
      }
      break;
    case "P": {
      const dr = pawnDirection(piece.color);
      const r = rank + dr;
      if (!onBoard(file, r)) break;
      if (!attacksOnly && !board[idx(file, r)]) targets.push(idx(file, r));
      for (const df of [-1, 1]) {
        const f = file + df;
        if (!onBoard(f, r)) continue;
        const to = idx(f, r);
        const occupant = board[to];
        if (attacksOnly) targets.push(to);
        else if (occupant && occupant.color !== piece.color) targets.push(to);
      }
      break;
    }
  }

  return targets;
}

export function findKing(board: Board, color: Color): number {
  for (let sq = 0; sq < SQUARE_COUNT; sq++) {
    const piece = board[sq];
    if (piece && piece.type === "K" && piece.color === color) return sq;
  }
  return -1;
}

export function isSquareAttacked(board: Board, square: number, by: Color): boolean {
  for (let from = 0; from < SQUARE_COUNT; from++) {
    const piece = board[from];
    if (!piece || piece.color !== by) continue;
    if (pieceTargets(board, from, true).includes(square)) return true;
  }
  return false;
}

export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  return king >= 0 && isSquareAttacked(board, king, color === "w" ? "b" : "w");
}

/** Applies a move to a board copy, ignoring legality. */
function boardAfter(board: Board, move: Move, color: Color): Board {
  const next = board.slice();
  if (move.kind === "drop") {
    next[move.to] = { type: move.piece, color };
    return next;
  }
  const piece = next[move.from];
  if (!piece) return next;
  next[move.from] = null;
  next[move.to] = move.promotion
    ? { type: move.promotion, color: piece.color, promoted: true }
    : piece;
  return next;
}

function isLegal(state: GameState, move: Move): boolean {
  return !isInCheck(boardAfter(state.board, move, state.turn), state.turn);
}

/** Every pseudo-legal move, before filtering out self-checks. */
function pseudoMoves(state: GameState): Move[] {
  const { board, turn } = state;
  const moves: Move[] = [];

  for (let from = 0; from < SQUARE_COUNT; from++) {
    const piece = board[from];
    if (!piece || piece.color !== turn) continue;
    for (const to of pieceTargets(board, from)) {
      if (piece.type === "P" && rankOf(to) === promotionRank(turn)) {
        for (const promotion of PROMOTION_TYPES) moves.push({ kind: "move", from, to, promotion });
      } else {
        moves.push({ kind: "move", from, to });
      }
    }
  }

  const available = DROP_TYPES.filter((type) => state.reserves[turn][type] > 0);
  if (available.length) {
    for (let to = 0; to < SQUARE_COUNT; to++) {
      if (board[to]) continue;
      const rank = rankOf(to);
      for (const type of available) {
        if (type === "P" && (rank === 0 || rank === 3)) continue; // no pawn drops on the back ranks
        moves.push({ kind: "drop", piece: type, to });
      }
    }
  }

  return moves;
}

export function legalMoves(state: GameState): Move[] {
  return pseudoMoves(state).filter((move) => isLegal(state, move));
}

export function getOutcome(state: GameState, moves = legalMoves(state)): GameOutcome {
  const inCheck = isInCheck(state.board, state.turn);
  if (moves.length > 0) return { over: false, inCheck };
  if (inCheck) {
    return {
      over: true,
      reason: "checkmate",
      winner: state.turn === "w" ? "b" : "w",
      inCheck: true,
    };
  }
  return { over: true, reason: "stalemate", winner: null, inCheck: false };
}

export function movesEqual(a: Move, b: Move): boolean {
  if (a.kind === "drop" && b.kind === "drop") return a.piece === b.piece && a.to === b.to;
  if (a.kind === "move" && b.kind === "move") {
    return a.from === b.from && a.to === b.to && a.promotion === b.promotion;
  }
  return false;
}

function notation(state: GameState, move: Move, suffix: string): string {
  const target = squareName(move.to);
  if (move.kind === "drop") return `${move.piece}@${target}${suffix}`;
  const piece = state.board[move.from];
  const captured = Boolean(state.board[move.to]);
  const promo = move.promotion ? `=${move.promotion}` : "";
  if (piece?.type === "P") {
    const prefix = captured ? `${FILES[fileOf(move.from)]}x` : "";
    return `${prefix}${target}${promo}${suffix}`;
  }
  return `${piece?.type ?? ""}${captured ? "x" : ""}${target}${promo}${suffix}`;
}

/** Applies a legal move and returns the resulting state. */
export function applyMove(state: GameState, move: Move): GameState {
  const mover = state.turn;
  const opponent: Color = mover === "w" ? "b" : "w";
  const board = state.board.slice();
  const reserves: Record<Color, Reserve> = {
    w: { ...state.reserves.w },
    b: { ...state.reserves.b },
  };

  if (move.kind === "drop") {
    reserves[mover][move.piece] -= 1;
    board[move.to] = { type: move.piece, color: mover };
  } else {
    const piece = board[move.from];
    if (!piece) return state;
    const captured = board[move.to];
    if (captured && captured.type !== "K") {
      // Promoted pieces revert to pawns when they land in a reserve.
      const banked: DropType = captured.promoted ? "P" : (captured.type as DropType);
      reserves[mover][banked] += 1;
    }
    board[move.from] = null;
    board[move.to] = move.promotion
      ? { type: move.promotion, color: mover, promoted: true }
      : piece;
  }

  const next: GameState = {
    board,
    turn: opponent,
    reserves,
    lastMove: move,
    history: state.history,
  };

  const outcome = getOutcome(next);
  const suffix = outcome.over && outcome.reason === "checkmate" ? "#" : outcome.inCheck ? "+" : "";
  next.history = [...state.history, { san: notation(state, move, suffix), color: mover, move }];

  return next;
}
