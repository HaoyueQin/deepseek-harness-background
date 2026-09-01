/**
 * Conversation jump engine — the shared behaviour both frontends run.
 *
 * Everything below the "which row" question lives here: paging older history
 * until the target node is loaded, waiting for React to commit the row,
 * detaching the host conversation's bottom-follow state so a re-render cannot
 * yank the glide back to the floor, and the glide itself.
 *
 * The official ChatView jump is one synchronous assignment
 * (`el.scrollTop += flowTop(row, el) - 24`) with no paging at all, which is
 * the pair of shortcomings this engine exists to fix. Both callers therefore
 * reuse the SAME code and differ only in two parameters: the host's
 * bottom-follow threshold (25px on the legacy conversation, 24px on the
 * current ChatView) and where the target row should land.
 */

import type { TimelineSessionHandle, TimelineSessionsService } from './types.ts'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How long one jump may keep paging older history before giving up. */
const JUMP_PAGE_DEADLINE_MS = 30000
/** How long to wait for the chat view to commit the target row. */
const JUMP_ROW_WAIT_MS = 3000

/**
 * Official conversation follow threshold of the current ChatView (25px on the
 * legacy conversation view). The reader stays "at bottom" while within this
 * distance of the floor, and the view keeps following new content.
 */
export const CHATVIEW_FOLLOW_ZONE_PX = 24
export const LEGACY_FOLLOW_ZONE_PX = 25

/** Distance from the scrollport top the official ChatView lands a jumped row at. */
const OFFICIAL_LANDING_INSET_PX = 24

/** Distances under this snap instead of animating. */
const MIN_GLIDE_DISTANCE_PX = 8

/** Glide duration floor / cap — a far-boundary jump stays a tangible slide. */
const MIN_GLIDE_MS = 280
const MAX_GLIDE_MS = 900

/** How many rounds one warm-up page waits for its prepend to commit. */
const WARM_PAGE_SETTLE_ROUNDS = 8
/** Pause between those rounds. */
const WARM_PAGE_SETTLE_MS = 25

/** Wall-clock budget for one warm-up run. */
const WARM_DEADLINE_MS = 15000
/** Page budget for one warm-up run. */
const WARM_MAX_PAGES = 40

/**
 * Where a jumped row should land.
 * @param el - the conversation scrollport.
 * @param row - the target chat row.
 * @returns the destination scrollTop.
 */
export type TargetTopResolver = (el: HTMLElement, row: HTMLElement) => number

/** Knobs one jump call may override. */
export interface JumpOptions {
  /** The host conversation's bottom-follow threshold in px. */
  followZonePx?: number
  /** Destination for the target row; defaults to centering it vertically. */
  targetTop?: TargetTopResolver
  /**
   * Restrict the pre-page bottom-follow detach to this scrollport. Omit to
   * detach every mounted scrollport (the safe default when the jump's target
   * column is not known yet).
   */
  scrollport?: HTMLElement | null
  /** Budget for paging older history. */
  pageDeadlineMs?: number
  /** Budget for waiting on the row to be committed. */
  rowWaitMs?: number
}

/** Every mounted conversation scrollport (multi-column layouts have several). */
export function conversationScrollports(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-conversation-scroll]'))
}

/**
 * Whether the target chat row is committed in ANY mounted conversation
 * scrollport. Kernel generations disagree on where the node table lives
 * (0.1.1: `SessionSnapshot.chat.nodes`; 0.1.2+: the `useChat` ChatSnapshot
 * node store, unreachable from `session.getSnapshot()` — its SessionSnapshot
 * faces no node table at all), but the rendered DOM is the ground truth both
 * share, so a jump probes it FIRST before deciding whether paging is needed.
 * @param anchorKey - chat anchor key of the target row.
 */
export function rowRenderedInDom(anchorKey: string): boolean {
  const selector = `[data-chat-anchor-key="${CSS.escape(anchorKey)}"]`
  for (const scrollport of conversationScrollports()) {
    if (scrollport.querySelector(selector) !== null) return true
  }
  return false
}

/**
 * Poll the conversation DOM until the target row is committed. The session
 * store updates BEFORE React renders the prepended page, so the old one-shot
 * query right after loadOlder() resolved could miss the row and silently
 * give up — the reported "click does nothing until the conversation is
 * nudged (scroll/click)" behavior.
 * @param key - chat anchor key to look for.
 * @param timeoutMs - polling budget.
 */
