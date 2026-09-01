import { describe, expect, it } from "vitest";
import { applyMove, createGame, legalMoves, movesEqual, type GameState, type Move } from "./engine";
import { moveFromUci } from "./uci";
import {
  addMove,
  createTree,
  outline,
  deserialize,
  isMainLine,
  mainLine,
  pathTo,
  positionAt,
  promote,
  promoteToMainLine,
  remove,
  serialize,
  treeFromHistory,
  type MoveTree,
} from "./variations";

/** The move written as `uci`, asserted legal in `state`. */
function move(state: GameState, uci: string): Move {
  const wanted = moveFromUci(uci);
  const found = legalMoves(state).find((candidate) => movesEqual(candidate, wanted));
  if (!found) throw new Error(`${uci} is not legal here`);
  return found;
}

/** Plays a line of UCI moves from the root, returning the tree and last node. */
function playLine(tree: MoveTree, from: string, ucis: string[]) {
  let nodeId = from;
  for (const uci of ucis) {
    const result = addMove(tree, nodeId, move(positionAt(tree, nodeId), uci));
    tree = result.tree;
    nodeId = result.nodeId;
  }
  return { tree, nodeId };
}

/** SAN along the main line, which is what the move list renders. */
const mainLineSan = (tree: MoveTree) =>
  mainLine(tree)
    .slice(1)
    .map((id) => tree.nodes[id].san);

describe("createTree", () => {
  it("starts with a lone root holding the initial position", () => {
    const tree = createTree();
    expect(Object.keys(tree.nodes)).toEqual([tree.root]);
    expect(tree.nodes[tree.root].move).toBeNull();
    expect(tree.nodes[tree.root].parent).toBeNull();
    expect(positionAt(tree, tree.root).history).toEqual([]);
    expect(mainLine(tree)).toEqual([tree.root]);
  });
});

describe("addMove", () => {
  it("appends a child and records its SAN", () => {
    const tree = createTree();
    const { tree: next, nodeId } = addMove(tree, tree.root, move(createGame(), "a2a3"));

    expect(next.nodes[next.root].children).toEqual([nodeId]);
    expect(next.nodes[nodeId].parent).toBe(next.root);
    expect(next.nodes[nodeId].san).toBe(applyMove(createGame(), move(createGame(), "a2a3")).history[0].san);
  });

  it("leaves the original tree untouched", () => {
    const tree = createTree();
    addMove(tree, tree.root, move(createGame(), "a2a3"));
    expect(tree.nodes[tree.root].children).toEqual([]);
  });

  it("reuses the existing child when the same move is played again", () => {
    const tree = createTree();
    const first = addMove(tree, tree.root, move(createGame(), "a2a3"));
    const second = addMove(first.tree, first.tree.root, move(createGame(), "a2a3"));

    expect(second.nodeId).toBe(first.nodeId);
    expect(second.tree.nodes[second.tree.root].children).toHaveLength(1);
  });

  it("adds a differing move as a sibling without disturbing the main line", () => {
    const tree = createTree();
    const first = addMove(tree, tree.root, move(createGame(), "a2a3"));
    const second = addMove(first.tree, first.tree.root, move(createGame(), "b1b2"));
    const children = second.tree.nodes[second.tree.root].children;

    expect(children).toHaveLength(2);
    expect(children[0]).toBe(first.nodeId); // main line unchanged
    expect(children[1]).toBe(second.nodeId);
    expect(isMainLine(second.tree, first.nodeId)).toBe(true);
    expect(isMainLine(second.tree, second.nodeId)).toBe(false);
  });
});

describe("positionAt", () => {
  it("replays a line to the same state as applying the moves by hand", () => {
    const { tree, nodeId } = playLine(createTree(), createTree().root, ["a2a3", "d3d2"]);

    let expected = createGame();
    expected = applyMove(expected, move(expected, "a2a3"));
    expected = applyMove(expected, move(expected, "d3d2"));

    const actual = positionAt(tree, nodeId);
    expect(actual.board).toEqual(expected.board);
    expect(actual.turn).toBe(expected.turn);
    expect(actual.reserves).toEqual(expected.reserves);
    expect(actual.history.map((entry) => entry.san)).toEqual(
      expected.history.map((entry) => entry.san),
    );
  });

  it("gives a branch its own position, independent of its sibling", () => {
    const base = createTree();
    const line = playLine(base, base.root, ["a2a3"]);
    const branch = addMove(line.tree, base.root, move(createGame(), "b1b2"));

    expect(positionAt(branch.tree, line.nodeId).board).not.toEqual(
      positionAt(branch.tree, branch.nodeId).board,
    );
  });
});

