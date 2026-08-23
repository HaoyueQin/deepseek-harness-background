/**
 * Conversation timeline rail — DeepSeek web ScrollNav rebuilt on this
 * plugin's frosted-glass system (styles: ./timeline-css.ts).
 *
 * Collapsed: a fixed 34px-wide frosted capsule at the right edge, vertically
 * centered, one tick per user message (active tick scaled + brand blue,
 * key-point bookmarks golden). Hovering expands the SAME box into a frosted
 * panel listing every user question (title fades in; >8 messages widen to
 * 260px, otherwise the width fits the longest title). Both states share one
 * computed outer height, so expanding never jumps, and 32px fade veils mask
 * the clipped edge on each side while that side actually scrolls.
 *
 * Enhancements ported from dsh-chat-timeline v0.1.4 (MIT):
 * - Key-point bookmarks: star a question in the expanded panel, persisted per
 *   session in localStorage; marked rows show a golden tick in the capsule
 *   and a "marked only" filter narrows the list.
 * - Jump stabilization: the reading-position tracker freezes while a smooth
 *   jump animates (cleared 150ms after the last scroll event, plus an 800ms
 *   fallback), so the panel cannot jitter mid-jump.
 * - Rewind integration: messages withdrawn by a rewind command node are
 *   filtered out of the rail.
 *
 * Data source, fastest first: the host-side `bgTimeline` session projection
 * (src/projection.ts — a complete enumeration of the session's user messages
 * delivered through the projection baseline/push channel) -> the loaded chat
 * node window. The conversation's own lazy loading is never driven from here;
 * clicking a row pages older history on demand, scrolls the conversation to
 * the target row, and keeps the rail's own active row visible.
 *
 * Collapsed idle strategy (official ScrollNav behavior): the tick stack is
 * pinned to the BOTTOM inner edge — the newest question's tick always sits at
 * the bottom of the capsule, older ticks clip away at the top. Hovering
 * expands the SAME box and scrolls the active row into view instead.
 *
 * The rail reads the shared settings transport: it renders unless
 * `timeline: false`. Its glass paints are self-contained official values
 * (see timeline-css.ts), independent of the plugin's token overrides.
 */

import react from 'react'
import reactDom from 'react-dom'
import { settingsClient } from './settings-client.ts'
import { injectTimelineCss } from './timeline-css.ts'

// Inject the stylesheet once at module evaluation (the loader removes
// plugin-owned tags on unload; re-evaluation dedupes on the tag id).
if (typeof document !== 'undefined') injectTimelineCss()

/** Structural view of one chat node this rail consumes. */
interface ChatNodeLike {
  kind?: string
  key?: string
  anchorSeq?: number
  data?: {
    time?: number
    content?: unknown
    name?: unknown
    seq?: unknown
    args?: unknown
    outcome?: { kind?: unknown; sourceEventSeq?: unknown; text?: unknown }
  }
}

/** One normalized user-message entry in the rail. */
export interface TimelineMessage {
  seq: number
  time: number
  text: string
  key?: string
}

/** Session handle face the rail needs off the runtime sessions service. */
export interface TimelineSessionHandle {
  subscribe(listener: () => void): () => void
  getSnapshot(): unknown
  loadOlder(): Promise<unknown>
}

/** Sessions service face (narrowed to what jump/data collection touches). */
export interface TimelineSessionsService {
  binding(sessionId: string): { session: TimelineSessionHandle } | undefined
}

/** Component props delivered by the dock slot registration. */
export interface TimelineRailProps {
  sessionId?: string
  sessionsService?: TimelineSessionsService
  /** Framework projection reader (SessionStandardProps seat; undefined-capable). */
  useProjection?: (key: string) => unknown
  t: (key: string) => string
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Extract preview text from a user message's ContentBlock list. */
function userTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') out += text
    }
  }
  return out.trim().slice(0, 80)
}

