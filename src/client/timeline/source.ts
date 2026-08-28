/**
 * Conversation timeline data source — the shared backend both frontends read.
 *
 * Two producers feed one normalized entry list, fastest first:
 * - The host-side `bgTimeline` session projection (src/projection.ts): a
 *   complete enumeration of the session's user messages, delivered through
 *   the projection baseline/push channel. It names turns the chat view has
 *   never loaded, which is what makes them jumpable at all.
 * - The loaded chat-node window: the fallback when the projection registry is
 *   absent or lost its baseline. **This is the one surface the 0.1.2 kernel
 *   broke** — it moved the Chat snapshot from `session.getSnapshot().chat`
 *   (a Map) to `useChat()` (a `{ order, nodes: { values() } }` store), so the
 *   reader below duck-types across both generations instead of assuming one.
 *
 * Enhancements carried over from the pre-0.5 rail:
 * - Rewind integration: messages withdrawn by a rewind command node are
 *   filtered out, so a cut lands in the rail before the next projection push.
 * - Entries without an anchor key (early events lacking a durable id) borrow
 *   the real key from the loaded window when it holds the same question.
 *
 * Enhancements REMOVED in 0.5 (the rail now reuses the official UI, which has
 * no affordance for them): key-point bookmarks, the "marked only" filter and
 * their localStorage persistence.
 */

import type { TimelineEntry } from './types.ts'

/** Shared constant lives in settings.ts; re-exported for consumers of this module. */
export { TIMELINE_PROJECTION_KEY } from '../../settings.ts'

/** Structural view of one chat node this rail consumes. */
interface ChatNodeLike {
  kind?: string
  key?: string
  anchorSeq?: number
  /** dsh >= 0.1.2 only: nodes removed from the visible surface stay hidden. */
  visibility?: string
  data?: {
    time?: number
    content?: unknown
    name?: unknown
    seq?: unknown
    args?: unknown
    outcome?: { kind?: unknown; sourceEventSeq?: unknown; text?: unknown }
    attributes?: unknown
  }
  rewindHidden?: unknown
  'data-dsh-rewind-hidden'?: unknown
}

/* ---- Node-window enumeration (both kernel generations) ------------------ */

/**
 * Enumerate the chat nodes of one conversation snapshot, duck-typed across
 * both kernel generations:
 * - dsh <= 0.1.1: `snapshot.chat.nodes` is a `Map` keyed by node key.
 * - dsh >= 0.1.2: the Chat snapshot is `{ order, nodes: { values() } }` and
 *   the session snapshot has no `chat` field at all.
 *
 * Both stores expose `values()`, so one structural read covers both; the
 * receiver must survive the call because these are prototype methods (the
 * real Session's own methods read `this`, and so do Map's).
 *
 * @param snapshot - a session snapshot or a Chat snapshot (loosely typed).
 * @returns the nodes, in the store's own order; empty when neither shape fits.
 */
export function chatNodesOf(snapshot: unknown): ChatNodeLike[] {
  const valuesOf = (store: unknown): ChatNodeLike[] | undefined => {
    if (store === null || typeof store !== 'object') return undefined
    const values = (store as { values?: unknown }).values
    if (typeof values !== 'function') return undefined
    let iterable: Iterable<unknown>
    try {
      iterable = (values as () => Iterable<unknown>).call(store)
    } catch {
      return undefined
    }
    if (iterable === null || typeof iterable !== 'object') return undefined
    const out: ChatNodeLike[] = []
    for (const node of iterable) {
      if (node !== null && typeof node === 'object') out.push(node as ChatNodeLike)
    }
    return out
  }
  const rec = (snapshot ?? {}) as { chat?: { nodes?: unknown }; nodes?: unknown }
  return valuesOf(rec.chat?.nodes) ?? valuesOf(rec.nodes) ?? []
}

/** Is this node part of the visible surface? Nodes without the flag are legacy. */
function isVisible(node: ChatNodeLike): boolean {
  return node.visibility === undefined || node.visibility === 'visible'
}

