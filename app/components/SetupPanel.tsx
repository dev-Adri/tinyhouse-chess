"use client";

import { PIECE_NAMES, type Color, type PieceType } from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import PieceIcon from "./PieceIcon";
import type { SetupTool } from "./useSetup";

const PALETTE: PieceType[] = ["K", "P", "W", "F", "H"];

interface SetupPanelProps {
  theme: BoardTheme;
  tool: SetupTool;
  onToolChange: (tool: SetupTool) => void;
  turn: Color;
  onTurnChange: (turn: Color) => void;
  /** Why the position cannot be analysed yet, or null when it can. */
  problem: string | null;
  onAnalyse: () => void;
  onClear: () => void;
  onReset: () => void;
}

/**
 * The position editor's controls: which piece the next click puts down, whose
 * move it is, and the way out into analysis.
 */
export default function SetupPanel({
  theme,
  tool,
  onToolChange,
  turn,
  onTurnChange,
  problem,
  onAnalyse,
  onClear,
  onReset,
}: SetupPanelProps) {
  const selected = (candidate: SetupTool) =>
    candidate.kind === "erase"
      ? tool.kind === "erase"
      : tool.kind === "piece" &&
        tool.piece.type === candidate.piece.type &&
        tool.piece.color === candidate.piece.color;

  const slot = (candidate: SetupTool, key: string, label: string, content: React.ReactNode) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected(candidate)}
      onClick={() => onToolChange(candidate)}
      className="flex aspect-square items-center justify-center rounded-md transition hover:brightness-125"
      style={{
        backgroundColor: selected(candidate) ? theme.accent : theme.overlay,
      }}
    >
      {content}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div>
        <h2 className="text-sm font-black uppercase tracking-wide">Set up position</h2>
        <p className="mt-0.5 text-[11px] leading-tight opacity-60">
          Pick a piece, then click a square. Drag a piece off the board to send it to the other
          side&apos;s drawer, as a capture would.
        </p>
      </div>

      {(["w", "b"] as const).map((color) => (
        <div key={color}>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wide opacity-70">
            {color === "w" ? "White" : "Black"}
          </h3>
          <div className="grid max-w-60 grid-cols-5 gap-1">
            {PALETTE.map((type) =>
              slot(
                { kind: "piece", piece: { type, color } },
                `${color}${type}`,
                `${color === "w" ? "White" : "Black"} ${PIECE_NAMES[type]}`,
                <PieceIcon type={type} color={color} theme={theme} className="h-[78%] w-[78%]" />,
              ),
            )}
          </div>
        </div>
      ))}

      <div className="grid max-w-60 grid-cols-5 gap-1">
        {slot(
          { kind: "erase" },
          "erase",
          "Erase — click a square to empty it, or a drawer slot to take one out",
          <span className="text-sm font-black">✕</span>,
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide opacity-70">To move</span>
        <div className="flex overflow-hidden rounded-lg" role="group" aria-label="Side to move">
          {(["w", "b"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={turn === side}
              aria-label={`${side === "w" ? "White" : "Black"} to move`}
              onClick={() => onTurnChange(side)}
              className="flex h-8 w-9 items-center justify-center transition"
              style={{
                backgroundColor: turn === side ? theme.accent : theme.overlay,
              }}
            >
              <span
                className="h-3.5 w-3.5 rounded-full border"
                style={{
                  backgroundColor: side === "w" ? theme.whitePiece : theme.blackPiece,
                  borderColor: turn === side ? theme.backdrop : theme.surfaceText,
                }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          className="h-8 flex-1 rounded-lg text-[11px] font-bold uppercase tracking-wide transition hover:brightness-125"
          style={{ backgroundColor: theme.overlay }}
        >
          Start pos.
        </button>
        <button
          type="button"
          onClick={onClear}
          className="h-8 flex-1 rounded-lg text-[11px] font-bold uppercase tracking-wide transition hover:brightness-125"
          style={{ backgroundColor: theme.overlay }}
        >
          Clear
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        {problem && (
          <p className="text-[11px] leading-tight" style={{ color: "#e6b34c" }} role="alert">
            {problem}
          </p>
        )}
        <button
          type="button"
          onClick={onAnalyse}
          disabled={problem !== null}
          className="h-10 w-full rounded-lg text-xs font-black uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40"
          style={{ backgroundColor: theme.accent, color: theme.backdrop }}
        >
          Analyse
        </button>
      </div>
    </div>
  );
}
