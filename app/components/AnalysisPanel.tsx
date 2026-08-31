"use client";

import { formatScore, toWhiteRelative } from "@/app/lib/engine/classification";
import type { AnalysisResult } from "@/app/lib/engine/types";
import type { GameOutcome } from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import type { MoveTree } from "@/app/lib/tinyhouse/variations";
import BoardNav from "./BoardNav";
import MoveTreeList from "./MoveTreeList";

interface AnalysisPanelProps {
  theme: BoardTheme;
  analysis: AnalysisResult | null;
  analysing: boolean;
  analysisError: string | null;
  /** Outcome at the node on the board, so a decided line says why it ended. */
  outcome: GameOutcome;
  tree: MoveTree;
  cursor: string;
  onSelect: (nodeId: string) => void;
  onPromote: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  /** Plays one of the engine's candidate moves, given as UCI. */
  onPlayLine: (uci: string) => void;
  onStart: () => void;
  onBack: () => void;
  onForward: () => void;
  onEnd: () => void;
  canBack: boolean;
  canForward: boolean;
  /** Back to the position editor, seeded with the position on the board. */
  onEditPosition: () => void;
}

export default function AnalysisPanel({
  theme,
  analysis,
  analysing,
  analysisError,
  outcome,
  tree,
  cursor,
  onSelect,
  onPromote,
  onDelete,
  onPlayLine,
  onStart,
  onBack,
  onForward,
  onEnd,
  canBack,
  canForward,
  onEditPosition,
}: AnalysisPanelProps) {
  const over = outcome.over;
  const overText = over
    ? outcome.reason === "checkmate"
      ? `Checkmate — ${outcome.winner === "w" ? "White" : "Black"} wins`
      : outcome.reason === "stalemate"
        ? "Stalemate — draw"
        : outcome.reason === "repetition"
          ? "Draw by repetition"
          : "Draw — move limit reached"
    : null;

  const headline = analysis ? toWhiteRelative(analysis.stm, analysis.score, analysis.mateIn) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-wide">Analysis</h2>
        <div className="flex items-center gap-2">
          {analysing && !over && <span className="text-[10px] opacity-60">thinking…</span>}
          <button
            type="button"
            onClick={onEditPosition}
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide opacity-70 hover:opacity-100"
            style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
          >
            Edit
          </button>
        </div>
      </div>

      {/* Engine verdict on the position now on the board. */}
      <div
        className="shrink-0 rounded-lg px-2 py-1.5 text-xs sm:min-h-[5.5rem]"
        style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
      >
        {over ? (
          <p className="font-bold">{overText}</p>
        ) : analysisError ? (
          <p className="opacity-80">Engine offline — moves still work.</p>
        ) : !analysis ? (
          <p className="opacity-60">Evaluating…</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-black tabular-nums">
                {formatScore(headline!.score, headline!.mateIn)}
              </span>
              <span className="text-[10px] opacity-60">
                depth {analysis.depth} · {(analysis.nodes / 1000).toFixed(0)}k nodes
              </span>
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {analysis.lines.map((line, index) => {
                const view = toWhiteRelative(analysis.stm, line.score, line.mateIn);
                return (
                  <button
                    key={line.uci}
                    type="button"
                    onClick={() => onPlayLine(line.uci)}
                    title={line.pv.join(" ")}
                    className="flex items-baseline gap-2 rounded px-1 py-0.5 text-left text-[11px] transition hover:brightness-125"
                    style={{ backgroundColor: index === 0 ? "rgba(255,255,255,0.1)" : "transparent" }}
                  >
                    <span className="w-3 shrink-0 opacity-50 tabular-nums">{index + 1}</span>
                    <span className="w-14 shrink-0 font-semibold">{line.san}</span>
                    <span className="tabular-nums opacity-70">
                      {formatScore(view.score, view.mateIn)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <BoardNav
        theme={theme}
        onStart={onStart}
        onBack={onBack}
        onForward={onForward}
        onEnd={onEnd}
        canBack={canBack}
        canForward={canForward}
      />

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <MoveTreeList
          tree={tree}
          cursor={cursor}
          theme={theme}
          onSelect={onSelect}
          onPromote={onPromote}
          onDelete={onDelete}
          emptyText="Play a move to start a line."
        />
      </div>

      <p className="hidden shrink-0 text-[10px] leading-tight opacity-50 sm:block">
        Play any move to branch. Right-click a move to promote or delete it. ← → step.
      </p>
    </div>
  );
}