describe("pathTo and mainLine", () => {
  it("walks from the root down to the node, inclusive", () => {
    const base = createTree();
    const { tree, nodeId } = playLine(base, base.root, ["a2a3", "d3d2"]);
    const path = pathTo(tree, nodeId);

    expect(path[0]).toBe(tree.root);
    expect(path).toHaveLength(3);
    expect(path[path.length - 1]).toBe(nodeId);
  });

  it("follows the first child only", () => {
    const base = createTree();
    const line = playLine(base, base.root, ["a2a3", "d3d2"]);
    const branched = addMove(line.tree, base.root, move(createGame(), "b1b2"));

    expect(mainLine(branched.tree)).toEqual(pathTo(branched.tree, line.nodeId));
  });
});

describe("promote", () => {
  it("moves a variation ahead of its siblings", () => {
    const base = createTree();
    const first = addMove(base, base.root, move(createGame(), "a2a3"));
    const second = addMove(first.tree, base.root, move(createGame(), "b1b2"));
    const promoted = promote(second.tree, second.nodeId);

    expect(promoted.nodes[promoted.root].children).toEqual([second.nodeId, first.nodeId]);
    expect(isMainLine(promoted, second.nodeId)).toBe(true);
  });

  it("is a no-op on a node that is already first", () => {
    const base = createTree();
    const first = addMove(base, base.root, move(createGame(), "a2a3"));
    const promoted = promote(first.tree, first.nodeId);

    expect(promoted.nodes[promoted.root].children).toEqual([first.nodeId]);
  });

  it("promoteToMainLine lifts a deep variation all the way to the root", () => {
    // Main line a2a3 d3d2, with a variation a4b3 branching at black's reply.
    const base = createTree();
    const main = playLine(base, base.root, ["a2a3", "d3d2"]);
    const afterWhite = pathTo(main.tree, main.nodeId)[1];
    const sideline = addMove(
      main.tree,
      afterWhite,
      move(positionAt(main.tree, afterWhite), "a4b3"),
    );
    // And a different first move for white, so the root has two children too.
    const other = addMove(sideline.tree, base.root, move(createGame(), "b1b2"));
    const deep = playLine(other.tree, other.nodeId, ["d3d2"]);

    const promoted = promoteToMainLine(deep.tree, deep.nodeId);

    expect(mainLine(promoted)).toEqual(pathTo(promoted, deep.nodeId));
    expect(isMainLine(promoted, deep.nodeId)).toBe(true);
    // The old main line survives as a variation.
    expect(promoted.nodes[promoted.root].children).toHaveLength(2);
    expect(promoted.nodes[main.nodeId]).toBeDefined();
  });
});

describe("remove", () => {
  it("deletes the node and everything under it, returning the parent", () => {
    const base = createTree();
    const line = playLine(base, base.root, ["a2a3", "d3d2"]);
    const target = pathTo(line.tree, line.nodeId)[1];

    const { tree, nodeId } = remove(line.tree, target);

    expect(nodeId).toBe(tree.root);
    expect(tree.nodes[target]).toBeUndefined();
    expect(tree.nodes[line.nodeId]).toBeUndefined();
    expect(tree.nodes[tree.root].children).toEqual([]);
  });

  it("leaves siblings and the rest of the tree alone", () => {
    const base = createTree();
    const first = addMove(base, base.root, move(createGame(), "a2a3"));
    const second = addMove(first.tree, base.root, move(createGame(), "b1b2"));

    const { tree } = remove(second.tree, second.nodeId);

    expect(tree.nodes[tree.root].children).toEqual([first.nodeId]);
    expect(mainLineSan(tree)).toEqual([first.tree.nodes[first.nodeId].san]);
  });

  it("refuses to delete the root", () => {
    const base = createTree();
    const { tree, nodeId } = remove(base, base.root);

    expect(nodeId).toBe(base.root);
    expect(tree).toBe(base);
  });
});

