// @vitest-environment jsdom
/**
 * Jump-path contracts: the DOM wait that follows paging (the regression
 * where a click silently did nothing because React had not committed the
 * prepended rows yet), the paging loop's time budget instead of the old
 * fixed iteration guard, and the visible glide — bottom-follow detach
 * before the animation, intermediate frames between start and target, and
 * reader input cancelling the glide so the user takes over instantly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  animateScrollTop, centeredScrollTopFor, detachBottomFollow, glideDurationFor,
  compensatedLoadOlder, jumpToMessage, officialTargetTopFor, scrollFloorOf,
  waitForChatRow, warmHistory,
} from '../src/client/timeline/index.tsx'
import type { TimelineSessionsService } from '../src/client/timeline/index.tsx'

/** jsdom has no CSS.escape / scrollIntoView — stub the former, record the latter. */
let scrollIntoViewCalls: { el: Element; behavior?: unknown; block?: unknown }[] = []
/** Stubbed rAF queue + clock for the glide tests. */
let rafQueue: FrameRequestCallback[] = []
let fakeNow = 0
let rafId = 0

beforeAll(() => {
  vi.stubGlobal('CSS', { escape: (s: string): string => s })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  document.body.innerHTML = ''
  scrollIntoViewCalls = []
  rafQueue = []
  fakeNow = 0
  rafId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    rafId += 1
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = []
  })
  vi.stubGlobal('performance', { now: (): number => fakeNow })
  ;(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (
    this: Element,
    opts?: { behavior?: unknown; block?: unknown },
  ) {
    scrollIntoViewCalls.push({ el: this, behavior: opts?.behavior, block: opts?.block })
  }
})

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

/** Advance the fake clock by ms and run every frame scheduled up to now. */
function stepFrames(ms: number): void {
  fakeNow += ms
  const batch = rafQueue.splice(0)
  for (const cb of batch) cb(fakeNow)
}

/** Yield one macrotask so in-flight microtask chains inside async work advance. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Drive the async jump pipeline: yield until the predicate holds, pumping
 * one rAF round per yield (jumpToMessage reaches its glide only after its
 * await chains settle, so tests must interleave yields with frame steps).
 */
async function driveUntil(pred: () => boolean, maxRounds = 200): Promise<void> {
  for (let i = 0; i < maxRounds; i += 1) {
    if (pred()) return
    await tick()
    if (rafQueue.length > 0) stepFrames(80)
  }
  throw new Error('driveUntil: predicate never satisfied')
}

/** Run every scheduled frame until the pending promise settles. */
async function pumpUntil(pending: Promise<unknown>): Promise<void> {
  let settled = false
  void pending.then(() => { settled = true })
  await driveUntil(() => settled)
}

/**
 * Pump rAF rounds and macrotasks until `pending` settles — for the paging
 * helpers, which bracket their DOM waits with settleScrollEvents() rather
 * than running a glide.
 */
async function pumpSettles(pending: Promise<unknown>): Promise<void> {
  let settled = false
  void pending.then(() => { settled = true })
  for (let round = 0; round < 200 && !settled; round += 1) {
    stepFrames(0)
    await tick()
  }
}

function mountScrollport(): HTMLElement {
  const sp = document.createElement('div')
  sp.setAttribute('data-conversation-scroll', '')
  document.body.appendChild(sp)
  return sp
}

function addRow(sp: HTMLElement, key: string): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', key)
  sp.appendChild(row)
  return row
}

interface ScrollGeometry {
  scrollHeight?: number
  clientHeight?: number
  scrollTop?: number
  top?: number
}

/**
 * Give a scrollport real geometry (jsdom reports zeros) and record every
 * scrollTop assignment, so tests can assert both the detach and the glide's
 * intermediate frames.
 */
