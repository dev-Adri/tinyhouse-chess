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
import type { AnalysisResult } from "@/app/lib/engine/types";

/** Long enough that stepping through a line does not queue a search per position. */
const DEBOUNCE_MS = 250;

/**
 * The engine's answer, tagged with the node it was asked about. Comparing that
 * tag with the current cursor is the whole staleness story: a reply that lands
 * after the user has moved on simply stops matching and is never shown.
 */
interface Evaluation {
  cursor: string;
  result: AnalysisResult | null;
  error: string | null;
}

export interface AnalysisState {
  tree: MoveTree;
  cursor: string;
}

export function useAnalysis(enabled: boolean, initial?: AnalysisState) {
  const [tree, setTree] = useState<MoveTree>(() => initial?.tree ?? createTree());
  const [cursor, setCursor] = useState<string>(() => initial?.cursor ?? tree.root);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

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

  // --- engine ---------------------------------------------------------------

  useEffect(() => {
    if (!enabled || outcome.over) return;

    const controller = new AbortController();
    const requested = cursor;
    let cancelled = false;

    // The request is fired from the timer rather than the effect body, so
    // stepping quickly through a line cancels before anything is sent.
    const timer = setTimeout(() => {
      fetchAnalysis(uciPath, { fen: startFen }, controller.signal)
        .then((result) => {
          if (!cancelled) setEvaluation({ cursor: requested, result, error: null });
        })
        .catch((error: Error) => {
          if (cancelled || error.name === "AbortError") return;
          setEvaluation({ cursor: requested, result: null, error: error.message });
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, cursor, uciPath, startFen, outcome.over]);

  // Everything the panel shows is derived, so switching modes or walking into a
  // finished line needs no clean-up pass of its own.
  const settled = evaluation && evaluation.cursor === cursor ? evaluation : null;
  const live = enabled && !outcome.over;

  return {
    tree,
    cursor,
    state,
    moves,
    outcome,
    path,
    uciPath,
    mainLine: useMemo(() => mainLine(tree), [tree]),
    analysis: live ? (settled?.result ?? null) : null,
    analysisError: live ? (settled?.error ?? null) : null,
    analysing: live && !settled,
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
