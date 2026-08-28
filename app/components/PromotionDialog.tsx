"use client";

import {
  PIECE_NAMES,
  squareName,
  type Color,
  type Move,
  type PromotionType,
} from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import PieceIcon from "./PieceIcon";

interface PromotionDialogProps {
  color: Color;
  square: number;
  options: Move[];
  theme: BoardTheme;
  onChoose: (move: Move) => void;
  onCancel: () => void;
}

export default function PromotionDialog({
  color,
  square,
  options,
  theme,
  onChoose,
  onCancel,
}: PromotionDialogProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose promotion piece"
      onClick={onCancel}
    >
      <div
        className="flex flex-col items-center gap-4 rounded-2xl p-5 shadow-2xl sm:p-6"
        style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-center">
          <h2 className="text-lg font-bold">Promote on {squareName(square)}</h2>
          <p className="text-sm opacity-70">Pick a piece for your pawn.</p>
        </div>

        <div className="flex gap-3">
          {options.map((move) => {
            const type = (move.kind === "move" ? move.promotion : undefined) as PromotionType;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onChoose(move)}
                className="flex aspect-square w-20 flex-col items-center justify-center rounded-xl transition hover:scale-105 sm:w-24"
                style={{ backgroundColor: theme.light }}
              >
                <PieceIcon type={type} color={color} theme={theme} className="h-[70%] w-[70%]" />
                <span className="text-xs font-semibold" style={{ color: theme.frame }}>
                  {PIECE_NAMES[type]}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="text-sm underline underline-offset-4 opacity-75 hover:opacity-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