function mockScrollport(
  sp: HTMLElement,
  g: ScrollGeometry = {},
): { setHistory: number[]; scrollTop: () => number; grow: (px: number) => void } {
  const state = {
    scrollHeight: g.scrollHeight ?? 3000,
    clientHeight: g.clientHeight ?? 600,
    scrollTop: g.scrollTop ?? 0,
  }
  const setHistory: number[] = [state.scrollTop]
  Object.defineProperty(sp, 'scrollHeight', { configurable: true, get: () => state.scrollHeight })
  Object.defineProperty(sp, 'clientHeight', { configurable: true, get: () => state.clientHeight })
  Object.defineProperty(sp, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (v: number) => {
      state.scrollTop = v
      setHistory.push(v)
    },
  })
  sp.getBoundingClientRect = () => ({
    top: g.top ?? 0, height: state.clientHeight, bottom: state.clientHeight,
    left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
  return {
    setHistory,
    scrollTop: () => state.scrollTop,
    // A prepend grows the transcript above the viewport; the browser keeps
    // scrollTop constant, so the reader's content shifts down by this much.
    grow: (px) => { state.scrollHeight += px },
  }
}

/** Give a row a deterministic rect/height for centeredScrollTopFor. */
function mockRow(row: HTMLElement, top: number, height = 40): void {
  Object.defineProperty(row, 'offsetHeight', { configurable: true, value: height })
  row.getBoundingClientRect = () => ({
    top, height, bottom: top + height,
    left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

/**
 * A page-aware row mock: the viewport-relative top derives from the
 * scrollport's CURRENT scrollTop, so a pre-glide detach shifts the row like
 * real geometry would (page coordinate stays put).
 */
function mockRowAt(row: HTMLElement, el: HTMLElement, pageTop: number, height = 40): void {
  Object.defineProperty(row, 'offsetHeight', { configurable: true, value: height })
  row.getBoundingClientRect = () => ({
    top: pageTop - el.scrollTop, height, bottom: pageTop - el.scrollTop + height,
    left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

interface FakeSession {
  nodes: Map<string, unknown>
  hasMore: boolean
  loadingOlder: boolean
  openState: string
  loadOlderCalls: number
  loadOlder(): Promise<void>
  getSnapshot(): { chat: { nodes: Map<string, unknown> }; hasMore: boolean; loadingOlder: boolean; openState: string }
  subscribe(): () => void
}

function fakeSession(
  initial: Partial<Pick<FakeSession, 'nodes' | 'hasMore' | 'openState' | 'loadingOlder'>> & object = {},
): FakeSession {
  const state = {
    nodes: new Map<string, unknown>(),
    hasMore: true,
    ...initial,
  } as FakeSession
  state.loadOlderCalls = 0
  state.loadOlder = async () => {
    state.loadOlderCalls += 1
    state.loadingOlder = true
    // Simulate one in-flight page: the caller observes loadingOlder true and waits.
    await new Promise((resolve) => setTimeout(resolve, 5))
    state.loadingOlder = false
  }
  state.getSnapshot = () => ({
    chat: { nodes: state.nodes },
    hasMore: state.hasMore,
    loadingOlder: state.loadingOlder,
    openState: state.openState ?? 'open',
  })
  state.subscribe = () => () => {}
  return state
}

function serviceFor(session: FakeSession): TimelineSessionsService {
  return { binding: () => ({ session: session as never }) }
}

describe('waitForChatRow', () => {
  it('returns the row when it is committed after the store updated', async () => {
    const sp = mountScrollport()
    const key = '13:input-messagex'
    const later = (): void => {
      window.setTimeout(() => addRow(sp, key), 120)
    }
    later()
    const row = await waitForChatRow(key, 2000)
    expect(row).not.toBeNull()
    expect(row?.getAttribute('data-chat-anchor-key')).toBe(key)
  })

  it('returns an immediately present row without waiting', async () => {
    const sp = mountScrollport()
    const row = addRow(sp, '13:input-messagey')
    expect(await waitForChatRow('13:input-messagey', 1000)).toBe(row)
  })

  it('gives up (null) after the timeout', async () => {
    mountScrollport()
    expect(await waitForChatRow('13:missing', 120)).toBeNull()
  })

  it('returns null when no conversation scrollport exists', async () => {
    expect(await waitForChatRow('13:x', 100)).toBeNull()
  })

  it('finds the row in a SECOND conversation scrollport (multi-column layouts)', async () => {
    const sp1 = mountScrollport()
    const sp2 = document.createElement('div')
    sp2.setAttribute('data-conversation-scroll', '')
    document.body.appendChild(sp2)
    const key = '13:input-messagecol2'
    const row = addRow(sp2, key)
    expect(await waitForChatRow(key, 1000)).toBe(row)
    // The first scrollport never held it and must stay untouched.
    expect(sp1.querySelector('[data-chat-anchor-key]')).toBeNull()
  })
})

describe('jump glide geometry', () => {
  it('computes the scrollport floor', () => {
    const sp = mountScrollport()
    mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600 })
    expect(scrollFloorOf(sp)).toBe(2400)
  })

  it('centers a row the same way scrollIntoView block:center would, clamped to the floor', () => {
    const sp = mountScrollport()
    mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const row = addRow(sp, 'k')
    mockRow(row, 1500, 40)
    expect(centeredScrollTopFor(sp, row)).toBe(1500 - (600 - 40) / 2)
    // Above the top: clamped to 0.
    mockRow(row, 60, 40)
    expect(centeredScrollTopFor(sp, row)).toBe(0)
    // Below the floor: clamped to the floor.
    mockRow(row, 2800, 40)
    expect(centeredScrollTopFor(sp, row)).toBe(2400)
  })

  it('bounds glide durations by distance with sane caps', () => {
    expect(glideDurationFor(100)).toBe(280) // floor
    expect(glideDurationFor(900)).toBe(366)
    expect(glideDurationFor(5000)).toBe(900) // cap
    expect(glideDurationFor(Number.NaN)).toBe(280)
  })

  it('detaches only when the reader sits inside the follow zone', () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 2400 })
    detachBottomFollow(sp)
    expect(g.scrollTop()).toBe(2400 - 25 - 1)
    // Already above the zone: untouched (own container, fresh geometry).
    const above = mountScrollport()
    const a = mockScrollport(above, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    detachBottomFollow(above)
    expect(a.scrollTop()).toBe(1000)
  })

  it('leaves a no-floor scrollport alone', () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 200, clientHeight: 600, scrollTop: 0 })
    detachBottomFollow(sp)
    expect(g.scrollTop()).toBe(0)
  })

  it('animates with intermediate frames and resolves true at the target', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const pending = animateScrollTop(sp, 1220, 900)
    stepFrames(150)
    const mid = g.scrollTop()
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1220)
    while (rafQueue.length > 0) stepFrames(100)
    expect(await pending).toBe(true)
    expect(g.scrollTop()).toBe(1220)
  })

  it('snaps instead of animating a hairline distance', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 100 })
    expect(await animateScrollTop(sp, 100.2, 500)).toBe(true)
    expect(g.scrollTop()).toBe(100.2)
    expect(rafQueue).toHaveLength(0)
  })

  it('reader wheel cancels the glide and leaves the position frozen', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const pending = animateScrollTop(sp, 1220, 900)
    stepFrames(150)
    const frozen = g.scrollTop()
    sp.dispatchEvent(new WheelEvent('wheel'))
    expect(await pending).toBe(false)
    stepFrames(300)
    expect(g.scrollTop()).toBe(frozen)
  })

  it('keyboard scroll input cancels the glide', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const pending = animateScrollTop(sp, 1220, 900)
    stepFrames(150)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))
    expect(await pending).toBe(false)
    stepFrames(300)
    expect(g.scrollTop()).toBeLessThan(1220)
  })
})

