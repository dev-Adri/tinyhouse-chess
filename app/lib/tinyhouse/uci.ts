/**
 * The wire format shared with the Python engine.
 *
 * - a board move is `from` + `to`, e.g. `c1d3`
 * - a promotion appends the new piece in lower case, e.g. `a3a4h`
 * - a drop is `P@b2`
 */

import {
  FILES,
  RANKS,
  fileOf,
  idx,
  rankOf,
  type DropType,
  type Move,
  type PromotionType,
} from "./engine";

export function squareToUci(square: number): string {
  return `${FILES[fileOf(square)]}${RANKS[rankOf(square)]}`;
}

export function squareFromUci(text: string): number {
  const file = FILES.indexOf(text[0] as (typeof FILES)[number]);
  const rank = RANKS.indexOf(text[1] as (typeof RANKS)[number]);
  if (file < 0 || rank < 0) throw new Error(`bad square: ${text}`);
  return idx(file, rank);
}

export function moveToUci(move: Move): string {
  if (move.kind === "drop") return `${move.piece}@${squareToUci(move.to)}`;
  const base = squareToUci(move.from) + squareToUci(move.to);
  return move.promotion ? base + move.promotion.toLowerCase() : base;
}

export function moveFromUci(text: string): Move {
  if (text.includes("@")) {
    const [piece, target] = text.split("@");
    return { kind: "drop", piece: piece.toUpperCase() as DropType, to: squareFromUci(target) };
  }
  const from = squareFromUci(text.slice(0, 2));
  const to = squareFromUci(text.slice(2, 4));
  if (text.length > 4) {
    return { kind: "move", from, to, promotion: text[4].toUpperCase() as PromotionType };
  }
  return { kind: "move", from, to };
}