/* ---- Text extraction ----------------------------------------------------- */

/** Preview cap so entries stay small (one short line per row). */
const MAX_TEXT_CHARS = 80

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
  return out.trim().slice(0, MAX_TEXT_CHARS)
}

/* ---- Rewind integration -------------------------------------------------- */

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
 * Extract the rewind target seq from a rewind outcome text. Multi-pattern:
 * an explicit `seq 42` declaration wins, then `#42`, then the broad
 * english/chinese verb forms — a single "rewound" regex silently missed real
 * success texts like "已撤回 seq 42" / "Withdrawn seq 42".
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
 * args.seq / args.raw / args[0]), then the outcome text — so
 * locale-independent producers keep parsing without text heuristics (the
 * args.seq guard skips the command's own seq).
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
 * Seq numbers of nodes carrying a rewind-hidden marker: host/plugin producers
 * can tag the node record itself (rewindHidden), its data payload, or the
 * payload's attributes map.
 * @param chat - a chat snapshot (loosely typed on purpose).
 */
export function rewindMarkedSeqsOfChat(chat: unknown): Set<number> {
  const marked = new Set<number>()
  for (const node of chatNodesOf(chat)) {
    const data = node.data
    if (data === null || typeof data !== 'object') continue
    const record = data as { attributes?: unknown; [k: string]: unknown }
    const attrs = record.attributes
    if (attrs !== null && typeof attrs === 'object'
      && (attrs as Record<string, unknown>)['data-dsh-rewind-hidden'] === true) {
      if (typeof node.anchorSeq === 'number') marked.add(node.anchorSeq)
      continue
    }
    if (record['data-dsh-rewind-hidden'] === true || node.rewindHidden === true) {
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
  for (const node of chatNodesOf(chat)) {
    if (node.kind !== 'command') continue
    const command = node.data
    if (command === null || typeof command !== 'object') continue
    if ((command as { name?: unknown }).name !== 'rewind') continue
    if (isRewindPreviewCommand(command as { args?: unknown })) {
      if (typeof (command as { seq?: unknown }).seq === 'number') hidden.add((command as { seq: number }).seq)
      continue
    }
    const outcome = (command as { outcome?: unknown }).outcome
    if (outcome === null || typeof outcome !== 'object' || (outcome as { kind?: unknown }).kind !== 'success') continue
    const own = (command as { seq?: unknown }).seq
    if (typeof own === 'number') hidden.add(own)
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
  for (const node of chatNodesOf(chat)) {
    if (node.kind !== 'command') continue
    const command = node.data
    if (command === null || typeof command !== 'object') continue
    if ((command as { name?: unknown }).name !== 'rewind') continue
    if (isRewindPreviewCommand(command as { args?: unknown })) continue
    const outcome = (command as { outcome?: unknown }).outcome
    if (outcome === null || typeof outcome !== 'object') continue
    const record = outcome as { kind?: unknown; sourceEventSeq?: unknown }
    if (record.kind !== 'success') continue
    const marker = record.sourceEventSeq
    if (typeof marker !== 'number') continue
    const target = rewindTargetOfCommand(command)
    if (target !== undefined) spans.push({ start: target, end: marker })
  }
  return spans
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
  for (const node of chatNodesOf(chat)) {
    const anchor = typeof node.anchorSeq === 'number' ? node.anchorSeq : undefined
    if (anchor === undefined) continue
    if (spans.some((span) => anchor >= span.start && anchor <= span.end)) hidden.add(anchor)
  }
  return hidden
}

/* ---- Projection source --------------------------------------------------- */

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
export function normalizeProjectedTimeline(value: unknown): TimelineEntry[] {
  if (value === null || typeof value !== 'object') return []
  const raw = (value as { messages?: unknown }).messages
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: TimelineEntry[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as { seq?: unknown; time?: unknown; text?: unknown; id?: unknown }
    if (typeof rec.seq !== 'number' || !Number.isFinite(rec.seq)) continue
    if (seen.has(rec.seq)) continue
    seen.add(rec.seq)
    out.push({
      seq: rec.seq,
      time: typeof rec.time === 'number' ? rec.time : 0,
      text: typeof rec.text === 'string' ? rec.text.slice(0, MAX_TEXT_CHARS) : '',
      ...(typeof rec.id === 'string' && rec.id !== '' ? { anchorKey: inputAnchorKeyOf(rec.id) } : {}),
    })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/* ---- Node-window source -------------------------------------------------- */

/**
 * Enumerate user messages from the loaded chat-node snapshot (the client-side
 * collector; sorted by anchor sequence, rewind-hidden entries dropped).
 * @param snapshot - a session snapshot or Chat snapshot (loosely typed).
 */
export function collectMessages(snapshot: unknown): TimelineEntry[] {
  const hidden = hiddenSeqsOfChat(snapshot)
  const out: TimelineEntry[] = []
  for (const node of chatNodesOf(snapshot)) {
    if (node.kind !== 'user') continue
    if (!isVisible(node)) continue
    const data = node.data
    if (data === null || typeof data !== 'object' || typeof data.time !== 'number' || !Array.isArray(data.content)) continue
    const anchorKey = typeof node.key === 'string' ? node.key : undefined
    if (anchorKey === undefined) continue
    const seq = typeof node.anchorSeq === 'number' ? node.anchorSeq : 0
    if (hidden.has(seq)) continue
    out.push({ seq, time: data.time, text: userTextOf(data.content), anchorKey })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/**
 * Count the user messages the loaded window holds WITHOUT collecting or
 * sorting them — the fast gate railMessages uses to skip the merge path on
 * the streaming hot path (see there).
 * @param snapshot - the loaded chat snapshot.
 */
function countWindowUserMessages(snapshot: unknown): number {
  let count = 0
  for (const node of chatNodesOf(snapshot)) {
    if (node.kind === 'user' && isVisible(node)) count += 1
  }
  return count
}

/**
 * Rail entries: the host projection (whole-session index) MERGED with the
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
export function railMessages(snapshot: unknown, projected: unknown): TimelineEntry[] {
  const projectedMessages = normalizeProjectedTimeline(projected)
  const hidden = rewindHiddenSeqsOfChat(snapshot)
  const marked = rewindMarkedSeqsOfChat(snapshot)
  const spans = rewindSpansOfChat(snapshot)
  const isHidden = (seq: number): boolean =>
    hidden.has(seq) || marked.has(seq) || spans.some((span) => seq >= span.start && seq <= span.end)

  if (projectedMessages.length === 0) return collectMessages(snapshot)
  // Fast gate: the loaded window is a subset of the whole log the projection
  // indexes, so when the window holds no MORE user messages than the
  // projection it cannot fill a gap. Skipping the collect+sort keeps the
  // streaming hot path (one render per token) allocation-free — the merged
  // path below runs only for a degraded projection (hot reload losing the
  // baseline) or rewinds cutting projection entries the window still holds.
  const windowUserCount = countWindowUserMessages(snapshot)
  // A keyless projected entry (early events without a durable id) can borrow
  // its anchor key from the window, so that case must reach the merge too.
  const projectionLacksKeys = projectedMessages.some((m) => m.anchorKey === undefined)
  if (windowUserCount <= projectedMessages.length && !projectionLacksKeys) {
    return marked.size === 0 && hidden.size === 0 && spans.length === 0
      ? projectedMessages
      : projectedMessages.filter((m) => !isHidden(m.seq))
  }
  const windowMessages = collectMessages(snapshot)

  const bySeq = new Map<number, TimelineEntry>()
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
    if (existing.anchorKey === undefined) {
      bySeq.set(m.seq, {
        ...existing,
        anchorKey: m.anchorKey,
        ...(existing.text === '' && m.text !== '' ? { text: m.text } : {}),
      })
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
