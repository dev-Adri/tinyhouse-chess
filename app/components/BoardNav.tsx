"use client";

import type { BoardTheme } from "@/app/lib/tinyhouse/themes";

interface BoardNavProps {
  theme: BoardTheme;
  onStart: () => void;
  onBack: () => void;
  onForward: () => void;
  onEnd: () => void;
  canBack: boolean;
  canForward: boolean;
  /**
   * Present only in a live game: false while rewound, so the button offers a
   * way back to the position actually being played.
   */
  atLive?: boolean;
  onLive?: () => void;
}

/** Step controls shared by live-game rewind and the analysis board. */
export default function BoardNav({
  theme,
  onStart,
  onBack,
  onForward,
  onEnd,
  canBack,
  canForward,
  atLive,
  onLive,
}: BoardNavProps) {
  const buttons = [
    { label: "⏮", title: "Start", onClick: onStart, enabled: canBack },
    { label: "◀", title: "Previous", onClick: onBack, enabled: canBack },
    { label: "▶", title: "Next", onClick: onForward, enabled: canForward },
    { label: "⏭", title: "End", onClick: onEnd, enabled: canForward },
  ];

  return (
    <div className="flex items-center justify-center gap-1">
      {buttons.map((button) => (
        <button
          key={button.title}
          type="button"
          title={button.title}
          onClick={button.onClick}
          disabled={!button.enabled}
          className="h-8 flex-1 rounded text-sm font-bold transition hover:brightness-125 disabled:opacity-30"
          style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
        >
          {button.label}
        </button>
      ))}

      {onLive && (
        <button
          type="button"
          onClick={onLive}
          disabled={atLive}
          title="Back to the live position"
          className="h-8 rounded px-2 text-[10px] font-black uppercase tracking-wide transition hover:brightness-110 disabled:opacity-30"
          style={{
            backgroundColor: atLive ? "rgba(255,255,255,0.1)" : theme.accent,
            color: atLive ? theme.surfaceText : theme.backdrop,
          }}
        >
          Live
        </button>
      )}
    </div>
  );
}