export async function waitForChatRow(key: string, timeoutMs: number): Promise<HTMLElement | null> {
  const selector = `[data-chat-anchor-key="${CSS.escape(key)}"]`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // Re-scan on every round: a ChatView remount (or a second column coming
    // up) repoints the row target, and the one-shot snapshot at entry would
    // miss a row committed into the PORT that appeared mid-wait.
    for (const scrollport of conversationScrollports()) {
      const row = scrollport.querySelector<HTMLElement>(selector)
      if (row !== null) return row
    }
    if (Date.now() >= deadline) return null
    await delay(40)
  }
}

/** Maximum scrollable offset of a conversation scrollport. */
export function scrollFloorOf(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

/**
 * Destination scrollTop that centers `row` inside `el` — the same geometry
 * as scrollIntoView({ block: 'center' }), computed directly so the glide owns
 * the scroll position instead of the browser.
 * @param el - the conversation scrollport.
 * @param row - the target chat row.
 */
export function centeredScrollTopFor(el: HTMLElement, row: HTMLElement): number {
  const floor = scrollFloorOf(el)
  const target = el.scrollTop
    + (row.getBoundingClientRect().top - el.getBoundingClientRect().top)
    - (el.clientHeight - row.offsetHeight) / 2
  if (!Number.isFinite(target)) return el.scrollTop
  return Math.max(0, Math.min(floor, target))
}

/**
 * Destination scrollTop the official ChatView uses for a navigation jump:
 * the row's top minus a 24px inset. Kept as a named resolver so the enhancer
 * lands exactly where the official would — only animated instead of assigned.
 * @param el - the conversation scrollport.
 * @param row - the target chat row.
 */
export function officialTargetTopFor(el: HTMLElement, row: HTMLElement): number {
  const floor = scrollFloorOf(el)
  const target = el.scrollTop
    + (row.getBoundingClientRect().top - el.getBoundingClientRect().top)
    - OFFICIAL_LANDING_INSET_PX
  if (!Number.isFinite(target)) return el.scrollTop
  return Math.max(0, Math.min(floor, target))
}

/**
 * Glide duration for a distance: longer slides take longer, bounded to
 * [MIN_GLIDE_MS, MAX_GLIDE_MS] (a deep-history jump reads as a deliberate
 * glide, not a sluggish race).
 * @param distance - px to travel.
 */
export function glideDurationFor(distance: number): number {
  if (!Number.isFinite(distance)) return MIN_GLIDE_MS
  return Math.round(Math.max(MIN_GLIDE_MS, Math.min(MAX_GLIDE_MS, 240 + Math.abs(distance) * 0.14)))
}

/**
 * Detach the host's bottom-follow state when the reader currently sits inside
 * its follow zone: assign the scroll position just outside the boundary. That
 * one synchronous scroll event settles at-bottom to false (moved-by-reader +
 * outside the zone) so a tip-moved re-render cannot yank the glide back to
 * the floor. No-op when already above the zone or when the assignment cannot
 * move (content shorter than the viewport).
 * @param el - the conversation scrollport.
 * @param followZonePx - the host's own follow threshold.
 */
export function detachBottomFollow(el: HTMLElement, followZonePx: number = LEGACY_FOLLOW_ZONE_PX): boolean {
  const floor = scrollFloorOf(el)
  // Only the bottom zone can still hold the follow flag: anywhere above it
  // the official scroll handler already settled at-bottom to false, and
  // dragging the viewport down to the zone would be a visible jump.
  if (el.scrollTop < floor - followZonePx) return false
  const detached = Math.max(0, floor - followZonePx - 1)
  if (Math.abs(el.scrollTop - detached) < 1) return false
  el.scrollTop = detached
  return true
}

/**
 * Wait until a detach assignment's scroll event has been dispatched AND
 * consumed by the host's scroll handler: scroll events fire on a later frame
 * than the assignment, and a paging commit's layout effect runs before that
 * dispatch — it would re-run the follow logic while the at-bottom flag is
 * still true and drag the viewport to the growing floor, undoing the detach
 * (two rAFs + a macrotask bracket the dispatch window).
 */
export function settleScrollEvents(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 0)))
  })
}