describe('jumpToMessage', () => {
  it('glides to an already-rendered row with intermediate scroll frames', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messagea'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    mockRow(addRow(sp, key), 1500, 40)
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await driveUntil(() => g.setHistory.length > 1) // glide started, first frame written
    await pumpUntil(pending)
    expect(await pending).toBe(true)
    expect(g.setHistory.length).toBeGreaterThan(2) // real intermediate frames, not one snap
    expect(g.scrollTop()).toBe(1500 - (600 - 40) / 2)
  })

  it('detaches the bottom follow zone first when starting at the floor', async () => {
    // Self-consistent page: floor = 5400, the target row sits at page 3000
    // (viewport top -2400 while scrolled to the floor).
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 6000, clientHeight: 600, scrollTop: 5400 })
    const key = '13:input-messagea'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    mockRowAt(addRow(sp, key), sp, 3000, 40)
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await driveUntil(() => g.setHistory.length >= 2)
    // The FIRST assignment is the pre-paging detach, not the glide target.
    expect(g.setHistory[1]).toBe(5400 - 25 - 1)
    await pumpUntil(pending)
    expect(await pending).toBe(true)
    expect(g.scrollTop()).toBe(5400 + (3000 - 5400) - (600 - 40) / 2)
  })

  it('places exactly once under reduced motion (no rAF frames)', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messageb'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    mockRow(addRow(sp, key), 1500, 40)
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: () => ({ matches: true }) as MediaQueryList,
    })
    try {
      expect(await jumpToMessage(serviceFor(session), 's1', key)).toBe(true)
      expect(g.scrollTop()).toBe(1500 - (600 - 40) / 2)
      expect(rafQueue).toHaveLength(0)
    } finally {
      Object.defineProperty(window, 'matchMedia', original!)
    }
  })

  it('waits for the committed row after loadOlder paging (the silent-failure regression)', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messagetarget'
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      // The store updates BEFORE React commits: add the node now, the row later.
      session.nodes.set(key, {})
      window.setTimeout(() => mockRow(addRow(sp, key), 1500, 40), 150)
    }
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await new Promise((resolve) => setTimeout(resolve, 260))
    while (rafQueue.length > 0) stepFrames(100)
    expect(await pending).toBe(true)
    expect(session.loadOlderCalls).toBe(1)
    expect(g.scrollTop()).toBe(1500 - (600 - 40) / 2)
  })

  it('skips paging entirely when the target row is already rendered (DOM ground truth, 0.1.2+)', async () => {
    // Regression: on 0.1.2+ `session.getSnapshot()` exposes no node table
    // (the useChat ChatSnapshot store is unreachable from the jump engine),
    // so the old snapshot-only probe saw "not loaded" forever and paged the
    // WHOLE history — even though the row was in the DOM all along. The
    // rendered DOM is the ground truth for both kernel generations.
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messagefar'
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      throw new Error('should not page')
    }
    mockRow(addRow(sp, key), 1500, 40)
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await pumpUntil(pending)
    expect(await pending).toBe(true)
    expect(session.loadOlderCalls).toBe(0)
    expect(g.scrollTop()).toBe(1500 - (600 - 40) / 2)
  })

  it('pages repeatedly until the target row renders, not merely until the node store knows it', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messagefar'
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      session.hasMore = session.loadOlderCalls < 3
      if (session.loadOlderCalls >= 3) {
        session.nodes.set(key, {})
        mockRow(addRow(sp, key), 1500, 40)
      }
    }
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await pumpUntil(pending)
    expect(await pending).toBe(true)
    expect(session.loadOlderCalls).toBe(3)
  })

  it('keeps the jump alive when a page fails and the row renders anyway', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messagebroken-page'
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      // The page call fails, but it still loaded the row that renders later.
      if (session.loadOlderCalls === 1) {
        session.nodes.set(key, {})
        window.setTimeout(() => mockRow(addRow(sp, key), 1500, 40), 100)
      }
      throw new Error('boom')
    }
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await pumpUntil(pending)
    await expect(pending).resolves.toBe(true)
    expect(session.loadOlderCalls).toBe(1)
    expect(g.scrollTop()).toBe(1500 - (600 - 40) / 2)
  })

  it('reports failure instead of throwing when the row never renders', async () => {
    mountScrollport()
    const key = '13:input-messageghost'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    // Node exists but the DOM row never appears. The injectable row-wait
    // budget keeps the test fast (production default is 3s).
    expect(await jumpToMessage(serviceFor(session), 's1', key, { rowWaitMs: 150 })).toBe(false)
  })

  it('returns false when the session binding is missing', async () => {
    expect(await jumpToMessage({ binding: () => undefined }, 's1', 'k')).toBe(false)
  })

  it('gives up paging when the row never renders and the deadline expires', async () => {
    // hasMore stays true forever: only the page deadline can end the loop.
    // The injectable budget keeps the test fast (production default is 30s).
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    expect(await jumpToMessage(serviceFor(fakeSession({ hasMore: true })), 's1', '13:input-messageghost-deadline', {
      pageDeadlineMs: 60,
      rowWaitMs: 80,
    })).toBe(false)
    expect(g.scrollTop()).toBe(0)
  })

  it('waits out a session that is not open yet instead of burning the page budget', async () => {
    // A cold session cannot page; the loop must wait rather than call
    // loadOlder (which cannot succeed), and still break at the deadline.
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const session = fakeSession({ hasMore: true, openState: 'cold' })
    const pending = jumpToMessage(serviceFor(session), 's1', '13:input-messagecold', {
      pageDeadlineMs: 350,
      rowWaitMs: 80,
    })
    await pumpUntil(pending)
    expect(await pending).toBe(false)
    expect(session.loadOlderCalls).toBe(0)
    expect(g.scrollTop()).toBe(0)
  })

  it('reader wheel during a jump glide hands the scrollport back (jump resolves false)', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 })
    const key = '13:input-messagew'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    mockRow(addRow(sp, key), 1500, 40)
    const pending = jumpToMessage(serviceFor(session), 's1', key)
    await driveUntil(() => rafQueue.length > 0) // glide armed
    stepFrames(150)
    const mid = g.scrollTop()
    expect(mid).toBeGreaterThan(0)
    sp.dispatchEvent(new WheelEvent('wheel'))
    expect(await pending).toBe(false)
    const frozen = g.scrollTop()
    stepFrames(400)
    expect(g.scrollTop()).toBe(frozen)
  })
})

