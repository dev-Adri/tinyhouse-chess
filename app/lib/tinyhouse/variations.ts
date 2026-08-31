/**
 * The move tree behind the analysis board.
 *
 * A game is a path from the root; a variation is a second child hanging off
 * the node where it diverges. `children[0]` *is* the main continuation, so
 * promoting a variation is a reordering of that array and nothing else needs
 * to stay in sync.
 *
 * Every operation is pure and returns a new tree. Positions are never stored —
 * they are replayed from the root with `applyMove` and cached per tree, so a
 * tree stays cheap to copy and safe to hold in React state.
 */

import {
  applyMove,
  createGame,
  fromFen,
  legalMoves,
  movesEqual,
  toFen,
  type GameState,
  type Move,
} from "./engine";
import { moveFromUci, moveToUci } from "./uci";

export interface TreeNode {
  id: string;
  /** null only at the root, which holds the starting position. */
  move: Move | null;
  /** "" at the root. */
  san: string;
  parent: string | null;
  /** children[0] is the main continuation. */
  children: string[];
}

export interface MoveTree {
  root: string;
  nodes: Record<string, TreeNode>;
  /** The position the root represents. */
  start: GameState;
  /** Monotonic counter, so ids stay stable across edits. */
  nextId: number;
}

const STORAGE_VERSION = 1;

export function createTree(start: GameState = createGame()): MoveTree {
  const root: TreeNode = { id: "0", move: null, san: "", parent: null, children: [] };
  return { root: root.id, nodes: { [root.id]: root }, start, nextId: 1 };
}

/** Shallow-copies the node map so callers can edit without touching `tree`. */
function edit(tree: MoveTree): MoveTree {
  const nodes: Record<string, TreeNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) nodes[id] = { ...node };
  return { ...tree, nodes };
}

/** Node ids from the root down to `nodeId`, inclusive. */
export function pathTo(tree: MoveTree, nodeId: string): string[] {
  const path: string[] = [];
  let current: string | null = nodeId;
  while (current) {
    const node: TreeNode | undefined = tree.nodes[current];
    if (!node) return [];
    path.push(current);
    current = node.parent;
  }
  return path.reverse();
}

/** Node ids from the root down the first child of each node, inclusive. */
export function mainLine(tree: MoveTree): string[] {
  const line = [tree.root];
  let node = tree.nodes[tree.root];
  while (node && node.children.length > 0) {
    const next = node.children[0];
    line.push(next);
    node = tree.nodes[next];
  }
  return line;
}

/** True when every step from the root to `nodeId` is a first child. */
export function isMainLine(tree: MoveTree, nodeId: string): boolean {
  const path = pathTo(tree, nodeId);
  if (path.length === 0) return false;
  for (let i = 1; i < path.length; i++) {
    if (tree.nodes[path[i - 1]].children[0] !== path[i]) return false;
  }
  return true;
}

/**
 * Replayed positions, cached per tree. Trees are immutable, so a cache keyed
 * by the tree object can never go stale; a new tree simply gets a new cache.
 */
const positions = new WeakMap<MoveTree, Map<string, GameState>>();

export function positionAt(tree: MoveTree, nodeId: string): GameState {
  let cache = positions.get(tree);
  if (!cache) {
    cache = new Map();
    positions.set(tree, cache);
  }
  const cached = cache.get(nodeId);
  if (cached) return cached;

  // Walk down from the deepest cached ancestor, caching each step on the way.
  const path = pathTo(tree, nodeId);
  let state = tree.start;
  let index = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const hit = cache.get(path[i]);
    if (hit) {
      state = hit;
      index = i;
      break;
    }
  }
  for (let i = index + 1; i < path.length; i++) {
    const move = tree.nodes[path[i]].move;
    if (move) state = applyMove(state, move);
    cache.set(path[i], state);
  }
  cache.set(nodeId, state);
  return state;
}

