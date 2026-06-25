import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/types'
import {
  normalizeTerminalLayoutSnapshot,
  resolvePtyBoundActiveLeafId
} from './terminal-layout-leaf-ids'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'
const LEAF_3 = '33333333-3333-4333-8333-333333333333'
const MISSING_LEAF = '99999999-9999-4999-8999-999999999999'

function splitLayout(): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_1 },
      second: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: LEAF_2 },
        second: { type: 'leaf', leafId: LEAF_3 }
      }
    },
    activeLeafId: LEAF_2,
    expandedLeafId: LEAF_3,
    ptyIdsByLeafId: {
      [LEAF_1]: 'pty-1',
      [LEAF_2]: 'pty-2',
      [LEAF_3]: 'pty-3'
    }
  }
}

describe('normalizeTerminalLayoutSnapshot', () => {
  it('repairs stale active leaf ids to the first leaf in the root layout', () => {
    const layout = splitLayout()
    layout.activeLeafId = MISSING_LEAF

    const normalized = normalizeTerminalLayoutSnapshot(layout)

    expect(normalized.changed).toBe(true)
    expect(normalized.snapshot.activeLeafId).toBe(LEAF_1)
    expect(normalized.snapshot.expandedLeafId).toBe(LEAF_3)
    expect(normalized.snapshot.ptyIdsByLeafId).toEqual(layout.ptyIdsByLeafId)
  })

  it('clears stale expanded leaf ids without changing a valid active leaf', () => {
    const layout = splitLayout()
    layout.expandedLeafId = MISSING_LEAF

    const normalized = normalizeTerminalLayoutSnapshot(layout)

    expect(normalized.changed).toBe(true)
    expect(normalized.snapshot.activeLeafId).toBe(LEAF_2)
    expect(normalized.snapshot.expandedLeafId).toBeNull()
  })

  it('preserves valid active and expanded leaf ids', () => {
    const layout = splitLayout()

    const normalized = normalizeTerminalLayoutSnapshot(layout)

    expect(normalized.changed).toBe(false)
    expect(normalized.snapshot.activeLeafId).toBe(LEAF_2)
    expect(normalized.snapshot.expandedLeafId).toBe(LEAF_3)
  })
})

describe('resolvePtyBoundActiveLeafId', () => {
  it('preserves the active leaf when it still has a PTY binding', () => {
    const layout = splitLayout()

    const activeLeafId = resolvePtyBoundActiveLeafId({
      root: layout.root,
      activeLeafId: LEAF_2,
      ptyIdsByLeafId: layout.ptyIdsByLeafId
    })

    expect(activeLeafId).toBe(LEAF_2)
  })

  it('moves active selection to the first bound layout leaf when the active PTY is gone', () => {
    const layout = splitLayout()

    const activeLeafId = resolvePtyBoundActiveLeafId({
      root: layout.root,
      activeLeafId: LEAF_2,
      ptyIdsByLeafId: {
        [LEAF_1]: 'pty-1',
        [LEAF_3]: 'pty-3'
      }
    })

    expect(activeLeafId).toBe(LEAF_1)
  })

  it('falls back to the current active leaf when no PTY bindings exist', () => {
    const layout = splitLayout()

    const activeLeafId = resolvePtyBoundActiveLeafId({
      root: layout.root,
      activeLeafId: LEAF_2,
      ptyIdsByLeafId: undefined
    })

    expect(activeLeafId).toBe(LEAF_2)
  })

  it('uses a binding key when there is no root layout to inspect', () => {
    const activeLeafId = resolvePtyBoundActiveLeafId({
      root: null,
      activeLeafId: null,
      ptyIdsByLeafId: { [LEAF_3]: 'pty-3' }
    })

    expect(activeLeafId).toBe(LEAF_3)
  })
})