/* ---- Key-point bookmarks (ported from dsh-chat-timeline v0.1.4) --------- */

/**
 * Stable bookmark key for one entry: the durable message key, falling back to
 * the anchor seq — so marks survive history reloads. Entries with neither are
 * not markable (empty key).
 * @param m - the entry (or any shaped object).
 */
export function markKeyOf(m: unknown): string {
  if (m === null || typeof m !== 'object') return ''
  const rec = m as { key?: unknown; seq?: unknown }
  if (typeof rec.key === 'string' && rec.key !== '') return `key:${rec.key}`
  return typeof rec.seq === 'number' ? `seq:${rec.seq}` : ''
}

/** localStorage key prefix for the per-session marked-key lists. */
export const MARKS_STORAGE_PREFIX = 'dsbt_marks_'

/**
 * Read the marked keys for one session from localStorage.
 * @param sessionId - the session the marks belong to.
 */
export function readMarks(sessionId: string | undefined): string[] {
  if (typeof window === 'undefined' || !sessionId) return []
  try {
    const raw = window.localStorage.getItem(MARKS_STORAGE_PREFIX + sessionId)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * Persist the marked keys for one session (removes the key when empty).
 * @param sessionId - the session the marks belong to.
 * @param marks - the marked-key list.
 */
export function writeMarks(sessionId: string | undefined, marks: string[]): void {
  if (typeof window === 'undefined' || !sessionId) return
  try {
    if (!Array.isArray(marks) || marks.length === 0) window.localStorage.removeItem(MARKS_STORAGE_PREFIX + sessionId)
    else window.localStorage.setItem(MARKS_STORAGE_PREFIX + sessionId, JSON.stringify(marks))
  } catch { /* storage unavailable — marks stay in-memory */ }
}

/* ---- Rewind integration (ported from dsh-chat-timeline v0.1.4) ---------- */

/**
 * Extract the rewind target seq from a rewind outcome text.
 * @param text - the command outcome text.
 */
export function rewindTargetOfOutcome(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined
  const match = /rewound.*?(?:target\s+)?(\d+)/i.exec(text) ?? /#(\d+)/.exec(text)
  const digits = match?.[1]
  if (digits === undefined) return undefined
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Is this rewind command a preview/dry-run (marks the target hidden without
 * an outcome)?
 * @param command - the command payload.
 */
function isRewindPreviewCommand(command: { args?: unknown }): boolean {
  if (command.args === null || typeof command.args !== 'object') return false
  const args = command.args as { preview?: unknown; dryRun?: unknown }
  return args.preview === true || args.dryRun === true
}

/**
 * Collect the seq numbers a rewind hid: preview commands hide their target
 * directly; successful commands hide their own row plus every node anchored
 * inside the rewound span [target, sourceEventSeq].
 * @param chat - a chat snapshot (loosely typed on purpose).
 */
export function hiddenSeqsOfChat(chat: unknown): Set<number> {
  const hidden = rewindHiddenSeqsOfChat(chat)
  const spans = rewindSpansOfChat(chat)
  if (spans.length === 0) return hidden
  const nodes = (chat as { nodes?: Map<string, ChatNodeLike> }).nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return hidden
  for (const node of nodes.values()) {
    if (node === null || typeof node !== 'object') continue
    const anchor = typeof node.anchorSeq === 'number' ? node.anchorSeq : undefined
    if (anchor === undefined) continue
    if (spans.some((span) => anchor >= span.start && anchor <= span.end)) hidden.add(anchor)
  }
  return hidden
}

/**
 * Seq numbers a rewind hid directly: successful commands hide their own row;
 * preview commands hide their target.
 * @param chat - a chat snapshot (loosely typed on purpose).
 */
export function rewindHiddenSeqsOfChat(chat: unknown): Set<number> {
  const hidden = new Set<number>()
  if (chat === null || typeof chat !== 'object') return hidden
  const nodes = (chat as { nodes?: Map<string, ChatNodeLike> }).nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return hidden
  for (const node of nodes.values()) {
    if (node === null || typeof node !== 'object') continue
    if (node.kind !== 'command') continue
    const command = node.data
    if (command === null || typeof command !== 'object') continue
    if (command.name !== 'rewind') continue
    if (isRewindPreviewCommand(command)) {
      if (typeof command.seq === 'number') hidden.add(command.seq)
      continue
    }
    const outcome = command.outcome
    if (outcome === null || typeof outcome !== 'object' || outcome.kind !== 'success') continue
    if (typeof command.seq === 'number') hidden.add(command.seq)
  }
  return hidden
}

/**
 * The [target, sourceEventSeq] spans successful rewind commands cut — the
 * range form of hiding, needed to filter sources that are NOT chat nodes
 * (the host projection) by plain seq membership.
 * @param chat - a chat snapshot (loosely typed on purpose).
 */
export function rewindSpansOfChat(chat: unknown): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  if (chat === null || typeof chat !== 'object') return spans
  const nodes = (chat as { nodes?: Map<string, ChatNodeLike> }).nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return spans
  for (const node of nodes.values()) {
    if (node === null || typeof node !== 'object') continue
    if (node.kind !== 'command') continue
    const command = node.data
    if (command === null || typeof command !== 'object') continue
    if (command.name !== 'rewind') continue
    if (isRewindPreviewCommand(command)) continue
    const outcome = command.outcome
    if (outcome === null || typeof outcome !== 'object' || outcome.kind !== 'success') continue
    const marker = outcome.sourceEventSeq
    if (typeof marker !== 'number') continue
    const target = rewindTargetOfOutcome(outcome.text)
    if (target !== undefined) spans.push({ start: target, end: marker })
  }
  return spans
}

/**
 * Enumerate user messages from the loaded chat-node snapshot (the client-side
 * collector; sorted by anchor sequence, rewind-hidden entries dropped).
 * @param snapshot - a session snapshot (loosely typed on purpose).
 */
export function collectMessages(snapshot: unknown): TimelineMessage[] {
  const chat = (snapshot as { chat?: { nodes?: Map<string, ChatNodeLike> } } | undefined)?.chat
  const nodes = chat?.nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return []
  const hidden = hiddenSeqsOfChat(chat)
  const out: TimelineMessage[] = []
  for (const node of nodes.values()) {
    if (node === null || typeof node !== 'object') continue
    if (node.kind !== 'user') continue
    const data = node.data
    if (data === null || typeof data !== 'object' || typeof data.time !== 'number' || !Array.isArray(data.content)) continue
    const key = typeof node.key === 'string' ? node.key : undefined
    if (key === undefined) continue
    const seq = typeof node.anchorSeq === 'number' ? node.anchorSeq : 0
    if (hidden.has(seq)) continue
    out.push({ seq, time: data.time, text: userTextOf(data.content), key })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/** Resolve the DOM anchor key of one entry (direct key form only). */
export function resolveAnchorKey(m: TimelineMessage): string | undefined {
  return typeof m.key === 'string' && m.key !== '' ? m.key : undefined
}

/* ---- Host projection source --------------------------------------------- */

/** Projection key the host half registers (see src/projection.ts). */
export const TIMELINE_PROJECTION_KEY = 'bgTimeline'

/** The user-message node definition kind in ui-conversation. */
const INPUT_MESSAGE_KIND = 'input-message'

/**
 * Rebuild a chat row's DOM anchor key from the durable message id — the same
 * engine formula as conversationContextKey(kind, id) for the input-message
 * definition (`13:input-message<id>`), so projected entries can jump even
 * when their chat node is not loaded yet.
 * @param id - the durable message id carried by the projection entry.
 */
export function inputAnchorKeyOf(id: string): string {
  return `${INPUT_MESSAGE_KIND.length}:${INPUT_MESSAGE_KIND}${id}`
}

/**
 * Validate one projected wire value into rail entries (defensive: the value
 * crosses the wire and may be absent, partial, or stale).
 * @param value - the raw useProjection(TIMELINE_PROJECTION_KEY) snapshot.
 */
export function normalizeProjectedTimeline(value: unknown): TimelineMessage[] {
  if (value === null || typeof value !== 'object') return []
  const raw = (value as { messages?: unknown }).messages
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: TimelineMessage[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as { seq?: unknown; time?: unknown; text?: unknown; id?: unknown }
    if (typeof rec.seq !== 'number' || !Number.isFinite(rec.seq)) continue
    if (seen.has(rec.seq)) continue
    seen.add(rec.seq)
    out.push({
      seq: rec.seq,
      time: typeof rec.time === 'number' ? rec.time : 0,
      text: typeof rec.text === 'string' ? rec.text.slice(0, 80) : '',
      ...(typeof rec.id === 'string' && rec.id !== '' ? { key: inputAnchorKeyOf(rec.id) } : {}),
    })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/**
 * Rail messages with the fastest source first: the host projection covers the
 * WHOLE session (and already excludes rewind cuts), so it wins whenever it
 * has anything; otherwise fall back to the loaded chat-node window. The
 * projection path still applies locally-known rewind hiding so a cut lands
 * instantly even before the next projection push arrives.
 * @param snapshot - the session conversation snapshot (node fallback).
 * @param projected - the raw bgTimeline projection value.
 */
export function railMessages(snapshot: unknown, projected: unknown): TimelineMessage[] {
  const projectedMessages = normalizeProjectedTimeline(projected)
  if (projectedMessages.length > 0) {
    // The host projection already drops rewind cuts authoritatively; this
    // locally-known hiding (command rows, preview targets and cut spans read
    // off the loaded window) makes a rewind land instantly, before the next
    // projection push arrives.
    const chat = (snapshot as { chat?: { nodes?: Map<string, ChatNodeLike> } } | undefined)?.chat
    const hidden = rewindHiddenSeqsOfChat(chat)
    const spans = rewindSpansOfChat(chat)
    if (hidden.size === 0 && spans.length === 0) return projectedMessages
    return projectedMessages.filter((m) =>
      !hidden.has(m.seq) && !spans.some((span) => m.seq >= span.start && m.seq <= span.end))
  }
  return collectMessages(snapshot)
}

/**
 * Outer rail height for a message count: rows + breathing room, clamped so
 * both states always share the exact same height (never jumps on expand).
 * @param count - number of user messages.
 */
export function railHeightFor(count: number): number {
  return Math.max(140, Math.min(300, count * 30 + 38))
}

/** Longest-title width estimate bounds. */
const RAIL_MIN_WIDTH = 96
const RAIL_MAX_WIDTH = 260

/**
 * Measure the expanded-panel width for the given titles (canvas text metrics;
 * falls back to the max width when measurement is unavailable). Accounts for
 * the star column so a marked row never clips its tick.
 * @param texts - the message previews.
 */
export function railWidthFor(texts: string[]): number {
  if (texts.length > 8) return RAIL_MAX_WIDTH
  let widest = 0
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      for (const t of texts) {
        const w = ctx.measureText(t === '' ? '…' : t).width
        if (w > widest) widest = w
      }
    }
  }
  // Title + title gap + star column + indicator + item gutters + border/padding.
  return Math.round(Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, widest + 6 + 24 + 16 + 12)))
}

/** Ensure the target node is loaded, then scroll its row into view. */
async function jumpToMessage(sessionsService: TimelineSessionsService, sessionId: string, key: string): Promise<boolean> {
  const session = sessionsService.binding(sessionId)?.session
  if (session === undefined) return false
  let guard = 0
  while (guard++ < 120) {
    const snapshot = session.getSnapshot() as { chat?: { nodes?: Map<string, unknown> }; hasMore?: boolean; loadingOlder?: boolean }
    if (snapshot?.chat?.nodes?.get(key) !== undefined) break
    if (snapshot?.hasMore !== true) return false
    if (snapshot.loadingOlder === true) {
      await delay(50)
      continue
    }
    await session.loadOlder()
  }
  const scrollport = document.querySelector('[data-conversation-scroll]')
  const row = scrollport?.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`) ?? null
  if (row === null) return false
  const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })
  return true
}

/**
 * Scroll only the rail itself so the active row stays visible (min distance).
 * offsetTop math instead of getBoundingClientRect: stable while the panel's
 * own smooth scroll animates (no feedback loop with live rects).
 */
function scrollTimelineItemIntoView(page: HTMLElement, item: HTMLElement): void {
  const pageTop = page.scrollTop
  const pageBottom = pageTop + page.clientHeight
  const itemTop = item.offsetTop
  const itemBottom = itemTop + item.offsetHeight
  if (itemTop < pageTop) page.scrollTop = Math.max(0, itemTop - 10)
  else if (itemBottom > pageBottom) page.scrollTop = itemBottom - page.clientHeight + 10
}

/** Is another timeline rail already mounted (e.g. dsh-chat-timeline)? */
function otherRailPresent(): boolean {
  return document.querySelector('.dsct_nav') !== null
}

/**
 * The timeline rail component. Portaled to body; registered into the
 * conversation input dock purely to bind per-session lifecycle.
 */
export function TimelineRail(props: TimelineRailProps): react.ReactElement | null {
  const { sessionId, sessionsService, useProjection, t } = props

  // Shared settings: the rail hides while timeline === false. Read through a
  // hook like every other store here, but the gate itself must sit with the
  // FINAL early return below — an early return between hooks would crash
  // React ("rendered fewer hooks") the moment the toggle flips mid-session.
  const settings = react.useSyncExternalStore(settingsClient.subscribe, settingsClient.getSnapshot)
  // Hide only while the persisted toggle is UNKNOWN (no wrong-state flash for
  // timeline:false users); once loading settles the default-on rail renders
  // even if the section errored.
  const timelineUnknown = settings.status === 'loading'
  const timelineDisabled = settings.value?.timeline === false

  const session = sessionId !== undefined && sessionsService !== undefined ? sessionsService.binding(sessionId)?.session : undefined
  // SessionFace methods are prototype methods reading "this"; React invokes
  // store callbacks as bare functions, so keep the receiver via closures
  // (same shape as the host's own wiring, e.g. ModelSelect). Identity stays
  // stable per session so uSES does not resubscribe on every render.
  const subscribeSession = react.useCallback(
    (listener: () => void) => session === undefined ? () => {} : session.subscribe(listener),
    [session],
  )
  const snapshotSession = react.useCallback(
    () => session === undefined ? undefined : session.getSnapshot(),
    [session],
  )
  const nodeSnapshot = react.useSyncExternalStore(subscribeSession, snapshotSession)

  // Host projection first: the full-session user-message index (baseline on
  // session open, live push frames after). Undefined until the framework
  // seat exists or the deployment lacks the projection registry — then the
  // loaded chat-node window below is the fallback source.
  const projected = useProjection !== undefined ? useProjection(TIMELINE_PROJECTION_KEY) : undefined

  // Collected per snapshot/projection change (the collector allocates +
  // sorts); memoized so width measurement and tracking effects key on
  // content, not renders.
  const messages = react.useMemo(() => railMessages(nodeSnapshot, projected), [nodeSnapshot, projected])

  const [activeIndex, setActiveIndex] = react.useState(-1)
  const [show, setShow] = react.useState(false)
  const [rightOffset, setRightOffset] = react.useState(16)
  const [railWidth, setRailWidth] = react.useState(RAIL_MAX_WIDTH)
  const [fades, setFades] = react.useState({ top: false, bottom: false })
  const [hidden, setHidden] = react.useState(() => otherRailPresent())
  // Key-point bookmarks: per-session list + the "marked only" filter toggle.
  const [marks, setMarks] = react.useState<string[]>(() => readMarks(sessionId))
  const [marksOnly, setMarksOnly] = react.useState(false)
  const [isNarrow, setIsNarrow] = react.useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 767px)').matches,
  )
  const pageRef = react.useRef<HTMLDivElement | null>(null)
  const activeItemRef = react.useRef<HTMLButtonElement | null>(null)
  // Jump-stabilization lock: freezes the reading-position tracker while a
  // click-triggered smooth jump animates (cleared by the settle timer below
  // or the 800ms fallback in the click handler). The fallback timeout is
  // tracked so the settle path can cancel it and unmount cannot leak it.
  const jumpPendingRef = react.useRef(false)
  const jumpFallbackRef = react.useRef<number | undefined>(undefined)

  // Marks follow the session switch; the filter resets with them.
  react.useEffect(() => {
    setMarks(readMarks(sessionId))
    setMarksOnly(false)
  }, [sessionId])

  const markedSet = react.useMemo(() => new Set(marks), [marks])
  // Mirror ref so rapid successive toggles always see the latest list (the
  // handler writes storage directly, outside the setState updater — updaters
  // must stay pure and StrictMode re-runs them).
  const marksRef = react.useRef(marks)
  marksRef.current = marks
  const toggleMark = react.useCallback((m: TimelineMessage) => {
    const k = markKeyOf(m)
    if (k === '') return
    const prev = marksRef.current
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    marksRef.current = next
    setMarks(next)
    writeMarks(sessionId, next)
  }, [sessionId])

  // Narrow-viewport guard (matches the official breakpoint).
  react.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent): void => setIsNarrow(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Width follows the longest title (remeasured when messages arrive/change).
  // No gating on a "fully loaded" flag: the projection source is complete by
  // construction, and the node fallback measures whatever it has.
  react.useEffect(() => {
    setRailWidth(railWidthFor(messages.map((m) => m.text)))
  }, [messages])

  // Reading position tracking: nearest user row to the 40% viewport line.
  // An IntersectionObserver (when available) keeps a live set of the rows
  // currently inside the scrollport — the best row is always one of them — so
  // each pass reads a few dozen rects instead of one per row of a possibly
  // thousand-row history; without IO measure() scans every row as before.
  react.useEffect(() => {
    if (messages.length === 0) return
    const indexByKey = new Map<string, number>()
    messages.forEach((m, i) => {
      const key = resolveAnchorKey(m)
      if (key !== undefined) indexByKey.set(key, i)
    })
    const sp = document.querySelector('[data-conversation-scroll]')
    if (sp === null) return
    const rows = sp.querySelectorAll('[data-chat-anchor-key]')

    let settleTimer: number | undefined
    let frame = 0
    const nearRows = new Set<Element>()

    const updateActive = (): void => {
      // A jump is animating: freeze the highlight so the panel cannot jitter.
      if (jumpPendingRef.current) return
      const rect = sp.getBoundingClientRect()
      if (rect.height === 0) return
      const candidates = nearRows.size > 0 ? nearRows : rows
      const line = rect.top + rect.height * 0.4
      let best = -1
      let bestDist = Infinity
      for (const row of candidates) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null) continue
        const idx = indexByKey.get(key) ?? -1
        if (idx === -1) continue
        const r = row.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - line)
        if (dist < bestDist) {
          bestDist = dist
          best = idx
        }
      }
      setActiveIndex(best)
    }
    const scheduleMeasure = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateActive()
      })
    }

    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) nearRows.add(entry.target)
          else nearRows.delete(entry.target)
        }
        scheduleMeasure()
      }, { root: sp })
      rows.forEach((row) => io?.observe(row))
    }

    const onScroll = (): void => {
      // Detect the true end of scrolling: 150ms after the LAST scroll event
      // release the jump lock and refresh the highlight exactly once.
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined
        if (jumpPendingRef.current) {
          jumpPendingRef.current = false
          if (jumpFallbackRef.current !== undefined) {
            clearTimeout(jumpFallbackRef.current)
            jumpFallbackRef.current = undefined
          }
          updateActive()
        }
      }, 150)
      scheduleMeasure()
    }
    sp.addEventListener('scroll', onScroll, { passive: true })
    const interval = window.setInterval(scheduleMeasure, 2000)
    scheduleMeasure()
    return () => {
      io?.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      if (jumpFallbackRef.current !== undefined) {
        clearTimeout(jumpFallbackRef.current)
        jumpFallbackRef.current = undefined
      }
      sp.removeEventListener('scroll', onScroll)
      clearInterval(interval)
    }
  }, [messages])

  // Fade veils reflect the page's actual clip state (scroll position).
  const syncFades = react.useCallback((): void => {
    const page = pageRef.current
    if (page === null) {
      setFades({ top: false, bottom: false })
      return
    }
    const canTop = page.scrollTop > 2
    const canBot = page.scrollTop + page.clientHeight < page.scrollHeight - 2
    setFades((prev) => (prev.top === canTop && prev.bottom === canBot ? prev : { top: canTop, bottom: canBot }))
  }, [])
  react.useEffect(syncFades, [syncFades, show, messages.length, marksOnly])

  // Keep the active row visible inside the rail without moving the chat.
  react.useLayoutEffect(() => {
    if (!show) return
    const page = pageRef.current
    const item = activeItemRef.current
    if (page === null || item === null) return
    scrollTimelineItemIntoView(page, item)
    syncFades()
  }, [activeIndex, messages.length, marksOnly, show, syncFades])

  // Collapsed idle strategy (official ScrollNav behavior): pin the tick stack
  // to the BOTTOM inner edge so the newest question's tick always hugs the
  // bottom of the capsule and older ticks clip away at the top. overflow:hidden
  // boxes still accept programmatic scrollTop; scrollHeight clamps the value,
  // and short stacks that fit simply stay put (the page centers them). Runs on
  // every collapse and whenever the stack changes while idle, so a message
  // sent in another window keeps the newest tick pinned.
  const height = railHeightFor(messages.length)
  react.useLayoutEffect(() => {
    if (show) return
    const page = pageRef.current
    if (page === null) return
    page.scrollTop = page.scrollHeight
  }, [show, messages.length, marksOnly, height])

  // Avoid right-side workbenches: derive the offset from the chat scrollport.
  react.useEffect(() => {
    let raf = 0
    const measure = (): void => {
      raf = 0
      const sp = document.querySelector('[data-conversation-scroll]')
      if (sp === null) return
      const rect = sp.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const next = Math.max(8, Math.round(window.innerWidth - rect.right + 12))
      setRightOffset((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    const schedule = (): void => {
      if (raf === 0) raf = window.requestAnimationFrame(measure)
    }
    const sp = document.querySelector('[data-conversation-scroll]')
    const ro = typeof ResizeObserver === 'function' && sp !== null ? new ResizeObserver(schedule) : null
    if (ro !== null && sp !== null) ro.observe(sp)
    window.addEventListener('resize', schedule)
    // Slow guard: pick up a competing rail (un)mounting mid-session.
    const guard = window.setInterval(() => setHidden(otherRailPresent()), 2000)
    measure()
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      clearInterval(guard)
    }
  }, [])

  if (timelineUnknown || timelineDisabled
    || sessionId === undefined || sessionsService === undefined || isNarrow || hidden || messages.length < 2) {
    return null
  }

  // Compare actives by bookmark key, not index: the filtered display list
  // reindexes rows, and the active ref must track the SAME question.
  const activeKey = activeIndex >= 0 && activeIndex < messages.length ? markKeyOf(messages[activeIndex]) : ''
  const displayMessages = marksOnly ? messages.filter((m) => markedSet.has(markKeyOf(m))) : messages

  return reactDom.createPortal(
    <div
      className="dsbt-nav"
      style={{ right: rightOffset, ['--dsbt-h' as string]: `${height}px`, ['--dsbt-w' as string]: `${railWidth}px` }}
      role="navigation"
      aria-label={t('timeline.railLabel')}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <div className={show ? 'dsbt-bg dsbt-bg-hide' : 'dsbt-bg'} />
      <div className={show ? 'dsbt-wrap dsbt-show' : 'dsbt-wrap'}>
        <div className="dsbt-filterbar">
          <button
            type="button"
            className={marksOnly ? 'dsbt-filterbtn dsbt-filteron' : 'dsbt-filterbtn'}
            aria-pressed={marksOnly}
            onClick={() => setMarksOnly((v) => !v)}
          >
            {t('timeline.marksOnly')}{marks.length > 0 ? ` (${marks.length})` : ''}
          </button>
        </div>
        <div className={fades.top ? 'dsbt-fade dsbt-fade-on' : 'dsbt-fade'} aria-hidden />
        <div className={fades.bottom ? 'dsbt-fade dsbt-fade-bot dsbt-fade-on' : 'dsbt-fade dsbt-fade-bot'} aria-hidden />
        <div
          className="dsbt-page"
          ref={pageRef}
          onScroll={syncFades}
        >
          {displayMessages.length === 0
            ? <div className="dsbt-empty">{t('timeline.noMarks')}</div>
            : displayMessages.map((m) => {
              const key = resolveAnchorKey(m)
              const mk = markKeyOf(m)
              const marked = markedSet.has(mk)
              const isActive = activeKey !== '' && mk === activeKey
              const cls = `dsbt-item${isActive ? ' dsbt-active' : ''}${marked ? ' dsbt-marked' : ''}`
              const label = `${marked ? '★ ' : ''}${t('timeline.roleUser')}: ${m.text.slice(0, 60) || t('timeline.noText')}`
              return (
                <button
                  type="button"
                  key={m.seq}
                  ref={isActive ? activeItemRef : undefined}
                  className={cls}
                  title={`${marked ? '★ ' : ''}${m.text === '' ? t('timeline.noText') : m.text}`}
                  aria-label={label}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={() => {
                    if (key === undefined) return
                    // Engage the stabilization lock with a fallback timeout:
                    // the settle timer normally releases it after the jump.
                    // A fresh click replaces the pending fallback so a rapid
                    // second jump cannot be unlocked by the first one's timer.
                    jumpPendingRef.current = true
                    if (jumpFallbackRef.current !== undefined) clearTimeout(jumpFallbackRef.current)
                    jumpFallbackRef.current = window.setTimeout(() => {
                      jumpFallbackRef.current = undefined
                      jumpPendingRef.current = false
                    }, 800)
                    void jumpToMessage(sessionsService, sessionId, key).catch(() => {})
                  }}
                >
                  <span className="dsbt-title">{m.text === '' ? t('timeline.noText') : m.text}</span>
                  <span
                    className={marked ? 'dsbt-star dsbt-staron' : 'dsbt-star'}
                    role="button"
                    tabIndex={0}
                    aria-pressed={marked}
                    aria-label={marked ? t('timeline.unmark') : t('timeline.mark')}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                    onClick={(e) => { e.stopPropagation(); toggleMark(m) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        toggleMark(m)
                      }
                    }}
                  >
                    ★
                  </span>
                  <span className="dsbt-ind" aria-hidden>
                    <span className="dsbt-line" />
                  </span>
                </button>
              )
            })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
