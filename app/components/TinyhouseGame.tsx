"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  PIECE_NAMES,
  applyMove,
  createGame,
  findKing,
  getOutcome,
  legalMoves,
  movesEqual,
  toFen,
  type Color,
  type GameState,
  type Move,
  type Piece,
} from "@/app/lib/tinyhouse/engine";
import { moveFromUci, moveToUci } from "@/app/lib/tinyhouse/uci";
import { DEFAULT_THEME_ID, getTheme } from "@/app/lib/tinyhouse/themes";
import {
  THEME_STORAGE_KEY,
  clearStored,
  loadAnalysis,
  loadGame,
  saveAnalysis,
  saveGame,
} from "@/app/lib/tinyhouse/storage";
import { createTree, mainLine, treeFromHistory } from "@/app/lib/tinyhouse/variations";
import { fetchBestMove, fetchReview } from "@/app/lib/engine/client";
import { toWhiteRelative } from "@/app/lib/engine/classification";
import type { EngineLevel, GameReview } from "@/app/lib/engine/types";
import AnalysisPanel from "./AnalysisPanel";
import Board, { type BoardArrow } from "./Board";
import BoardNav from "./BoardNav";
import EvalBar from "./EvalBar";
import MatchPanel, { type OpponentMode } from "./MatchPanel";
import MoveTreeList from "./MoveTreeList";
import PieceIcon from "./PieceIcon";
import PromotionDialog from "./PromotionDialog";
import ReserveBank from "./ReserveBank";
import ReviewPanel from "./ReviewPanel";
import SetupPanel from "./SetupPanel";
import { useAnalysis } from "./useAnalysis";
import { useBoardInteraction } from "./useBoardInteraction";
import { useSetup } from "./useSetup";

/** Mirrors the levels the Python engine exposes; refreshed from /health. */
const FALLBACK_LEVELS: EngineLevel[] = [
  { level: 1, name: "Beginner", depth: 1, timeMs: 100 },
  { level: 2, name: "Easy", depth: 2, timeMs: 200 },
  { level: 3, name: "Casual", depth: 3, timeMs: 400 },
  { level: 4, name: "Intermediate", depth: 5, timeMs: 900 },
  { level: 5, name: "Advanced", depth: 7, timeMs: 1800 },
  { level: 6, name: "Master", depth: 24, timeMs: 3500 },
];

