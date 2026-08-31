"use client";

import type { Color } from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import type { EngineLevel } from "@/app/lib/engine/types";
import ThemePicker from "./ThemePicker";

export type OpponentMode = "human" | "bot" | "engines" | "analysis";

interface MatchPanelProps {
  theme: BoardTheme;
  mode: OpponentMode;
  level: number;
  /** The colour the human plays when facing the bot. */
  humanSide: Color;
  levels: EngineLevel[];
  /** A match is under way — settings are fixed until it ends. */
  started: boolean;
  /** The match has been decided, so playback has nothing left to control. */
  gameOver: boolean;
  canReview: boolean;
  reviewing: boolean;
  inReview: boolean;
  /** A played game exists that could be handed to the analysis board. */
  canAnalyse: boolean;
  /** Phones keep the panel behind a toggle so the board keeps the room. */
  open: boolean;
  /** Levels for the two machine players, used in `engines` mode. */
  engineLevels: Record<Color, number>;
  /** Floor on the interval between machine moves, in milliseconds. */
  moveDelayMs: number;
  paused: boolean;
  onToggle: () => void;
  onModeChange: (mode: OpponentMode) => void;
  onLevelChange: (level: number) => void;
  onSideChange: (side: Color) => void;
  onStart: () => void;
  onNewMatch: () => void;
  onReview: () => void;
  onAnalyse: () => void;
  onThemeSelect: (id: string) => void;
  onEngineLevelChange: (color: Color, level: number) => void;
  onDelayChange: (ms: number) => void;
  onTogglePause: () => void;
  onStep: () => void;
}

/** Kept beside the type so a new mode cannot be added without a label. */
const MODE_OPTIONS: { mode: OpponentMode; label: string }[] = [
  { mode: "human", label: "2 players" },
  { mode: "bot", label: "vs Bot" },
  { mode: "engines", label: "Bot vs Bot" },
  { mode: "analysis", label: "Analysis" },
];

