import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode } from '../../../../shared/types'
import { isTerminalLeafId, type TerminalLeafId } from '../../../../shared/stable-pane-id'
import { mintStablePaneId } from '@/lib/pane-manager/mint-stable-pane-id'

const EMPTY_TERMINAL_LAYOUT: TerminalLayoutSnapshot = {
  root: null,
  activeLeafId: null,
  expandedLeafId: null
}

type LeafIdRewrite = {
  nextLeafIdByInputLeafId: Map<string, TerminalLeafId>
  duplicatedInputLeafIds: Set<string>
}

function cloneLayoutWithLeafRewrite(
  node: TerminalPaneLayoutNode,
  rewrite: LeafIdRewrite
): TerminalPaneLayoutNode {
  if (node.type === 'leaf') {
    const replacement = rewrite.nextLeafIdByInputLeafId.get(node.leafId) ?? mintStablePaneId()
    return { type: 'leaf', leafId: replacement }
  }
  return {
    ...node,
    first: cloneLayoutWithLeafRewrite(node.first, rewrite),
    second: cloneLayoutWithLeafRewrite(node.second, rewrite)
  }
}

function remapLeafRecord(
  source: Record<string, string> | undefined,
  rewrite: LeafIdRewrite
): Record<string, string> | undefined {
  if (!source) {
    return undefined
  }
  const next: Record<string, string> = {}
  for (const [leafId, value] of Object.entries(source)) {
    if (rewrite.duplicatedInputLeafIds.has(leafId)) {
      continue
    }
    const nextLeafId = rewrite.nextLeafIdByInputLeafId.get(leafId)
    if (nextLeafId) {
      next[nextLeafId] = value
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function collectLeafCounts(
  node: TerminalPaneLayoutNode,
  counts: Map<string, number> = new Map()
): Map<string, number> {
  if (node.type === 'leaf') {
    counts.set(node.leafId, (counts.get(node.leafId) ?? 0) + 1)
    return counts
  }
  collectLeafCounts(node.first, counts)
  collectLeafCounts(node.second, counts)
  return counts
}

function firstLeafId(node: TerminalPaneLayoutNode | null): string | null {
  if (!node) {
    return null
  }
  return node.type === 'leaf' ? node.leafId : firstLeafId(node.first)
}

function getRemappedLeafId(
  leafId: string | null | undefined,
  rewrite: LeafIdRewrite
): string | null {
  if (!leafId || rewrite.duplicatedInputLeafIds.has(leafId)) {
    return null
  }
  return rewrite.nextLeafIdByInputLeafId.get(leafId) ?? null
}

export function normalizeTerminalLayoutSnapshot(
  snapshot: TerminalLayoutSnapshot | null | undefined
): { snapshot: TerminalLayoutSnapshot; changed: boolean } {
  if (!snapshot?.root) {
    return { snapshot: snapshot ?? EMPTY_TERMINAL_LAYOUT, changed: false }
  }
  const counts = collectLeafCounts(snapshot.root)
  const duplicatedInputLeafIds = new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([leafId]) => leafId)
  )
  const nextLeafIdByInputLeafId = new Map<string, TerminalLeafId>()
  let changed = false
  for (const [leafId, count] of counts) {
    if (count === 1 && isTerminalLeafId(leafId)) {
      nextLeafIdByInputLeafId.set(leafId, leafId)
      continue
    }
    changed = true
    if (count === 1) {
      nextLeafIdByInputLeafId.set(leafId, mintStablePaneId())
    }
  }
  const inputLeafIds = new Set(counts.keys())
  const selectionChanged =
    (snapshot.activeLeafId !== null &&
      snapshot.activeLeafId !== undefined &&
      !inputLeafIds.has(snapshot.activeLeafId)) ||
    (snapshot.expandedLeafId !== null &&
      snapshot.expandedLeafId !== undefined &&
      !inputLeafIds.has(snapshot.expandedLeafId))
  if (!changed && !selectionChanged) {
    return { snapshot, changed: false }
  }
  const rewrite: LeafIdRewrite = { nextLeafIdByInputLeafId, duplicatedInputLeafIds }
  const root = changed ? cloneLayoutWithLeafRewrite(snapshot.root, rewrite) : snapshot.root
  // Why: split panes can be restored after a leaf was closed elsewhere; stale
  // selection ids must not strand focus on a missing pane.
  const activeLeafId = getRemappedLeafId(snapshot.activeLeafId, rewrite) ?? firstLeafId(root)
  const expandedLeafId = getRemappedLeafId(snapshot.expandedLeafId, rewrite)
  const ptyIdsByLeafId = remapLeafRecord(snapshot.ptyIdsByLeafId, rewrite)
  const buffersByLeafId = remapLeafRecord(snapshot.buffersByLeafId, rewrite)
  const scrollbackRefsByLeafId = remapLeafRecord(snapshot.scrollbackRefsByLeafId, rewrite)
  const titlesByLeafId = remapLeafRecord(snapshot.titlesByLeafId, rewrite)
  const {
    ptyIdsByLeafId: _oldPtyIdsByLeafId,
    buffersByLeafId: _oldBuffersByLeafId,
    scrollbackRefsByLeafId: _oldScrollbackRefsByLeafId,
    titlesByLeafId: _oldTitlesByLeafId,
    ...snapshotWithoutLeafRecords
  } = snapshot
  return {
    snapshot: {
      ...snapshotWithoutLeafRecords,
      root,
      activeLeafId,
      expandedLeafId,
      ...(ptyIdsByLeafId ? { ptyIdsByLeafId } : {}),
      ...(buffersByLeafId ? { buffersByLeafId } : {}),
      ...(scrollbackRefsByLeafId ? { scrollbackRefsByLeafId } : {}),
      ...(titlesByLeafId ? { titlesByLeafId } : {})
    },
    changed: true
  }
}

export function collectLeafIdsInOrder(node: TerminalPaneLayoutNode | null | undefined): string[] {
  if (!node) {
    return []
  }
  if (node.type === 'leaf') {
    return [node.leafId]
  }
  return [...collectLeafIdsInOrder(node.first), ...collectLeafIdsInOrder(node.second)]
}

export function resolvePtyBoundActiveLeafId(args: {
  root: TerminalPaneLayoutNode | null | undefined
  activeLeafId: string | null | undefined
  ptyIdsByLeafId: Record<string, string> | null | undefined
}): string | null {
  const leafIds = collectLeafIdsInOrder(args.root)
  const leafIdSet = new Set(leafIds)
  const ptyIdsByLeafId = args.ptyIdsByLeafId ?? {}
  if (
    args.activeLeafId &&
    ptyIdsByLeafId[args.activeLeafId] &&
    (leafIds.length === 0 || leafIdSet.has(args.activeLeafId))
  ) {
    return args.activeLeafId
  }

  const firstBoundLeafId = leafIds.find((leafId) => ptyIdsByLeafId[leafId])
  if (firstBoundLeafId) {
    return firstBoundLeafId
  }

  if (leafIds.length === 0) {
    return Object.keys(ptyIdsByLeafId)[0] ?? args.activeLeafId ?? null
  }

  if (args.activeLeafId && leafIdSet.has(args.activeLeafId)) {
    return args.activeLeafId
  }
  return leafIds[0] ?? null
}

export function getLeftmostLeafId(node: TerminalPaneLayoutNode): string {
  return node.type === 'leaf' ? node.leafId : getLeftmostLeafId(node.first)
}

function collectReplayCreatedPaneLeafIds(
  node: Extract<TerminalPaneLayoutNode, { type: 'split' }>,
  leafIdsInReplayCreationOrder: string[]
): void {
  // Why: replayTerminalLayout() creates one new pane per split and assigns it
  // to the split's second subtree before recursing, so the new pane maps to
  // the leftmost leaf reachable within that second subtree.
  leafIdsInReplayCreationOrder.push(getLeftmostLeafId(node.second))

  if (node.first.type === 'split') {
    collectReplayCreatedPaneLeafIds(node.first, leafIdsInReplayCreationOrder)
  }
  if (node.second.type === 'split') {
    collectReplayCreatedPaneLeafIds(node.second, leafIdsInReplayCreationOrder)
  }
}

export function collectLeafIdsInReplayCreationOrder(
  node: TerminalPaneLayoutNode | null | undefined
): string[] {
  if (!node) {
    return []
  }
  const leafIdsInReplayCreationOrder = [getLeftmostLeafId(node)]
  if (node.type === 'split') {
    collectReplayCreatedPaneLeafIds(node, leafIdsInReplayCreationOrder)
  }
  return leafIdsInReplayCreationOrder
}
