"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  PIECE_NAMES,
  applyMove,
  createGame,
  findKing,
  getOutcome,
  legalMoves,
  type Color,
  type GameState,
  type Move,
  type Piece,
} from "@/app/lib/tinyhouse/engine";
import { moveFromUci, moveToUci } from "@/app/lib/tinyhouse/uci";
import { DEFAULT_THEME_ID, getTheme } from "@/app/lib/tinyhouse/themes";
import { fetchBestMove, fetchReview } from "@/app/lib/engine/client";
import type { EngineLevel, GameReview } from "@/app/lib/engine/types";
import Board, { type BoardArrow } from "./Board";
import EvalBar from "./EvalBar";
import GameSetup, { type OpponentMode } from "./GameSetup";
import PieceIcon from "./PieceIcon";
import PromotionDialog from "./PromotionDialog";
import ReserveBank from "./ReserveBank";
import ReviewPanel from "./ReviewPanel";
import ThemePicker from "./ThemePicker";
import { sameSelection, type Selection } from "./types";

const THEME_STORAGE_KEY = "tinyhouse:theme";

/** Mirrors the levels the Python engine exposes; refreshed from /health. */
const FALLBACK_LEVELS: EngineLevel[] = [
  { level: 1, name: "Beginner", depth: 1, timeMs: 100 },
  { level: 2, name: "Easy", depth: 2, timeMs: 200 },
  { level: 3, name: "Casual", depth: 3, timeMs: 400 },
  { level: 4, name: "Intermediate", depth: 5, timeMs: 900 },
  { level: 5, name: "Advanced", depth: 7, timeMs: 1800 },
  { level: 6, name: "Master", depth: 24, timeMs: 3500 },
];

interface DragState {
  origin: Selection;
  piece: Piece;
  x: number;
  y: number;
  moved: boolean;
  size: number;
}

const PIECE_LEGEND: { type: Piece["type"]; text: string }[] = [
  { type: "K", text: "one step in any direction" },
  { type: "P", text: "one step forward, captures diagonally, promotes on the far rank" },
  { type: "W", text: "one step orthogonally" },
  { type: "F", text: "one step diagonally" },
  { type: "H", text: "knight leap, but blocked by a piece on the first step" },
];

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

