/**
 * Official-rail enhancer — behaviour-only improvements to the kernel's own
 * turn navigator (dsh >= 0.1.2-rc.1, `TurnNavigator` in dsh-client-ui-chat).
 *
 * This component renders NOTHING. It borrows the official rail exactly as the
 * kernel painted it and fixes its behaviour, scoped to what the frame-style
 * rail (dsh >= 0.1.2-alpha.3, unchanged on 0.1.2-rc.1) still lacks — told
 * apart by capability, never by version compare:
 *
 * Smooth jump. The official `navigateToTurn` is one assignment
 * (`el.scrollTop += flowTop(row, el) - 24`); a click across a long transcript
 * teleports. Clicks on LOADED marks are intercepted in the capture phase and
 * re-run through the shared glide instead. The frame-style rail also renders
 * marks for turns OUTSIDE the loaded window (fed by the whole-log
 * `turnOutline` projection); those jumps page history through the kernel's
 * own loadThrough machinery — marks without an anchor key are left to it, and
 * the click index is resolved against the same merged ladder the kernel
 * renders. While one of those kernel jumps is still paging (a mark pulses
 * `aria-busy`), the plugin stands down entirely: the kernel's loaded branch
 * cancels its own pending jump before landing, and an interception would
 * bypass that cancellation.
 *
 * State-ownership note (why intercepting the official click loses nothing):
 * the kernel's scrollport (`data-conversation-scroll`, ChatView's
 * `onScrollRef` handler) treats every unaccounted scrollTop assignment as a
 * reader move and on each frame (a) flips its own at-bottom machinery,
 * (b) `chatScroll.save(position)` for view-tab restore, and (c)
 * `scheduleActiveTurn()` to re-derive the rail's active mark. The glide
 * animates the real scrollport, so all three keep converging to the target
 * row while it runs — the only thing the interception skips is the official
 * handler's synchronous `setActiveTurn(item.turn)`, which its own
 * scroll-driven active derivation re-settles by the time the glide lands.
 *
 * The jump goes through the shared backend (jump.ts).
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
import { CHATVIEW_FOLLOW_ZONE_PX, jumpToMessage, officialTargetTopFor } from './jump.ts'
import { indexForEvent, mergeRailItems, normalizeNavigationItems } from './rail-pointer.ts'
import type { TimelineSessionsService, TurnRailLadderItem } from './types.ts'

/**
 * Structural anchor of the official rail — its inline style carries the
 * frame's own metric (`--turn-natural-height`), published on every supported
 * kernel (dsh >= 0.1.2-rc.1). Whether the found rail is the supported
 * frame-style generation is then told apart by isFrameRail, never by a
 * version compare.
 */
export const OFFICIAL_RAIL_SELECTOR = '[data-conversation-scroll] nav[style*="--turn-natural-height"]'

/**
 * Rails claimed by an enhancer instance, keyed by the owning instance's
 * claim token. One session-scoped enhancer mounts per session; without a
 * claim two instances would both attach capture listeners to the FIRST rail
 * in the document (multi-column layouts) and one of them — not necessarily
 * the one owning the reader's column — would win the click. The token
 * distinguishes "already mine" (the poll keeps it) from "someone else's"
 * (this instance must stand down). Weak: a replaced rail element disappears
 * as soon as the browser collects it, so remounts need no bookkeeping.
 */
const claimedRails = new WeakMap<HTMLElement, symbol>()

/** How often the official rail is looked for (it mounts with the chat view). */
const RAIL_POLL_MS = 400

