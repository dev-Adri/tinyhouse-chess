"use client";

import type { Color } from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import type { EngineLevel } from "@/app/lib/engine/types";

export type OpponentMode = "human" | "bot";

interface GameSetupProps {
  mode: OpponentMode;
  level: number;
  /** The colour the human plays when facing the bot. */
  humanSide: Color;
  levels: EngineLevel[];
  theme: BoardTheme;
  onModeChange: (mode: OpponentMode) => void;
  onLevelChange: (level: number) => void;
  onSideChange: (side: Color) => void;
}

export default function GameSetup({
  mode,
  level,
  humanSide,
  levels,
  theme,
  onModeChange,
  onLevelChange,
  onSideChange,
}: GameSetupProps) {
  const pill = (active: boolean) => ({
    backgroundColor: active ? theme.accent : "rgba(255,255,255,0.08)",
    color: active ? theme.backdrop : theme.label,
  });

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex overflow-hidden rounded-full" role="group" aria-label="Opponent">
        {(["human", "bot"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => onModeChange(option)}
            className="h-8 px-3 text-xs font-bold uppercase tracking-wide transition"
            style={pill(mode === option)}
          >
            {option === "human" ? "2 players" : "Bot"}
          </button>
        ))}
      </div>

      {mode === "bot" && (
        <>
          <select
            aria-label="Bot difficulty"
            value={level}
            onChange={(event) => onLevelChange(Number(event.target.value))}
            className="h-8 rounded-full px-2 text-xs font-bold"
            style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
          >
            {levels.map((option) => (
              <option key={option.level} value={option.level}>
                {option.level}. {option.name}
              </option>
            ))}
          </select>

          <div className="flex overflow-hidden rounded-full" role="group" aria-label="Play as">
            {(["w", "b"] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={humanSide === side}
                title={`Play as ${side === "w" ? "White" : "Black"}`}
                onClick={() => onSideChange(side)}
                className="flex h-8 w-8 items-center justify-center text-xs font-black transition"
                style={pill(humanSide === side)}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border"
                  style={{
                    backgroundColor: side === "w" ? theme.whitePiece : theme.blackPiece,
                    borderColor: humanSide === side ? theme.backdrop : theme.label,
                  }}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
