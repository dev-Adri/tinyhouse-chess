"use client";

import type { Color } from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import type { EngineLevel } from "@/app/lib/engine/types";
import ThemePicker from "./ThemePicker";

export type OpponentMode = "human" | "bot";

interface MatchPanelProps {
  theme: BoardTheme;
  mode: OpponentMode;
  level: number;
  /** The colour the human plays when facing the bot. */
  humanSide: Color;
  levels: EngineLevel[];
  /** A match is under way — settings are fixed until it ends. */
  started: boolean;
  canReview: boolean;
  reviewing: boolean;
  inReview: boolean;
  /** Phones keep the panel behind a toggle so the board keeps the room. */
  open: boolean;
  onToggle: () => void;
  onModeChange: (mode: OpponentMode) => void;
  onLevelChange: (level: number) => void;
  onSideChange: (side: Color) => void;
  onStart: () => void;
  onNewMatch: () => void;
  onReview: () => void;
  onThemeSelect: (id: string) => void;
}

export default function MatchPanel({
  theme,
  mode,
  level,
  humanSide,
  levels,
  started,
  canReview,
  reviewing,
  inReview,
  open,
  onToggle,
  onModeChange,
  onLevelChange,
  onSideChange,
  onStart,
  onNewMatch,
  onReview,
  onThemeSelect,
}: MatchPanelProps) {
  // Settings are locked once a match starts, so the board never shifts under
  // the player and the engine is never asked mid-game to change sides.
  const locked = started;
  const botControlsActive = mode === "bot" && !locked;
  const levelName = levels.find((entry) => entry.level === level)?.name ?? `Level ${level}`;

  const chip = (active: boolean) => ({
    backgroundColor: active ? theme.accent : "rgba(255,255,255,0.08)",
    color: active ? theme.backdrop : theme.surfaceText,
  });

  const startButton = (className: string) => (
    <button
      type="button"
      onClick={started ? onNewMatch : onStart}
      className={`rounded-lg text-xs font-black uppercase tracking-wide transition hover:brightness-110 ${className}`}
      style={{ backgroundColor: theme.accent, color: theme.backdrop }}
    >
      {started ? "New match" : "Start match"}
    </button>
  );

  const reviewButton = (className: string) => (
    <button
      type="button"
      onClick={onReview}
      disabled={!canReview || reviewing}
      className={`rounded-lg text-xs font-bold uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40 ${className}`}
      style={{ backgroundColor: "rgba(255,255,255,0.1)", color: theme.surfaceText }}
    >
      {reviewing ? "Analysing…" : "Review"}
    </button>
  );

  return (
    <>
      {/* Phone bar: the two actions that matter, plus a way in to the rest. */}
      <div className="flex shrink-0 items-center gap-2 md:hidden">
        {startButton("h-9 flex-1 px-3")}
        {!inReview && reviewButton("h-9 px-3")}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label="Match settings"
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold"
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        >
          <span
            className="h-3 w-3 rounded-full border"
            style={{
              backgroundColor:
                mode === "bot" && humanSide === "b" ? theme.blackPiece : theme.whitePiece,
              borderColor: theme.surfaceText,
            }}
          />
          {mode === "bot" ? levelName : "2 players"}
        </button>
      </div>

      {open && (
        <button
          type="button"
          aria-label="Close settings"
          onClick={onToggle}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      {/* A sheet on phones, a sidebar from md up. */}
      <section
        className={`${
          open ? "fixed inset-x-2 top-14 z-40 flex max-h-[70dvh] overflow-y-auto shadow-2xl" : "hidden"
        } shrink-0 flex-col gap-3 rounded-xl p-3 md:static md:z-auto md:flex md:max-h-full md:w-52 md:overflow-visible md:shadow-none`}
        style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        aria-label="Match settings"
      >
        <h2 className="text-xs font-black uppercase tracking-wide opacity-60">Match</h2>

        <div className="flex w-full overflow-hidden rounded-lg" role="group" aria-label="Opponent">
          {(["human", "bot"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              disabled={locked}
              onClick={() => onModeChange(option)}
              className="h-8 flex-1 px-3 text-xs font-bold uppercase tracking-wide transition disabled:cursor-default"
              style={{ ...chip(mode === option), opacity: locked && mode !== option ? 0.35 : 1 }}
            >
              {option === "human" ? "2 players" : "Bot"}
            </button>
          ))}
        </div>

        {/* Bot settings stay mounted so the layout never jumps when switching. */}
        <div
          className="flex w-full flex-col gap-2"
          style={{ opacity: mode === "bot" ? 1 : 0.35 }}
          aria-hidden={mode !== "bot"}
        >
          <label className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide">
            <span className="opacity-70">Level</span>
            <select
              aria-label="Bot difficulty"
              value={level}
              disabled={!botControlsActive}
              onChange={(event) => onLevelChange(Number(event.target.value))}
              className="h-8 w-32 rounded-lg px-2 text-xs font-bold"
              style={{ backgroundColor: "rgba(255,255,255,0.1)", color: theme.surfaceText }}
            >
              {levels.map((option) => (
                <option key={option.level} value={option.level}>
                  {option.level}. {option.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide">
            <span className="opacity-70">You play</span>
            <div className="flex overflow-hidden rounded-lg" role="group" aria-label="Play as">
              {(["w", "b"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={humanSide === side}
                  disabled={!botControlsActive}
                  aria-label={`Play as ${side === "w" ? "White" : "Black"}`}
                  onClick={() => onSideChange(side)}
                  className="flex h-8 w-8 items-center justify-center transition disabled:cursor-default"
                  style={chip(humanSide === side)}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border"
                    style={{
                      backgroundColor: side === "w" ? theme.whitePiece : theme.blackPiece,
                      borderColor: humanSide === side ? theme.backdrop : theme.surfaceText,
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden flex-col gap-2 md:flex">
          {startButton("h-9 w-full px-4")}
          {!inReview && reviewButton("h-8 w-full px-3")}
        </div>

        <div
          className="w-full border-t pt-3 md:mt-auto"
          style={{ borderColor: "rgba(255,255,255,0.12)" }}
        >
          <h2 className="mb-1.5 text-xs font-black uppercase tracking-wide opacity-60">Board</h2>
          <ThemePicker theme={theme} onSelect={onThemeSelect} />
        </div>
      </section>
    </>
  );
}
