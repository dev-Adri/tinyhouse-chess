import type { Classification } from "./types";

export interface ClassificationStyle {
  label: string;
  glyph: string;
  color: string;
}

export const CLASSIFICATION_STYLE: Record<Classification, ClassificationStyle> = {
  best: { label: "Best", glyph: "★", color: "#5fa85f" },
  great: { label: "Great", glyph: "!", color: "#4c9ed9" },
  excellent: { label: "Excellent", glyph: "✓", color: "#8ab84b" },
  good: { label: "Good", glyph: "✓", color: "#a3ab7a" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!", color: "#e6b34c" },
  mistake: { label: "Mistake", glyph: "?", color: "#e08a3c" },
  blunder: { label: "Blunder", glyph: "??", color: "#cf4a3f" },
  forced: { label: "Forced", glyph: "⇢", color: "#98a2ad" },
};

/** Order used for the summary table. */
export const CLASSIFICATION_ORDER: Classification[] = [
  "best",
  "great",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "forced",
];

/** Formats a White-relative score the way a chess site does: `+1.4`, `M3`. */
export function formatScore(centipawns: number, mateIn: number | null): string {
  if (mateIn !== null && mateIn !== 0) {
    return `${mateIn > 0 ? "" : "-"}M${Math.abs(mateIn)}`;
  }
  const pawns = centipawns / 100;
  return `${pawns > 0 ? "+" : pawns < 0 ? "−" : ""}${Math.abs(pawns).toFixed(1)}`;
}

/** Maps a White-relative score to White's share of a 0..1 bar. */
export function evalToShare(centipawns: number, mateIn: number | null): number {
  if (mateIn !== null && mateIn !== 0) return mateIn > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-centipawns / 300));
}
