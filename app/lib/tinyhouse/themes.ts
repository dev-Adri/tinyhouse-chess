export interface BoardTheme {
  id: string;
  name: string;
  /** Light square fill. */
  light: string;
  /** Dark square fill. */
  dark: string;
  /** Frame around the board. */
  frame: string;
  /** Page backdrop behind the board. */
  backdrop: string;
  /** Coordinate labels outside the board. */
  label: string;
  /** Surface colour for panels (reserves, HUD). */
  surface: string;
  surfaceText: string;
  /** Fill/stroke for the two piece colours. */
  whitePiece: string;
  whiteOutline: string;
  blackPiece: string;
  blackOutline: string;
  /** Highlight overlays. */
  selected: string;
  lastMove: string;
  target: string;
  accent: string;
}

export const THEMES: BoardTheme[] = [
  {
    id: "wood",
    name: "Classic Wood",
    light: "#f2dfc0",
    dark: "#b58863",
    frame: "#6f4a2f",
    backdrop: "#2a1c12",
    label: "#e8d5b7",
    surface: "#3b2718",
    surfaceText: "#f2dfc0",
    whitePiece: "#fdf7ec",
    whiteOutline: "#5a3d28",
    blackPiece: "#2f2118",
    blackOutline: "#0f0a06",
    selected: "#f6c453",
    lastMove: "#d9b25f",
    target: "#3f7d3f",
    accent: "#e0a33c",
  },
  {
    id: "slate",
    name: "Slate Blue",
    light: "#e8eef6",
    dark: "#7a93b3",
    frame: "#3d5169",
    backdrop: "#111a26",
    label: "#c7d6e8",
    surface: "#1b2735",
    surfaceText: "#dbe6f4",
    whitePiece: "#ffffff",
    whiteOutline: "#33465c",
    blackPiece: "#22303f",
    blackOutline: "#0a1119",
    selected: "#67b7ff",
    lastMove: "#5b8fc7",
    target: "#2f8f6b",
    accent: "#5aa9ff",
  },
  {
    id: "emerald",
    name: "Emerald",
    light: "#edeed1",
    dark: "#779952",
    frame: "#3f5330",
    backdrop: "#16210f",
    label: "#d8e6c2",
    surface: "#22301a",
    surfaceText: "#e6f0d6",
    whitePiece: "#fbfdf3",
    whiteOutline: "#3f5330",
    blackPiece: "#25301c",
    blackOutline: "#0c1207",
    selected: "#f2d24b",
    lastMove: "#cbd35a",
    target: "#2f7f4f",
    accent: "#9ccb5a",
  },
  {
    id: "midnight",
    name: "Midnight",
    light: "#5b6472",
    dark: "#2c333d",
    frame: "#191d24",
    backdrop: "#0b0e13",
    label: "#93a0b3",
    surface: "#161b22",
    surfaceText: "#c9d3e0",
    whitePiece: "#f4f7fb",
    whiteOutline: "#2c333d",
    blackPiece: "#131820",
    blackOutline: "#7d8899",
    selected: "#7c9cff",
    lastMove: "#4d5f8f",
    target: "#3fa08a",
    accent: "#8aa4ff",
  },
  {
    id: "coral",
    name: "Coral",
    light: "#ffe6dc",
    dark: "#e08672",
    frame: "#a3543f",
    backdrop: "#2d1712",
    label: "#ffd8c9",
    surface: "#3d2019",
    surfaceText: "#ffe6dc",
    whitePiece: "#fff8f4",
    whiteOutline: "#8c4632",
    blackPiece: "#3a1f17",
    blackOutline: "#150a06",
    selected: "#ffc14d",
    lastMove: "#f2a07f",
    target: "#3f8f74",
    accent: "#ff9c72",
  },
  {
    id: "amethyst",
    name: "Amethyst",
    light: "#efe7ff",
    dark: "#8f79c4",
    frame: "#503d7a",
    backdrop: "#1a1230",
    label: "#d9cdf5",
    surface: "#251a42",
    surfaceText: "#e9e0ff",
    whitePiece: "#fdfaff",
    whiteOutline: "#4a3a70",
    blackPiece: "#241a3a",
    blackOutline: "#0e0819",
    selected: "#ffd166",
    lastMove: "#b79ce8",
    target: "#3f9a86",
    accent: "#b38dff",
  },
];

export const DEFAULT_THEME_ID = "wood";

export function getTheme(id: string): BoardTheme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
