import type { DropType } from "@/app/lib/tinyhouse/engine";

/** What the player currently has picked up: a board piece or a reserve piece. */
export type Selection =
  | { kind: "square"; square: number }
  | { kind: "reserve"; piece: DropType };

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "square" && b.kind === "square") return a.square === b.square;
  if (a.kind === "reserve" && b.kind === "reserve") return a.piece === b.piece;
  return false;
}
