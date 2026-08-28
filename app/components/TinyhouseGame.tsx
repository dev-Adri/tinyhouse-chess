"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  PIECE_NAMES,
  applyMove,
  createGame,
  findKing,
  getOutcome,
  legalMoves,
  type Move,
  type Piece,
} from "@/app/lib/tinyhouse/engine";
import { DEFAULT_THEME_ID, getTheme } from "@/app/lib/tinyhouse/themes";
import Board from "./Board";
import PieceIcon from "./PieceIcon";
import PromotionDialog from "./PromotionDialog";
import ReserveBank from "./ReserveBank";
import ThemePicker from "./ThemePicker";
import { sameSelection, type Selection } from "./types";

const THEME_STORAGE_KEY = "tinyhouse:theme";

interface DragState {
  origin: Selection;
  piece: Piece;
  x: number;
  y: number;
  moved: boolean;
  size: number;
}

/** Theme persistence, read through a store so hydration stays consistent. */
function subscribeToStoredTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

const PIECE_LEGEND: { type: Piece["type"]; text: string }[] = [
  { type: "K", text: "one step in any direction" },
  { type: "P", text: "one step forward, captures diagonally, promotes on the far rank" },
  { type: "W", text: "one step orthogonally" },
  { type: "F", text: "one step diagonally" },
  { type: "H", text: "knight leap, but blocked by a piece on the first step" },
];

