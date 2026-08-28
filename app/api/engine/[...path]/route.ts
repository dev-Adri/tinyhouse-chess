/**
 * Proxies the browser to the Python engine.
 *
 * Keeping it server-side means no CORS dance and the engine's address stays
 * configurable through ENGINE_URL (default http://127.0.0.1:8000).
 */

import { NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8000";
const ALLOWED = new Set(["health", "bestmove", "review"]);
/** Long enough for a Master-level search or a full-game review. */
const TIMEOUT_MS = 120_000;

function engineUnreachable(error: unknown) {
  return NextResponse.json(
    {
      error:
        "The Tinyhouse engine is not running. Start it with `python -m tinyhouse serve` " +
        "in the engine/ directory.",
      detail: error instanceof Error ? error.message : String(error),
    },
    { status: 503 },
  );
}

async function forward(request: Request, path: string[], body?: string) {
  const endpoint = path.join("/");
  if (!ALLOWED.has(endpoint)) {
    return NextResponse.json({ error: `unknown engine route: ${endpoint}` }, { status: 404 });
  }

  try {
    const response = await fetch(`${ENGINE_URL}/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return engineUnreachable(error);
  }
}

export async function GET(request: Request, context: RouteContext<"/api/engine/[...path]">) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: Request, context: RouteContext<"/api/engine/[...path]">) {
  const { path } = await context.params;
  return forward(request, path, await request.text());
}
