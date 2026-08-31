/**
 * Move sounds.
 *
 * Which sound a move makes is decided from its SAN, because SAN already
 * records everything that matters: `@` is a drop, `x` a capture, `+` a check,
 * `#` a mate. That keeps the decision a pure function — testable, and with no
 * call sites scattered through the move handlers.
 */

export type SoundKind = "move" | "capture" | "drop" | "check" | "end";

export const SOUND_STORAGE_KEY = "tinyhouse:muted";

const FILES: Record<SoundKind, string> = {
  move: "/sounds/move.wav",
  capture: "/sounds/capture.wav",
  drop: "/sounds/drop.wav",
  check: "/sounds/check.wav",
  end: "/sounds/end.wav",
};

/** Loudest fact first: a mating capture is an ending, not a capture. */
export function soundForSan(san: string): SoundKind {
  if (san.includes("#")) return "end";
  if (san.includes("+")) return "check";
  if (san.includes("x")) return "capture";
  if (san.includes("@")) return "drop";
  return "move";
}

/** One element per sound, reused: stepping quickly must not leak elements. */
const players = new Map<SoundKind, HTMLAudioElement>();

export function playSound(kind: SoundKind): void {
  if (typeof window === "undefined") return;
  try {
    let player = players.get(kind);
    if (!player) {
      player = new Audio(FILES[kind]);
      player.preload = "auto";
      player.volume = 0.55;
      players.set(kind, player);
    }
    player.currentTime = 0;
    // Rejects until the page has had a user gesture. Sound is a garnish, so a
    // refusal is swallowed rather than surfaced.
    void player.play().catch(() => {});
  } catch {
    // No Audio support — the app is otherwise unaffected.
  }
}

export function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
}
