// @vitest-environment jsdom
/**
 * Timeline rail component contract. Mounts the rail against a session-store
 * double whose subscribe/getSnapshot are UNBOUND prototype methods — exactly
 * like the real runtime Session — so a regression to passing the methods bare
 * into useSyncExternalStore (which drops the receiver and throws "Cannot read
 * properties of undefined") fails this suite. Also pins the visibility gates:
 * no rail while the persisted timeline toggle is still loading or switched
 * off, and no full-history paging when the rail is off. Also pins the
 * projection-first data source: entries from the host bgTimeline projection
 * render even when their chat nodes were never loaded into the client
 * window.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { MARKS_STORAGE_PREFIX, TimelineRail } from '../src/client/timeline.tsx'
import { settingsClient } from '../src/client/settings-client.ts'
import type { BackgroundSettings } from '../src/settings.ts'

const t = (key: string): string => key

/** One user chat node the collector accepts. */
function userNode(key: string, anchorSeq: number, text: string): object {
  return {
    kind: 'user',
    key,
    anchorSeq,
    data: { time: 1, content: [{ type: 'text', text }] },
  }
}

/**
 * Session-like store with prototype methods (the real Session shape): the
 * methods read `this`, so bare extraction would throw.
 */
class SessionLike {
  readonly loadOlderCalls: number[] = []
  private listeners = new Set<() => void>()
  constructor(private readonly snap: { chat: { nodes: Map<string, object> }; hasMore: boolean }) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): unknown {
    return this.snap
  }

  loadOlder(): Promise<void> {
    this.loadOlderCalls.push(this.snap.chat.nodes.size)
    return Promise.resolve()
  }
}

function snapshotWith(nodes: Map<string, object>, hasMore = false): { chat: { nodes: Map<string, object> }; hasMore: boolean } {
  return { chat: { nodes }, hasMore }
}

/** Write the shared settings snapshot (the rail reads it via uSES). */
function setSettings(status: 'loading' | 'ready' | 'error', timeline: boolean): void {
  ;(settingsClient as unknown as { snapshot: unknown }).snapshot = {
    status,
    value: { timeline } as unknown as BackgroundSettings,
  }
}

function renderRail(sessionId: string, store: SessionLike, projected?: unknown): void {
  const extra = projected === undefined ? {} : { useProjection: (): unknown => projected }
  render(React.createElement(TimelineRail as never, {
    sessionId,
    sessionsService: { binding: (id: string) => id === sessionId ? { session: store } : undefined },
    ...extra,
    t,
  }))
}

afterEach(() => {
  cleanup()
  document.body.style.cssText = ''
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(MARKS_STORAGE_PREFIX)) window.localStorage.removeItem(key)
  }
  setSettings('loading', true)
})

describe('TimelineRail component', () => {
  it('renders one tick per user message from an unbound-method session store (P0 regression)', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    // Before the receiver fix this call threw TypeError (undefined notifier).
    expect(() => renderRail('s1', store)).not.toThrow()
    const nav = document.querySelector('.dsbt-nav')
    expect(nav).not.toBeNull()
    expect(nav?.querySelectorAll('.dsbt-item')).toHaveLength(2)
    expect(store.loadOlderCalls).toHaveLength(0) // hasMore false: no paging
  })

  it('renders the rail for a single-question session (official ScrollNav shows it too)', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'only')],
    ])))
    renderRail('s1', store)
    const nav = document.querySelector('.dsbt-nav')
    expect(nav).not.toBeNull()
    expect(nav?.querySelectorAll('.dsbt-item')).toHaveLength(1)
  })

  it('hides the rail while the persisted toggle is still loading (no wrong-state flash)', () => {
    setSettings('loading', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    renderRail('s1', store)
    expect(document.querySelector('.dsbt-nav')).toBeNull()
  })

  it('does not page history while the timeline toggle is off (P1 regression)', () => {
    setSettings('ready', false)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ]), true))
    renderRail('s1', store)
    expect(document.querySelector('.dsbt-nav')).toBeNull()
    // The full-history loader must not run when the rail is switched off.
    expect(store.loadOlderCalls).toHaveLength(0)
  })

  it('renders projected entries for messages absent from the loaded node window', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'loaded question')],
    ])))
    // Host projection: the whole session's user turns, loaded window or not.
    const projected = { messages: [
      { seq: 2, time: 1, text: 'loaded question', id: 'a' },
      { seq: 40, time: 2, text: 'tail question', id: 'z' },
    ] }
    renderRail('s1', store, projected)
    const nav = document.querySelector('.dsbt-nav')
    expect(nav).not.toBeNull()
    expect(nav?.querySelectorAll('.dsbt-item')).toHaveLength(2)
    const titles = [...(nav?.querySelectorAll('.dsbt-title') ?? [])].map((el) => el.textContent)
    expect(titles).toContain('tail question')
  })

  it('unmounts its body portal cleanly', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    renderRail('s1', store)
    expect(document.querySelector('.dsbt-nav')).not.toBeNull()
    cleanup()
    expect(document.querySelector('.dsbt-nav')).toBeNull()
  })

  it('joins the unified glass recipe while the glass gate is on', () => {
    const tag = document.querySelector('style[data-plugin-css="deepseek-harness-background/timeline"]')
    const text = tag?.textContent ?? ''
    // Under the glass gate the capsule + expanded panel take the composer's
    // fill token and the shared blur chain (the glass-blur slider), instead
    // of the fixed official 5/16px paints.
    expect(text).toContain('body[data-dsh-bg-glass] .dsbt-bg')
    expect(text).toContain('body[data-dsh-bg-glass] .dsbt-wrap.dsbt-show')
    expect(text).toContain('var(--dsw-specific-input-major)')
    expect(text).toContain('blur(var(--bg-glass-blur')
    expect(text).toContain('saturate(var(--bg-glass-saturate')
  })
})
