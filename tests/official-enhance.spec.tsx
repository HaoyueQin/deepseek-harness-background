// @vitest-environment jsdom
/**
 * Official-rail enhancer behaviour.
 *
 * The contracts that make the enhancement real:
 * 1. A click on the official rail is INTERCEPTED — the kernel's own instant
 *    jump never runs (proved by a bubble-phase listener that never fires),
 *    and the shared glide runs instead.
 * 2. Nothing is intercepted while the persisted toggle is off, so turning the
 *    setting off really does restore stock behaviour.
 * 3. Reaching for the rail pages older history in — but only while the rail
 *    has spare capacity, and only while the log has more to give.
 * 4. The alpha.3 frame-style rail narrows the enhancement: its full ladder
 *    (outline + loaded) resolves click indexes, LOADED marks are still
 *    intercepted, UNLOADED ones pass through to the kernel's own jump, and
 *    the warm-up never runs there.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import React from 'react'
import {
  OfficialTimelineEnhancer, OFFICIAL_RAIL_SELECTOR, railCapacityOf,
  frameIndexAtPointer, indexForEvent, isFrameRail, mergeRailItems,
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

function mountOfficialRail(count: number, height = 412, scrollTopPx?: number): HTMLElement {
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
  // jsdom does not parse custom properties back out of `style`. A defined
  // scroll offset turns the stand-in into the alpha.3 frame-style rail (whose
  // frameStyle publishes `--turn-scroll-top` on every render, 0px included).
  const framePart = scrollTopPx === undefined ? '' : `; --turn-scroll-top: ${String(scrollTopPx)}px`
  nav.setAttribute('style', `--turn-natural-height: ${String(height)}px; --turn-rail-inset: 6px${framePart}`)
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
  extra: { outline?: unknown } = {},
): { panel: HTMLElement } {
  render(React.createElement(OfficialTimelineEnhancer as never, {
    sessionId: 's1',
    sessionsService: { binding: () => ({ session: session as never }) },
    useChat: useChatStub(items(count)),
    // An undefined outline keeps the prop absent — the merge then degrades to
    // the loaded items, exactly like a pre-alpha.3 kernel reading an
    // unregistered projection key.
    useProjection: extra.outline === undefined
      ? undefined
      : (key: string) => key === 'turnOutline' ? extra.outline : undefined,
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

  it('computes the uncompressed tick capacity from the band clamp, not the current height', () => {
    // Regression: with few loaded turns the rail's rendered height IS its
    // natural height (count-driven, e.g. 3 turns -> 32px), so measuring the
    // rendered height made capacity equal the count and the warm-up gate
    // could never open. The official stylesheet caps the height with
    // min(natural, band - 64px, 420px); capacity must come from that clamp.
    // 412px cap, 6px end insets -> 400px usable -> 41 ticks at 10px spacing.
    // Past this the official stylesheet switches marks to percentage
    // positions and the column degrades into a solid bar.
    expect(railCapacityOf(mountOfficialRail(3, 412))).toBe(41)
    expect(railCapacityOf(null)).toBe(41)
  })

  it('reads the band clamp off the scrollport measurements', () => {
    // Published inline by ConversationRoot on the scroll host; a tall window
    // clamps at the 420px cap while a short one shrinks the rail.
    const tall = mountOfficialRail(3, 32)
    tall.parentElement!.style.setProperty('--dsh-conversation-viewport-height', '700px')
    tall.parentElement!.style.setProperty('--dsh-composer-height', '140px')
    expect(railCapacityOf(tall)).toBe(41) // min(700-140-64, 420) = 420

    const short = mountOfficialRail(3, 32)
    short.parentElement!.style.setProperty('--dsh-conversation-viewport-height', '300px')
    short.parentElement!.style.setProperty('--dsh-composer-height', '150px')
    expect(railCapacityOf(short)).toBe(8) // min(300-150-64, 420) = 86
  })

  it('falls back to the 420px cap without published band measurements', () => {
    // The ported rail portals itself to body: no scroll host, and its own
    // stylesheet carries the same 420px clamp.
    expect(railCapacityOf(mountOfficialRail(3, 32))).toBe(41)
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
    // A short band clamps the rail below the loaded count (90px band - 64px
    // clearance -> 26px rail -> room for 2 ticks) and it already shows 3:
    // warming up would only compress the marks into an unaimable bar.
    const nav = mountOfficialRail(3, 26)
    nav.parentElement!.style.setProperty('--dsh-conversation-viewport-height', '200px')
    nav.parentElement!.style.setProperty('--dsh-composer-height', '110px')
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

describe('alpha.3 frame rail detection and geometry', () => {
  /** A DOMRect stub pinning the frame's viewport box (jsdom reports zeros). */
  function rectAt(top: number): DOMRect {
    return { top, left: 0, right: 28, bottom: top + 412, width: 28, height: 412, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }

  it('tells the frame rail apart by its published scroll-top metric', () => {
    expect(isFrameRail(mountOfficialRail(3))).toBe(false)
    // The alpha.3 frameStyle publishes the var on EVERY render, 0px included.
    expect(isFrameRail(mountOfficialRail(3, 412, 0))).toBe(true)
    expect(isFrameRail(null)).toBe(false)
  })

  it('maps a click by fixed pitch over the scrolled ladder', () => {
    // Official alpha.3 itemAtPointer: offset = clientY - rect.top + scrollTop
    // - inset, index = round(offset / 10), clamped to the ladder.
    const nav = mountOfficialRail(5, 412, 20)
    nav.getBoundingClientRect = (): DOMRect => rectAt(10)
    // offset = clientY - 10 + 20 - 6
    expect(frameIndexAtPointer(5, nav, 10 + 6 - 20 + 23)).toBe(2)
    expect(frameIndexAtPointer(5, nav, 10 + 6 - 20 - 100)).toBe(0) // clamp low
    expect(frameIndexAtPointer(5, nav, 10 + 6 - 20 + 95)).toBe(4) // round(9.5) -> clamp high
  })

  it('dispatches indexForEvent to the frame geometry when the metric is published', () => {
    const nav = mountOfficialRail(5, 412, 20)
    nav.getBoundingClientRect = (): DOMRect => rectAt(10)
    const event = { clientY: 10 + 6 - 20 + 23 } as unknown as MouseEvent
    expect(indexForEvent(nav, event)).toBe(2)
  })
})

