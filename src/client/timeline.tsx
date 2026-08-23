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
 * Data source (client-side only): loaded chat nodes -> background loadOlder
 * loop until complete. Clicking a row loads older history on demand, scrolls
 * the conversation to the target row, and keeps the rail's own active row
 * visible.
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

/**
 * Normalize one projection/record entry; null when unusable.
 * @param m - candidate entry.
 */
export function normalizeMessage(m: unknown): TimelineMessage | null {
  if (m === null || typeof m !== 'object') return null
  const rec = m as { seq?: unknown; time?: unknown; text?: unknown; key?: unknown }
  if (typeof rec.seq !== 'number') return null
  return {
    seq: rec.seq,
    time: typeof rec.time === 'number' ? rec.time : 0,
    text: typeof rec.text === 'string' ? rec.text : '',
    ...(typeof rec.key === 'string' ? { key: rec.key } : {}),
  }
}

/* ---- Key-point bookmarks (ported from dsh-chat-timeline v0.1.4) --------- */

/**
 * Stable bookmark key for one entry: prefer the durable message key, then the
 * seq — so marks survive history reloads.
 * @param m - the entry (or any shaped object).
 */
export function markKeyOf(m: unknown): string {
  if (m === null || typeof m !== 'object') return ''
  const rec = m as { id?: unknown; key?: unknown; seq?: unknown }
  if (typeof rec.id === 'string' && rec.id !== '') return `id:${rec.id}`
  if (typeof rec.key === 'string' && rec.key !== '') return `key:${rec.key}`
  return `seq:${String(rec.seq)}`
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
  const hidden = new Set<number>()
  if (chat === null || typeof chat !== 'object') return hidden
  const nodes = (chat as { nodes?: Map<string, ChatNodeLike> }).nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return hidden
  const all = [...nodes.values()]
  const spans: { start: number; end: number }[] = []
  for (const node of all) {
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
    const marker = outcome.sourceEventSeq
    if (typeof marker !== 'number') continue
    if (typeof command.seq === 'number') hidden.add(command.seq)
    const target = rewindTargetOfOutcome(outcome.text)
    if (target !== undefined) spans.push({ start: target, end: marker })
  }
  if (spans.length === 0) return hidden
  for (const node of all) {
    if (node === null || typeof node !== 'object') continue
    const anchor = typeof node.anchorSeq === 'number' ? node.anchorSeq : undefined
    if (anchor === undefined) continue
    if (spans.some((span) => anchor >= span.start && anchor <= span.end)) hidden.add(anchor)
  }
  return hidden
}

/**
 * Drop messages whose seq was hidden by a rewind.
 * @param messages - normalized entries.
 * @param hidden - hidden seq set.
 */