/** Component props delivered by the dock slot registration. */
export interface OfficialTimelineEnhancerProps {
  sessionId?: string
  sessionsService?: TimelineSessionsService
  /** Kernel selector hook over the Chat snapshot (dsh >= 0.1.2-rc.1). */
  useChat?: (selector: (snapshot: unknown) => unknown) => unknown
  /** Framework projection reader; the whole-log turn outline
   *  (`turnOutline`) arrives through it. */
  useProjection?: (key: string) => unknown
  /** Whether the persisted timeline toggle is on. */
  enabled: boolean
  t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * The enhancer: no visual output, only the behaviour fixes the running rail
 * generation lacks.
 * @param props - dock slot props plus the enabled gate.
 * @returns null (always).
 */
export function OfficialTimelineEnhancer(props: OfficialTimelineEnhancerProps): null {
  const { sessionId, sessionsService, useChat, useProjection, enabled } = props

  // The official navigation index — the loaded-window half of what the rail
  // renders, so this plugin always targets a mark that visually exists.
  const raw = useChat === undefined ? undefined : useChat((snapshot: unknown) => {
    const nav = (snapshot as { navigation?: { items?: () => unknown } } | undefined)?.navigation
    return typeof nav?.items === 'function' ? nav.items() : undefined
  })
  const items = normalizeNavigationItems(raw)
  // The whole-log outline (dsh >= 0.1.2-alpha.3) — the other half of the
  // rendered ladder. Reading an unregistered key is `undefined` on older
  // kernels, and the merge then degrades to the loaded items, which IS the
  // alpha.1/2 ladder. Called unconditionally per render: useProjection's
  // presence never flips within a kernel, so the hook order stays stable.
  const rawOutline = useProjection === undefined ? undefined : useProjection('turnOutline')
  const ladder = mergeRailItems(items, rawOutline)

  const [rail, setRail] = react.useState<HTMLElement | null>(null)

  // Mirrors so the listeners below stay identity-stable: `ladder` changes
  // identity on every turn change, and re-attaching a listener each time
  // would be pure churn. `railRef` mirrors the claimed rail so the poll
  // effect can release its claim on unmount without re-subscribing.
  const ladderRef = react.useRef(ladder)
  ladderRef.current = ladder
  const railRef = react.useRef<HTMLElement | null>(rail)
  railRef.current = rail

  // Locate the official rail. It mounts with the chat view and is replaced
  // whenever the view remounts, so it is polled rather than observed once.
  //
  // Ownership guard: one enhancer instance mounts per SESSION (the dock slot
  // is session-scoped), so a multi-column layout can run several instances
  // against the same selector. Without a claim, the first instance's capture
  // listener — the first registered on the shared rail — would swallow the
  // clicks of every other instance, which then silently jump the WRONG
  // session. The first instance to find the rail claims it for its
  // registration lifetime; later instances stand down and the stock
  // behaviour stays (no duplicate handlers, no mis-directed jumps). The
  // poll re-runs on the SAME instance, so the claim check must recognise
  // "already mine" instead of standing down against itself.
  const claimToken = react.useMemo<symbol>(() => Symbol('dsh-bg-timeline-claim'), [])
  react.useEffect(() => {
    const check = (): void => {
      const found = document.querySelector<HTMLElement>(OFFICIAL_RAIL_SELECTOR)
      if (found === null) {
        setRail(null)
        return
      }
      const owner = claimedRails.get(found)
      if (owner !== undefined && owner !== claimToken) {
        setRail(null)
        return
      }
      claimedRails.set(found, claimToken)
      setRail(found)
    }
    check()
    const timer = window.setInterval(check, RAIL_POLL_MS)
    return () => {
      window.clearInterval(timer)
      // Release the claim on unmount so a later instance (or a same-layout
      // remount that reuses the element) can take over.
      if (railRef.current !== null) claimedRails.delete(railRef.current)
    }
  }, [claimToken])

  const navigate = react.useCallback((item: TurnRailLadderItem): void => {
    // An outline-only mark (an unloaded turn) has no addressable row here —
    // the kernel's own loadThrough jump owns it (the click handler never
    // routes one this way; the guard is for direct callers).
    if (item.anchorKey === undefined) return
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

  // Click interception. Capture phase on the rail itself, so this runs before
  // React's root bubble listener and the official handler never fires — for a
  // LOADED mark. An outline-only mark (an unloaded turn, alpha.3) carries no
  // anchor key: standing down lets the event reach the kernel's own handler,
  // whose loadThrough machinery pages the history in and lands the row. While
  // one of those kernel jumps is still paging (its mark pulses aria-busy) the
  // plugin stands down ENTIRELY: the kernel's loaded branch cancels its own
  // pending jump before landing, which an interception would bypass — the
  // orphaned jump would teleport the scrollport away mid-glide at settle.
  react.useEffect(() => {
    if (!enabled || rail === null) return
    const onClick = (event: MouseEvent): void => {
      if (rail.querySelector('[aria-busy="true"]') !== null) return
      const index = indexForEvent(rail, event)
      const item = ladderRef.current[index]
      if (item === undefined || item.anchorKey === undefined) return
      event.preventDefault()
      event.stopImmediatePropagation()
      navigate(item)
    }
    rail.addEventListener('click', onClick, true)
    return () => { rail.removeEventListener('click', onClick, true) }
  }, [enabled, rail, navigate])

  return null
}
