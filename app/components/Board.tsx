"use client";

import type { RefObject } from "react";
import {
  FILES,
  RANKS,
  fileOf,
  idx,
  rankOf,
  squareName,
  type Board as BoardArray,
  type Move,
} from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import PieceIcon from "./PieceIcon";

interface BoardProps {
  board: BoardArray;
  theme: BoardTheme;
  boardRef: RefObject<HTMLDivElement | null>;
  targets: Set<number>;
  selectedSquare: number | null;
  dragOriginSquare: number | null;
  checkSquare: number | null;
  lastMove: Move | null;
  disabled: boolean;
  onSquarePointerDown: (event: React.PointerEvent, square: number) => void;
  onSquareActivate: (square: number) => void;
}

export default function Board({
  board,
  theme,
  boardRef,
  targets,
  selectedSquare,
  dragOriginSquare,
  checkSquare,
  lastMove,
  disabled,
  onSquarePointerDown,
  onSquareActivate,
}: BoardProps) {
  const lastFrom = lastMove && lastMove.kind === "move" ? lastMove.from : null;
  const lastTo = lastMove ? lastMove.to : null;

  const squares: number[] = [];
  for (let rank = 3; rank >= 0; rank--) {
    for (let file = 0; file < 4; file++) squares.push(idx(file, rank));
  }

  return (
    <div
      className="w-full select-none rounded-lg p-1.5 shadow-2xl sm:rounded-xl sm:p-2"
      style={{ backgroundColor: theme.frame }}
    >
      <div
        ref={boardRef}
        role="grid"
        aria-label="Tinyhouse board"
        className="grid aspect-square w-full grid-cols-4 grid-rows-4 overflow-hidden rounded-sm"
      >
        {squares.map((square) => {
          const file = fileOf(square);
          const rank = rankOf(square);
          const isDark = (file + rank) % 2 === 0;
          const piece = board[square];
          const isTarget = targets.has(square);
          const isCapture = isTarget && Boolean(piece);
          const isSelected = selectedSquare === square;
          const isLast = square === lastFrom || square === lastTo;
          const isCheck = checkSquare === square;
          const labelColor = isDark ? theme.light : theme.dark;

          return (
            <button
              key={square}
              type="button"
              role="gridcell"
              data-square={square}
              disabled={disabled}
              aria-label={`${squareName(square)}${piece ? ` — ${piece.color === "w" ? "White" : "Black"} ${piece.type}` : " — empty"}`}
              onPointerDown={(event) => onSquarePointerDown(event, square)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSquareActivate(square);
                }
              }}
              className="relative flex items-center justify-center outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset"
              style={{
                backgroundColor: isDark ? theme.dark : theme.light,
                touchAction: "none",
                cursor: disabled ? "default" : piece || isTarget ? "pointer" : "default",
              }}
            >
              {isLast && (
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundColor: theme.lastMove, opacity: 0.42 }}
                />
              )}
              {isCheck && (
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(circle at center, rgba(255,60,60,0.95) 0%, rgba(255,60,60,0.55) 45%, rgba(255,60,60,0) 72%)",
                  }}
                />
              )}
              {isSelected && (
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundColor: theme.selected, opacity: 0.55 }}
                />
              )}

              {piece && (
                <PieceIcon
                  type={piece.type}
                  color={piece.color}
                  theme={theme}
                  className="pointer-events-none relative h-[84%] w-[84%]"
                  style={dragOriginSquare === square ? { opacity: 0.28 } : undefined}
                />
              )}

              {isTarget && !isCapture && (
                <span
                  className="pointer-events-none absolute h-[30%] w-[30%] rounded-full"
                  style={{ backgroundColor: theme.target, opacity: 0.75 }}
                />
              )}
              {isCapture && (
                <span
                  className="pointer-events-none absolute inset-[6%] rounded-full border-[6px]"
                  style={{ borderColor: theme.target, opacity: 0.8 }}
                />
              )}

              {/* Algebraic coordinates along the a-file and the 1st rank */}
              {file === 0 && (
                <span
                  className="pointer-events-none absolute left-1 top-0.5 text-xs font-bold leading-none sm:text-sm"
                  style={{ color: labelColor }}
                >
                  {RANKS[rank]}
                </span>
              )}
              {rank === 0 && (
                <span
                  className="pointer-events-none absolute bottom-0.5 right-1 text-xs font-bold leading-none sm:text-sm"
                  style={{ color: labelColor }}
                >
                  {FILES[file]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