describe('official landing geometry', () => {
  it('lands a row 24px below the scrollport top, exactly where the official jump puts it', () => {
    const sp = mountScrollport()
    mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    const row = addRow(sp, 'k')
    mockRow(row, 0, 40) // row top flush with the scrollport top
    expect(officialTargetTopFor(sp, row)).toBe(1000 - 24)
    // Above the very top: clamped to 0 (1000 + (-1000) - 24 underflows).
    mockRow(row, -1000, 40)
    expect(officialTargetTopFor(sp, row)).toBe(0)
    // Past the floor: clamped to the floor.
    mockRow(row, 2900, 40)
    expect(officialTargetTopFor(sp, row)).toBe(2400)
  })
})

describe('compensatedLoadOlder (plugin-driven paging)', () => {
  it('restores the reader position by the prepended height', async () => {
    // Regression: the host compensates a prepend through an internal anchor
    // ref only its own "load earlier" button arms, so a plugin-driven page
    // pushed the reader's content down.
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => { g.grow(400) }
    const pending = compensatedLoadOlder(session, sp, 24)
    await pumpSettles(pending)
    expect(await pending).toBe(true)
    expect(g.scrollTop()).toBe(1400)
  })

  it('leaves a reader pinned to the floor alone (the host re-pins by itself)', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 2400 })
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => { g.grow(400) }
    const pending = compensatedLoadOlder(session, sp, 24)
    await pumpSettles(pending)
    expect(await pending).toBe(true)
    // No compensation: fighting the host's own follow logic would overshoot.
    expect(g.scrollTop()).toBe(2400)
  })

  it('stops on a failed page instead of retrying', async () => {
    const sp = mountScrollport()
    mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      throw new Error('boom')
    }
    const pending = compensatedLoadOlder(session, sp, 24)
    await pumpSettles(pending)
    expect(await pending).toBe(false)
    expect(session.loadOlderCalls).toBe(1)
  })
})

