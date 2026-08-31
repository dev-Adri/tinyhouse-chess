import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH, clampDepth } from "./storage";

describe("clampDepth", () => {
  it("keeps a value in range", () => {
    expect(clampDepth(4)).toBe(4);
    expect(clampDepth(8)).toBe(8);
    expect(clampDepth(12)).toBe(12);
  });

  it("clamps out-of-range values to the ends", () => {
    expect(clampDepth(1)).toBe(MIN_DEPTH);
    expect(clampDepth(99)).toBe(MAX_DEPTH);
  });

  it("rounds a fractional value", () => {
    expect(clampDepth(7.6)).toBe(8);
  });

  it("falls back to the default for anything that is not a number", () => {
    expect(clampDepth("deep")).toBe(DEFAULT_DEPTH);
    expect(clampDepth(undefined)).toBe(DEFAULT_DEPTH);
    expect(clampDepth(null)).toBe(DEFAULT_DEPTH);
    expect(clampDepth(Number.NaN)).toBe(DEFAULT_DEPTH);
  });
});
