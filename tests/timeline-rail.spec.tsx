// @vitest-environment jsdom
/**
 * Timeline dock entry: the mode dispatch and the legacy rail it mounts.
 *
 * Pins the contracts that matter across the 0.1.2 split:
 * - A kernel that publishes the official turn-navigation index (`useChat`)
 *   gets the behaviour-only enhancer (this plugin renders NO rail of its own).
 * - A kernel that does not gets the ported official rail, fed by the shared
 *   backend — including turns the chat view never loaded.
 * - The session store is a double whose subscribe/getSnapshot are UNBOUND
 *   prototype methods, exactly like the real runtime Session: a regression to
 *   passing those methods bare into useSyncExternalStore (which drops the
 *   receiver and throws "Cannot read properties of undefined") fails here.
 * - Visibility gates: no rail while the persisted toggle is still loading or
 *   switched off, and no history paging while it is off.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import {
  TimelineBridge, TIMELINE_CSS, LEGACY_FOLLOW_ZONE_PX, CHATVIEW_FOLLOW_ZONE_PX,
} from '../src/client/timeline/index.tsx'
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

function snapshotWith(
  nodes: Map<string, object>,
  hasMore = false,
): { chat: { nodes: Map<string, object> }; hasMore: boolean } {
  return { chat: { nodes }, hasMore }
}

/** Write the shared settings snapshot (the dock entry reads it via uSES). */
function setSettings(status: 'loading' | 'ready' | 'error', timeline: boolean): void {
  ;(settingsClient as unknown as { snapshot: unknown }).snapshot = {
    status,
    value: { timeline } as unknown as BackgroundSettings,
  }
}

interface RenderExtra {
  useChat?: (selector: (snapshot: unknown) => unknown) => unknown
  useProjection?: (key: string) => unknown
}

function renderTimeline(sessionId: string, store: SessionLike, extra: RenderExtra = {}): void {
  render(React.createElement(TimelineBridge as never, {
    sessionId,
    sessionsService: { binding: (id: string) => id === sessionId ? { session: store } : undefined },
    t,
    ...extra,
  }))
}

/** A selector hook shaped like the kernel's `useChat`, over an official index. */
interface OfficialItem {
  turn: number
  anchorKey: string
  prompt: string
  response: string
}

function useChatStub(entries: readonly OfficialItem[]):
  (selector: (snapshot: unknown) => unknown) => unknown {
  return (selector) => selector({
    navigation: { items: () => entries },
    order: [], nodes: { get: () => undefined, values: () => [] },
  })
}

afterEach(() => {
  cleanup()
  document.body.style.cssText = ''
  setSettings('loading', true)
})

describe('TimelineBridge mode dispatch', () => {
  it('mounts the ported rail when the kernel publishes no turn index (legacy)', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    expect(() => renderTimeline('s1', store)).not.toThrow()
    expect(document.querySelector('.dsbt-slot')).not.toBeNull()
    expect(document.querySelectorAll('.dsbt-mark')).toHaveLength(2)
    expect(store.loadOlderCalls).toHaveLength(0) // hasMore false: no paging
  })

  it('renders NOTHING of its own when the official index exists (enhance)', () => {
    // The official rail is already on screen; this plugin only fixes its
    // behaviour, so a second rail would be duplicate chrome.
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    renderTimeline('s1', store, {
      useChat: useChatStub([
        { turn: 1, anchorKey: 'k1', prompt: 'first', response: '' },
        { turn: 2, anchorKey: 'k2', prompt: 'second', response: '' },
      ]),
    })
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })
})

describe('legacy rail rendering', () => {
  it('matches the official rail: nothing to navigate between a lone question', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'only')],
    ])))
    renderTimeline('s1', store)
    // The official TurnNavigator returns null below two items.
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })

  it('hides the rail while the persisted toggle is still loading (no wrong-state flash)', () => {
    setSettings('loading', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    renderTimeline('s1', store)
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })

  it('does not page history while the timeline toggle is off (P1 regression)', () => {
    setSettings('ready', false)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ]), true))
    renderTimeline('s1', store)
    expect(document.querySelector('.dsbt-slot')).toBeNull()
    // The history warm-up must not run when the rail is switched off.
    expect(store.loadOlderCalls).toHaveLength(0)
  })

  it('renders projected entries for messages absent from the loaded node window', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'loaded question')],
    ])))
    const projected = { messages: [
      { seq: 2, time: 1, text: 'loaded question', id: 'a' },
      { seq: 40, time: 2, text: 'tail question', id: 'z' },
    ] }
    renderTimeline('s1', store, { useProjection: (): unknown => projected })
    expect(document.querySelectorAll('.dsbt-mark')).toHaveLength(2)
    // hovering is what reveals a preview; the entries themselves must exist.
    expect(document.querySelector('.dsbt-rail')).not.toBeNull()
  })

  it('unmounts its body portal cleanly', () => {
    setSettings('ready', true)
    const store = new SessionLike(snapshotWith(new Map<string, object>([
      ['a', userNode('13:input-messagea', 2, 'first')],
      ['b', userNode('13:input-messageb', 7, 'second')],
    ])))
    renderTimeline('s1', store)
    expect(document.querySelector('.dsbt-slot')).not.toBeNull()
    cleanup()
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })
})

describe('rail paint', () => {
  it('is glassed under the wallpapered gate: preview fill, blur chain and edge fade all ship', () => {
    // The rail is background-plugin chrome over the user's art, so its hover
    // preview joins the glass sheet (painter's composer token + shared
    // blur/sheen) under body[data-dsh-bg-glass] — the same recipe and the
    // same off-switch as the composer card — and the marks column carries
    // the DeepSeek-web edge dissolve.
    expect(TIMELINE_CSS).toContain('body[data-dsh-bg-glass] .dsbt-preview')
    expect(TIMELINE_CSS).toContain('background-color: var(--dsw-specific-input-major)')
    expect(TIMELINE_CSS).toContain('backdrop-filter: blur(var(--bg-glass-blur, 16px))')
    expect(TIMELINE_CSS).toContain('mask-image: linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%)')
    expect(TIMELINE_CSS).toContain('var(--dsw-alias-border-l4)')
    expect(TIMELINE_CSS).toContain('var(--dsw-alias-bg-layer-1)')
  })
})

describe('follow zones', () => {
  it('uses each conversation generation\'s own bottom-follow threshold', () => {
    // The current ChatView follows within 24px of the floor; the legacy
    // conversation view within 25px. A mismatch lets the host yank the glide
    // back to the floor mid-animation.
    expect(CHATVIEW_FOLLOW_ZONE_PX).toBe(24)
    expect(LEGACY_FOLLOW_ZONE_PX).toBe(25)
  })
})
