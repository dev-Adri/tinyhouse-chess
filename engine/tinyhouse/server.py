"""A small JSON API over the engine.

Deliberately stdlib-only: `python -m tinyhouse.server` and it runs. The Next.js
app proxies to it through /api/engine/*.

    GET  /health              engine status and the difficulty levels
    POST /bestmove            {moves, level, fen?, seed?} -> the move to play
    POST /review              {moves, fen?, depth?, timeMs?} -> a game report
"""

from __future__ import annotations

import argparse
import json
import random
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .analysis import CLASSIFICATIONS, review_game
from .position import Game, Position, move_from_uci
from .search import LEVELS, LEVEL_NAMES, Limits, Searcher, choose_move

MAX_BODY = 1 << 20  # 1 MB is far more than any legal request needs


class EngineError(Exception):
    """A bad request, reported to the caller as a 400."""


def _build_game(payload: dict) -> Game:
    moves = payload.get("moves") or []
    if not isinstance(moves, list) or len(moves) > 1000:
        raise EngineError("moves must be a list of at most 1000 UCI strings")
    fen = payload.get("fen")
    try:
        game = Game(Position.from_fen(fen) if fen else None)
        for text in moves:
            game.push(_legal_move(game, text))
    except EngineError:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced to the client verbatim
        raise EngineError(f"could not replay the game: {exc}") from exc
    return game


def _legal_move(game: Game, text: str) -> int:
    move = move_from_uci(text)
    if move not in game.position.generate_legal():
        raise EngineError(f"illegal move {text!r} in {game.position.to_fen()!r}")
    return move


def handle_bestmove(payload: dict) -> dict:
    game = _build_game(payload)
    level = int(payload.get("level", 4))
    if level not in LEVELS:
        raise EngineError(f"level must be one of {sorted(LEVELS)}")

    status, winner = game.outcome()
    if status != "playing":
        raise EngineError(f"the game is already over ({status})")

    limits = LEVELS[level]
    if payload.get("timeMs"):
        limits = Limits(
            depth=limits.depth,
            time_ms=min(int(payload["timeMs"]), 30_000),
            exact_root=limits.exact_root,
            randomness=limits.randomness,
            blunder_chance=limits.blunder_chance,
        )

    result = Searcher().search(game, limits)
    if not result.root:
        raise EngineError("no legal moves")

    seed = payload.get("seed")
    rng = random.Random(seed) if seed is not None else random.Random()
    played = choose_move(result, limits, rng)
    stm_is_white = game.position.stm == 0

    def white(score: int) -> int:
        return score if stm_is_white else -score

    return {
        "move": played.uci,
        "san": played.san,
        "score": played.score,
        "scoreWhite": white(played.score),
        "mateIn": played.mate_in,
        "isBest": played.uci == result.best,
        "best": result.best,
        "bestScoreWhite": white(result.score),
        "depth": result.depth,
        "nodes": result.nodes,
        "timeMs": result.time_ms,
        "pv": played.pv,
        "level": level,
        "levelName": LEVEL_NAMES[level],
        "top": [
            {
                "uci": entry.uci,
                "san": entry.san,
                "score": entry.score,
                "scoreWhite": white(entry.score),
                "mateIn": entry.mate_in,
            }
            for entry in result.root[:5]
        ],
    }


def handle_review(payload: dict) -> dict:
    moves = payload.get("moves") or []
    if not isinstance(moves, list) or len(moves) > 400:
        raise EngineError("moves must be a list of at most 400 UCI strings")
    # Validate before spending time on the search.
    _build_game(payload)

    limits = Limits(
        depth=max(1, min(int(payload.get("depth", 8)), 20)),
        time_ms=max(20, min(int(payload.get("timeMs", 400)), 5_000)),
        exact_root=True,
    )
    report = review_game(moves, payload.get("fen"), limits)
    data = report.to_json()
    data["classifications"] = CLASSIFICATIONS
    return data


ROUTES = {
    "/bestmove": handle_bestmove,
    "/review": handle_review,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "TinyhouseEngine/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter default logging
        print(f"[engine] {self.address_string()} {fmt % args}")

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - required name
        self._send(200, {"ok": True})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] in ("/health", "/"):
            self._send(
                200,
                {
                    "ok": True,
                    "engine": "tinyhouse",
                    "levels": [
                        {
                            "level": level,
                            "name": LEVEL_NAMES[level],
                            "depth": limits.depth,
                            "timeMs": limits.time_ms,
                        }
                        for level, limits in sorted(LEVELS.items())
                    ],
                },
            )
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        route = ROUTES.get(self.path.split("?")[0])
        if route is None:
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise EngineError("request body too large")
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict):
                raise EngineError("body must be a JSON object")
            self._send(200, route(payload))
        except EngineError as exc:
            self._send(400, {"error": str(exc)})
        except json.JSONDecodeError:
            self._send(400, {"error": "body must be valid JSON"})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": f"engine failure: {exc}"})


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Tinyhouse engine listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Tinyhouse engine server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    serve(args.host, args.port)


if __name__ == "__main__":
    main()