export function filterVisibleMessages(messages: TimelineMessage[], hidden: Set<number>): TimelineMessage[] {
  if (hidden.size === 0) return messages
  return messages.filter((m) => !hidden.has(m.seq))
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

/** Stable no-session store faces for useSyncExternalStore (identity-stable). */
const NOOP_UNSUBSCRIBE = (): void => {}
const noopSubscribe = (): (() => void) => NOOP_UNSUBSCRIBE
const noopSnapshot = (): unknown => undefined

/**
 * The timeline rail component. Portaled to body; registered into the
 * conversation input dock purely to bind per-session lifecycle.
 */
export function TimelineRail(props: TimelineRailProps): react.ReactElement | null {
  const { sessionId, sessionsService, t } = props

  // Shared settings: the rail hides while timeline === false. Read through a
  // hook like every other store here, but the gate itself must sit with the
  // FINAL early return below — an early return between hooks would crash
  // React ("rendered fewer hooks") the moment the toggle flips mid-session.
  const settings = react.useSyncExternalStore(settingsClient.subscribe, settingsClient.getSnapshot)

  const session = sessionId !== undefined && sessionsService !== undefined ? sessionsService.binding(sessionId)?.session : undefined
  const nodeSnapshot = react.useSyncExternalStore(
    session?.subscribe ?? noopSubscribe,
    session?.getSnapshot ?? noopSnapshot,
  )

  // Collected per snapshot change (the collector allocates + sorts); memoized
  // so width measurement and tracking effects key on content, not renders.
  const messages = react.useMemo(() => collectMessages(nodeSnapshot), [nodeSnapshot])

  const [loadedAll, setLoadedAll] = react.useState(false)
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
  // or the 800ms fallback in the click handler).
  const jumpPendingRef = react.useRef(false)

  // Marks follow the session switch; the filter resets with them.
  react.useEffect(() => {
    setMarks(readMarks(sessionId))
    setMarksOnly(false)
  }, [sessionId])

  const markedSet = react.useMemo(() => new Set(marks), [marks])
  const toggleMark = react.useCallback((m: TimelineMessage) => {
    const k = markKeyOf(m)
    setMarks((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
      writeMarks(sessionId, next)
      return next
    })
  }, [sessionId])

  // Narrow-viewport guard (matches the official breakpoint).
  react.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent): void => setIsNarrow(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Background full-history load: follow hasMore until complete.
  react.useEffect(() => {
    if (session === undefined || isNarrow || sessionId === undefined) return
    setLoadedAll(false)
    let cancelled = false
    const run = async (): Promise<void> => {
      let guard = 0
      while (!cancelled && guard++ < 120) {
        const snap = session.getSnapshot() as { hasMore?: boolean; loadingOlder?: boolean }
        if (snap?.hasMore !== true) break
        if (snap.loadingOlder === true) {
          await delay(50)
          continue
        }
        await session.loadOlder()
      }
      if (!cancelled) setLoadedAll(true)
    }
    void run().catch(() => { if (!cancelled) setLoadedAll(true) })
    return () => { cancelled = true }
  }, [sessionId, isNarrow, session])

  // Width follows the longest title (remeasured when messages arrive/change);
  // loadedAll gates it so late history cannot leave a stale narrow rail.
  react.useEffect(() => {
    if (!loadedAll && messages.length > 0) return
    setRailWidth(railWidthFor(messages.map((m) => m.text)))
  }, [loadedAll, messages])

  // Reading position tracking: nearest user row to the 40% viewport line.
  react.useEffect(() => {
    if (messages.length === 0) return
    const indexByKey = new Map<string, number>()
    messages.forEach((m, i) => {
      const key = resolveAnchorKey(m)
      if (key !== undefined) indexByKey.set(key, i)
    })
    const updateActive = (): void => {
      // A jump is animating: freeze the highlight so the panel cannot jitter.
      if (jumpPendingRef.current) return
      const sp = document.querySelector('[data-conversation-scroll]')
      if (sp === null) return
      const rect = sp.getBoundingClientRect()
      if (rect.height === 0) return
      const line = rect.top + rect.height * 0.4
      const rows = sp.querySelectorAll('[data-chat-anchor-key]')
      let best = -1
      let bestDist = Infinity
      for (const row of rows) {
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
    updateActive()
    const el = document.querySelector('[data-conversation-scroll]')
    let timer: number | undefined
    let settleTimer: number | undefined
    const onScroll = (): void => {
      // Detect the true end of scrolling: 150ms after the LAST scroll event
      // release the jump lock and refresh the highlight exactly once.
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined
        if (jumpPendingRef.current) {
          jumpPendingRef.current = false
          updateActive()
        }
      }, 150)
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        updateActive()
      }, 60)
    }
    el?.addEventListener('scroll', onScroll, { passive: true })
    const interval = window.setInterval(updateActive, 2000)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      el?.removeEventListener('scroll', onScroll)
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
  react.useEffect(syncFades, [syncFades, show, messages.length, loadedAll, marksOnly])

  // Keep the active row visible inside the rail without moving the chat.
  react.useLayoutEffect(() => {
    if (!show) return
    const page = pageRef.current
    const item = activeItemRef.current
    if (page === null || item === null) return
    scrollTimelineItemIntoView(page, item)
    syncFades()
  }, [activeIndex, messages.length, marksOnly, show, syncFades])

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

  if (settings.value?.timeline === false
    || sessionId === undefined || sessionsService === undefined || isNarrow || hidden || messages.length < 2) {
    return null
  }

  const height = railHeightFor(messages.length)
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
                  title={`${marked ? '★ ' : ''}${m.text === '' ? t('timeline.noText') : m.text.slice(0, 200)}`}
                  aria-label={label}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={() => {
                    if (key === undefined) return
                    // Engage the stabilization lock with a fallback timeout:
                    // the settle timer normally releases it after the jump.
                    jumpPendingRef.current = true
                    window.setTimeout(() => { jumpPendingRef.current = false }, 800)
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