/**
 * Animate el.scrollTop toward target with an ease-in-out cubic profile.
 * Wheel / touch / keyboard-scroll input cancels the glide so the reader
 * takes over immediately. Resolves true when the glide completed, false
 * when the reader cancelled it.
 * @param el - the conversation scrollport.
 * @param target - destination scrollTop.
 * @param durationMs - animation budget.
 */
export function animateScrollTop(el: HTMLElement, target: number, durationMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = el.scrollTop
    const delta = target - start
    let done = false
    let frame = 0
    const finish = (completed: boolean): void => {
      if (done) return
      done = true
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouch)
      window.removeEventListener('keydown', onKey)
      if (frame !== 0) cancelAnimationFrame(frame)
      resolve(completed)
    }
    const onWheel = (): void => finish(false)
    const onTouch = (): void => finish(false)
    const onKey = (e: KeyboardEvent): void => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) finish(false)
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouch, { passive: true })
    window.addEventListener('keydown', onKey)
    if (Math.abs(delta) < 0.5 || durationMs <= 0) {
      el.scrollTop = target
      finish(true)
      return
    }
    const t0 = performance.now()
    const ease = (x: number): number => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
    const step = (now: number): void => {
      if (done) return
      const t = Math.min(1, (now - t0) / durationMs)
      el.scrollTop = start + delta * ease(t)
      if (t < 1) frame = requestAnimationFrame(step)
      else finish(true)
    }
    frame = requestAnimationFrame(step)
  })
}

/**
 * Page older history in WITHOUT moving what the reader is looking at.
 *
 * The host's ChatView compensates a prepend through an internal anchor ref
 * that only its own "load earlier" button and its own navigation arm. A
 * plugin calling `session.loadOlder()` from the outside gets no compensation,
 * so the prepended rows push the reader's content down — a visible jump.
 * This restores the visual position by the growth the prepend added.
 *
 * A reader pinned to the floor needs none of it: the host's follow logic
 * re-pins to the (growing) floor by itself, and compensating there would
 * fight it and overshoot.
 *
 * @param session - the session handle to page.
 * @param el - the conversation scrollport.
 * @param followZonePx - the host's bottom-follow threshold.
 * @returns whether the page actually grew the transcript (false = exhausted
 *   or failed, so the caller should stop paging).
 */
export async function compensatedLoadOlder(
  session: { loadOlder(): Promise<unknown> },
  el: HTMLElement,
  followZonePx: number = LEGACY_FOLLOW_ZONE_PX,
): Promise<boolean> {
  const pinned = scrollFloorOf(el) - el.scrollTop <= followZonePx
  const heightBefore = el.scrollHeight
  try {
    await session.loadOlder()
  } catch (error) {
    console.warn('[deepseek-harness-background] timeline history page failed:', error)
    return false
  }
  // The prepend commits on a later frame than the request's resolution
  // (store update -> React commit), so wait for the growth to land.
  for (let round = 0; round < WARM_PAGE_SETTLE_ROUNDS; round += 1) {
    await settleScrollEvents()
    const growth = el.scrollHeight - heightBefore
    if (growth > 0) {
      // Relative, not absolute: the browser keeps scrollTop constant while
      // content above it grows, so whatever the reader scrolled to during
      // the round-trip is preserved and only the prepend's height is undone.
      if (!pinned) el.scrollTop = el.scrollTop + growth
      return true
    }
    if (round < WARM_PAGE_SETTLE_ROUNDS - 1) await delay(WARM_PAGE_SETTLE_MS)
  }
  return false
}

/** Knobs one warm-up run may override. */
export interface WarmOptions {
  /** The host conversation's bottom-follow threshold in px. */
  followZonePx?: number
  /** Wall-clock budget for the whole run. */
  deadlineMs?: number
  /** Maximum number of pages one run may request. */
  maxPages?: number
  /** False once the caller unmounted — the run then stops at its next check. */
  alive?: () => boolean
  /** How many entries the rail currently shows. */
  countOf: () => number
  /** Marks the rail can show before it starts compressing them. */
  capacity: number
}