/**
 * Plays `move` at `nodeId`. Repeating a move that is already there follows the
 * existing child instead of duplicating it, so walking a line back and forth
 * never grows the tree.
 */
export function addMove(
  tree: MoveTree,
  nodeId: string,
  move: Move,
): { tree: MoveTree; nodeId: string } {
  const parent = tree.nodes[nodeId];
  if (!parent) return { tree, nodeId };

  const existing = parent.children.find((childId) => {
    const child = tree.nodes[childId].move;
    return child && movesEqual(child, move);
  });
  if (existing) return { tree, nodeId: existing };

  const next = applyMove(positionAt(tree, nodeId), move);
  const san = next.history[next.history.length - 1]?.san ?? "";
  const id = String(tree.nextId);

  const updated = edit(tree);
  updated.nodes[id] = { id, move, san, parent: nodeId, children: [] };
  updated.nodes[nodeId].children = [...parent.children, id];
  updated.nextId = tree.nextId + 1;
  return { tree: updated, nodeId: id };
}

/** Makes `nodeId` the first of its siblings — the main continuation there. */
export function promote(tree: MoveTree, nodeId: string): MoveTree {
  const node = tree.nodes[nodeId];
  if (!node || node.parent === null) return tree;
  const siblings = tree.nodes[node.parent].children;
  if (siblings[0] === nodeId) return tree;

  const updated = edit(tree);
  updated.nodes[node.parent].children = [nodeId, ...siblings.filter((id) => id !== nodeId)];
  return updated;
}

/** Promotes every step from `nodeId` up to the root, so it becomes the main line. */
export function promoteToMainLine(tree: MoveTree, nodeId: string): MoveTree {
  let updated = tree;
  for (const id of pathTo(tree, nodeId).slice(1).reverse()) {
    updated = promote(updated, id);
  }
  return updated;
}

/**
 * Deletes `nodeId` and everything below it, returning the parent as the node
 * to select next. The root is never deleted.
 */
export function remove(tree: MoveTree, nodeId: string): { tree: MoveTree; nodeId: string } {
  const node = tree.nodes[nodeId];
  if (!node || node.parent === null) return { tree, nodeId: tree.root };

  const doomed: string[] = [];
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    doomed.push(id);
    stack.push(...tree.nodes[id].children);
  }

  const updated = edit(tree);
  for (const id of doomed) delete updated.nodes[id];
  updated.nodes[node.parent].children = updated.nodes[node.parent].children.filter(
    (id) => id !== nodeId,
  );
  return { tree: updated, nodeId: node.parent };
}

/** A played game as a tree with a single line — what "Analyse from here" needs. */
export function treeFromHistory(
  history: GameState["history"],
  start: GameState = createGame(),
): MoveTree {
  let tree = createTree(start);
  let nodeId = tree.root;
  for (const entry of history) {
    const result = addMove(tree, nodeId, entry.move);
    tree = result.tree;
    nodeId = result.nodeId;
  }
  return tree;
}

interface StoredNode {
  uci: string | null;
  parent: string | null;
  children: string[];
}

/**
 * Moves are stored as UCI and SAN is recomputed on the way back in, so nothing
 * in the payload can drift out of step with the rules.
 */
export function serialize(tree: MoveTree): string {
  const nodes: Record<string, StoredNode> = {};
  for (const node of Object.values(tree.nodes)) {
    nodes[node.id] = {
      uci: node.move ? moveToUci(node.move) : null,
      parent: node.parent,
      children: node.children,
    };
  }
  return JSON.stringify({
    v: STORAGE_VERSION,
    root: tree.root,
    // The root may be a hand-built position, so it travels as a FEN.
    start: toFen(tree.start),
    nodes,
  });
}

/**
 * Returns null for anything that is not a tree of legal moves — a bad version,
 * malformed JSON, an unreachable node, or a move the rules reject. The caller
 * then starts fresh rather than showing a position that cannot exist.
 */