const EMPTY_TARGETS: Set<number> = new Set();

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
  const [chosenTheme, setChosenTheme] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Opponent. Settings are chosen before a match and fixed while it runs.
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<OpponentMode>("human");
  const [level, setLevel] = useState(3);
  const [humanSide, setHumanSide] = useState<Color>("w");
  const [levels, setLevels] = useState<EngineLevel[]>(FALLBACK_LEVELS);
  const [engineError, setEngineError] = useState<string | null>(null);
  /** Bumped by the retry button so the bot effect runs again after a failure. */
  const [retryToken, setRetryToken] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Analysis has no fixed orientation, so it gets a manual flip. */
  const [flipBoard, setFlipBoard] = useState(false);

  // Review
  const [review, setReview] = useState<GameReview | null>(null);
  const [reviewing, setReviewing] = useState(false);

  /**
   * How far into the live game the board is showing: 0 is the starting
   * position, history.length is the position actually being played. Doubles as
   * the review cursor, so there is only ever one place to look.
   *
   * The ply is stored together with the history length it was chosen against.
   * When a move lands — the player's or the bot's — the lengths stop matching
   * and the view falls back to the live position, so looking back never hides
   * what just happened.
   */
  const [view, setView] = useState({ at: 0, of: 0 });

  /** Move count of a game picked back up from storage, for the notice. */
  const [restored, setRestored] = useState<number | null>(null);
  const hydrated = useRef(false);

  const analysisMode = mode === "analysis";
  const analysis = useAnalysis(analysisMode);

  /**
   * The analysis tab opens on the position editor: pieces go anywhere, in any
   * number, either colour, with no turn order. Pressing Analyse hands the
   * result to the tree, and from then on only legal moves are playable.
   */
  const [editing, setEditing] = useState(false);
  const setup = useSetup();
  const setupMode = analysisMode && editing;

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

  // --- the live game ---------------------------------------------------------

  const botSide: Color = humanSide === "w" ? "b" : "w";
  const liveMoves = useMemo(() => legalMoves(game), [game]);
  const outcome = useMemo(() => getOutcome(game, liveMoves), [game, liveMoves]);
  const uciMoves = useMemo(() => game.history.map((entry) => moveToUci(entry.move)), [game.history]);

  /** Every position of the game, for stepping back through it. */
  const positions = useMemo(() => {
    const list: GameState[] = [createGame()];
    let current = list[0];
    for (const entry of game.history) {
      current = applyMove(current, entry.move);
      list.push(current);
    }
    return list;
  }, [game.history]);

  const viewPly = view.of === game.history.length ? view.at : game.history.length;
  const setViewPly = useCallback(
    (ply: number) => setView({ at: ply, of: game.history.length }),
    [game.history.length],
  );

  const inReview = review !== null && !analysisMode;
  const rewound = viewPly < game.history.length;
  const displayedLive = positions[viewPly] ?? game;

  const botToMove = started && mode === "bot" && game.turn === botSide && !outcome.over;

  // --- what the player can act on -------------------------------------------

  const rewoundMoves = useMemo(
    () => (rewound ? legalMoves(displayedLive) : []),
    [rewound, displayedLive],
  );

  const active = analysisMode ? analysis.state : rewound ? displayedLive : game;
  const activeMoves = analysisMode ? analysis.moves : rewound ? rewoundMoves : liveMoves;

  /**
   * Reviewing, or looking at a finished game, a move is not a continuation but
   * a question: what if this had been played instead? Those moves open the
   * analysis board branching from the position on screen, with the game as
   * played kept as the main line.
   *
   * While a game is still running the rewound board stays read-only — a move
   * there would be ambiguous about whether it counted.
   */
  const branching = !analysisMode && (inReview || outcome.over);

  const locked = !analysisMode && !branching && (!started || botToMove || rewound);

  /** Hands the played game to the analysis board, optionally playing one move. */
  const openAnalysis = useCallback(
    (ply: number, firstMove?: Move) => {
      const tree = treeFromHistory(game.history);
      const line = mainLine(tree);
      const cursor = line[Math.max(0, Math.min(ply, line.length - 1))];
      analysis.load(tree, cursor, firstMove);
      // The report is kept rather than cleared: `inReview` already yields to
      // analysis mode, and holding it means going back costs nothing later.
      setEditing(false);
      setMode("analysis");
      setStarted(true);
      setSettingsOpen(false);
    },
    [game.history, analysis],
  );

  const handleMove = useCallback(
    (move: Move) => {
      if (analysisMode) {
        analysis.play(move);
        return;
      }
      if (branching) {
        openAnalysis(viewPly, move);
        return;
      }
      setGame((current) => applyMove(current, move));
    },
    [analysisMode, analysis, branching, openAnalysis, viewPly],
  );

  const interaction = useBoardInteraction({
    state: active,
    moves: activeMoves,
    locked,
    boardRef,
    onMove: handleMove,
  });

  /** A request is in flight for exactly as long as it is the bot's turn. */
  const thinking = botToMove && !engineError && interaction.promotion === null && !inReview;

  const resetBoard = useCallback(() => {
    setGame(createGame());
    setReview(null);
    setEngineError(null);
    interaction.clear();
  }, [interaction]);

  /** Begin a match with the settings currently chosen. */
  const startMatch = useCallback(() => {
    resetBoard();
    if (mode === "analysis") {
      analysis.reset();
      setup.reset();
      setEditing(true);
    }
    setStarted(true);
  }, [resetBoard, mode, analysis, setup]);

  /** Back to the setup screen, where the settings can be changed again. */
  const newMatch = useCallback(() => {
    resetBoard();
    analysis.reset();
    setStarted(false);
    setRestored(null);
    clearStored("game");
    clearStored("analysis");
  }, [resetBoard, analysis]);

  // --- persistence -----------------------------------------------------------

  // Restoring has to happen after mount and has to write state: localStorage
  // does not exist while rendering on the server, so reading it during render
  // would make the first client render disagree with the server's. It runs
  // once, before anything is on screen, so there is no cascade to speak of.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedAnalysis = loadAnalysis();
    // A hand-built start position is worth restoring even before a move is
    // played on it — otherwise arranging a board and refreshing loses it.
    const hasAnalysis =
      storedAnalysis !== null &&
      (storedAnalysis.tree.nodes[storedAnalysis.tree.root].children.length > 0 ||
        toFen(storedAnalysis.tree.start) !== toFen(createGame()));
    if (hasAnalysis) {
      analysis.load(storedAnalysis!.tree, storedAnalysis!.cursor);
    }

    const stored = loadGame();
    if (stored && (stored.started || stored.game.history.length > 0)) {
      setGame(stored.game);
      setMode(stored.mode);
      setLevel(stored.level);
      setHumanSide(stored.humanSide);
      setStarted(stored.started);
      setRestored(stored.game.history.length);
      if (stored.mode === "analysis" && !hasAnalysis) setEditing(true);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated.current) return;
    if (!started && game.history.length === 0) return;
    const timer = setTimeout(() => saveGame({ game, mode, level, humanSide, started }), 300);
    return () => clearTimeout(timer);
  }, [game, mode, level, humanSide, started]);

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => saveAnalysis(analysis.tree, analysis.cursor), 300);
    return () => clearTimeout(timer);
  }, [analysis.tree, analysis.cursor]);

  // --- engine: the bot's move ------------------------------------------------

  useEffect(() => {
    if (mode !== "bot" || !botToMove || interaction.promotion || inReview) return;

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
  }, [mode, botToMove, interaction.promotion, inReview, uciMoves, level, game, retryToken]);

  // --- engine: the game review ----------------------------------------------

  const startReview = useCallback(async () => {
    if (!uciMoves.length || reviewing) return;
    setReviewing(true);
    setEngineError(null);
    try {
      const report = await fetchReview(uciMoves);
      setReview(report);
      setViewPly(report.plies.length);
      interaction.clear();
    } catch (error) {
      setEngineError((error as Error).message);
    } finally {
      setReviewing(false);
    }
  }, [uciMoves, reviewing, interaction, setViewPly]);

  const closeReview = useCallback(() => {
    setReview(null);
    setViewPly(game.history.length);
  }, [game.history.length, setViewPly]);

  // --- navigation ------------------------------------------------------------

  const lastPly = inReview && review ? review.plies.length : game.history.length;
  const stepBack = useCallback(
    () => setViewPly(Math.max(0, viewPly - 1)),
    [viewPly, setViewPly],
  );
  const stepForward = useCallback(
    () => setViewPly(Math.min(lastPly, viewPly + 1)),
    [viewPly, lastPly, setViewPly],
  );
  const toStart = useCallback(() => setViewPly(0), [setViewPly]);
  const toLive = useCallback(() => setViewPly(lastPly), [lastPly, setViewPly]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        interaction.clear();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (setupMode) return;
      const back = event.key === "ArrowLeft";
      if (analysisMode) {
        if (back) analysis.back();
        else analysis.forward();
        return;
      }
      if (back) stepBack();
      else stepForward();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [analysisMode, setupMode, analysis, stepBack, stepForward, interaction]);

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

  // --- the live game as a tree, so one move list serves both boards ---------

  const liveTree = useMemo(() => treeFromHistory(game.history), [game.history]);
  const liveLine = useMemo(() => mainLine(liveTree), [liveTree]);
  const liveCursor = liveLine[Math.min(viewPly, liveLine.length - 1)] ?? liveTree.root;
  const selectLivePly = useCallback(
    (nodeId: string) => {
      const index = liveLine.indexOf(nodeId);
      if (index >= 0) setViewPly(index);
    },
    [liveLine, setViewPly],
  );

  // --- presentation ----------------------------------------------------------

  const displayed = analysisMode ? analysis.state : displayedLive;
  const displayedOutcome = useMemo(() => {
    if (analysisMode) return analysis.outcome;
    if (rewound || inReview) return getOutcome(displayedLive);
    return outcome;
  }, [analysisMode, analysis.outcome, rewound, inReview, displayedLive, outcome]);

  const turnName = active.turn === "w" ? "White" : "Black";
  let status: string;
  if (setupMode) {
    status = "Arrange the position";
  } else if (analysisMode) {
    status = analysis.outcome.over ? "Line ends here" : `${turnName} to move`;
  } else if (outcome.over && outcome.reason === "checkmate") {
    status = `Checkmate — ${outcome.winner === "w" ? "White" : "Black"} wins`;
  } else if (outcome.over && outcome.reason === "stalemate") {
    status = "Stalemate — draw";
  } else if (outcome.over && outcome.reason === "repetition") {
    status = "Draw by repetition";
  } else if (outcome.over) {
    status = "Draw — move limit reached";
  } else if (thinking) {
    status = "Bot is thinking…";
  } else if (rewound) {
    status = `Move ${viewPly} of ${game.history.length}`;
  } else {
    status = outcome.inCheck ? `${turnName} is in check` : `${turnName} to move`;
  }

  // Review overlays: the engine's suggestion here, and how the last move rated.
  const reviewPly = review?.plies[viewPly] ?? null;
  const previousPly = review && viewPly > 0 ? review.plies[viewPly - 1] : null;

  const arrow: BoardArrow | null = useMemo(() => {
    const uci = analysisMode
      ? (analysis.analysis?.lines[0]?.uci ?? null)
      : (reviewPly?.best_uci ?? null);
    if (!uci) return null;
    const best = moveFromUci(uci);
    if (best.kind === "move") return { from: best.from, to: best.to };
    // A suggested drop has no origin square, so show the piece itself.
    return {
      from: null,
      to: best.to,
      piece: {
        type: best.piece,
        color: analysisMode ? analysis.state.turn : (reviewPly?.color ?? "w"),
      },
    };
  }, [analysisMode, analysis.analysis, analysis.state.turn, reviewPly]);

  const badge =
    !analysisMode && previousPly
      ? { square: moveFromUci(previousPly.uci).to, classification: previousPly.classification }
      : null;

  const barScore = useMemo(() => {
    if (analysisMode) {
      if (!analysis.analysis) return { score: 0, mate: null as number | null };
      const view = toWhiteRelative(
        analysis.analysis.stm,
        analysis.analysis.score,
        analysis.analysis.mateIn,
      );
      return { score: view.score, mate: view.mateIn };
    }
    if (previousPly) return { score: previousPly.eval_after, mate: previousPly.mate_after };
    if (review?.plies[0]) {
      return { score: review.plies[0].eval_before, mate: review.plies[0].mate_before };
    }
    return { score: 0, mate: null as number | null };
  }, [analysisMode, analysis.analysis, previousPly, review]);

  /**
   * Branches on one of the engine's review suggestions — "play what it says
   * instead of what I did". `ply` is the position the move is played from,
   * which for "best was…" is the position *before* the move that was played.
   */
  const playSuggestion = useCallback(
    (ply: number, uci: string) => {
      const from = positions[ply];
      if (!from) return;
      const wanted = moveFromUci(uci);
      const move = legalMoves(from).find((candidate) => movesEqual(candidate, wanted));
      if (move) openAnalysis(ply, move);
    },
    [positions, openAnalysis],
  );

  const playAnalysisLine = useCallback(
    (uci: string) => {
      const wanted = moveFromUci(uci);
      const legal = analysis.moves.find((candidate) => movesEqual(candidate, wanted));
      if (legal) analysis.play(legal);
    },
    [analysis],
  );

  /** Leaves the editor and hands the arranged position to the analysis tree. */
  const analyseSetup = useCallback(() => {
    if (setup.problem) return;
    analysis.load(createTree(setup.state));
    setEditing(false);
  }, [setup.problem, setup.state, analysis]);

  /** Back to the editor, seeded with whatever is on the analysis board now. */
  const editPosition = useCallback(() => {
    setup.load({
      board: analysis.state.board.slice(),
      reserves: {
        w: { ...analysis.state.reserves.w },
        b: { ...analysis.state.reserves.b },
      },
      turn: analysis.state.turn,
    });
    setEditing(true);
  }, [setup, analysis.state]);

  const checkSquare =
    !setupMode && displayedOutcome.inCheck ? findKing(displayed.board, displayed.turn) : null;
  const flipped = analysisMode ? flipBoard : mode === "bot" && humanSide === "b";
  const canReview = uciMoves.length >= 2 && !analysisMode;
  const showSidePanel = inReview || analysisMode;
  /** No evaluation to show while the position is still being arranged. */
  const showEvalBar = inReview || (analysisMode && !editing);
  const boardPosition = setupMode ? setup.state : displayed;
  const banks = setupMode ? setup.position.reserves : displayed.reserves;
  const ghost = setupMode ? setup.drag : interaction.drag;
  const boardWidth = () => boardRef.current?.getBoundingClientRect().width ?? 0;
  const cursorNode = analysis.tree.nodes[analysis.cursor];

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
            {!setupMode && !displayedOutcome.over && (
              <span
                className={`h-2.5 w-2.5 rounded-full border ${thinking ? "animate-pulse" : ""}`}
                style={{
                  backgroundColor: active.turn === "w" ? theme.whitePiece : theme.blackPiece,
                  borderColor: theme.label,
                }}
              />
            )}
            {status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {analysisMode && (
            <button
              type="button"
              onClick={() => setFlipBoard((current) => !current)}
              className="rounded-full px-3 py-1 text-xs font-bold"
              style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
            >
              Flip
            </button>
          )}
          <span className="text-xs opacity-60 sm:text-sm">
            {analysisMode
              ? "Analysis"
              : mode === "bot"
                ? `vs ${levels.find((entry) => entry.level === level)?.name ?? "Bot"}`
                : "2 players"}
          </span>
        </div>
      </header>

      {restored !== null && (
        <div
          className="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-xs"
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
          role="status"
        >
          <span className="flex-1">
            Resumed your game ({restored} {restored === 1 ? "move" : "moves"}).
          </span>
          <button
            type="button"
            onClick={() => setRestored(null)}
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          >
            Keep
          </button>
          <button
            type="button"
            onClick={newMatch}
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: theme.accent, color: theme.backdrop }}
          >
            Discard
          </button>
        </div>
      )}

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

      <main className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 md:flex-row md:gap-3 md:px-3">
        <MatchPanel
          theme={theme}
          mode={mode}
          level={level}
          humanSide={humanSide}
          levels={levels}
          started={started}
          canReview={canReview}
          reviewing={reviewing}
          inReview={inReview}
          canAnalyse={game.history.length > 0}
          open={settingsOpen}
          onToggle={() => setSettingsOpen((current) => !current)}
          onModeChange={(next) => {
            setMode(next);
            if (next === "analysis") {
              setup.reset();
              setEditing(true);
            }
          }}
          onLevelChange={setLevel}
          onSideChange={setHumanSide}
          onStart={() => {
            setSettingsOpen(false);
            startMatch();
          }}
          onNewMatch={() => {
            setSettingsOpen(false);
            newMatch();
          }}
          onReview={() => {
            setSettingsOpen(false);
            startReview();
          }}
          onAnalyse={() => openAnalysis(viewPly)}
          onThemeSelect={selectTheme}
        />

        {/* Board and reserves, sized from the space that is left so the page
            never scrolls. The extra width covers the two banks and the eval
            bar, which keeps them tight against the board. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
          style={{ containerType: "size" }}
        >
          <div
            className={`flex flex-col items-stretch gap-2 sm:flex-row ${
              showEvalBar
                ? "[--extra:-6.5rem] sm:[--extra:10rem]"
                : "[--extra:-6.5rem] sm:[--extra:8rem]"
            }`}
            style={{ width: "min(100cqw, calc(100cqh + var(--extra)))" }}
          >
            {showEvalBar && (
              <EvalBar
                score={barScore.score}
                mateIn={barScore.mate}
                theme={theme}
                flipped={flipped}
              />
            )}

            <ReserveBank
              color="b"
              reserve={banks.b}
              theme={theme}
              editable={setupMode}
              active={setupMode ? setup.position.turn === "b" : !locked && active.turn === "b"}
              selectedPiece={
                !setupMode && active.turn === "b" && interaction.selection?.kind === "reserve"
                  ? interaction.selection.piece
                  : null
              }
              draggingPiece={
                !setupMode && interaction.drag?.origin.kind === "reserve"
                  ? interaction.drag.origin.piece
                  : null
              }
              onPointerDown={(event, piece) =>
                setupMode
                  ? setup.handlePointerDown(event, { kind: "bank", color: "b", piece }, boardWidth())
                  : interaction.handlePointerDown(event, { kind: "reserve", piece })
              }
              onActivate={(piece) =>
                setupMode
                  ? setup.activateBank("b", piece)
                  : interaction.activate({ kind: "reserve", piece })
              }
            />

            <div className="relative min-w-0 flex-1">
              <Board
                board={boardPosition.board}
                theme={theme}
                boardRef={boardRef}
                targets={setupMode ? EMPTY_TARGETS : interaction.targets}
                selectedSquare={
                  !setupMode && interaction.selection?.kind === "square"
                    ? interaction.selection.square
                    : null
                }
                dragOriginSquare={
                  !setupMode && interaction.drag?.origin.kind === "square"
                    ? interaction.drag.origin.square
                    : null
                }
                checkSquare={checkSquare}
                lastMove={setupMode ? null : displayed.lastMove}
                disabled={setupMode ? false : locked}
                flipped={flipped}
                arrow={setupMode ? null : arrow}
                badge={setupMode ? null : badge}
                onSquarePointerDown={(event, square) =>
                  setupMode
                    ? setup.handlePointerDown(event, { kind: "square", square }, boardWidth())
                    : interaction.handlePointerDown(event, { kind: "square", square })
                }
                onSquareActivate={(square) =>
                  setupMode
                    ? setup.activateSquare(square)
                    : interaction.activate({ kind: "square", square })
                }
              />

              {outcome.over && !inReview && !analysisMode && !rewound && (
                <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-black/45 sm:rounded-xl">
                  <div
                    className="flex flex-col items-center gap-3 rounded-xl px-6 py-4 text-center shadow-2xl"
                    style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
                  >
                    <p className="text-base font-bold sm:text-lg">{status}</p>
                    <div className="flex flex-wrap justify-center gap-2">
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
                        onClick={() => openAnalysis(game.history.length)}
                        className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide"
                        style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
                      >
                        Analyse
                      </button>
                      <button
                        type="button"
                        onClick={startMatch}
                        className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide"
                        style={{ backgroundColor: theme.accent, color: theme.backdrop }}
                      >
                        Rematch
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!started && !analysisMode && (
                <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-black/50 sm:rounded-xl">
                  <button
                    type="button"
                    onClick={startMatch}
                    className="rounded-xl px-6 py-3 text-sm font-black uppercase tracking-wide shadow-2xl transition hover:brightness-110"
                    style={{ backgroundColor: theme.accent, color: theme.backdrop }}
                  >
                    Start match
                  </button>
                </div>
              )}
            </div>

            <ReserveBank
              color="w"
              reserve={banks.w}
              theme={theme}
              editable={setupMode}
              active={setupMode ? setup.position.turn === "w" : !locked && active.turn === "w"}
              selectedPiece={
                !setupMode && active.turn === "w" && interaction.selection?.kind === "reserve"
                  ? interaction.selection.piece
                  : null
              }
              draggingPiece={
                !setupMode && interaction.drag?.origin.kind === "reserve"
                  ? interaction.drag.origin.piece
                  : null
              }
              onPointerDown={(event, piece) =>
                setupMode
                  ? setup.handlePointerDown(event, { kind: "bank", color: "w", piece }, boardWidth())
                  : interaction.handlePointerDown(event, { kind: "reserve", piece })
              }
              onActivate={(piece) =>
                setupMode
                  ? setup.activateBank("w", piece)
                  : interaction.activate({ kind: "reserve", piece })
              }
            />
          </div>
        </div>

        <aside
          className={`${
            showSidePanel ? "flex max-h-[45%] md:max-h-full" : "hidden xl:flex"
          } w-full shrink-0 flex-col gap-3 overflow-hidden rounded-xl p-3 md:w-52 xl:w-64 xl:flex xl:self-center`}
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        >
          {setupMode ? (
            <SetupPanel
              theme={theme}
              tool={setup.tool}
              onToolChange={setup.setTool}
              turn={setup.position.turn}
              onTurnChange={setup.setTurn}
              problem={setup.problem}
              onAnalyse={analyseSetup}
              onClear={setup.clear}
              onReset={setup.reset}
            />
          ) : analysisMode ? (
            <AnalysisPanel
              theme={theme}
              analysis={analysis.analysis}
              analysing={analysis.analysing}
              analysisError={analysis.analysisError}
              outcome={analysis.outcome}
              tree={analysis.tree}
              cursor={analysis.cursor}
              onSelect={analysis.goTo}
              onPromote={analysis.promote}
              onDelete={analysis.deleteNode}
              onPlayLine={playAnalysisLine}
              onStart={analysis.toStart}
              onBack={analysis.back}
              onForward={analysis.forward}
              onEnd={analysis.toEnd}
              canBack={Boolean(cursorNode?.parent)}
              canForward={Boolean(cursorNode?.children.length)}
              onEditPosition={editPosition}
            />
          ) : review ? (
            <ReviewPanel
              review={review}
              theme={theme}
              position={viewPly}
              onSelect={setViewPly}
              onPlay={playSuggestion}
              onClose={closeReview}
            />
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wide opacity-70">Moves</h2>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <MoveTreeList
                    tree={liveTree}
                    cursor={liveCursor}
                    theme={theme}
                    onSelect={selectLivePly}
                  />
                </div>
                <BoardNav
                  theme={theme}
                  onStart={toStart}
                  onBack={stepBack}
                  onForward={stepForward}
                  onEnd={toLive}
                  canBack={viewPly > 0}
                  canForward={rewound}
                  atLive={!rewound}
                  onLive={toLive}
                />
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

      {ghost && ghost.moved && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: ghost.x - ghost.size / 2,
            top: ghost.y - ghost.size / 2,
            width: ghost.size,
            height: ghost.size,
          }}
        >
          <PieceIcon
            type={ghost.piece.type}
            color={ghost.piece.color}
            theme={theme}
            className="h-full w-full"
            style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.5))" }}
          />
        </div>
      )}

      {interaction.promotion && (
        <PromotionDialog
          color={active.turn}
          square={interaction.promotion.square}
          options={interaction.promotion.options}
          theme={theme}
          onChoose={interaction.choosePromotion}
          onCancel={interaction.cancelPromotion}
        />
      )}
    </div>
  );
}