/**
 * Page older history in until the rail is full or the log is exhausted — the
 * "turns behind the load-earlier button become reachable" half of the
 * enhancement, shared by both frontends.
 *
 * Stops at `capacity` on purpose: past the rail's uncompressed tick count the
 * official stylesheet squeezes every mark into the same 420px column and the
 * rail degrades into a solid bar the reader cannot aim at. Filling it exactly
 * to capacity is free reach; going past it is not.
 *
 * @param session - the session handle to page.
 * @param scrollport - the conversation scrollport (compensation anchor).
 * @param options - budgets, the live entry count and the rail's capacity.
 */
export async function warmHistory(
  session: TimelineSessionHandle,
  scrollport: HTMLElement,
  options: WarmOptions,
): Promise<void> {
  const followZonePx = options.followZonePx ?? LEGACY_FOLLOW_ZONE_PX
  const deadline = Date.now() + (options.deadlineMs ?? WARM_DEADLINE_MS)
  const maxPages = options.maxPages ?? WARM_MAX_PAGES
  const alive = options.alive ?? ((): boolean => true)
  for (let page = 0; page < maxPages; page += 1) {
    if (!alive()) return
    if (options.countOf() >= options.capacity) return
    const snapshot = session.getSnapshot() as {
      hasMore?: boolean
      loadingOlder?: boolean
      openState?: unknown
    }
    if (snapshot?.hasMore !== true) return
    if (Date.now() >= deadline) return
    if (snapshot.loadingOlder === true) {
      await delay(50)
      continue
    }
    // A session that is not open yet cannot page; wait instead of burning the
    // budget on calls that cannot succeed.
    if (snapshot.openState !== undefined && snapshot.openState !== 'open') {
      await delay(100)
      continue
    }
    const grew = await compensatedLoadOlder(session, scrollport, followZonePx)
    if (!grew) return
  }
}

/**
 * Ensure the target node is loaded, wait for the chat view to commit its row
 * into the DOM, then glide it into view. Paging uses a time budget instead
 * of a fixed iteration guard (each in-flight page burned part of that guard,
 * so slow history could exhaust it and silently fail).
 *
 * @param sessionsService - the runtime sessions service.
 * @param sessionId - the session owning the target row.
 * @param anchorKey - chat anchor key of the target row.
 * @param options - follow zone, landing resolver, paging scopes and budgets.
 * @returns whether the row was reached (false when it never rendered or the
 *   reader took the scrollport back mid-glide).
 */
