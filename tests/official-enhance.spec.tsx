// @vitest-environment jsdom
/**
 * Official-rail enhancer behaviour.
 *
 * The three contracts that make the enhancement real:
 * 1. A click on the official rail is INTERCEPTED — the kernel's own instant
 *    jump never runs (proved by a bubble-phase listener that never fires),
 *    and the shared glide runs instead.
 * 2. Nothing is intercepted while the persisted toggle is off, so turning the
 *    setting off really does restore stock behaviour.
 * 3. Reaching for the rail pages older history in — but only while the rail
 *    has spare capacity, and only while the log has more to give.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import React from 'react'
import {
  OfficialTimelineEnhancer, OFFICIAL_RAIL_SELECTOR, railCapacityOf,
} from '../src/client/timeline/index.tsx'

const t = (key: string): string => key

/** How often the enhancer polls for the official rail. */
const RAIL_POLL_MS = 400

interface FakeSession {
  hasMore: boolean
  loadingOlder: boolean
  loadOlderCalls: number
  getSnapshot(): { hasMore: boolean; loadingOlder: boolean; openState: string }
  loadOlder(): Promise<void>
  subscribe(): () => void
}

function fakeSession(initial: Partial<Pick<FakeSession, 'hasMore'>> = {}): FakeSession {
  const state = {
    hasMore: true,
    loadingOlder: false,
    loadOlderCalls: 0,
    ...initial,
  } as FakeSession
  state.getSnapshot = () => ({
    hasMore: state.hasMore,
    loadingOlder: state.loadingOlder,
    openState: 'open',
  })
  state.loadOlder = async () => { state.loadOlderCalls += 1 }
  state.subscribe = () => () => {}
  return state
}

/**
 * Mount a stand-in for the official rail: a `<nav>` inside the conversation
 * scrollport carrying the inline metrics the real component publishes, with
 * one focusable mark button per entry.
 */
/** Live scrollport height per mounted stand-in (a prepend grows it). */
const scrollHeights = new WeakMap<HTMLElement, { value: number }>()

/** Grow a mounted stand-in's scrollport, the way a prepend would. */
function growScrollport(nav: HTMLElement, px: number): void {
  const sp = nav.parentElement
  if (sp === null) return
  const box = scrollHeights.get(sp)
  if (box !== undefined) box.value += px
}

function mountOfficialRail(count: number, height = 412): HTMLElement {
  const sp = document.createElement('div')
  sp.setAttribute('data-conversation-scroll', '')
  // Real geometry: the warm-up helper decides whether a page landed by
  // measuring the scrollport's growth, which jsdom would otherwise report
  // as a constant zero.
  const box = { value: 3000 }
  scrollHeights.set(sp, box)
  Object.defineProperty(sp, 'scrollHeight', { configurable: true, get: () => box.value })
  Object.defineProperty(sp, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(sp, 'scrollTop', { configurable: true, writable: true, value: 1000 })
  const nav = document.createElement('nav')
  // Set the attribute directly: the selector matches its serialization, and
  // jsdom does not parse custom properties back out of `style`.
  nav.setAttribute('style', `--turn-natural-height: ${String(height)}px; --turn-rail-inset: 6px`)
  Object.defineProperty(nav, 'clientHeight', { configurable: true, value: height })
  for (let i = 0; i < count; i += 1) {
    const slot = document.createElement('div')
    const button = document.createElement('button')
    button.setAttribute('aria-label', `jump to turn ${String(i + 1)}`)
    slot.appendChild(button)
    nav.appendChild(slot)
  }
  sp.appendChild(nav)
  document.body.appendChild(sp)
  return nav
}

function items(count: number): readonly { turn: number; anchorKey: string; prompt: string; response: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    turn: i + 1,
    anchorKey: `13:input-message${String(i)}`,
    prompt: `question ${String(i + 1)}`,
    response: '',
  }))
}

function useChatStub(value: readonly { turn: number; anchorKey: string; prompt: string; response: string }[]):
  (selector: (snapshot: unknown) => unknown) => unknown {
  return (selector) => selector({ navigation: { items: () => value } })
}

function renderEnhancer(
  session: FakeSession,
  count: number,
  enabled: boolean,
): { panel: HTMLElement } {
  render(React.createElement(OfficialTimelineEnhancer as never, {
    sessionId: 's1',
    sessionsService: { binding: () => ({ session: session as never }) },
    useChat: useChatStub(items(count)),
    enabled,
    t,
  }))
  return { panel: document.body }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('official rail discovery', () => {
  it('finds the rail through its published metrics', async () => {
    const nav = mountOfficialRail(3)
    expect(document.querySelector(OFFICIAL_RAIL_SELECTOR)).toBe(nav)
  })

  it('computes the uncompressed tick capacity from the rendered height', () => {
    // 412px rail, 6px end insets -> 400px usable -> 41 ticks at 10px spacing.
    // Past this the official stylesheet switches marks to percentage
    // positions and the column degrades into a solid bar.
    expect(railCapacityOf(mountOfficialRail(3, 412))).toBe(41)
    expect(railCapacityOf(mountOfficialRail(3, 300))).toBe(29)
    expect(railCapacityOf(null)).toBe(41)
  })
})

describe('click interception', () => {
  it('swallows the official click so the kernel\'s instant jump never runs', async () => {
    const nav = mountOfficialRail(3)
    const session = fakeSession({ hasMore: false })
    renderEnhancer(session, 3, true)
    // Stand in for React 18's root container: it dispatches onClick during
    // the BUBBLE phase, so a capture listener on the rail must beat it.
    const bubbled: Event[] = []
    document.addEventListener('click', (event) => { bubbled.push(event) })

    // The capture listener attaches only after the poll effect has found the
    // rail: wait one full poll cycle for the find + claim, one more for the
    // listener effect to bind.
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    nav.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 200 }))
    expect(bubbled).toHaveLength(0)
    document.removeEventListener('click', (event) => { bubbled.push(event) })
  })

  it('leaves the official behaviour untouched while the toggle is off', async () => {
    const nav = mountOfficialRail(3)
    const session = fakeSession({ hasMore: false })
    renderEnhancer(session, 3, false)
    const bubbled: Event[] = []
    const record = (event: Event): void => { bubbled.push(event) }
    document.addEventListener('click', record)
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    nav.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 200 }))
    expect(bubbled).toHaveLength(1)
    document.removeEventListener('click', record)
  })
})

describe('history warm-up', () => {
  it('pages older history while the rail still has spare capacity', async () => {
    const nav = mountOfficialRail(3, 412)
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      growScrollport(nav, 400)
      // Exhaust the log after two pages.
      if (session.loadOlderCalls >= 2) session.hasMore = false
    }
    renderEnhancer(session, 3, true)
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    nav.dispatchEvent(new Event('pointerenter'))
    await waitFor(() => {
      expect(session.loadOlderCalls).toBe(2)
    })
  })

  it('pages nothing when the rail is already at capacity', async () => {
    // A short rail has room for 2 ticks and already shows 3: warming up would
    // only compress the marks into an unaimable bar.
    const nav = mountOfficialRail(3, 26)
    const session = fakeSession({ hasMore: true })
    renderEnhancer(session, 3, true)
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    nav.dispatchEvent(new Event('pointerenter'))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(session.loadOlderCalls).toBe(0)
  })

  it('pages nothing when the log is exhausted', async () => {
    const nav = mountOfficialRail(3, 412)
    const session = fakeSession({ hasMore: false })
    renderEnhancer(session, 3, true)
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    nav.dispatchEvent(new Event('pointerenter'))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(session.loadOlderCalls).toBe(0)
  })
})
