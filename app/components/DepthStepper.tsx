"use client";

import { MAX_DEPTH, MIN_DEPTH } from "@/app/lib/tinyhouse/storage";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";

interface DepthStepperProps {
  theme: BoardTheme;
  value: number;
  onChange: (depth: number) => void;
  /** Shown before the number; keep it to a word. */
  label?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * A stepper rather than a slider: each click is one committed change, and a
 * search per step is expensive enough that a dragged slider would fire a
 * dozen of them.
 */
export default function DepthStepper({
  theme,
  value,
  onChange,
  label = "Depth",
  disabled = false,
  title,
}: DepthStepperProps) {
  const button = (delta: number, glyph: string, name: string) => (
    <button
      type="button"
      aria-label={name}
      title={name}
      disabled={disabled || value + delta < MIN_DEPTH || value + delta > MAX_DEPTH}
      onClick={() => onChange(value + delta)}
      className="h-5 w-5 rounded text-[11px] font-black leading-none transition hover:brightness-125 disabled:opacity-30"
      style={{ backgroundColor: theme.overlay }}
    >
      {glyph}
    </button>
  );

  return (
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" title={title}>
      <span className="opacity-60">{label}</span>
      {button(-1, "−", "Decrease depth")}
      <span className="w-4 text-center tabular-nums opacity-90">{value}</span>
      {button(1, "+", "Increase depth")}
    </span>
  );
}