export default function MatchPanel({
  theme,
  mode,
  level,
  humanSide,
  levels,
  started,
  gameOver,
  canReview,
  reviewing,
  inReview,
  canAnalyse,
  open,
  engineLevels,
  moveDelayMs,
  paused,
  onToggle,
  onModeChange,
  onLevelChange,
  onSideChange,
  onStart,
  onNewMatch,
  onReview,
  onAnalyse,
  onThemeSelect,
  onEngineLevelChange,
  onDelayChange,
  onTogglePause,
  onStep,
}: MatchPanelProps) {
  // Settings are locked once a match starts, so the board never shifts under
  // the player and the engine is never asked mid-game to change sides.
  const locked = started;
  const botControlsActive = mode === "bot" && !locked;
  const enginesMode = mode === "engines";
  // The two level selects are fixed once the match starts — changing an
  // engine's strength mid-game is a different thing. Pacing is not: watching
  // is the whole point of the mode, so the delay slider stays live.
  const engineControlsActive = enginesMode && !locked;
  const levelName = levels.find((entry) => entry.level === level)?.name ?? `Level ${level}`;
  const analysing = mode === "analysis";

  const chip = (active: boolean) => ({
    backgroundColor: active ? theme.accent : theme.overlay,
    color: active ? theme.backdrop : theme.surfaceText,
  });

  const startButton = (className: string) => (
    <button
      type="button"
      onClick={started ? onNewMatch : onStart}
      className={`rounded-lg text-xs font-black uppercase tracking-wide transition hover:brightness-110 ${className}`}
      style={{ backgroundColor: theme.accent, color: theme.backdrop }}
    >
      {started ? "New match" : analysing ? "Open analysis" : "Start match"}
    </button>
  );

  const reviewButton = (className: string) => (
    <button
      type="button"
      onClick={onReview}
      disabled={!canReview || reviewing}
      className={`rounded-lg text-xs font-bold uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40 ${className}`}
      style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
    >
      {reviewing ? "Analysing…" : "Review"}
    </button>
  );

  const analyseButton = (className: string) => (
    <button
      type="button"
      onClick={onAnalyse}
      disabled={!canAnalyse}
      title="Open this game on the analysis board"
      className={`rounded-lg text-xs font-bold uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40 ${className}`}
      style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
    >
      Analyse from here
    </button>
  );

  return (
    <>
      {/* Phone bar: the two actions that matter, plus a way in to the rest. */}
      <div className="flex shrink-0 items-center gap-2 md:hidden">
        {startButton("h-9 flex-1 px-3")}
        {!inReview && !analysing && reviewButton("h-9 px-3")}
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
          {mode === "bot"
            ? levelName
            : enginesMode
              ? "Bot vs Bot"
              : analysing
                ? "Analysis"
                : "2 players"}
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

        <div className="grid grid-cols-2 gap-1" role="group" aria-label="Opponent">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              disabled={locked}
              onClick={() => onModeChange(option.mode)}
              className="h-9 rounded-lg px-1.5 text-[11px] font-bold uppercase tracking-wide transition disabled:cursor-default"
              style={{
                ...chip(mode === option.mode),
                opacity: locked && mode !== option.mode ? 0.35 : 1,
              }}
            >
              {option.label}
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
              style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
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

        {/* Machine-versus-machine settings. Mounted only in that mode: unlike
            the bot block there is nothing here to keep the layout steady for. */}
        {enginesMode && (
          <div className="flex w-full flex-col gap-2">
            {(["w", "b"] as const).map((color) => (
              <label
                key={color}
                className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide"
              >
                <span className="flex items-center gap-1.5 opacity-70">
                  <span
                    className="h-3 w-3 rounded-full border"
                    style={{
                      backgroundColor: color === "w" ? theme.whitePiece : theme.blackPiece,
                      borderColor: theme.surfaceText,
                    }}
                  />
                  {color === "w" ? "White" : "Black"}
                </span>
                <select
                  aria-label={`${color === "w" ? "White" : "Black"} engine level`}
                  value={engineLevels[color]}
                  disabled={!engineControlsActive}
                  onChange={(event) => onEngineLevelChange(color, Number(event.target.value))}
                  className="h-8 w-28 rounded-lg px-2 text-xs font-bold"
                  style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
                >
                  {levels.map((option) => (
                    <option key={option.level} value={option.level}>
                      {option.level}. {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide">
              <span className="flex items-center justify-between">
                <span className="opacity-70">Move every</span>
                <span className="tabular-nums opacity-90">{(moveDelayMs / 1000).toFixed(1)}s</span>
              </span>
              <input
                type="range"
                min={200}
                max={10000}
                step={100}
                value={moveDelayMs}
                onChange={(event) => onDelayChange(Number(event.target.value))}
                aria-label="Seconds between engine moves"
                className="w-full"
                style={{ accentColor: theme.accent }}
              />
            </label>

            {/* Playback, available only while the machines are actually playing. */}
            {started && !gameOver && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={onTogglePause}
                  className="h-8 flex-1 rounded-lg text-[11px] font-bold uppercase tracking-wide transition hover:brightness-110"
                  style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={onStep}
                  disabled={!paused}
                  title="Play a single move"
                  className="h-8 flex-1 rounded-lg text-[11px] font-bold uppercase tracking-wide transition hover:brightness-110 disabled:opacity-40"
                  style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
                >
                  Step
                </button>
              </div>
            )}
          </div>
        )}

        <div className="hidden flex-col gap-2 md:flex">
          {startButton("h-9 w-full px-4")}
          {!inReview && !analysing && reviewButton("h-8 w-full px-3")}
          {!analysing && analyseButton("h-8 w-full px-3")}
        </div>

        <div
          className="w-full border-t pt-3 md:mt-auto"
          style={{ borderColor: theme.overlay }}
        >
          <h2 className="mb-1.5 text-xs font-black uppercase tracking-wide opacity-60">Board</h2>
          <ThemePicker theme={theme} onSelect={onThemeSelect} />
        </div>
      </section>
    </>
  );
}