export default function TinyhouseGame() {
  const [game, setGame] = useState(createGame);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [promotion, setPromotion] = useState<{ square: number; options: Move[] } | null>(null);
  const [chosenTheme, setChosenTheme] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const storedTheme = useSyncExternalStore(
    subscribeToStoredTheme,
    readStoredTheme,
    () => DEFAULT_THEME_ID,
  );
  const theme = getTheme(chosenTheme ?? storedTheme);

  const selectTheme = useCallback((id: string) => {
    setChosenTheme(id);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // storage unavailable — the choice still applies for this session
    }
  }, []);

  const moves = useMemo(() => legalMoves(game), [game]);
  const outcome = useMemo(() => getOutcome(game, moves), [game, moves]);

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

  const checkSquare = outcome.inCheck ? findKing(game.board, game.turn) : null;
  const locked = outcome.over || promotion !== null;

  const commit = useCallback((candidates: Move[]) => {
    if (candidates.length === 0) return false;
    if (candidates.length > 1) {
      // Only promotions produce several moves to the same square.
      setPromotion({ square: candidates[0].to, options: candidates });
      return true;
    }
    setGame((current) => applyMove(current, candidates[0]));
    setSelection(null);
    return true;
  }, []);

  const pieceForOrigin = useCallback(
    (origin: Selection): Piece | null => {
      if (origin.kind === "square") {
        const piece = game.board[origin.square];
        return piece && piece.color === game.turn ? piece : null;
      }
      return game.reserves[game.turn][origin.piece] > 0
        ? { type: origin.piece, color: game.turn }
        : null;
    },
    [game],
  );

  /** Click / keyboard activation, without dragging. */
  const activate = useCallback(
    (origin: Selection) => {
      if (locked) return;
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
    [locked, selection, targets, selectionMoves, commit, pieceForOrigin, movesForOrigin],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent, origin: Selection) => {
      if (locked || event.button !== 0) return;

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

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [locked, selection, targets, selectionMoves, commit, pieceForOrigin, movesForOrigin],
  );

  const restart = useCallback(() => {
    setGame(createGame());
    setSelection(null);
    setPromotion(null);
    setDrag(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        setPromotion(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const turnName = game.turn === "w" ? "White" : "Black";
  let status: string;
  if (outcome.over && outcome.reason === "checkmate") {
    status = `Checkmate — ${outcome.winner === "w" ? "White" : "Black"} wins`;
  } else if (outcome.over) {
    status = "Stalemate — draw";
  } else {
    status = outcome.inCheck ? `${turnName} is in check` : `${turnName} to move`;
  }

  const historyRows = useMemo(() => {
    const rows: { number: number; white?: string; black?: string }[] = [];
    game.history.forEach((entry, i) => {
      const row = Math.floor(i / 2);
      rows[row] ??= { number: row + 1 };
      if (entry.color === "w") rows[row].white = entry.san;
      else rows[row].black = entry.san;
    });
    return rows;
  }, [game.history]);

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={{ backgroundColor: theme.backdrop, color: theme.label }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <h1 className="text-lg font-black tracking-tight sm:text-xl">Tinyhouse</h1>
          <span
            className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold sm:text-sm"
            style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
            aria-live="polite"
          >
            {!outcome.over && (
              <span
                className="h-2.5 w-2.5 rounded-full border"
                style={{
                  backgroundColor: game.turn === "w" ? theme.whitePiece : theme.blackPiece,
                  borderColor: theme.label,
                }}
              />
            )}
            {status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemePicker theme={theme} onSelect={selectTheme} />
          <button
            type="button"
            onClick={restart}
            className="h-8 shrink-0 rounded-full px-4 text-xs font-bold uppercase tracking-wide transition hover:brightness-110"
            style={{ backgroundColor: theme.accent, color: theme.backdrop }}
          >
            Restart
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-stretch gap-2 px-2 pb-2 sm:flex-row sm:justify-center sm:gap-3 sm:px-3">
        <ReserveBank
          color="b"
          reserve={game.reserves.b}
          theme={theme}
          active={game.turn === "b" && !locked}
          selectedPiece={game.turn === "b" && selection?.kind === "reserve" ? selection.piece : null}
          draggingPiece={drag?.origin.kind === "reserve" ? drag.origin.piece : null}
          onPointerDown={(event, piece) => handlePointerDown(event, { kind: "reserve", piece })}
          onActivate={(piece) => activate({ kind: "reserve", piece })}
        />

        {/* The board is sized from whatever space is left, so it never scrolls. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div className="relative" style={{ width: "min(100cqw, 100cqh)" }}>
            <Board
            board={game.board}
            theme={theme}
            boardRef={boardRef}
            targets={targets}
            selectedSquare={selection?.kind === "square" ? selection.square : null}
            dragOriginSquare={drag?.origin.kind === "square" ? drag.origin.square : null}
            checkSquare={checkSquare}
            lastMove={game.lastMove}
            disabled={outcome.over}
            onSquarePointerDown={(event, square) =>
              handlePointerDown(event, { kind: "square", square })
            }
              onSquareActivate={(square) => activate({ kind: "square", square })}
            />

            {outcome.over && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-black/45 sm:rounded-xl">
                <div
                  className="flex flex-col items-center gap-3 rounded-xl px-6 py-4 text-center shadow-2xl"
                  style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
                >
                  <p className="text-base font-bold sm:text-lg">{status}</p>
                  <button
                    type="button"
                    onClick={restart}
                    className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide"
                    style={{ backgroundColor: theme.accent, color: theme.backdrop }}
                  >
                    New game
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <ReserveBank
          color="w"
          reserve={game.reserves.w}
          theme={theme}
          active={game.turn === "w" && !locked}
          selectedPiece={game.turn === "w" && selection?.kind === "reserve" ? selection.piece : null}
          draggingPiece={drag?.origin.kind === "reserve" ? drag.origin.piece : null}
          onPointerDown={(event, piece) => handlePointerDown(event, { kind: "reserve", piece })}
          onActivate={(piece) => activate({ kind: "reserve", piece })}
        />

        <aside
          className="hidden w-60 shrink-0 flex-col gap-3 self-center overflow-hidden rounded-xl p-3 xl:flex"
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        >
          <div>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide opacity-70">Moves</h2>
            <div className="max-h-64 overflow-y-auto text-sm tabular-nums">
              {historyRows.length === 0 && <p className="opacity-60">No moves yet.</p>}
              {historyRows.map((row) => (
                <div key={row.number} className="flex gap-2 py-0.5">
                  <span className="w-6 opacity-60">{row.number}.</span>
                  <span className="w-16 font-semibold">{row.white ?? ""}</span>
                  <span className="w-16 font-semibold">{row.black ?? ""}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-2" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide opacity-70">Pieces</h2>
            <ul className="flex flex-col gap-1.5 text-xs leading-tight">
              {PIECE_LEGEND.map((item) => (
                <li key={item.type} className="flex items-start gap-2">
                  <PieceIcon
                    type={item.type}
                    color="w"
                    theme={theme}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span>
                    <strong>{PIECE_NAMES[item.type]}</strong> — {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>

      {drag && drag.moved && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.x - drag.size / 2,
            top: drag.y - drag.size / 2,
            width: drag.size,
            height: drag.size,
          }}
        >
          <PieceIcon
            type={drag.piece.type}
            color={drag.piece.color}
            theme={theme}
            className="h-full w-full"
            style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.5))" }}
          />
        </div>
      )}

      {promotion && (
        <PromotionDialog
          color={game.turn}
          square={promotion.square}
          options={promotion.options}
          theme={theme}
          onChoose={(move) => {
            setPromotion(null);
            setGame((current) => applyMove(current, move));
            setSelection(null);
          }}
          onCancel={() => {
            setPromotion(null);
            setSelection(null);
          }}
        />
      )}
    </div>
  );
}
