"use client";

import { CLASSIFICATION_STYLE } from "@/app/lib/engine/classification";
import type { Classification } from "@/app/lib/engine/types";

interface ClassificationBadgeProps {
  classification: Classification;
  /** Sizes the badge. The glyph follows, because the box is an SVG viewBox. */
  className?: string;
  /** Defaults to the classification's label. */
  title?: string;
}

/**
 * The coloured circle with a glyph in it (★, ?!, ??…).
 *
 * Drawn as an SVG rather than a div with a font size: a viewBox scales its
 * contents, so one component reads correctly at 16px in a move list and at
 * 32px in a panel on a large screen, with nothing to keep in sync.
 */
export default function ClassificationBadge({
  classification,
  className = "h-5 w-5",
  title,
}: ClassificationBadgeProps) {
  const style = CLASSIFICATION_STYLE[classification];
  // Two-character glyphs (?!, ??) need to sit smaller inside the same circle.
  const fontSize = style.glyph.length > 1 ? 11 : 14;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={title ?? style.label}
    >
      <title>{title ?? style.label}</title>
      <circle cx="12" cy="12" r="12" fill={style.color} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight="900"
        fill="#ffffff"
      >
        {style.glyph}
      </text>
    </svg>
  );
}
