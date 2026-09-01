"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DROP_TYPES,
  SQUARE_COUNT,
  createInitialBoard,
  setupProblem,
  stateFrom,
  type Board,
  type Color,
  type DropType,
  type GameState,
  type Piece,
  type PieceType,
  type Reserve,
} from "@/app/lib/tinyhouse/engine";

export interface SetupPosition {
  board: Board;
  reserves: Record<Color, Reserve>;
  turn: Color;
}

/** What a click on a square does: place this piece, or clear the square. */
export type SetupTool = { kind: "piece"; piece: Piece } | { kind: "erase" };

/** Where a setup drag started. */
type Origin =
  | { kind: "square"; square: number }
  | { kind: "bank"; color: Color; piece: DropType };

export interface SetupDrag {
  piece: Piece;
  x: number;
  y: number;
  moved: boolean;
  size: number;
}

const emptyReserve = (): Reserve => ({ P: 0, W: 0, F: 0, H: 0 });

const emptyReserves = (): Record<Color, Reserve> => ({
  w: emptyReserve(),
  b: emptyReserve(),
});

export const startingSetup = (): SetupPosition => ({
  board: createInitialBoard(),
  reserves: emptyReserves(),
  turn: "w",
});

export const emptySetup = (): SetupPosition => ({
  board: Array(SQUARE_COUNT).fill(null),
  reserves: emptyReserves(),
  turn: "w",
});

/** Kings are never captured, so they are the one thing a drawer cannot hold. */
const bankable = (type: PieceType): type is DropType => DROP_TYPES.includes(type as DropType);

/**
 * The position editor.
 *
 * Anything goes while arranging — pieces move in any direction, both colours,
 * as many as you like. `problem` reports what would stop the position being
 * analysed, and the Analyse button reads it; nothing here enforces the rules.
 */
export function useSetup(initial: SetupPosition = startingSetup()) {
  const [position, setPosition] = useState<SetupPosition>(initial);
  const [tool, setTool] = useState<SetupTool>({ kind: "piece", piece: { type: "P", color: "w" } });
  const [drag, setDrag] = useState<SetupDrag | null>(null);

  const put = useCallback((square: number, piece: Piece | null) => {
    setPosition((current) => {
      const board = current.board.slice();
      board[square] = piece;
      return { ...current, board };
    });
  }, []);

  /** Adds to or takes from a drawer; counts never go below zero. */
  const bank = useCallback((color: Color, piece: DropType, delta: number) => {
    setPosition((current) => {
      const reserves = {
        w: { ...current.reserves.w },
        b: { ...current.reserves.b },
      };
      reserves[color][piece] = Math.max(0, reserves[color][piece] + delta);
      return { ...current, reserves };
    });
  }, []);

  const setTurn = useCallback((turn: Color) => {
    setPosition((current) => ({ ...current, turn }));
  }, []);

  const clear = useCallback(() => setPosition(emptySetup()), []);
  const reset = useCallback(() => setPosition(startingSetup()), []);
  const load = useCallback((next: SetupPosition) => setPosition(next), []);

  /** A click, when no drag happened: apply the current tool. */
  const activateSquare = useCallback(
    (square: number) => {
      put(square, tool.kind === "erase" ? null : { ...tool.piece });
    },
    [put, tool],
  );

  /** A click on a drawer slot: the eraser takes one out, anything else adds one. */
  const activateBank = useCallback(
    (color: Color, piece: DropType) => bank(color, piece, tool.kind === "erase" ? -1 : 1),
    [bank, tool],
  );

  /**
   * Drag, drop and — the point of it — dragging a piece off the board, which
   * banks it the way capturing it would: to the other side's drawer, reverting
   * a promoted piece to the pawn it started as.
   */
  const handlePointerDown = useCallback(
    (event: React.PointerEvent, origin: Origin, boardWidth: number) => {
      if (event.button !== 0) return;

      const piece =
        origin.kind === "square"
          ? position.board[origin.square]
          : { type: origin.piece as PieceType, color: origin.color };
      if (!piece) {
        // An empty square with a tool selected: place immediately.
        if (origin.kind === "square") activateSquare(origin.square);
        return;
      }
      if (origin.kind === "bank" && position.reserves[origin.color][origin.piece] === 0) {
        activateBank(origin.color, origin.piece);
        return;
      }

      const size = boardWidth ? boardWidth / 4 : 72;
      const startX = event.clientX;
      const startY = event.clientY;
      setDrag({ piece, x: startX, y: startY, moved: false, size });

      let moved = false;
      const onMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 6) {
          moved = true;
        }
        setDrag((current) =>
          current ? { ...current, x: moveEvent.clientX, y: moveEvent.clientY, moved } : current,
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };
      const onUp = (upEvent: PointerEvent) => {
        cleanup();
        setDrag(null);

        if (!moved) {
          if (origin.kind === "square") activateSquare(origin.square);
          else activateBank(origin.color, origin.piece);
          return;
        }

        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const squareEl = element?.closest("[data-square]");
        const bankEl = element?.closest("[data-bank]");
        const target = squareEl ? Number(squareEl.getAttribute("data-square")) : null;
        const bankColor = bankEl?.getAttribute("data-bank") as Color | null;

        setPosition((current) => {
          const board = current.board.slice();
          const reserves = {
            w: { ...current.reserves.w },
            b: { ...current.reserves.b },
          };

          // Lift the piece out of wherever it came from.
          if (origin.kind === "square") board[origin.square] = null;
          else reserves[origin.color][origin.piece] = Math.max(0, reserves[origin.color][origin.piece] - 1);

          if (target !== null) {
            board[target] = { ...piece };
          } else if (bankColor === "w" || bankColor === "b") {
            // Dropped straight onto a drawer: it goes in that one.
            if (bankable(piece.type)) reserves[bankColor][piece.type] += 1;
          } else if (origin.kind === "square" && bankable(piece.type)) {
            // Dragged off the board entirely — captured, so it lands in the
            // other side's drawer, as a pawn again if it had promoted.
            const captor: Color = piece.color === "w" ? "b" : "w";
            reserves[captor][piece.promoted ? "P" : piece.type] += 1;
          }

          return { ...current, board, reserves };
        });
      };
      const onCancel = () => {
        cleanup();
        setDrag(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [position, activateSquare, activateBank],
  );

  const state: GameState = useMemo(
    () => stateFrom(position.board, position.reserves, position.turn),
    [position],
  );
  const problem = useMemo(() => setupProblem(state), [state]);

  return {
    position,
    state,
    problem,
    tool,
    setTool,
    drag,
    put,
    bank,
    setTurn,
    clear,
    reset,
    load,
    activateSquare,
    activateBank,
    handlePointerDown,
  };
}