describe('warmHistory', () => {
  it('pages until the rail capacity is reached, then stops', async () => {
    const sp = mountScrollport()
    const g = mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    const session = fakeSession({ hasMore: true })
    let count = 2
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      g.grow(200)
      count += 1
    }
    const pending = warmHistory(session, sp, { countOf: () => count, capacity: 4, followZonePx: 24 })
    await pumpSettles(pending)
    expect(session.loadOlderCalls).toBe(2)
    expect(count).toBe(4)
  })

  it('pages nothing when the log is already exhausted', async () => {
    const sp = mountScrollport()
    mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    const session = fakeSession({ hasMore: false })
    session.loadOlder = async () => { throw new Error('should not page') }
    const pending = warmHistory(session, sp, { countOf: () => 2, capacity: 41, followZonePx: 24 })
    await pumpSettles(pending)
    expect(session.loadOlderCalls).toBe(0)
  })

  it('stops as soon as a page stops growing the transcript', async () => {
    const sp = mountScrollport()
    mockScrollport(sp, { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 })
    const session = fakeSession({ hasMore: true })
    // A page that loads nothing must not spin the whole budget.
    session.loadOlder = async () => { session.loadOlderCalls += 1 }
    const pending = warmHistory(session, sp, { countOf: () => 2, capacity: 41, followZonePx: 24 })
    await pumpSettles(pending)
    expect(session.loadOlderCalls).toBe(1)
  })
})