export async function jumpToMessage(
  sessionsService: TimelineSessionsService,
  sessionId: string,
  anchorKey: string,
  options: JumpOptions = {},
): Promise<boolean> {
  const session = sessionsService.binding(sessionId)?.session
  if (session === undefined) return false
  const followZonePx = options.followZonePx ?? LEGACY_FOLLOW_ZONE_PX
  const resolveTarget = options.targetTop ?? centeredScrollTopFor
  const pageDeadlineMs = options.pageDeadlineMs ?? JUMP_PAGE_DEADLINE_MS
  const rowWaitMs = options.rowWaitMs ?? JUMP_ROW_WAIT_MS

  // Detach the host's bottom-follow flag BEFORE paging: while a multi-page
  // loadOlder is in flight, every prepend commit re-runs the follow layout
  // effect (tip-moved + at-bottom) and toBottom() drags the viewport to the
  // (growing) floor — the jump would read as "surf to the newest floor, then
  // slide back to the target". One synchronous assignment just outside the
  // zone settles the flag for the whole paging phase, but the flag only flips
  // when the assignment's scroll event reaches the host handler, which
  // happens a frame later — so the paging phase waits for it first. The
  // post-wait detach below stays idempotent for the already-loaded case.
  // Multi-column layouts cannot pin the target session's scrollport before
  // the row exists, so every mounted scrollport is detached unless the caller
  // already knows the column (a ~zone-sized nudge elsewhere is the whole
  // cost; the reader's next scroll re-engages follow there).
  const ports = options.scrollport != null ? [options.scrollport] : conversationScrollports()
  let detachedAny = false
  for (const el of ports) {
    if (detachBottomFollow(el, followZonePx)) {
      // The host scroll handler flips its at-bottom flag on a scroll event,
      // and the real one only dispatches on a later frame — a paging
      // commit's layout effect runs before it and re-runs the follow logic.
      // A synthetic event notifies the handler synchronously, so the flag
      // settles before any prepend commit can observe it.
      el.dispatchEvent(new Event('scroll'))
      detachedAny = true
    }
  }
  if (detachedAny) await settleScrollEvents()
  const deadline = Date.now() + pageDeadlineMs
  for (;;) {
    // DOM ground truth FIRST: the row may already be committed in some
    // scrollport while the snapshot's node table — whatever generation it is
    // — does not host it. On 0.1.2+ `session.getSnapshot()` exposes no node
    // table at all (the `useChat` ChatSnapshot store is unreachable from
    // here), so without this probe every jump would page the WHOLE history
    // to the end (or burn the 30s deadline) even when the target row is on
    // screen behind the "load earlier" button.
    if (rowRenderedInDom(anchorKey)) break
    const snapshot = session.getSnapshot() as {
      chat?: { nodes?: { get(key: string): unknown } }
      nodes?: { get(key: string): unknown }
      hasMore?: boolean
      loadingOlder?: boolean
      openState?: unknown
    }
    // Legacy (<= 0.1.1) fast path: read the keyed node reader where one
    // EXISTS. The two kernel generations disagree on where the node table
    // lives AND on its shape — 0.1.1's snapshot exposes the windowed
    // ChatSnapshot node store at `chat.nodes` while its top-level `nodes`
    // compatibility field is a PLAIN ARRAY (no .get) — so both reads are
    // shape-guarded and a malformed store reads as absent (the DOM probe
    // above and the paging loop below then take over).
    const keyedNodeOf = (store: unknown): unknown =>
      store !== null && typeof store === 'object'
      && typeof (store as { get?: unknown }).get === 'function'
        ? (store as { get(key: string): unknown }).get(anchorKey)
        : undefined
    const loaded = keyedNodeOf(snapshot?.chat?.nodes) ?? keyedNodeOf(snapshot?.nodes)
    if (loaded !== undefined) break
    if (snapshot?.hasMore !== true) break
    if (Date.now() >= deadline) break
    if (snapshot.loadingOlder === true) {
      await delay(50)
      continue
    }
    // A session that is not open yet cannot page; give it a moment instead
    // of spinning the full budget on no-op calls.
    if (snapshot.openState !== undefined && snapshot.openState !== 'open') {
      await delay(100)
      continue
    }
    // A failing page must not reject the whole jump (or leave a lock to a
    // fallback timer): log and stop paging — the row may still render from an
    // earlier page, so waitForChatRow below gets its chance anyway.
    try {
      await session.loadOlder()
    } catch (error) {
      console.warn('[deepseek-harness-background] timeline jump paging failed:', error)
      break
    }
  }
  const row = await waitForChatRow(anchorKey, rowWaitMs)
  if (row === null) {
    console.warn(`[deepseek-harness-background] timeline jump target never rendered: ${anchorKey}`)
    return false
  }
  const reducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const scroller = row.closest<HTMLElement>('[data-conversation-scroll]')
  // No addressable scrollport (defensive): keep the platform path — the
  // instant placement flips the host's bottom-follow state through its scroll
  // event, the smooth pass afterwards is a no-op when already centered (and a
  // graceful glide when the row moved since).
  if (scroller === null) {
    row.scrollIntoView({ behavior: 'auto', block: 'center' })
    if (!reducedMotion) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }
  const target = resolveTarget(scroller, row)
  // Reduced motion or a hairline distance: one placement (its scroll event
  // still flips the bottom-follow state when it lands outside the zone).
  if (reducedMotion || Math.abs(target - scroller.scrollTop) < MIN_GLIDE_DISTANCE_PX) {
    scroller.scrollTop = target
    return true
  }
  // Bottom-follow detach BEFORE the glide: a pure slide starting at the floor
  // leaves the at-bottom flag true for its first frames, so a tip-moved
  // re-render (turn end / commit) yanks it back to the floor. The detach moves
  // at most ~zone px to just outside the follow zone (reads as a nudge, not a
  // jump); the flag settles once the dispatch frame passes, so the glide
  // waits for it first.
  if (detachBottomFollow(scroller, followZonePx)) {
    scroller.dispatchEvent(new Event('scroll'))
    await settleScrollEvents()
  }
  const completed = await animateScrollTop(scroller, target, glideDurationFor(Math.abs(target - scroller.scrollTop)))
  return completed
}
