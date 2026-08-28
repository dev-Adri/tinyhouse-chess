import type { BestMoveResponse, EngineHealth, GameReview } from "./types";

const BASE = "/api/engine";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error ?? `engine request failed (${response.status})`);
  }
  return data as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<EngineHealth> {
  return call<EngineHealth>("health", { method: "GET", signal });
}

export function fetchBestMove(
  moves: string[],
  level: number,
  signal?: AbortSignal,
): Promise<BestMoveResponse> {
  return call<BestMoveResponse>("bestmove", {
    method: "POST",
    body: JSON.stringify({ moves, level }),
    signal,
  });
}

export function fetchReview(
  moves: string[],
  options: { depth?: number; timeMs?: number } = {},
  signal?: AbortSignal,
): Promise<GameReview> {
  return call<GameReview>("review", {
    method: "POST",
    body: JSON.stringify({ moves, depth: options.depth ?? 8, timeMs: options.timeMs ?? 400 }),
    signal,
  });
}
