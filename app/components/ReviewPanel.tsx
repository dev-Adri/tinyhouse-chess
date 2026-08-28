"use client";

import { useMemo } from "react";
import {
  CLASSIFICATION_ORDER,
  CLASSIFICATION_STYLE,
  evalToShare,
  formatScore,
} from "@/app/lib/engine/classification";
import type { GameReview } from "@/app/lib/engine/types";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";

interface ReviewPanelProps {
  review: GameReview;
  theme: BoardTheme;
  /** 0 = starting position, i + 1 = the position after ply i. */
  position: number;
  onSelect: (position: number) => void;
  onClose: () => void;
}

export default function ReviewPanel({
  review,
  theme,
  position,
  onSelect,
  onClose,
}: ReviewPanelProps) {
  const { plies } = review;

  // One eval per position, White's point of view: the start plus each ply.
  const curve = useMemo(() => {
    if (!plies.length) return [0.5];
    const points = [evalToShare(plies[0].eval_before, plies[0].mate_before)];
    for (const ply of plies) points.push(evalToShare(ply.eval_after, ply.mate_after));
    return points;
  }, [plies]);

  const area = useMemo(() => {
    if (curve.length < 2) return "";
    const step = 100 / (curve.length - 1);
    const top = curve.map((share, i) => `${(i * step).toFixed(2)},${((1 - share) * 40).toFixed(2)}`);
    return `M0,40 L${top.join(" L")} L100,40 Z`;
  }, [curve]);

  const selected = position > 0 ? plies[position - 1] : null;
  const upcoming = plies[position] ?? null;

  const move = (delta: number) => onSelect(Math.max(0, Math.min(plies.length, position + delta)));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-wide">Game review</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-2 py-0.5 text-xs font-bold opacity-70 hover:opacity-100"
          style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
        >
          Close
        </button>
      </div>

      {/* Accuracy */}
      <div className="grid grid-cols-2 gap-2">
        {(["w", "b"] as const).map((color) => (
          <div
            key={color}
            className="rounded-lg px-2 py-1.5 text-center"
            style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
          >
            <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">
              {color === "w" ? "White" : "Black"}
            </div>
            <div className="text-xl font-black tabular-nums">{review.accuracy[color]}</div>
            <div className="text-[10px] opacity-60">accuracy</div>
          </div>
        ))}
      </div>

      {/* Evaluation curve */}
      <div>
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="h-12 w-full cursor-pointer rounded"
          style={{ backgroundColor: theme.blackPiece }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            onSelect(Math.round(ratio * plies.length));
          }}
        >
          <path d={area} fill={theme.whitePiece} />
          <line x1="0" y1="20" x2="100" y2="20" stroke={theme.accent} strokeWidth="0.4" opacity="0.5" />
          {plies.length > 0 && (
            <line
              x1={(position / plies.length) * 100}
              y1="0"
              x2={(position / plies.length) * 100}
              y2="40"
              stroke={theme.selected}
              strokeWidth="0.8"
            />
          )}
        </svg>
      </div>

      {/* Navigation sits above the variable-height blocks so the buttons never
          move under the cursor while stepping through quickly. */}
      <div className="flex items-center justify-center gap-1">
        {[
          { label: "⏮", delta: -position, title: "Start" },
          { label: "◀", delta: -1, title: "Previous" },
          { label: "▶", delta: 1, title: "Next" },
          { label: "⏭", delta: plies.length - position, title: "End" },
        ].map((button) => (
          <button
            key={button.title}
            type="button"
            title={button.title}
            onClick={() => move(button.delta)}
            className="h-8 flex-1 rounded text-sm font-bold transition hover:brightness-125"
            style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
          >
            {button.label}
          </button>
        ))}
      </div>

      {/* What happened on the selected move. Fixed height: its content varies
          between one and three lines. */}
      <div
        className="h-[4.75rem] shrink-0 overflow-hidden rounded-lg px-2 py-1.5 text-xs leading-snug"
        style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
      >
        {selected ? (
          <>
            <div className="flex items-center gap-2">
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white"
                style={{ backgroundColor: CLASSIFICATION_STYLE[selected.classification].color }}
              >
                {CLASSIFICATION_STYLE[selected.classification].glyph}
              </span>
              <span className="font-bold">
                {Math.floor(selected.ply / 2) + 1}
                {selected.color === "w" ? "." : "..."} {selected.san}
              </span>
              <span className="opacity-70">
                {CLASSIFICATION_STYLE[selected.classification].label}
              </span>
              <span className="ml-auto tabular-nums">
                {formatScore(selected.eval_after, selected.mate_after)}
              </span>
            </div>
            {selected.classification !== "best" && selected.classification !== "forced" && (
              <div className="mt-1 opacity-80">
                Best was <strong>{selected.best_san}</strong> ({formatScore(selected.eval_before, selected.mate_before)})
                {selected.loss > 0 && <> — lost {(selected.loss / 100).toFixed(1)}</>}
              </div>
            )}
          </>
        ) : (
          <div className="opacity-70">Starting position. Step through to see each move graded.</div>
        )}
        {upcoming && (
          <div className="mt-1 opacity-80">
            Engine plays <strong>{upcoming.best_san}</strong> here.
          </div>
        )}
      </div>

      {/* Move list */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {plies.map((ply) => {
          const style = CLASSIFICATION_STYLE[ply.classification];
          const isSelected = position === ply.ply + 1;
          return (
            <button
              key={ply.ply}
              type="button"
              onClick={() => onSelect(ply.ply + 1)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs"
              style={{ backgroundColor: isSelected ? "rgba(255,255,255,0.16)" : "transparent" }}
            >
              <span className="w-7 text-right opacity-50 tabular-nums">
                {ply.color === "w" ? `${Math.floor(ply.ply / 2) + 1}.` : ""}
              </span>
              <span className="w-16 font-semibold">{ply.san}</span>
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white"
                style={{ backgroundColor: style.color }}
                title={style.label}
              >
                {style.glyph}
              </span>
              <span className="ml-auto tabular-nums opacity-70">
                {formatScore(ply.eval_after, ply.mate_after)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[11px]">
        {CLASSIFICATION_ORDER.filter(
          (label) => review.counts.w[label] || review.counts.b[label],
        ).map((label) => (
          <div key={label} className="contents">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: CLASSIFICATION_STYLE[label].color }}
              />
              {CLASSIFICATION_STYLE[label].label}
            </span>
            <span className="tabular-nums">{review.counts.w[label]}</span>
            <span className="tabular-nums opacity-70">{review.counts.b[label]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
