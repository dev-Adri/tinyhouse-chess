"use client";

import { THEMES, type BoardTheme } from "@/app/lib/tinyhouse/themes";

interface ThemePickerProps {
  theme: BoardTheme;
  onSelect: (id: string) => void;
}

export default function ThemePicker({ theme, onSelect }: ThemePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Board theme">
      {THEMES.map((option) => {
        const isActive = option.id === theme.id;
        return (
          <button
            key={option.id}
            type="button"
            title={option.name}
            aria-label={`${option.name} board theme`}
            aria-pressed={isActive}
            onClick={() => onSelect(option.id)}
            className="flex h-8 shrink-0 items-center gap-2 rounded-full p-1 text-xs font-semibold transition xl:pr-3"
            style={{
              backgroundColor: isActive ? option.surface : "rgba(255,255,255,0.06)",
              color: isActive ? option.surfaceText : theme.label,
              outline: isActive ? `2px solid ${option.accent}` : "2px solid transparent",
            }}
          >
            <span
              className="h-6 w-6 overflow-hidden rounded-full border"
              style={{ borderColor: option.frame }}
            >
              <span className="grid h-full w-full grid-cols-2">
                <span style={{ backgroundColor: option.light }} />
                <span style={{ backgroundColor: option.dark }} />
                <span style={{ backgroundColor: option.dark }} />
                <span style={{ backgroundColor: option.light }} />
              </span>
            </span>
            <span className="hidden xl:inline">{option.name}</span>
          </button>
        );
      })}
    </div>
  );
}
