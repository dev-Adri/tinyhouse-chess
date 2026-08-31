"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createGame, getOutcome, legalMoves, toFen, type Move } from "@/app/lib/tinyhouse/engine";
import { moveToUci } from "@/app/lib/tinyhouse/uci";
import {
  addMove,
  createTree,
  mainLine,
  pathTo,
  positionAt,
  promoteToMainLine,
  remove,
  type MoveTree,
} from "@/app/lib/tinyhouse/variations";
import { fetchAnalysis } from "@/app/lib/engine/client";
import type { AnalysisResult, GameReview } from "@/app/lib/engine/types";
import { verdictFrom, verdictFromReview, type MoveVerdict } from "@/app/lib/engine/verdict";

/** Long enough that stepping through a line does not queue a search per position. */
const DEBOUNCE_MS = 250;

/**
 * Evaluations, keyed by node id. Node ids are stable within a tree and a
 * node's position never changes, so this cache cannot go stale — a new tree
 * (or a new depth) simply gets a new one.
 */
type Evaluations = Record<string, AnalysisResult>;

/** An error is tied to the node it happened on, so it clears by navigating. */
interface EvalError {
  cursor: string;
  message: string;
}

const NO_VERDICTS: Record<string, MoveVerdict> = {};

export interface AnalysisState {
  tree: MoveTree;
  cursor: string;
}

