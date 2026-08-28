"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  FILES,
  RANKS,
  fileOf,
  idx,
  rankOf,
  squareName,
  type Board as BoardArray,
  type Move,
  type Piece,
} from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import { CLASSIFICATION_STYLE } from "@/app/lib/engine/classification";
import type { Classification } from "@/app/lib/engine/types";
import PieceIcon from "./PieceIcon";

/**
 * The engine's suggestion, drawn over the board during a review: an arrow for
 * a board move, or a translucent piece on the square a drop would land on.
 */
export interface BoardArrow {
  from: number | null;
  to: number;
  piece?: Piece | null;
}

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
  /** Black at the bottom. */
  flipped?: boolean;
  arrow?: BoardArrow | null;
  badge?: { square: number; classification: Classification } | null;
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
  flipped = false,
  arrow = null,
  badge = null,
  onSquarePointerDown,
  onSquareActivate,
}: BoardProps) {
  const lastFrom = lastMove && lastMove.kind === "move" ? lastMove.from : null;
  const lastTo = lastMove ? lastMove.to : null;

  const squares: number[] = [];
  const ranks = flipped ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const files = flipped ? [3, 2, 1, 0] : [0, 1, 2, 3];
  for (const rank of ranks) {
    for (const file of files) squares.push(idx(file, rank));
  }

  /** Grid position of a square, in columns/rows from the top left. */
  const place = (square: number): [number, number] => {
    const file = fileOf(square);
    const rank = rankOf(square);
    return [flipped ? 3 - file : file, flipped ? rank : 3 - rank];
  };

  /** Centre of a square in the 0..4 coordinate space of the arrow overlay. */
  const centre = (square: number): [number, number] => {
    const [column, row] = place(square);
    return [column + 0.5, row + 0.5];
  };

  // Slide the piece that just moved in from where it came, so the board reads
  // as motion rather than a jump. Runs on the element already in place, so
  // there is no ghost element to keep in sync.
  const animated = useRef<Move | null>(null);
  useEffect(() => {
    const move = lastMove;
    if (!move || move === animated.current) return;
    animated.current = move;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const grid = boardRef.current;
    const cell = grid?.querySelector<HTMLElement>(`[data-square="${move.to}"]`);
    const piece = cell?.querySelector<HTMLElement>("svg");
    if (!grid || !cell || !piece) return;

    const size = grid.getBoundingClientRect().width / 4;
    const frames: Keyframe[] =
      move.kind === "move"
        ? (() => {
            const [fromColumn, fromRow] = place(move.from);
            const [toColumn, toRow] = place(move.to);
            const dx = (fromColumn - toColumn) * size;
            const dy = (fromRow - toRow) * size;
            return [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }];
          })()
        : [
            { transform: "scale(0.55)", opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ];

    cell.style.zIndex = "30";
    const animation = piece.animate(frames, {
      duration: move.kind === "move" ? 160 : 130,
      easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
    });
    const clear = () => {
      cell.style.zIndex = "";
    };
    animation.finished.then(clear, clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMove, flipped, boardRef]);

  return (
    <div
      className="relative w-full select-none rounded-lg p-1.5 shadow-2xl sm:rounded-xl sm:p-2"
      style={{ backgroundColor: theme.frame }}
    >
      <div
        ref={boardRef}
        role="grid"
        aria-label="Tinyhouse board"
        className="relative grid aspect-square w-full grid-cols-4 grid-rows-4 overflow-hidden rounded-sm"
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

              {/* A suggested drop: show the piece itself, faintly. */}
              {arrow?.from === null && arrow.to === square && arrow.piece && (
                <PieceIcon
                  type={arrow.piece.type}
                  color={arrow.piece.color}
                  theme={theme}
                  className="pointer-events-none absolute h-[80%] w-[80%]"
                  style={{ opacity: 0.45 }}
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

              {badge?.square === square && (
                <span
                  className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-[34%] w-[34%] items-center justify-center rounded-full text-[9px] font-black text-white shadow-md sm:text-xs"
                  style={{ backgroundColor: CLASSIFICATION_STYLE[badge.classification].color }}
                  title={CLASSIFICATION_STYLE[badge.classification].label}
                >
                  {CLASSIFICATION_STYLE[badge.classification].glyph}
                </span>
              )}
            </button>
          );
        })}

        {arrow && arrow.from !== null && (
          <svg
            viewBox="0 0 4 4"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {
              (() => {
                const [x1, y1] = centre(arrow.from as number);
                const [x2, y2] = centre(arrow.to);
                const dx = x2 - x1;
                const dy = y2 - y1;
                const length = Math.hypot(dx, dy) || 1;
                const ux = dx / length;
                const uy = dy / length;
                const head = 0.24;
                const tipX = x2 - ux * 0.06;
                const tipY = y2 - uy * 0.06;
                const baseX = tipX - ux * head;
                const baseY = tipY - uy * head;
                return (
                  <g stroke={theme.target} fill={theme.target} opacity={0.9}>
                    <line
                      x1={x1 + ux * 0.18}
                      y1={y1 + uy * 0.18}
                      x2={baseX}
                      y2={baseY}
                      strokeWidth={0.13}
                      strokeLinecap="round"
                    />
                    <polygon
                      points={[
                        `${tipX},${tipY}`,
                        `${baseX - uy * head * 0.6},${baseY + ux * head * 0.6}`,
                        `${baseX + uy * head * 0.6},${baseY - ux * head * 0.6}`,
                      ].join(" ")}
                      stroke="none"
                    />
                  </g>
                );
              })()
            }
          </svg>
        )}
      </div>
    </div>
  );
}
