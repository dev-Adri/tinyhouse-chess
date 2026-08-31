import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEMES, getTheme, type BoardTheme } from "./themes";

const COLOUR_FIELDS = [
  "light",
  "dark",
  "frame",
  "backdrop",
  "label",
  "surface",
  "surfaceText",
  "whitePiece",
  "whiteOutline",
  "blackPiece",
  "blackOutline",
  "selected",
  "lastMove",
  "target",
  "accent",
] as const satisfies readonly (keyof BoardTheme)[];

describe("THEMES", () => {
  it("offers twelve themes", () => {
    expect(THEMES).toHaveLength(12);
  });

  it("has unique ids", () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
  });

  it("adds a genuine light-board choice alongside the dark ones", () => {
    expect(THEMES.filter((theme) => theme.group === "light")).toHaveLength(3);
    expect(THEMES.filter((theme) => theme.group === "dark")).toHaveLength(9);
  });

  it("gives every theme a name and a complete palette", () => {
    for (const theme of THEMES) {
      expect(theme.name.length, `${theme.id} name`).toBeGreaterThan(0);
      for (const field of COLOUR_FIELDS) {
        expect(theme[field], `${theme.id}.${field}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("resolves an unknown id to the default theme", () => {
    expect(getTheme("no-such-theme").id).toBe(DEFAULT_THEME_ID);
  });
});
