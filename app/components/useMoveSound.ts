"use client";

import { useEffect, useRef } from "react";
import { playSound, soundForSan } from "@/app/lib/tinyhouse/sound";

/**
 * Plays a sound whenever the move shown on the board changes.
 *
 * `key` identifies the position being shown — the live ply index, or the
 * analysis node id — so stepping between two moves that happen to share a SAN
 * still sounds. The first render is silent: arriving on a page mid-game should
 * not replay the last move.
 */
export function useMoveSound({
  san,
  key,
  muted,
}: {
  san: string | null;
  key: string;
  muted: boolean;
}): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const signature = `${key}:${san ?? ""}`;
    const first = previous.current === null;
    const changed = previous.current !== signature;
    previous.current = signature;
    if (first || !changed || muted || !san) return;
    playSound(soundForSan(san));
    // `muted` is deliberately absent from the deps: muting is not a move, and
    // toggling it should neither play nor swallow a sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [san, key]);
}
