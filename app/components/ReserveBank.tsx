"use client";

import {
  DROP_TYPES,
  PIECE_NAMES,
  type Color,
  type DropType,
  type Reserve,
} from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import PieceIcon from "./PieceIcon";

interface ReserveBankProps {
  color: Color;
  reserve: Reserve;
  theme: BoardTheme;
  /** True when this side is to move and may drop. */
  active: boolean;
  selectedPiece: DropType | null;
  draggingPiece: DropType | null;
  onPointerDown: (event: React.PointerEvent, piece: DropType) => void;
  onActivate: (piece: DropType) => void;
}

/**
 * A player's captured pieces. Stacks beside the board on wide screens and sits
 * above/below it on narrow ones, so the board always keeps the tallest slice.
 */
export default function ReserveBank({
  color,
  reserve,
  theme,
  active,
  selectedPiece,
  draggingPiece,
  onPointerDown,
  onActivate,
}: ReserveBankProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-center gap-1 rounded-lg p-1 sm:flex-col sm:gap-1.5 sm:self-center sm:p-1.5"
      style={{
        backgroundColor: theme.surface,
        color: theme.surfaceText,
        outline: active ? `2px solid ${theme.accent}` : "2px solid transparent",
      }}
    >
      <span className="px-1 text-[10px] font-bold uppercase tracking-wide opacity-75">
        {color === "w" ? "White" : "Black"}
      </span>

      {DROP_TYPES.map((type) => {
        const count = reserve[type];
        const usable = active && count > 0;
        const isSelected = selectedPiece === type;
        return (
          <button
            key={type}
            type="button"
            disabled={!usable}
            title={`${PIECE_NAMES[type]} — ${count} available`}
            aria-label={`Drop ${PIECE_NAMES[type]}, ${count} available`}
            onPointerDown={(event) => usable && onPointerDown(event, type)}
            onKeyDown={(event) => {
              if (usable && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onActivate(type);
              }
            }}
            className="relative flex aspect-square w-9 items-center justify-center rounded-md transition sm:w-11"
            style={{
              backgroundColor: isSelected ? theme.selected : "rgba(255,255,255,0.07)",
              opacity: count > 0 ? 1 : 0.28,
              touchAction: "none",
              cursor: usable ? "pointer" : "default",
            }}
          >
            <PieceIcon
              type={type}
              color={color}
              theme={theme}
              className="h-[78%] w-[78%]"
              style={draggingPiece === type ? { opacity: 0.28 } : undefined}
            />
            <span
              className="absolute bottom-0 right-0.5 text-[10px] font-bold tabular-nums"
              style={{ color: isSelected ? theme.frame : theme.surfaceText }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