describe('alpha.3 narrow enhancement', () => {
  /** The whole-log outline for a 3-turn session; only turns 1-2 are loaded. */
  const outline = [
    { turn: 1, seq: 2, prompt: 'q1', response: '' },
    { turn: 2, seq: 5, prompt: 'q2', response: 'r2' },
    { turn: 3, seq: 9, prompt: 'q3', response: '' },
  ]

  it('intercepts a loaded mark and lets the kernel own an unloaded one', async () => {
    const nav = mountOfficialRail(3, 412, 0)
    const session = fakeSession({ hasMore: false })
    renderEnhancer(session, 2, true, { outline })
    const bubbled: Event[] = []
    const record = (event: Event): void => { bubbled.push(event) }
    document.addEventListener('click', record)
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    // Keyboard activation of the UNLOADED turn-3 mark: the ladder entry has
    // no anchor key, so the plugin stands down and the event bubbles to the
    // kernel's own loadThrough jump.
    nav.querySelectorAll('button')[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(bubbled).toHaveLength(1)

    // A click landing on the LOADED turn-1 mark (geometry path: offset =
    // clientY - 0 + 0 - 6): still intercepted, the kernel never sees it.
    nav.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 6 }))
    expect(bubbled).toHaveLength(1)
    document.removeEventListener('click', record)
  })

  it('pages nothing on reach for the frame rail (the kernel owns reachability)', async () => {
    const nav = mountOfficialRail(3, 412, 0)
    const session = fakeSession({ hasMore: true })
    renderEnhancer(session, 2, true, { outline })
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    nav.dispatchEvent(new Event('pointerenter'))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(session.loadOlderCalls).toBe(0)
  })

  it('stands down entirely while a kernel jump is still paging (aria-busy)', async () => {
    const nav = mountOfficialRail(3, 412, 0)
    // The kernel pulses the mark whose load-through jump is in flight.
    nav.querySelectorAll('button')[1]!.setAttribute('aria-busy', 'true')
    const session = fakeSession({ hasMore: false })
    renderEnhancer(session, 2, true, { outline })
    const bubbled: Event[] = []
    const record = (event: Event): void => { bubbled.push(event) }
    document.addEventListener('click', record)
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))
    await new Promise((resolve) => setTimeout(resolve, RAIL_POLL_MS + 50))

    // A LOADED mark click during the kernel's own jump: the plugin must NOT
    // intercept — the official loaded branch cancels its pending jump before
    // landing, and an interception would bypass that, leaving the orphaned
    // jump to teleport the scrollport away mid-glide at settle.
    nav.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 6 }))
    expect(bubbled).toHaveLength(1)
    document.removeEventListener('click', record)
  })
})