describe("treeFromHistory", () => {
  it("turns a played game into a single main line", () => {
    let game = createGame();
    game = applyMove(game, move(game, "a2a3"));
    game = applyMove(game, move(game, "d3d2"));

    const tree = treeFromHistory(game.history);

    expect(mainLineSan(tree)).toEqual(game.history.map((entry) => entry.san));
    const last = mainLine(tree)[mainLine(tree).length - 1];
    expect(positionAt(tree, last).board).toEqual(game.board);
  });

  it("gives an empty history a lone root", () => {
    const tree = treeFromHistory([]);
    expect(mainLine(tree)).toEqual([tree.root]);
  });
});

describe("serialize and deserialize", () => {
  it("round-trips a branching tree", () => {
    const base = createTree();
    const line = playLine(base, base.root, ["a2a3", "d3d2"]);
    const branched = addMove(line.tree, base.root, move(createGame(), "b1b2"));

    const restored = deserialize(serialize(branched.tree));

    expect(restored).not.toBeNull();
    expect(restored!.root).toBe(branched.tree.root);
    expect(restored!.nodes).toEqual(branched.tree.nodes);
    expect(positionAt(restored!, line.nodeId).board).toEqual(
      positionAt(branched.tree, line.nodeId).board,
    );
  });

  it("keeps ids unique after restoring", () => {
    const base = createTree();
    const line = playLine(base, base.root, ["a2a3"]);
    const restored = deserialize(serialize(line.tree))!;
    const added = addMove(restored, restored.root, move(createGame(), "b1b2"));

    expect(added.nodeId).not.toBe(line.nodeId);
    expect(added.tree.nodes[added.nodeId]).toBeDefined();
  });

  it("rejects malformed, stale and illegal payloads", () => {
    expect(deserialize("not json")).toBeNull();
    expect(deserialize(JSON.stringify({ v: 99, root: "0", nodes: {} }))).toBeNull();

    const base = createTree();
    const line = playLine(base, base.root, ["a2a3"]);
    const tampered = JSON.parse(serialize(line.tree));
    tampered.nodes[line.nodeId].uci = "a2d4"; // not a legal move
    expect(deserialize(JSON.stringify(tampered))).toBeNull();
  });
});

describe("outline", () => {
  it("lists the main line in order", () => {
    const base = createTree();
    const { tree, nodeId } = playLine(base, base.root, ["a2a3", "d3d2"]);
    const rows = outline(tree);

    expect(rows.map((row) => row.ply)).toEqual([0, 1]);
    expect(rows.map((row) => tree.nodes[row.nodeId].san)).toEqual(
      mainLineSan(tree),
    );
    expect(rows[rows.length - 1].nodeId).toBe(nodeId);
    expect(rows.every((row) => row.variations.length === 0)).toBe(true);
  });

  it("terminates on a branch instead of recursing between siblings", () => {
    // The shape that used to hang: two moves at the same point, each listing
    // the other as its alternative for ever.
    const base = createTree();
    const first = addMove(base, base.root, move(createGame(), "a2a3"));
    const second = addMove(first.tree, base.root, move(createGame(), "b1b2"));
    const rows = outline(second.tree);

    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe(first.nodeId);
    expect(rows[0].variations).toHaveLength(1);
    // The variation is the sibling, and it does NOT list the main move again.
    expect(rows[0].variations[0][0].nodeId).toBe(second.nodeId);
    expect(rows[0].variations[0][0].variations).toEqual([]);
    expect(rows[0].variations[0]).toHaveLength(1);
  });

  it("keeps ply numbering consistent inside a variation", () => {
    const base = createTree();
    const main = playLine(base, base.root, ["a2a3", "d3d2"]);
    const afterWhite = pathTo(main.tree, main.nodeId)[1];
    const sideline = addMove(
      main.tree,
      afterWhite,
      move(positionAt(main.tree, afterWhite), "a4b3"),
    );
    const rows = outline(sideline.tree);

    // Black's alternative sits under White's first move and shares its ply.
    expect(rows[0].ply).toBe(0);
    expect(rows[1].ply).toBe(1);
    expect(rows[1].variations[0][0].ply).toBe(1);
  });

  it("carries a variation on down its own continuation", () => {
    const base = createTree();
    const first = addMove(base, base.root, move(createGame(), "a2a3"));
    const second = addMove(first.tree, base.root, move(createGame(), "b1b2"));
    const deep = playLine(second.tree, second.nodeId, ["d3d2"]);
    const rows = outline(deep.tree);

    const variation = rows[0].variations[0];
    expect(variation).toHaveLength(2);
    expect(variation[0].nodeId).toBe(second.nodeId);
    expect(variation[1].nodeId).toBe(deep.nodeId);
    expect(variation.map((item) => item.ply)).toEqual([0, 1]);
  });

  it("gives an empty tree an empty outline", () => {
    expect(outline(createTree())).toEqual([]);
  });

  it("survives a tree whose links form a loop", () => {
    const base = createTree();
    const { tree, nodeId } = playLine(base, base.root, ["a2a3"]);
    const looped = {
      ...tree,
      nodes: { ...tree.nodes, [nodeId]: { ...tree.nodes[nodeId], children: [tree.root] } },
    };

    // Nothing should hang or overflow the stack.
    expect(() => outline(looped)).not.toThrow();
    expect(outline(looped).length).toBeLessThan(5);
  });
});