export default function TinyhouseGame() {
  const [game, setGame] = useState(createGame);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [promotion, setPromotion] = useState<{ square: number; options: Move[] } | null>(null);
  const [chosenTheme, setChosenTheme] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Opponent
  const [mode, setMode] = useState<OpponentMode>("human");
  const [level, setLevel] = useState(3);
  const [humanSide, setHumanSide] = useState<Color>("w");
  const [levels, setLevels] = useState<EngineLevel[]>(FALLBACK_LEVELS);
  const [engineError, setEngineError] = useState<string | null>(null);
  /** Bumped by the retry button so the bot effect runs again after a failure. */
  const [retryToken, setRetryToken] = useState(0);

  // Review
  const [review, setReview] = useState<GameReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewPosition, setReviewPosition] = useState(0);

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

  const botSide: Color = humanSide === "w" ? "b" : "w";
  const inReview = review !== null;

  const moves = useMemo(() => legalMoves(game), [game]);
  const outcome = useMemo(() => getOutcome(game, moves), [game, moves]);
  const uciMoves = useMemo(() => game.history.map((entry) => moveToUci(entry.move)), [game.history]);

  /** Every position of the game, for stepping through a review. */
  const positions = useMemo(() => {
    const list: GameState[] = [createGame()];
    let current = list[0];
    for (const entry of game.history) {
      current = applyMove(current, entry.move);
      list.push(current);
    }
    return list;
  }, [game.history]);

  const displayed = inReview ? (positions[reviewPosition] ?? game) : game;
  const displayedOutcome = inReview ? getOutcome(displayed) : outcome;

  const botToMove = mode === "bot" && game.turn === botSide && !outcome.over;
  /** A request is in flight for exactly as long as it is the bot's turn. */
  const thinking = botToMove && !engineError && promotion === null && !inReview;
  const locked = outcome.over || promotion !== null || inReview || botToMove;

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

  const checkSquare = displayedOutcome.inCheck ? findKing(displayed.board, displayed.turn) : null;

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
    setReview(null);
    setReviewPosition(0);
    setEngineError(null);
  }, []);

  // --- engine: the bot's move ------------------------------------------------

  useEffect(() => {
    if (mode !== "bot" || !botToMove || promotion || inReview) return;

    const controller = new AbortController();
    let cancelled = false;

    fetchBestMove(uciMoves, level, controller.signal)
      .then((response) => {
        if (cancelled) return;
        const move = moveFromUci(response.move);
        // Guard against a stale reply landing on a position that moved on.
        setGame((current) => (current === game ? applyMove(current, move) : current));
      })
      .catch((error: Error) => {
        if (!cancelled && error.name !== "AbortError") setEngineError(error.message);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, botToMove, promotion, inReview, uciMoves, level, game, retryToken]);

  // --- engine: the game review ----------------------------------------------

  const startReview = useCallback(async () => {
    if (!uciMoves.length || reviewing) return;
    setReviewing(true);
    setEngineError(null);
    try {
      const report = await fetchReview(uciMoves);
      setReview(report);
      setReviewPosition(report.plies.length);
      setSelection(null);
    } catch (error) {
      setEngineError((error as Error).message);
    } finally {
      setReviewing(false);
    }
  }, [uciMoves, reviewing]);

  const closeReview = useCallback(() => {
    setReview(null);
    setReviewPosition(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        setPromotion(null);
      }
      if (!review) return;
      if (event.key === "ArrowLeft") {
        setReviewPosition((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        setReviewPosition((current) => Math.min(review.plies.length, current + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [review]);

  // Difficulty levels come from the engine when it is reachable.
  useEffect(() => {
    const controller = new AbortController();
    import("@/app/lib/engine/client")
      .then(({ fetchHealth }) => fetchHealth(controller.signal))
      .then((health) => setLevels(health.levels))
      .catch(() => {
        /* engine offline — the fallback list still lets the user pick */
      });
    return () => controller.abort();
  }, []);

  // --- presentation ----------------------------------------------------------

  const turnName = game.turn === "w" ? "White" : "Black";
  let status: string;
  if (outcome.over && outcome.reason === "checkmate") {
    status = `Checkmate — ${outcome.winner === "w" ? "White" : "Black"} wins`;
  } else if (outcome.over && outcome.reason === "stalemate") {
    status = "Stalemate — draw";
  } else if (outcome.over && outcome.reason === "repetition") {
    status = "Draw by repetition";
  } else if (outcome.over) {
    status = "Draw — move limit reached";
  } else if (thinking) {
    status = "Bot is thinking…";
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

  // Review overlays: the engine's suggestion here, and how the last move rated.
  const reviewPly = review?.plies[reviewPosition] ?? null;
  const previousPly = review && reviewPosition > 0 ? review.plies[reviewPosition - 1] : null;
  const arrow: BoardArrow | null = useMemo(() => {
    if (!reviewPly) return null;
    const best = moveFromUci(reviewPly.best_uci);
    return { from: best.kind === "move" ? best.from : null, to: best.to };
  }, [reviewPly]);
  const badge = previousPly
    ? { square: moveFromUci(previousPly.uci).to, classification: previousPly.classification }
    : null;
  const barScore = previousPly
    ? { score: previousPly.eval_after, mate: previousPly.mate_after }
    : review?.plies[0]
      ? { score: review.plies[0].eval_before, mate: review.plies[0].mate_before }
      : { score: 0, mate: null };

  const flipped = mode === "bot" && humanSide === "b";
  const canReview = uciMoves.length >= 2;

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
                className={`h-2.5 w-2.5 rounded-full border ${thinking ? "animate-pulse" : ""}`}
                style={{
                  backgroundColor: game.turn === "w" ? theme.whitePiece : theme.blackPiece,
                  borderColor: theme.label,
                }}
              />
            )}
            {status}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GameSetup
            mode={mode}
            level={level}
            humanSide={humanSide}
            levels={levels}
            theme={theme}
            onModeChange={(next) => {
              setMode(next);
              restart();
            }}
            onLevelChange={setLevel}
            onSideChange={(side) => {
              setHumanSide(side);
              restart();
            }}
          />
          {!inReview && (
            <button
              type="button"
              onClick={startReview}
              disabled={!canReview || reviewing}
              className="h-8 rounded-full px-3 text-xs font-bold uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40"
              style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
            >
              {reviewing ? "Analysing…" : "Review"}
            </button>
          )}
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

      {engineError && (
        <div
          className="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-xs"
          style={{ backgroundColor: "rgba(207,74,63,0.18)", color: theme.label }}
          role="alert"
        >
          <span className="flex-1">{engineError}</span>
          <button
            type="button"
            onClick={() => {
              setEngineError(null);
              setRetryToken((token) => token + 1);
            }}
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: theme.accent, color: theme.backdrop }}
          >
            Retry
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 sm:px-3 xl:flex-row xl:justify-center xl:gap-3">
        {/* Banks and board: a row on all but the narrowest screens. */}
        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:justify-center sm:gap-3">
        <ReserveBank
          color="b"
          reserve={displayed.reserves.b}
          theme={theme}
          active={!locked && game.turn === "b"}
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
          <div
            className="flex items-stretch gap-2"
            style={{ width: inReview ? "min(100cqw, calc(100cqh + 1.75rem))" : "min(100cqw, 100cqh)" }}
          >
            {inReview && (
              <EvalBar
                score={barScore.score}
                mateIn={barScore.mate}
                theme={theme}
                flipped={flipped}
              />
            )}
            <div className="relative min-w-0 flex-1">
            <Board
              board={displayed.board}
              theme={theme}
              boardRef={boardRef}
              targets={targets}
              selectedSquare={selection?.kind === "square" ? selection.square : null}
              dragOriginSquare={drag?.origin.kind === "square" ? drag.origin.square : null}
              checkSquare={checkSquare}
              lastMove={displayed.lastMove}
              disabled={locked}
              flipped={flipped}
              arrow={arrow}
              badge={badge}
              onSquarePointerDown={(event, square) =>
                handlePointerDown(event, { kind: "square", square })
              }
              onSquareActivate={(square) => activate({ kind: "square", square })}
            />

            {outcome.over && !inReview && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-black/45 sm:rounded-xl">
                <div
                  className="flex flex-col items-center gap-3 rounded-xl px-6 py-4 text-center shadow-2xl"
                  style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
                >
                  <p className="text-base font-bold sm:text-lg">{status}</p>
                  <div className="flex gap-2">
                    {canReview && (
                      <button
                        type="button"
                        onClick={startReview}
                        disabled={reviewing}
                        className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide disabled:opacity-50"
                        style={{ backgroundColor: theme.surfaceText, color: theme.surface }}
                      >
                        {reviewing ? "Analysing…" : "Review game"}
                      </button>
                    )}
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
              </div>
            )}
            </div>
          </div>
        </div>

        <ReserveBank
          color="w"
          reserve={displayed.reserves.w}
          theme={theme}
          active={!locked && game.turn === "w"}
          selectedPiece={game.turn === "w" && selection?.kind === "reserve" ? selection.piece : null}
          draggingPiece={drag?.origin.kind === "reserve" ? drag.origin.piece : null}
          onPointerDown={(event, piece) => handlePointerDown(event, { kind: "reserve", piece })}
          onActivate={(piece) => activate({ kind: "reserve", piece })}
        />
        </div>

        <aside
          className={`${inReview ? "flex max-h-[45%] xl:max-h-full" : "hidden xl:flex"} w-full shrink-0 flex-col gap-3 overflow-hidden rounded-xl p-3 xl:w-64 xl:flex xl:self-center`}
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        >
          {review ? (
            <ReviewPanel
              review={review}
              theme={theme}
              position={reviewPosition}
              onSelect={setReviewPosition}
              onClose={closeReview}
            />
          ) : (
            <>
              <div className="min-h-0 flex-1">
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
            </>
          )}
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