export function deserialize(text: string, fallback: GameState = createGame()): MoveTree | null {
  let payload: {
    v?: number;
    root?: string;
    start?: unknown;
    nodes?: Record<string, StoredNode>;
  };
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload?.v !== STORAGE_VERSION) return null;

  // A payload written before custom start positions simply has no `start`.
  let start = fallback;
  if (typeof payload.start === "string") {
    const parsed = fromFen(payload.start);
    if (!parsed) return null;
    start = parsed;
  }

  const { root, nodes: stored } = payload;
  if (typeof root !== "string" || !stored || typeof stored !== "object") return null;
  if (!stored[root] || stored[root].parent !== null) return null;

  const nodes: Record<string, TreeNode> = {
    [root]: { id: root, move: null, san: "", parent: null, children: [] },
  };
  const states = new Map<string, GameState>([[root, start]]);
  let visited = 0;
  let highestId = Number(root);

  // Breadth-first from the root: every node must be reachable, and every move
  // must be legal in the position its parent replays to.
  const queue = [root];
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    const entry = stored[id];
    if (!entry || !Array.isArray(entry.children)) return null;

    const state = states.get(id)!;
    const children: string[] = [];
    for (const childId of entry.children) {
      const child = stored[childId];
      if (typeof childId !== "string" || !child || child.parent !== id) return null;
      if (nodes[childId]) return null; // already seen: a cycle or a shared child
      if (typeof child.uci !== "string") return null;

      let move: Move;
      try {
        move = moveFromUci(child.uci);
      } catch {
        return null;
      }
      const legal = legalMoves(state).find((candidate) => movesEqual(candidate, move));
      if (!legal) return null;

      const next = applyMove(state, legal);
      nodes[childId] = {
        id: childId,
        move: legal,
        san: next.history[next.history.length - 1]?.san ?? "",
        parent: id,
        children: [],
      };
      states.set(childId, next);
      children.push(childId);
      queue.push(childId);

      const numeric = Number(childId);
      if (Number.isFinite(numeric) && numeric > highestId) highestId = numeric;
    }
    nodes[id].children = children;
  }

  if (visited !== Object.keys(stored).length) return null; // orphaned nodes

  // Ids are derived from what actually survived, so a tampered counter cannot
  // hand out an id that is already taken.
  return { root, nodes, start, nextId: highestId + 1 };
}

/** One move in a rendered line, with the variations that replace it nested under it. */
export interface LineItem {
  nodeId: string;
  /** Half-moves from the root, so numbering is the same inside a variation. */
  ply: number;
  /** Each entry is a complete alternative line, starting with the move itself. */
  variations: LineItem[][];
}

/**
 * The move list as a nested outline: the main continuation from `parentId`,
 * with each move's alternatives hanging off it.
 *
 * Alternatives belong to the *parent*, and are emitted only while walking that
 * parent's main line. Walking into an alternative and asking for its siblings
 * again is what turns a two-way branch into infinite mutual recursion.
 */
export function outline(tree: MoveTree, parentId: string = tree.root, startPly = 0): LineItem[] {
  const line: LineItem[] = [];
  const seen = new Set<string>([parentId]);
  let parent: TreeNode | undefined = tree.nodes[parentId];
  let ply = startPly;

  while (parent && parent.children.length > 0) {
    const main: string = parent.children[0];
    const alternatives = parent.children.slice(1);
    const node: TreeNode | undefined = tree.nodes[main];
    if (!node || seen.has(main)) break; // a malformed tree must not hang the UI
    seen.add(main);

    line.push({
      nodeId: main,
      ply,
      // A variation starts with the move that replaces `main`, then carries on
      // down its own line. Its siblings are this level's business, not its own.
      variations: alternatives
        .filter((alt) => tree.nodes[alt])
        .map((alt) => [
          { nodeId: alt, ply, variations: [] },
          ...outline(tree, alt, ply + 1),
        ]),
    });

    parent = node;
    ply += 1;
  }
  return line;
}
