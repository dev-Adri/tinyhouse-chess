"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";
import { outline, type LineItem, type MoveTree } from "@/app/lib/tinyhouse/variations";

interface MoveTreeListProps {
  tree: MoveTree;
  /** The node currently on the board. */
  cursor: string;
  theme: BoardTheme;
  onSelect: (nodeId: string) => void;
  /** Omitted in a live game, where the line cannot be reshaped. */
  onPromote?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  emptyText?: string;
}

/** Where a right-click landed, so the menu can open next to the pointer. */
interface Menu {
  nodeId: string;
  x: number;
  y: number;
}

const MENU_WIDTH = 160;
const MENU_HEIGHT = 80;

/** Keeps the menu on screen. Measured on click: a resize closes it anyway. */
function menuAt(nodeId: string, x: number, y: number): Menu {
  return {
    nodeId,
    x: Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH)),
    y: Math.max(4, Math.min(y, window.innerHeight - MENU_HEIGHT)),
  };
}

/**
 * The move list, main line and variations both.
 *
 * Moves flow inline rather than in two fixed columns: variations nest to
 * arbitrary depth and a narrow panel has no room for a column per side. A tree
 * with no branches therefore reads as a plain numbered list, which is what a
 * live game shows.
 */
export default function MoveTreeList({
  tree,
  cursor,
  theme,
  onSelect,
  onPromote,
  onDelete,
  emptyText = "No moves yet.",
}: MoveTreeListProps) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const editable = Boolean(onPromote || onDelete);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    // A menu pinned to a pointer position is meaningless once the layout moves.
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const moveButton = (nodeId: string, ply: number, variation: boolean) => {
    const node = tree.nodes[nodeId];
    const isCursor = nodeId === cursor;
    const white = ply % 2 === 0;
    return (
      <button
        key={nodeId}
        type="button"
        onClick={() => onSelect(nodeId)}
        onContextMenu={
          editable && node.parent !== null
            ? (event) => {
                event.preventDefault();
                setMenu(menuAt(nodeId, event.clientX, event.clientY));
              }
            : undefined
        }
        className={`rounded px-1 py-0.5 text-left tabular-nums transition hover:brightness-125 ${
          variation ? "text-[11px]" : "text-xs font-semibold"
        }`}
        style={{
          backgroundColor: isCursor ? "rgba(255,255,255,0.2)" : "transparent",
          opacity: variation && !isCursor ? 0.75 : 1,
        }}
        aria-current={isCursor ? "true" : undefined}
      >
        <span className="opacity-50">
          {white ? `${Math.floor(ply / 2) + 1}.` : variation ? `${Math.floor(ply / 2) + 1}…` : ""}
        </span>
        {white || variation ? " " : ""}
        {node.san}
      </button>
    );
  };

  // The traversal itself lives in variations.ts, where it is unit-tested:
  // working out which moves are alternatives to which is easy to get subtly,
  // and catastrophically, wrong.
  const rows = useMemo(() => outline(tree), [tree]);

  /** Renders a line, dropping each move's alternatives in right after it. */
  const renderLine = (items: LineItem[], depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const item of items) {
      out.push(moveButton(item.nodeId, item.ply, depth > 0));
      for (const variation of item.variations) {
        out.push(
          <div
            key={`variation-${variation[0].nodeId}`}
            className="my-0.5 flex w-full flex-wrap items-baseline gap-x-0.5 border-l pl-1.5"
            style={{ borderColor: "rgba(255,255,255,0.25)", marginLeft: depth * 4 }}
          >
            {renderLine(variation, depth + 1)}
          </div>,
        );
      }
    }
    return out;
  };

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-0.5">
        {rows.length > 0 ? (
          renderLine(rows, 0)
        ) : (
          <p className="text-xs opacity-60">{emptyText}</p>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-50 flex flex-col overflow-hidden rounded-lg py-1 text-xs shadow-2xl"
          style={{
            left: menu.x,
            top: menu.y,
            minWidth: MENU_WIDTH,
            backgroundColor: theme.surface,
            color: theme.surfaceText,
          }}
          role="menu"
        >
          {onPromote && (
            <button
              type="button"
              role="menuitem"
              className="px-3 py-1.5 text-left hover:brightness-125"
              onClick={() => {
                onPromote(menu.nodeId);
                setMenu(null);
              }}
            >
              Promote to main line
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className="px-3 py-1.5 text-left hover:brightness-125"
              onClick={() => {
                onDelete(menu.nodeId);
                setMenu(null);
              }}
            >
              Delete from here
            </button>
          )}
        </div>
      )}
    </>
  );
}