describe("branching out of a played game", () => {
  /** What the review panel does: replay the game, step back, play something else. */
  it("keeps the game as the main line and hangs the alternative beside it", () => {
    let game = createGame();
    for (const uci of ["a2a3", "d3d2", "b1b2"]) {
      game = applyMove(game, move(game, uci));
    }
    const played = game.history.map((entry) => entry.san);

    // Rewind to just after White's first move and play Black's alternative.
    const tree = treeFromHistory(game.history);
    const atPly1 = mainLine(tree)[1];
    const alternative = move(positionAt(tree, atPly1), "a4b3");
    const branched = addMove(tree, atPly1, alternative);

    // The game as played is untouched and still the main line.
    expect(mainLineSan(branched.tree)).toEqual(played);

    // The alternative is a sibling of the move that was actually played.
    const siblings = branched.tree.nodes[atPly1].children;
    expect(siblings).toHaveLength(2);
    expect(siblings[1]).toBe(branched.nodeId);
    expect(isMainLine(branched.tree, branched.nodeId)).toBe(false);

    // And it is a real position the engine can carry on from.
    const after = positionAt(branched.tree, branched.nodeId);
    expect(after.turn).toBe("w");
    expect(legalMoves(after).length).toBeGreaterThan(0);
  });

  it("shows the alternative as a variation under the move it replaces", () => {
    let game = createGame();
    for (const uci of ["a2a3", "d3d2"]) game = applyMove(game, move(game, uci));

    const tree = treeFromHistory(game.history);
    const atPly1 = mainLine(tree)[1];
    const branched = addMove(tree, atPly1, move(positionAt(tree, atPly1), "a4b3"));
    const rows = outline(branched.tree);

    // Row 0 is White's move, row 1 is Black's as played, with the alternative
    // hanging off it rather than replacing it.
    expect(rows).toHaveLength(2);
    expect(rows[1].variations).toHaveLength(1);
    expect(rows[1].variations[0][0].nodeId).toBe(branched.nodeId);
    expect(rows[1].variations[0][0].ply).toBe(1);
  });

  it("continuing down the alternative extends only that line", () => {
    let game = createGame();
    for (const uci of ["a2a3", "d3d2"]) game = applyMove(game, move(game, uci));
    const played = game.history.map((entry) => entry.san);

    const tree = treeFromHistory(game.history);
    const atPly1 = mainLine(tree)[1];
    const branched = addMove(tree, atPly1, move(positionAt(tree, atPly1), "a4b3"));
    const deeper = playLine(branched.tree, branched.nodeId, ["b1b2"]);

    expect(mainLineSan(deeper.tree)).toEqual(played);
    expect(pathTo(deeper.tree, deeper.nodeId)).toHaveLength(4); // root + 3 moves
  });
});
