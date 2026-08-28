/**
 * Official-rail enhancer — behaviour-only improvements to the kernel's own
 * turn navigator (dsh >= 0.1.2, `TurnNavigator` in dsh-client-ui-chat).
 *
 * This component renders NOTHING. It borrows the official rail exactly as the
 * kernel painted it and fixes two behaviours:
 *
 * 1. Smooth jump. The official `navigateToTurn` is one assignment
 *    (`el.scrollTop += flowTop(row, el) - 24`); a click across a long
 *    transcript teleports. Clicks are intercepted in the CAPTURE phase and
 *    re-run through the shared glide instead.
 * 2. Reachable history. The official rail only lists turns the client has
 *    already loaded, so anything behind the "load earlier" button has no mark
 *    at all. Hovering or focusing the rail pages older history in — only up
 *    to the rail's own uncompressed capacity, so the marks never degrade into
 *    a solid bar — with the scroll position compensated so the reader's view
 *    never moves.
 *
 * Both go through the shared backend (jump.ts), which is why the legacy port
 * behaves identically.
 *
 * Interception notes: React 18 dispatches `onClick` from a listener on the
 * root container during the BUBBLE phase. A capture listener on the rail
 * itself therefore runs first, and `stopImmediatePropagation()` there prevents
 * the event from ever reaching React's root — the official handler never
 * fires. The rail owns pointer input for its whole column (marks carry
 * `pointer-events: none`), so one listener catches mouse and keyboard alike.
 *
 * Nothing here touches the official DOM: no nodes are injected into a
 * React-owned subtree and no official class or paint is overridden.
 */

import react from 'react'
import { CHATVIEW_FOLLOW_ZONE_PX, jumpToMessage, officialTargetTopFor, warmHistory } from './jump.ts'
import { indexForEvent, normalizeNavigationItems, railCapacityOf } from './rail-pointer.ts'
import type { OfficialNavigationItem, TimelineSessionsService } from './types.ts'

/** Structural anchor of the official rail (its inline style carries the rail's own metrics). */
export const OFFICIAL_RAIL_SELECTOR = '[data-conversation-scroll] nav[style*="--turn-natural-height"]'

/** How often the official rail is looked for (it mounts with the chat view). */
const RAIL_POLL_MS = 400

/** Component props delivered by the dock slot registration. */
export interface OfficialTimelineEnhancerProps {
  sessionId?: string
  sessionsService?: TimelineSessionsService
  /** Kernel selector hook over the Chat snapshot (absent before 0.1.2). */
  useChat?: (selector: (snapshot: unknown) => unknown) => unknown
  /** Whether the persisted timeline toggle is on. */
  enabled: boolean
  t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * The enhancer: no visual output, only the two behaviour fixes.
 * @param props - dock slot props plus the enabled gate.
 * @returns null (always).
 */
export function OfficialTimelineEnhancer(props: OfficialTimelineEnhancerProps): null {
  const { sessionId, sessionsService, useChat, enabled } = props

  // The official navigation index — the very array the official rail renders,
  // so this plugin always targets a mark that visually exists.
  const raw = useChat === undefined ? undefined : useChat((snapshot: unknown) => {
    const nav = (snapshot as { navigation?: { items?: () => unknown } } | undefined)?.navigation
    return typeof nav?.items === 'function' ? nav.items() : undefined
  })
  const items = normalizeNavigationItems(raw)

  const session = sessionId !== undefined && sessionsService !== undefined
    ? sessionsService.binding(sessionId)?.session
    : undefined
  const [rail, setRail] = react.useState<HTMLElement | null>(null)

  // Mirrors so the listeners below stay identity-stable: `items` changes
  // identity on every turn change, and re-attaching a listener each time
  // would be pure churn.
  const itemsRef = react.useRef(items)
  itemsRef.current = items
  const aliveRef = react.useRef(true)
  const warmingRef = react.useRef(false)

  react.useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // Locate the official rail. It mounts with the chat view and is replaced
  // whenever the view remounts, so it is polled rather than observed once.
  react.useEffect(() => {
    const check = (): void => {
      const found = document.querySelector<HTMLElement>(OFFICIAL_RAIL_SELECTOR)
      setRail((prev) => (prev === found ? prev : found))
    }
    check()
    const timer = window.setInterval(check, RAIL_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [])

  const navigate = react.useCallback((item: OfficialNavigationItem): void => {
    if (sessionsService === undefined || sessionId === undefined) return
    // Scope the bottom-follow detach to the column this rail belongs to: the
    // official rail is mounted, so its scrollport is known and the other
    // columns need no nudge.
    const scrollport = rail === null ? null : rail.closest<HTMLElement>('[data-conversation-scroll]')
    void jumpToMessage(sessionsService, sessionId, item.anchorKey, {
      followZonePx: CHATVIEW_FOLLOW_ZONE_PX,
      targetTop: officialTargetTopFor,
      scrollport,
    }).catch(() => {})
  }, [sessionsService, sessionId, rail])

  /**
   * Page older history in until the rail is full or the log is exhausted.
   * Each page is compensated so the reader's view stays put (see
   * compensatedLoadOlder for why the kernel cannot do this for us).
   */
  const warm = react.useCallback(async (): Promise<void> => {
    if (session === undefined || rail === null) return
    if (warmingRef.current) return
    const scrollport = rail.closest<HTMLElement>('[data-conversation-scroll]')
    if (scrollport === null) return
    warmingRef.current = true
    try {
      await warmHistory(session, scrollport, {
        followZonePx: CHATVIEW_FOLLOW_ZONE_PX,
        alive: () => aliveRef.current,
        countOf: () => itemsRef.current.length,
        capacity: railCapacityOf(rail),
      })
    } finally {
      warmingRef.current = false
    }
  }, [session, rail])

  // Click interception. Capture phase on the rail itself, so this runs before
  // React's root bubble listener and the official handler never fires.
  react.useEffect(() => {
    if (!enabled || rail === null) return
    const onClick = (event: MouseEvent): void => {
      const index = indexForEvent(rail, event)
      const item = itemsRef.current[index]
      if (item === undefined) return
      event.preventDefault()
      event.stopImmediatePropagation()
      navigate(item)
    }
    rail.addEventListener('click', onClick, true)
    return () => { rail.removeEventListener('click', onClick, true) }
  }, [enabled, rail, navigate])

  // Warm-up trigger: pointer or keyboard intent on the rail. Nothing pages
  // until the reader actually reaches for the rail.
  react.useEffect(() => {
    if (!enabled || rail === null) return
    const start = (): void => { void warm() }
    rail.addEventListener('pointerenter', start)
    rail.addEventListener('focusin', start)
    return () => {
      rail.removeEventListener('pointerenter', start)
      rail.removeEventListener('focusin', start)
    }
  }, [enabled, rail, warm])

  return null
}