describe('full-ladder merge (alpha.3)', () => {
  it('mirrors the official merge: loaded overrides, outline fills, ascending', () => {
    const loaded = [
      { turn: 1, anchorKey: 'k1', prompt: 'loaded q1', response: '' },
      { turn: 2, anchorKey: 'k2', prompt: '', response: '' },
    ]
    const outline = [
      { turn: 1, seq: 2, prompt: 'outline q1', response: 'outline r1' },
      { turn: 2, seq: 5, prompt: 'outline q2', response: 'outline r2' },
      { turn: 5, seq: 30, prompt: 'outline q5', response: '' },
      { turn: 3, seq: 9, prompt: 'q3', response: 'r3' },
    ]
    const ladder = mergeRailItems(loaded as never, outline)
    // Ascending by turn regardless of outline order.
    expect(ladder.map((mark) => mark.turn)).toEqual([1, 2, 3, 5])
    // A loaded turn keeps its own anchor and its own non-empty previews,
    // borrowing the outline's only where its own are empty.
    expect(ladder[0]).toMatchObject({ anchorKey: 'k1', prompt: 'loaded q1', response: 'outline r1' })
    expect(ladder[1]).toMatchObject({ anchorKey: 'k2', prompt: 'outline q2', response: 'outline r2' })
    // An outline-only turn stays addressable to nobody but the kernel.
    expect(ladder[2]?.anchorKey).toBeUndefined()
    expect(ladder[2]).toMatchObject({ prompt: 'q3', response: 'r3' })
    expect(ladder[3]?.anchorKey).toBeUndefined()
  })

  it('drops damaged outline entries and degrades to the loaded items without one', () => {
    const loaded = [
      { turn: 2, anchorKey: 'k2', prompt: 'q2', response: '' },
    ]
    // No outline value at all (undefined key, pre-baseline, older kernel):
    // the ladder IS the loaded window — the alpha.1/2 behaviour, unchanged.
    expect(mergeRailItems(loaded as never, undefined)).toEqual(loaded)
    expect(mergeRailItems(loaded as never, 'garbage')).toEqual(loaded)
    // Every entry here is damaged (negative turn, fractional turn, negative
    // seq, missing seq, non-object) — all dropped, none invented.
    expect(mergeRailItems(loaded as never, [
      { turn: -1, seq: 1, prompt: '', response: '' },
      { turn: 1.5, seq: 1, prompt: '', response: '' },
      { turn: 3, seq: -2, prompt: '', response: '' },
      { turn: 3, prompt: '', response: '' },
      'garbage',
      null,
    ])).toEqual(loaded)
  })
})
