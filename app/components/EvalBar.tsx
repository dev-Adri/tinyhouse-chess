"use client";

import { evalToShare, formatScore } from "@/app/lib/engine/classification";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";

interface EvalBarProps {
  /** Centipawns from White's point of view. */
  score: number;
  mateIn: number | null;
  theme: BoardTheme;
  flipped?: boolean;
}

export default function EvalBar({ score, mateIn, theme, flipped = false }: EvalBarProps) {
  const share = evalToShare(score, mateIn);
  const whitePercent = Math.round(share * 100);
  const label = formatScore(score, mateIn);

  return (
    <div
      className="flex w-5 shrink-0 flex-col overflow-hidden rounded-md sm:w-6"
      style={{ backgroundColor: theme.blackPiece }}
      title={`Evaluation: ${label}`}
      aria-label={`Evaluation ${label}`}
    >
      {/* The white share grows from the side the white pieces are on. */}
      <div className={`flex min-h-0 w-full flex-1 flex-col ${flipped ? "" : "justify-end"}`}>
        <div
          className="w-full transition-[height] duration-300"
          style={{ height: `${whitePercent}%`, backgroundColor: theme.whitePiece }}
        />
      </div>
      <span
        className="w-full shrink-0 py-0.5 text-center text-[9px] font-bold tabular-nums"
        style={{
          backgroundColor: score >= 0 ? theme.whitePiece : theme.blackPiece,
          color: score >= 0 ? theme.blackPiece : theme.whitePiece,
        }}
      >
        {label}
      </span>
    </div>
  );
}
