import { describe, expect, it } from "vitest";
import { soundForSan } from "./sound";

describe("soundForSan", () => {
  it("plays the move sound for a quiet move", () => {
    expect(soundForSan("Fc2")).toBe("move");
    expect(soundForSan("a3")).toBe("move");
  });

  it("plays the capture sound for a capture", () => {
    expect(soundForSan("Hxc2")).toBe("capture");
  });

  it("plays the drop sound for a reserve drop", () => {
    expect(soundForSan("F@a3")).toBe("drop");
    expect(soundForSan("P@b2")).toBe("drop");
  });

  it("plays the check sound when the move gives check", () => {
    expect(soundForSan("Fc2+")).toBe("check");
  });

  it("prefers check over capture and drop, since check is the louder fact", () => {
    expect(soundForSan("Hxc2+")).toBe("check");
    expect(soundForSan("F@a3+")).toBe("check");
  });

  it("plays the end sound for mate, whatever else the move did", () => {
    expect(soundForSan("F@a3#")).toBe("end");
    expect(soundForSan("Hxc2#")).toBe("end");
  });

  it("falls back to the move sound for an empty or odd SAN", () => {
    expect(soundForSan("")).toBe("move");
  });
});
