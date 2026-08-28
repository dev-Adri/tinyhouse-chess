import type { Color, PieceType } from "@/app/lib/tinyhouse/engine";
import type { BoardTheme } from "@/app/lib/tinyhouse/themes";

const BASE = "M24 79h52a4 4 0 0 1 4 4v6a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3v-6a4 4 0 0 1 4-4z";

/** Each piece is a silhouette drawn in a 100x100 box. */
const PATHS: Record<PieceType, string[]> = {
  K: [
    "M46 6h8v8h8v8h-8v8h-8v-8h-8v-8h8z",
    "M50 30c-10 0-18 6-18 14 0 5 3 9 8 12-6 5-10 12-11 20-.4 3-.2 3 .5 5h41c.7-2 .9-2 .5-5-1-8-5-15-11-20 5-3 8-7 8-12 0-8-8-14-18-14z",
    BASE,
  ],
  P: [
    "M50 14a14 14 0 0 1 8 25c5 4 8 10 8 17 0 7 2 14 6 19H28c4-5 6-12 6-19 0-7 3-13 8-17a14 14 0 0 1 8-25z",
    BASE,
  ],
  // Wazir: moves one step orthogonally — a squared, tower-like silhouette.
  W: [
    "M26 18h10v8h9v-8h10v8h9v-8h10v20l-7 6c2 12 4 24 7 31H26c3-7 5-19 7-31l-7-6z",
    BASE,
  ],
  // Ferz: moves one step diagonally — a diamond-crowned silhouette.
  F: [
    "M50 6l11 12-11 12-11-12z",
    "M44 32h12c8 6 14 16 14 26 0 7-2 13-6 17H36c-4-4-6-10-6-17 0-10 6-20 14-26z",
    BASE,
  ],
  // Hors: the xiangqi horse — a knight head.
  H: [
    "M28 79C27 65 31 55 40 49L16 45C15 35 22 25 35 19L31 6L47 14C64 19 76 35 74 55C73 66 73 73 73 79Z",
    BASE,
  ],
};

interface PieceIconProps {
  type: PieceType;
  color: Color;
  theme: BoardTheme;
  className?: string;
  style?: React.CSSProperties;
}

export default function PieceIcon({ type, color, theme, className, style }: PieceIconProps) {
  const fill = color === "w" ? theme.whitePiece : theme.blackPiece;
  const stroke = color === "w" ? theme.whiteOutline : theme.blackOutline;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.35))", ...style }}
    >
      <g
        fill={fill}
        stroke={stroke}
        strokeWidth={5}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {PATHS[type].map((d, i) => (
          <path key={i} d={d} />
        ))}
        {type === "H" && <circle cx={33} cy={32} r={3.6} fill={stroke} stroke="none" />}
      </g>
    </svg>
  );
}