export function useAnalysis(
  enabled: boolean,
  options: { depth: number; review: GameReview | null; initial?: AnalysisState },
) {
  const { depth, review, initial } = options;
  const [tree, setTree] = useState<MoveTree>(() => initial?.tree ?? createTree());
  const [cursor, setCursor] = useState<string>(() => initial?.cursor ?? tree.root);
  const [evals, setEvals] = useState<Evaluations>({});
  const [error, setError] = useState<EvalError | null>(null);

  const state = useMemo(() => positionAt(tree, cursor), [tree, cursor]);
  const moves = useMemo(() => legalMoves(state), [state]);
  const outcome = useMemo(() => getOutcome(state, moves), [state, moves]);
  const path = useMemo(() => pathTo(tree, cursor), [tree, cursor]);
  const uciPath = useMemo(
    () => path.slice(1).map((id) => moveToUci(tree.nodes[id].move!)),
    [path, tree],
  );

  /**
   * Null when the tree starts from the normal opening, so ordinary analysis
   * sends what it always did; a hand-built root travels as a FEN.
   */
  const startFen = useMemo(() => {
    const fen = toFen(tree.start);
    return fen === toFen(createGame()) ? null : fen;
  }, [tree.start]);

  /**
   * Replaces the whole analysis — used by "Analyse from here". `then` plays a
   * move on the freshly loaded tree, which is how a move on a rewound board
   * both opens the analysis and lands as a branch in one step.
   */
  const load = useCallback((next: MoveTree, nodeId?: string, then?: Move) => {
    // A different tree means different node ids; a stale cache would attach
    // one line's evaluations to another's moves.
    setEvals({});
    setError(null);
    const at = nodeId ?? next.root;
    if (then) {
      const result = addMove(next, at, then);
      setTree(result.tree);
      setCursor(result.nodeId);
      return;
    }
    setTree(next);
    setCursor(at);
  }, []);

  const reset = useCallback(() => load(createTree()), [load]);

  /** Plays a move at the cursor; a move that diverges becomes a new variation. */
  const play = useCallback(
    (move: Move) => {
      const result = addMove(tree, cursor, move);
      setTree(result.tree);
      setCursor(result.nodeId);
    },
    [tree, cursor],
  );

  const goTo = useCallback((nodeId: string) => setCursor(nodeId), []);

  const back = useCallback(() => {
    setCursor((current) => tree.nodes[current]?.parent ?? current);
  }, [tree]);

  const forward = useCallback(() => {
    setCursor((current) => tree.nodes[current]?.children[0] ?? current);
  }, [tree]);

  const toStart = useCallback(() => setCursor(tree.root), [tree]);

  const toEnd = useCallback(() => {
    setCursor((current) => {
      let id = current;
      let node = tree.nodes[id];
      while (node && node.children.length > 0) {
        id = node.children[0];
        node = tree.nodes[id];
      }
      return id;
    });
  }, [tree]);

  const promote = useCallback(
    (nodeId: string) => setTree(promoteToMainLine(tree, nodeId)),
    [tree],
  );

  /** Deleting the branch the cursor sits on moves it up to the surviving parent. */
  const deleteNode = useCallback(
    (nodeId: string) => {
      const doomed = new Set<string>();
      const stack = [nodeId];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (!tree.nodes[id] || doomed.has(id)) continue;
        doomed.add(id);
        stack.push(...tree.nodes[id].children);
      }
      const result = remove(tree, nodeId);
      setTree(result.tree);
      if (doomed.has(cursor)) setCursor(result.nodeId);
    },
    [tree, cursor],
  );

  // Evaluations are only comparable at one depth, so changing it starts over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvals({});
    setError(null);
  }, [depth]);

  // --- engine ---------------------------------------------------------------

  const parentId = tree.nodes[cursor]?.parent ?? null;
  const haveCursor = Boolean(evals[cursor]);
  const haveParent = parentId === null || Boolean(evals[parentId]);

  useEffect(() => {
    if (!enabled || outcome.over) return;
    if (haveCursor && haveParent) return;

    const controller = new AbortController();
    let cancelled = false;

    // Fired from the timer rather than the effect body, so stepping quickly
    // through a line cancels before anything is sent.
    const timer = setTimeout(() => {
      const wanted: { id: string; path: string[] }[] = [];
      if (!haveCursor) wanted.push({ id: cursor, path: uciPath });
      // The parent is what turns an evaluation into a grade for the move
      // played. Normally already cached — you arrive at a node from its parent
      // — so this second request is the exception, not the rule.
      if (!haveParent && parentId) wanted.push({ id: parentId, path: uciPath.slice(0, -1) });

      for (const { id, path } of wanted) {
        fetchAnalysis(path, { fen: startFen, depth }, controller.signal)
          .then((result) => {
            if (cancelled) return;
            setEvals((current) => ({ ...current, [id]: result }));
            setError(null);
          })
          .catch((failure: Error) => {
            if (cancelled || failure.name === "AbortError") return;
            setError({ cursor, message: failure.message });
          });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    enabled,
    cursor,
    parentId,
    haveCursor,
    haveParent,
    uciPath,
    startFen,
    depth,
    outcome.over,
  ]);

  /**
   * Grades taken from a review report, keyed by node. The report describes the
   * game as played, which `treeFromHistory` lays down as the main line, so ply
   * i is `mainLine(tree)[i + 1]`. The SAN check stops a report being pinned to
   * a tree it no longer describes.
   */
  const seeded = useMemo(() => {
    if (!review) return NO_VERDICTS;
    const line = mainLine(tree);
    const out: Record<string, MoveVerdict> = {};
    for (const ply of review.plies) {
      const id = line[ply.ply + 1];
      if (!id || tree.nodes[id].san !== ply.san) break;
      out[id] = verdictFromReview(ply);
    }
    return out;
  }, [review, tree]);

  /**
   * A grade for every node whose own and whose parent's evaluation are both
   * cached, which is every node you have walked through. Seeded grades win:
   * they come from the review's own search, which is at least as deep.
   */
  const verdicts = useMemo(() => {
    const out: Record<string, MoveVerdict> = { ...seeded };
    for (const [id, child] of Object.entries(evals)) {
      if (out[id]) continue;
      const node = tree.nodes[id];
      if (!node || node.parent === null || !node.move) continue;
      const parent = evals[node.parent];
      if (!parent) continue;
      const alternatives = legalMoves(positionAt(tree, node.parent)).length;
      const verdict = verdictFrom(parent, child, moveToUci(node.move), alternatives);
      if (verdict) out[id] = verdict;
    }
    return out;
  }, [seeded, evals, tree]);

  const live = enabled && !outcome.over;
  const current = evals[cursor] ?? null;
  const currentError = error && error.cursor === cursor ? error.message : null;

  return {
    tree,
    cursor,
    state,
    moves,
    outcome,
    path,
    uciPath,
    mainLine: useMemo(() => mainLine(tree), [tree]),
    analysis: live ? current : null,
    analysisError: live ? currentError : null,
    analysing: live && !current && !currentError,
    verdicts,
    play,
    goTo,
    back,
    forward,
    toStart,
    toEnd,
    promote,
    deleteNode,
    load,
    reset,
  };
}
