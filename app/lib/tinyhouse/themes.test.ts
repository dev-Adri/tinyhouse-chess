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

/** rgba strings rather than hex, so they get their own assertions. */
const OVERLAY_FIELDS = ["overlay", "overlayStrong"] as const satisfies readonly (keyof BoardTheme)[];

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

  it("gives every theme both chrome overlays, darkening on the light ones", () => {
    for (const theme of THEMES) {
      for (const field of OVERLAY_FIELDS) {
        expect(theme[field], `${theme.id}.${field}`).toMatch(/^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
      }
      // A white overlay is invisible on a white panel, and vice versa.
      const expected = theme.group === "light" ? "rgba(0,0,0," : "rgba(255,255,255,";
      for (const field of OVERLAY_FIELDS) {
        expect(theme[field], `${theme.id}.${field}`).toContain(expected);
      }
    }
  });

  it("keeps the light themes' overlays distinct from the dark ones'", () => {
    const dark = THEMES.filter((theme) => theme.group === "dark");
    const light = THEMES.filter((theme) => theme.group === "light");
    for (const field of OVERLAY_FIELDS) {
      const darkValues = new Set(dark.map((theme) => theme[field]));
      const lightValues = new Set(light.map((theme) => theme[field]));
      for (const value of lightValues) {
        expect(darkValues.has(value), `${field} ${value}`).toBe(false);
      }
    }
  });

  it("resolves an unknown id to the default theme", () => {
    expect(getTheme("no-such-theme").id).toBe(DEFAULT_THEME_ID);
  });
});
