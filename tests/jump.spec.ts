// @vitest-environment jsdom
/**
 * Jump-path contracts: the DOM wait that follows paging (the regression
 * where a click silently did nothing because React had not committed the
 * prepended rows yet) and the paging loop's time budget instead of the old
 * fixed iteration guard.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { jumpToMessage, waitForChatRow } from '../src/client/timeline.tsx'
import type { TimelineSessionsService } from '../src/client/timeline.tsx'

/** jsdom has no CSS.escape / scrollIntoView — stub the former, record the latter. */
let scrollIntoViewCalls: { el: Element; behavior?: unknown; block?: unknown }[] = []

beforeAll(() => {
  vi.stubGlobal('CSS', { escape: (s: string): string => s })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  document.body.innerHTML = ''
  scrollIntoViewCalls = []
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

function fakeSession(initial: Partial<Pick<FakeSession, 'nodes' | 'hasMore'>> & object = {}): FakeSession {
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
})

describe('jumpToMessage', () => {
  it('scrolls immediately when the node and its row are already rendered', async () => {
    const sp = mountScrollport()
    const key = '13:input-messagea'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    const row = addRow(sp, key)
    expect(await jumpToMessage(serviceFor(session), 's1', key)).toBe(true)
    expect(scrollIntoViewCalls).toHaveLength(2) // instant + smooth pass
    expect(scrollIntoViewCalls[0]?.el).toBe(row)
    expect(scrollIntoViewCalls[0]?.block).toBe('center')
  })

  it('waits for the committed row after loadOlder paging (the silent-failure regression)', async () => {
    const sp = mountScrollport()
    const key = '13:input-messagetarget'
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      // The store updates BEFORE React commits: add the node now, the row later.
      session.nodes.set(key, {})
      window.setTimeout(() => addRow(sp, key), 150)
    }
    expect(await jumpToMessage(serviceFor(session), 's1', key)).toBe(true)
    expect(session.loadOlderCalls).toBe(1)
    expect(scrollIntoViewCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('pages repeatedly until the target node enters the window', async () => {
    const sp = mountScrollport()
    const key = '13:input-messagefar'
    const session = fakeSession({ hasMore: true })
    session.loadOlder = async () => {
      session.loadOlderCalls += 1
      session.hasMore = session.loadOlderCalls < 3
      if (session.loadOlderCalls >= 3) session.nodes.set(key, {})
    }
    addRow(sp, key) // row already present (previously loaded history scenario)
    expect(await jumpToMessage(serviceFor(session), 's1', key)).toBe(true)
    expect(session.loadOlderCalls).toBe(3)
  })

  it('reports failure instead of throwing when the row never renders', async () => {
    mountScrollport()
    const key = '13:input-messageghost'
    const session = fakeSession({ nodes: new Map([[key, {}]]), hasMore: false })
    // Node exists but the DOM row never appears.
    expect(await jumpToMessage(serviceFor(session), 's1', key)).toBe(false)
    expect(scrollIntoViewCalls).toHaveLength(0)
  })

  it('returns false when the session binding is missing', async () => {
    expect(await jumpToMessage({ binding: () => undefined }, 's1', 'k')).toBe(false)
  })
})
