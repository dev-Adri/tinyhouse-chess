import { describe, expect, it } from "vitest";
import {
  SQUARE_COUNT,
  applyMove,
  createGame,
  fromFen,
  legalMoves,
  movesEqual,
  parseSquare,
  setupProblem,
  stateFrom,
  toFen,
  type Board,
  type Color,
  type PieceType,
  type Reserve,
} from "./engine";
import { moveFromUci } from "./uci";
import { deserialize, positionAt, serialize, treeFromHistory } from "./variations";

const noReserves = (): Record<Color, Reserve> => ({
  w: { P: 0, W: 0, F: 0, H: 0 },
  b: { P: 0, W: 0, F: 0, H: 0 },
});

/** Builds a position from `square: piece` pairs, e.g. `{ a1: "Kw" }`. */
function position(
  pieces: Record<string, string>,
  turn: Color = "w",
  reserves = noReserves(),
) {
  const board: Board = Array(SQUARE_COUNT).fill(null);
  for (const [square, code] of Object.entries(pieces)) {
    board[parseSquare(square)] = {
      type: code[0] as PieceType,
      color: code[1] as Color,
      ...(code[2] === "~" ? { promoted: true } : {}),
    };
  }
  return stateFrom(board, reserves, turn);
}

describe("fromFen", () => {
  it("round-trips the starting position", () => {
    const start = createGame();
    const parsed = fromFen(toFen(start));

    expect(parsed).not.toBeNull();
    expect(parsed!.board).toEqual(start.board);
    expect(parsed!.reserves).toEqual(start.reserves);
    expect(parsed!.turn).toBe(start.turn);
    expect(toFen(parsed!)).toBe(toFen(start));
  });

  it("round-trips reserves, promoted pieces and the side to move", () => {
    const original = position(
      { a1: "Kw", d4: "Kb", b2: "Ww", c3: "Fb~" },
      "b",
      { w: { P: 2, W: 0, F: 1, H: 0 }, b: { P: 0, W: 1, F: 0, H: 3 } },
    );
    const parsed = fromFen(toFen(original));

    expect(parsed).not.toBeNull();
    expect(toFen(parsed!)).toBe(toFen(original));
    expect(parsed!.board[parseSquare("c3")]).toEqual({ type: "F", color: "b", promoted: true });
    expect(parsed!.reserves.w.P).toBe(2);
    expect(parsed!.reserves.b.H).toBe(3);
    expect(parsed!.turn).toBe("b");
  });

  it("starts with no history, so the position is the beginning of its own game", () => {
    const parsed = fromFen(toFen(position({ a1: "Kw", d4: "Kb" })))!;

    expect(parsed.history).toEqual([]);
    expect(parsed.lastMove).toBeNull();
    expect(parsed.keys).toEqual([toFen(parsed)]);
  });

  it("rejects malformed input", () => {
    expect(fromFen("")).toBeNull();
    expect(fromFen("nonsense")).toBeNull();
    expect(fromFen("fhwk/3p/P3[] w")).toBeNull(); // three ranks
    expect(fromFen("fhwk/3p/P3/KWHF[] x")).toBeNull(); // no such side
    expect(fromFen("fhwk/3p/P3/KWHFF[] w")).toBeNull(); // rank too long
    expect(fromFen("fhwk/3p/P3/KWH[] w")).toBeNull(); // rank too short
    expect(fromFen("fhwk/3p/P3/KWHZ[] w")).toBeNull(); // no such piece
    expect(fromFen("fhwk/3p/P3/KWHF[Z] w")).toBeNull(); // no such reserve piece
  });
});

describe("setupProblem", () => {
  it("accepts a position with one king each and nobody wrongly in check", () => {
    expect(setupProblem(position({ a1: "Kw", d4: "Kb" }))).toBeNull();
  });

  it("insists on exactly one king per side", () => {
    expect(setupProblem(position({ d4: "Kb" }))).toMatch(/White/);
    expect(setupProblem(position({ a1: "Kw" }))).toMatch(/Black/);
    expect(setupProblem(position({ a1: "Kw", b1: "Kw", d4: "Kb" }))).toMatch(/White/);
  });

  it("rejects a position where the side that just moved is still in check", () => {
    // White wazir on c4 attacks the black king on d4, but it is White to move.
    const problem = setupProblem(position({ a1: "Kw", d4: "Kb", c4: "Ww" }, "w"));
    expect(problem).toMatch(/Black is in check/);
  });

  it("allows the side to move to be in check", () => {
    expect(setupProblem(position({ a1: "Kw", d4: "Kb", c4: "Ww" }, "b"))).toBeNull();
  });
});

describe("analysing a hand-built position", () => {
  it("generates legal moves from it and plays them", () => {
    const start = position({ a1: "Kw", d4: "Kb", b2: "Ww" }, "w");
    const moves = legalMoves(start);
    expect(moves.length).toBeGreaterThan(0);

    const wanted = moveFromUci("b2b3");
    const move = moves.find((candidate) => movesEqual(candidate, wanted));
    expect(move).toBeDefined();

    const next = applyMove(start, move!);
    expect(next.turn).toBe("b");
    expect(next.history).toHaveLength(1);
  });

  it("survives a save and reload with its start position intact", () => {
    const start = position(
      { a1: "Kw", d4: "Kb", b2: "Ww" },
      "w",
      { w: { P: 1, W: 0, F: 0, H: 0 }, b: { P: 0, W: 0, F: 2, H: 0 } },
    );
    let seeded = start;
    const move = legalMoves(seeded).find((candidate) =>
      movesEqual(candidate, moveFromUci("b2b3")),
    )!;
    seeded = applyMove(seeded, move);

    const tree = treeFromHistory(seeded.history, start);
    const restored = deserialize(serialize(tree));

    expect(restored).not.toBeNull();
    expect(toFen(restored!.start)).toBe(toFen(start));
    expect(restored!.start.reserves).toEqual(start.reserves);

    const tip = Object.values(restored!.nodes).find((node) => node.children.length === 0)!;
    expect(toFen(positionAt(restored!, tip.id))).toBe(toFen(seeded));
  });

  it("refuses a payload whose start position is corrupt", () => {
    const tree = treeFromHistory([], position({ a1: "Kw", d4: "Kb" }));
    const tampered = JSON.parse(serialize(tree));
    tampered.start = "not-a-fen";
    expect(deserialize(JSON.stringify(tampered))).toBeNull();
  });
});
