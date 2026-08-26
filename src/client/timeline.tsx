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
 * - Jump stabilization: the reading-position tracker freezes while a jump
 *   glide animates (cleared 150ms after the last scroll event, plus a 2s
 *   fallback), so the panel cannot jitter mid-jump. The glide itself is a
 *   rAF ease-in-out on the conversation scrollport: a ~26px bottom-follow
 *   detach first settles the official at-bottom flag outside its 25px zone
 *   (so a tip-moved re-render cannot yank the slide back to the floor — the
 *   earlier instant+smooth double pass kept the jump working but made the
 *   slide invisible), and wheel/touch/keyboard input cancels it so the
 *   reader takes over instantly.
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
import { TIMELINE_PROJECTION_KEY } from '../settings.ts'
import { injectTimelineCss, TIMELINE_TITLE_FONT_PX } from './timeline-css.ts'

/** Shared constant lives in settings.ts; re-exported for consumers of this module. */
export { TIMELINE_PROJECTION_KEY }

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

/** Parse digits into a finite number (undefined otherwise). */
function parseSeqDigits(digits: string | undefined): number | undefined {
  if (digits === undefined) return undefined
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : undefined
}

/** Extract a seq from a string-ish field ('@42', 'seq 42', '#42', bare 42). */
function seqFromStringish(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const m = /(?:@|seq\s*|#)?(\d+)/i.exec(value)
  return m === null ? undefined : parseSeqDigits(m[1])
}

/**
 * Extract the rewind target seq from a rewind outcome text. Multi-pattern
 * (ported from dsh-chat-timeline v0.1.5): an explicit `seq 42` declaration
 * wins, then `#42`, then the broad english/chinese verb forms — the old
 * single "rewound" regex silently missed real success texts like "已撤回
 * seq 42" / "Withdrawn seq 42" (upstream issue #6).
 * @param text - the command outcome text.
 */
export function rewindTargetOfOutcome(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined
  const seqMatch = /seq\s*(\d+)/i.exec(text)
  if (seqMatch !== null) return parseSeqDigits(seqMatch[1])
  const hashMatch = /#(\d+)/.exec(text)
  if (hashMatch !== null) return parseSeqDigits(hashMatch[1])
  const broadMatch = /(?:rewound|withdrawn|已撤回).*?(?:target\s+)?(\d+)/i.exec(text)
  if (broadMatch !== null) return parseSeqDigits(broadMatch[1])
  return undefined
}

/**
 * Resolve the target of a rewind command: structured fields first
 * (outcome.targetSeq / outcome.target / args.targetSeq / args.target /
 * args.seq / args.raw / args[0]), then the outcome text — mirrors upstream
 * v0.1.5 so locale-independent producers keep parsing without text
 * heuristics (the args.seq guard skips the command's own seq).
 * @param command - the command payload.
 */
export function rewindTargetOfCommand(command: unknown): number | undefined {
  if (command === null || typeof command !== 'object') return undefined
  const rec = command as { outcome?: unknown; args?: unknown; seq?: unknown }
  const outcome = rec.outcome
  if (outcome !== null && typeof outcome === 'object') {
    const o = outcome as { targetSeq?: unknown; target?: unknown }
    if (typeof o.targetSeq === 'number' && Number.isFinite(o.targetSeq)) return o.targetSeq
    if (typeof o.target === 'number' && Number.isFinite(o.target)) return o.target
  }
  const args = rec.args
  if (args !== null && typeof args === 'object') {
    const record = args as { targetSeq?: unknown; target?: unknown; seq?: unknown; raw?: unknown; '0'?: unknown }
    if (typeof record.targetSeq === 'number' && Number.isFinite(record.targetSeq)) return record.targetSeq
    if (typeof record.target === 'number' && Number.isFinite(record.target)) return record.target
    if (typeof record.seq === 'number' && Number.isFinite(record.seq) && record.seq !== rec.seq) return record.seq
    const rawish = record.raw ?? record['0'] ?? (Array.isArray(args) ? args[0] : undefined)
    if (rawish !== undefined) {
      const n = seqFromStringish(rawish)
      if (n !== undefined) return n
    }
    if (typeof record.target === 'string') {
      const n = seqFromStringish(record.target)
      if (n !== undefined) return n
    }
  }
  if (outcome !== null && typeof outcome === 'object') {
    const text = (outcome as { text?: unknown }).text
    if (typeof text === 'string') return rewindTargetOfOutcome(text)
  }
  return undefined
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
  for (const seq of rewindMarkedSeqsOfChat(chat)) hidden.add(seq)
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
 * Seq numbers of nodes carrying a rewind-hidden marker (upstream v0.1.5):
 * host/plugin producers can tag the node record itself (rewindHidden), its
 * data payload, or the payload's attributes map.
 * @param chat - a chat snapshot (loosely typed on purpose).
 */
export function rewindMarkedSeqsOfChat(chat: unknown): Set<number> {
  const marked = new Set<number>()
  const nodes = (chat as { nodes?: Map<string, ChatNodeLike> }).nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return marked
  for (const node of nodes.values()) {
    if (node === null || typeof node !== 'object') continue
    const data = node.data
    if (data === null || typeof data !== 'object') continue
    const record = data as { attributes?: unknown; [k: string]: unknown }
    const attrs = record.attributes
    if (attrs !== null && typeof attrs === 'object'
      && (attrs as Record<string, unknown>)['data-dsh-rewind-hidden'] === true) {
      if (typeof node.anchorSeq === 'number') marked.add(node.anchorSeq)
      continue
    }
    if (record['data-dsh-rewind-hidden'] === true
      || (node as { rewindHidden?: unknown }).rewindHidden === true) {
      if (typeof node.anchorSeq === 'number') marked.add(node.anchorSeq)
    }
  }
  return marked
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
    const target = rewindTargetOfCommand(command)
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

/**
 * Count the user messages the loaded window holds WITHOUT collecting or
 * sorting them — the fast gate railMessages uses to skip the merge path on
 * the streaming hot path (see there).
 * @param chat - the loaded chat snapshot.
 */
function countWindowUserMessages(chat: unknown): number {
  const nodes = (chat as { nodes?: Map<string, ChatNodeLike> } | undefined)?.nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return 0
  let count = 0
  for (const node of nodes.values()) {
    if (node !== null && typeof node === 'object' && node.kind === 'user') count += 1
  }
  return count
}

/** Resolve the DOM anchor key of one entry (direct key form only). */
export function resolveAnchorKey(m: TimelineMessage): string | undefined {
  return typeof m.key === 'string' && m.key !== '' ? m.key : undefined
}

/* ---- Host projection source --------------------------------------------- */

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
 * Rail messages: the host projection (whole-session index) MERGED with the
 * loaded chat-node window. The projection normally wins outright, but a
 * projection that lost its baseline (e.g. the plugin was hot-reloaded after
 * the session's tail page seeded the client store) can miss early entries —
 * the window fills those gaps whenever it holds them, and window entries
 * lend their real anchor key to projected entries whose durable id was
 * absent (early events without one). Locally-known rewind hiding applies to
 * the merged list so a cut lands instantly, before the next projection push.
 * @param snapshot - the session conversation snapshot (node window).
 * @param projected - the raw bgTimeline projection value.
 */
export function railMessages(snapshot: unknown, projected: unknown): TimelineMessage[] {
  const projectedMessages = normalizeProjectedTimeline(projected)
  const chat = (snapshot as { chat?: { nodes?: Map<string, ChatNodeLike> } } | undefined)?.chat
  const hidden = rewindHiddenSeqsOfChat(chat)
  const marked = rewindMarkedSeqsOfChat(chat)
  const spans = rewindSpansOfChat(chat)
  const isHidden = (seq: number): boolean =>
    hidden.has(seq) || marked.has(seq) || spans.some((span) => seq >= span.start && seq <= span.end)

  if (projectedMessages.length === 0) return collectMessages(snapshot)
  // Fast gate: the loaded window is a subset of the whole log the projection
  // indexes, so when the window holds no MORE user messages than the
  // projection it cannot fill a gap. Skipping the collect+sort keeps the
  // streaming hot path (one render per token) allocation-free — the merged
  // path below runs only for a degraded projection (hot reload losing the
  // baseline) or rewinds cutting projection entries the window still holds.
  const windowUserCount = countWindowUserMessages(chat)
  // A keyless projected entry (early events without a durable id) can borrow
  // its anchor key from the window, so that case must reach the merge too.
  const projectionLacksKeys = projectedMessages.some((m) => m.key === undefined)
  if (windowUserCount <= projectedMessages.length && !projectionLacksKeys) {
    return marked.size === 0 && hidden.size === 0 && spans.length === 0
      ? projectedMessages
      : projectedMessages.filter((m) => !isHidden(m.seq))
  }
  const windowMessages = collectMessages(snapshot)

  const bySeq = new Map<number, TimelineMessage>()
  for (const m of projectedMessages) {
    if (!isHidden(m.seq)) bySeq.set(m.seq, m)
  }
  for (const m of windowMessages) {
    if (isHidden(m.seq)) continue
    const existing = bySeq.get(m.seq)
    if (existing === undefined) {
      bySeq.set(m.seq, m)
      continue
    }
    // A projected entry missing its anchor key (early events without a
    // durable id) borrows the window entry's real key so the row can jump.
    if (existing.key === undefined && m.key !== undefined) {
      bySeq.set(m.seq, {
        ...existing,
        key: m.key,
        ...(existing.text === '' && m.text !== '' ? { text: m.text } : {}),
      })
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
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
      ctx.font = `${TIMELINE_TITLE_FONT_PX}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      for (const t of texts) {
        const w = ctx.measureText(t === '' ? '…' : t).width
        if (w > widest) widest = w
      }
    }
  }
  // Title + title gap + star column + indicator + item gutters + border/padding.
  return Math.round(Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, widest + 6 + 24 + 16 + 12)))
}

/** How long one jump may keep paging older history before giving up. */
const JUMP_PAGE_DEADLINE_MS = 30000
/** How long to wait for the chat view to commit the target row. */
const JUMP_ROW_WAIT_MS = 3000
/** How long the jump-stabilization lock may stay engaged without settling. */
const JUMP_LOCK_FALLBACK_MS = 2000

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
  // Multi-column layouts can mount more than one conversation scrollport;
  // the target row may live in ANY of them (the first match is no longer
  // assumed to own every session's rows).
  const scrollports = Array.from(document.querySelectorAll<HTMLElement>('[data-conversation-scroll]'))
  if (scrollports.length === 0) return null
  const selector = `[data-chat-anchor-key="${CSS.escape(key)}"]`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (const scrollport of scrollports) {
      const row = scrollport.querySelector<HTMLElement>(selector)
      if (row !== null) return row
    }
    if (Date.now() >= deadline) return null
    await delay(40)
  }
}

/** Official conversation follow threshold: the view keeps bottom-following while within this distance of the floor (dsh-client-ui-conversation, 25px). */
const CONVERSATION_FOLLOW_ZONE_PX = 25

/** Distances under this snap instead of animating. */
const MIN_GLIDE_DISTANCE_PX = 8

/** Glide duration floor / cap — a far-boundary rail click stays a tangible slide. */
const MIN_GLIDE_MS = 280
const MAX_GLIDE_MS = 900

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
 * Glide duration for a distance: longer slides take longer, bounded to
 * [MIN_GLIDE_MS, MAX_GLIDE_MS] (a deep-history rail click reads as a
 * deliberate glide, not a sluggish race).
 * @param distance - px to travel.
 */
export function glideDurationFor(distance: number): number {
  if (!Number.isFinite(distance)) return MIN_GLIDE_MS
  return Math.round(Math.max(MIN_GLIDE_MS, Math.min(MAX_GLIDE_MS, 240 + Math.abs(distance) * 0.14)))
}

/**
 * Detach the official bottom-follow state when the reader currently sits
 * inside its follow zone: assign the scroll position just outside the 25px
 * boundary. That one synchronous scroll event settles at-bottom to false
 * (moved-by-reader + outside the zone) so a tip-moved re-render cannot yank
 * the glide back to the floor. No-op when already above the zone or when
 * the assignment cannot move (content shorter than the viewport).
 * @param el - the conversation scrollport.
 */
export function detachBottomFollow(el: HTMLElement): boolean {
  const floor = scrollFloorOf(el)
  // Only the bottom zone can still hold the follow flag: anywhere above it
  // the official scroll handler already settled at-bottom to false, and
  // dragging the viewport down to the zone would be a visible jump.
  if (el.scrollTop < floor - CONVERSATION_FOLLOW_ZONE_PX) return false
  const detached = Math.max(0, floor - CONVERSATION_FOLLOW_ZONE_PX - 1)
  if (Math.abs(el.scrollTop - detached) < 1) return false
  el.scrollTop = detached
  return true
}

/**
 * Wait until a detach assignment's scroll event has been dispatched AND
 * consumed by the official scroll handler: scroll events fire on a later
 * frame than the assignment, and a paging commit's layout effect runs
 * before that dispatch — it would re-run the follow logic while the
 * at-bottom flag is still true and drag the viewport to the growing floor,
 * undoing the detach (two rAFs + a macrotask bracket the dispatch window).
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
 * Ensure the target node is loaded, wait for the chat view to commit its row
 * into the DOM, then glide it into view. Paging uses a time budget instead
 * of the old fixed 120-iteration guard (each in-flight page burned 50ms of
 * that guard, so slow history could exhaust it and silently fail).
 */
export async function jumpToMessage(sessionsService: TimelineSessionsService, sessionId: string, key: string, rowWaitMs: number = JUMP_ROW_WAIT_MS): Promise<boolean> {
  const session = sessionsService.binding(sessionId)?.session
  if (session === undefined) return false
  // Detach the official bottom-follow flag BEFORE paging: while a multi-page
  // loadOlder is in flight, every prepend commit re-runs the follow layout
  // effect (tip-moved + at-bottom) and toBottom() drags the viewport to the
  // (growing) floor — the rail click would read as "surf to the newest floor,
  // then slide back to the target". One synchronous assignment just outside
  // the 25px zone settles the flag for the whole paging phase, but the flag
  // only flips when the assignment's scroll event reaches the official
  // handler, which happens a frame later — so the paging phase waits for it
  // first. The post-wait detach below stays idempotent for the already-loaded
  // case. Multi-column layouts cannot pin the target session's scrollport
  // before the row exists, so every mounted scrollport is detached (a 26px
  // nudge elsewhere is the whole cost; the reader's next scroll re-engages
  // follow there).
  let detachedAny = false
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-conversation-scroll]'))) {
    if (detachBottomFollow(el)) {
      // The official scroll handler flips its at-bottom flag on a scroll
      // event, and the real one only dispatches on a later frame — a paging
      // commit's layout effect runs before it and re-runs the follow logic.
      // A synthetic event notifies the handler synchronously, so the flag
      // settles before any prepend commit can observe it.
      el.dispatchEvent(new Event('scroll'))
      detachedAny = true
    }
  }
  if (detachedAny) await settleScrollEvents()
  const deadline = Date.now() + JUMP_PAGE_DEADLINE_MS
  for (;;) {
    const snapshot = session.getSnapshot() as {
      chat?: { nodes?: Map<string, unknown> }
      hasMore?: boolean
      loadingOlder?: boolean
      openState?: unknown
    }
    if (snapshot?.chat?.nodes?.get(key) !== undefined) break
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
    // A failing page must not reject the whole jump (or leave the rail lock
    // to the fallback timer): log and stop paging — the row may still render
    // from an earlier page, so waitForChatRow below gets its chance anyway.
    try {
      await session.loadOlder()
    } catch (error) {
      console.warn('[deepseek-harness-background] timeline jump paging failed:', error)
      break
    }
  }
  const row = await waitForChatRow(key, rowWaitMs)
  if (row === null) {
    console.warn(`[deepseek-harness-background] timeline jump target never rendered: ${key}`)
    return false
  }
  const reducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const scroller = row.closest<HTMLElement>('[data-conversation-scroll]')
  // No addressable scrollport (defensive): keep the platform path — the
  // instant placement flips the official bottom-follow state through its
  // scroll event, the smooth pass afterwards is a no-op when already
  // centered (and a graceful glide when the row moved since).
  if (scroller === null) {
    row.scrollIntoView({ behavior: 'auto', block: 'center' })
    if (!reducedMotion) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }
  const target = centeredScrollTopFor(scroller, row)
  // Reduced motion or a hairline distance: one placement (its scroll event
  // still flips the bottom-follow state when it lands outside the zone).
  if (reducedMotion || Math.abs(target - scroller.scrollTop) < MIN_GLIDE_DISTANCE_PX) {
    scroller.scrollTop = target
    return true
  }
  // Bottom-follow detach BEFORE the glide: a pure slide starting at the floor
  // leaves the official at-bottom flag true for its first frames, so a
  // tip-moved re-render (turn end / commit) yanks it back to the floor.
  // The previous fix scrolled instantly to the target and ran a zero-distance
  // smooth pass — functional, but the visible slide was gone. The detach moves
  // at most ~26px to just outside the follow zone (reads as a nudge, not a
  // jump); the flag settles once the dispatch frame passes, so the glide
  // waits for it first.
  if (detachBottomFollow(scroller)) {
    // Synchronous flag flip, then the glide (see the pre-paging detach above).
    scroller.dispatchEvent(new Event('scroll'))
    await settleScrollEvents()
  }
  const completed = await animateScrollTop(scroller, target, glideDurationFor(Math.abs(target - scroller.scrollTop)))
  return completed
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
  // click-triggered jump glide animates (cleared by the settle timer below
  // or the JUMP_LOCK_FALLBACK_MS fallback in the click handler). The fallback
  // timeout is tracked so the settle path can cancel it and unmount cannot
  // leak it.
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

  // Any non-empty conversation gets the rail — the official ScrollNav renders
  // for a lone question too, and the clamped shared height keeps a single
  // tick cleanly bottom-pinned instead of hiding the capsule.
  if (timelineUnknown || timelineDisabled
    || sessionId === undefined || sessionsService === undefined || isNarrow || hidden || messages.length === 0) {
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
              return (
                <div key={m.seq} className={cls}>
                  {/* Jump target and star bookmark are SIBLING real buttons —
                      the previous span[role=button] nested inside the row
                      button was invalid interactive-in-interactive markup,
                      while native buttons keep Enter/Space for both roles.
                      Entries without an anchor key (early events lacking a
                      durable id) render disabled instead of silently eating
                      the click. */}
                  <button
                    type="button"
                    className="dsbt-jump"
                    ref={isActive ? activeItemRef : undefined}
                    disabled={key === undefined}
                    title={key === undefined
                      ? t('timeline.cannotJump')
                      : `${marked ? '★ ' : ''}${m.text === '' ? t('timeline.noText') : m.text}`}
                    aria-label={key === undefined
                      ? `${marked ? '★ ' : ''}${t('timeline.roleUser')}: ${t('timeline.cannotJump')}`
                      : `${marked ? '★ ' : ''}${t('timeline.roleUser')}: ${m.text.slice(0, 60) || t('timeline.noText')}`}
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
                      }, JUMP_LOCK_FALLBACK_MS)
                      // The glide resolves on completion OR reader takeover —
                      // release the lock right then; the settle timer path
                      // stays idempotent either way.
                      void jumpToMessage(sessionsService, sessionId, key)
                        .catch(() => {})
                        .finally(() => {
                          if (jumpFallbackRef.current !== undefined) {
                            clearTimeout(jumpFallbackRef.current)
                            jumpFallbackRef.current = undefined
                          }
                          jumpPendingRef.current = false
                        })
                    }}
                  >
                    <span className="dsbt-title">{m.text === '' ? t('timeline.noText') : m.text}</span>
                  </button>
                  <button
                    type="button"
                    className={marked ? 'dsbt-star dsbt-staron' : 'dsbt-star'}
                    aria-pressed={marked}
                    aria-label={marked ? t('timeline.unmark') : t('timeline.mark')}
                    onClick={() => toggleMark(m)}
                  >
                    ★
                  </button>
                  <span className="dsbt-ind" aria-hidden>
                    <span className="dsbt-line" />
                  </span>
                </div>
              )
            })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
