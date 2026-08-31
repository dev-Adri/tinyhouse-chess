"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { THEMES, type BoardTheme } from "@/app/lib/tinyhouse/themes";

interface ThemePickerProps {
  theme: BoardTheme;
  onSelect: (id: string) => void;
}

const GROUPS: { group: BoardTheme["group"]; label: string }[] = [
  { group: "dark", label: "Dark" },
  { group: "light", label: "Light" },
];

/** The four-square board preview shown beside a theme's name. */
function Swatch({ theme, className = "h-5 w-5" }: { theme: BoardTheme; className?: string }) {
  return (
    <span
      className={`overflow-hidden rounded-full border ${className}`}
      style={{ borderColor: theme.frame }}
    >
      <span className="grid h-full w-full grid-cols-2">
        <span style={{ backgroundColor: theme.light }} />
        <span style={{ backgroundColor: theme.dark }} />
        <span style={{ backgroundColor: theme.dark }} />
        <span style={{ backgroundColor: theme.light }} />
      </span>
    </span>
  );
}

/**
 * A dropdown rather than a row of chips: twelve swatches wrapped across a
 * narrow settings panel pushed everything else off the screen.
 */
export default function ThemePicker({ theme, onSelect }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    // A list anchored to the button is meaningless once the layout moves.
    const onResize = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
    button.current?.focus();
  };

  /** Arrow-key navigation between options: native buttons get none for free. */
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) return;
    const currentIndex = options.findIndex((option) => option === document.activeElement);
    const nextIndex =
      currentIndex === -1
        ? event.key === "ArrowDown"
          ? 0
          : options.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  return (
    <div className="relative" ref={container}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs font-bold transition hover:brightness-125"
        style={{ backgroundColor: theme.overlay, color: theme.surfaceText }}
      >
        <Swatch theme={theme} />
        <span className="flex-1 text-left">{theme.name}</span>
        <span className="opacity-60">▾</span>
      </button>

      {open && (
        <div
          ref={list}
          role="listbox"
          aria-label="Board theme"
          onKeyDown={onListKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full min-w-40 overflow-y-auto rounded-lg py-1 shadow-2xl"
          style={{ backgroundColor: theme.surface, color: theme.surfaceText }}
        >
          {GROUPS.map(({ group, label }) => (
            <div key={group} role="group" aria-label={label}>
              <div className="px-2 py-1 text-[10px] font-black uppercase tracking-wide opacity-50">
                {label}
              </div>
              {THEMES.filter((option) => option.group === group).map((option) => {
                const active = option.id === theme.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(option.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-semibold transition hover:brightness-125"
                    style={{ backgroundColor: active ? theme.overlayStrong : "transparent" }}
                  >
                    <Swatch theme={option} />
                    <span className="flex-1">{option.name}</span>
                    {active && <span aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
