"use client";

import { useCallback, useMemo, useState } from "react";
import type { GameState, Move, Piece } from "@/app/lib/tinyhouse/engine";
import { sameSelection, type Selection } from "./types";

export interface DragState {
  origin: Selection;
  piece: Piece;
  x: number;
  y: number;
  moved: boolean;
  size: number;
}

interface Options {
  /** The position the player is acting in — the live game, or an analysis node. */
  state: GameState;
  /** Legal moves in `state`, passed in so the caller can memoise them once. */
  moves: Move[];
  /** Board is read-only for reasons the caller owns (not your turn, rewound, …). */
  locked: boolean;
  boardRef: React.RefObject<HTMLDivElement | null>;
  /** Called with the move the player settled on. */
  onMove: (move: Move) => void;
}

/**
 * Selecting, dragging and promoting on a board.
 *
 * Kept apart from any particular game so the live board and the analysis board
 * behave identically — they differ only in which position they act on and what
 * happens to the move that comes out.
 */
export function useBoardInteraction({ state, moves, locked, boardRef, onMove }: Options) {
  // The selection is tagged with the position it was made in, so a position
  // that moves on underneath it — a bot reply, a rewind — drops it without an
  // effect having to reach in and clear it.
  const [held, setHeld] = useState<{ state: GameState; origin: Selection } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [promotion, setPromotion] = useState<{ square: number; options: Move[] } | null>(null);

  const selection = held && held.state === state ? held.origin : null;
  const setSelection = useCallback(
    (origin: Selection | null) => setHeld(origin ? { state, origin } : null),
    [state],
  );

  // A promotion dialog is modal: nothing else on the board responds while it is up.
  const blocked = locked || promotion !== null;

  const movesForOrigin = useCallback(
    (origin: Selection) =>
      moves.filter((move) =>
        origin.kind === "square"
          ? move.kind === "move" && move.from === origin.square
          : move.kind === "drop" && move.piece === origin.piece,
      ),
    [moves],
  );

  const selectionMoves = useMemo(
    () => (selection ? movesForOrigin(selection) : []),
    [selection, movesForOrigin],
  );
  const targets = useMemo(() => new Set(selectionMoves.map((m) => m.to)), [selectionMoves]);

  const clear = useCallback(() => {
    setHeld(null);
    setPromotion(null);
    setDrag(null);
  }, []);

  const commit = useCallback(
    (candidates: Move[]) => {
      if (candidates.length === 0) return false;
      if (candidates.length > 1) {
        // Only promotions produce several moves to the same square.
        setPromotion({ square: candidates[0].to, options: candidates });
        return true;
      }
      onMove(candidates[0]);
      setHeld(null);
      return true;
    },
    [onMove],
  );

  const pieceForOrigin = useCallback(
    (origin: Selection): Piece | null => {
      if (origin.kind === "square") {
        const piece = state.board[origin.square];
        return piece && piece.color === state.turn ? piece : null;
      }
      return state.reserves[state.turn][origin.piece] > 0
        ? { type: origin.piece, color: state.turn }
        : null;
    },
    [state],
  );

  /** Click / keyboard activation, without dragging. */
  const activate = useCallback(
    (origin: Selection) => {
      if (blocked) return;
      if (origin.kind === "square" && selection && targets.has(origin.square)) {
        commit(selectionMoves.filter((move) => move.to === origin.square));
        return;
      }
      const piece = pieceForOrigin(origin);
      if (!piece || movesForOrigin(origin).length === 0) {
        setSelection(null);
        return;
      }
      setSelection(sameSelection(selection, origin) ? null : origin);
    },
    [blocked, selection, targets, selectionMoves, commit, pieceForOrigin, movesForOrigin, setSelection],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent, origin: Selection) => {
      if (blocked || event.button !== 0) return;

      // Dropping onto a highlighted destination plays the move immediately.
      if (origin.kind === "square" && selection && targets.has(origin.square)) {
        commit(selectionMoves.filter((move) => move.to === origin.square));
        return;
      }

      const piece = pieceForOrigin(origin);
      const originMoves = piece ? movesForOrigin(origin) : [];
      if (!piece || originMoves.length === 0) {
        setSelection(null);
        return;
      }

      const wasSelected = sameSelection(selection, origin);
      setSelection(origin);

      const rect = boardRef.current?.getBoundingClientRect();
      const size = rect ? rect.width / 4 : 72;
      const startX = event.clientX;
      const startY = event.clientY;
      setDrag({ origin, piece, x: startX, y: startY, moved: false, size });

      let moved = false;
      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 6) {
          moved = true;
        }
        setDrag((current) =>
          current ? { ...current, x: moveEvent.clientX, y: moveEvent.clientY, moved } : current,
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };
      const onUp = (upEvent: PointerEvent) => {
        cleanup();
        setDrag(null);
        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const squareEl = element?.closest("[data-square]");
        const to = squareEl ? Number(squareEl.getAttribute("data-square")) : -1;
        const candidates = originMoves.filter((move) => move.to === to);
        if (candidates.length > 0) {
          commit(candidates);
          return;
        }
        // A plain click keeps the piece selected; re-clicking it clears it.
        if (moved || wasSelected) setSelection(null);
      };
      const onCancel = () => {
        cleanup();
        setDrag(null);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [blocked, selection, targets, selectionMoves, commit, pieceForOrigin, movesForOrigin, boardRef, setSelection],
  );

  const choosePromotion = useCallback(
    (move: Move) => {
      setPromotion(null);
      setHeld(null);
      onMove(move);
    },
    [onMove],
  );

  const cancelPromotion = useCallback(() => {
    setPromotion(null);
    setHeld(null);
  }, []);

  return {
    selection,
    drag,
    promotion,
    targets,
    activate,
    handlePointerDown,
    choosePromotion,
    cancelPromotion,
    clear,
  };
}
