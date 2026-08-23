/**
 * Host-side conversation timeline projection — the full-history data source
 * for the client timeline rail.
 *
 * The rail needs one entry per USER-sent message of the WHOLE session, while
 * the chat view only pages a bounded window into the client (the "load
 * earlier" button extends it on demand). Paging the whole log through the
 * session window just to draw ticks would flood the conversation DOM, so the
 * enumeration runs where the whole log already lives: a session projection
 * unit. The framework drives the pure fold over every committed event and
 * delivers the wire value to the browser (tail-page projections baseline plus
 * live push frames); the rail reads it via `useProjection` and never touches
 * the chat window's loading state.
 *
 * Shape mirrors the reference port dsh-chat-timeline v0.1.4 (MIT), re-typed
 * against the current ProjectionDefinition contract:
 * - Only direct user turns (`user/message` with source.kind === 'user') join
 *   the timeline — plugin/tool-injected context rides the same event type
 *   with another source.kind and would crowd the rail with non-questions.
 * - A surface replace (`{ op: 'replace', … }` — the only non-append
 *   SurfaceOp) drops the user messages it shadows so the rail matches the
 *   surviving surface, whatever event type carries it: compaction's
 *   checkpoint rides `user/message`, rewind-style producers differ. The
 *   checkpoint marker itself is plugin-sourced and never joins the index.
 *
 * The registry service is provided by @deepseek-ai/dsh-session-projection,
 * which ships in the base bundle. Registration is defensive: without the
 * service the inject simply never fires and the rail falls back to reading
 * the loaded chat nodes.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Projection key this plugin owns in the client-visible value map. */
export const TIMELINE_PROJECTION_KEY = 'bgTimeline'

/** One enumerated user message (the wire entry shape). */
export interface TimelineProjectionEntry {
  /** Durable event seq (sort order + rewind filtering). */
  seq: number
  /** Event time (ms epoch). */
  time: number
  /** Preview text (capped). */
  text: string
  /** Durable message id — rebuilds the chat node anchor key for jumps. */
  id?: string
}

/** Fold state: the complete user-message index of one session. */
export interface TimelineProjectionState {
  messages: TimelineProjectionEntry[]
}

/** Preview cap so projection payloads stay small (~1-2 lines per row). */
const MAX_TEXT_CHARS = 80

/** Join the text blocks of a host-side ContentBlock list. */
function textOf(content: unknown): string {
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

/** Structural read of one committed session event (loose on purpose). */
interface LooseEvent {
  type?: unknown
  seq?: unknown
  time?: unknown
  surfaceOp?: unknown
  sourceEventSeqs?: unknown
  data?: {
    id?: unknown
    time?: unknown
    content?: unknown
    source?: { kind?: unknown } | null
  } | null
}

/**
 * A surface replace cuts nodes out of the model-visible surface so indexed
 * user messages whose seq is cited in sourceEventSeqs must leave the index.
 * SurfaceOp.replace is the OBJECT form `{ op: 'replace', start, end }`
 * (core/session types) — never the bare string 'replace'; matching the whole
 * value against a string can never fire.
 */
function dropShadowedMessages(state: TimelineProjectionState, event: LooseEvent): TimelineProjectionState {
  const op = (event as { surfaceOp?: unknown }).surfaceOp
  if (op === null || typeof op !== 'object' || (op as { op?: unknown }).op !== 'replace') return state
  const shadowed = event.sourceEventSeqs
  if (!Array.isArray(shadowed) || shadowed.length === 0) return state
  const hide = new Set<number>()
  for (const seq of shadowed) {
    if (typeof seq === 'number' && Number.isFinite(seq)) hide.add(seq)
  }
  if (hide.size === 0) return state
  const next = state.messages.filter((m) => !hide.has(m.seq))
  return next.length === state.messages.length ? state : { messages: next }
}

/** Validate the persisted-state shape before a cache row seeds the fold. */
const stateSchema = {
  parse(value: unknown): unknown {
    if (
      value === null || typeof value !== 'object'
      || !Array.isArray((value as { messages?: unknown }).messages)
    ) throw new Error('bgTimeline: persisted state is not a message index')
    return value
  },
}

/**
 * The projection definition in the runtime shape the registry drives (key /
 * stateSchema / init / apply / wire / stateVersion). Typed loosely here and
 * registered through a structural face: the typed contract lives behind
 * @deepseek-ai/dsh-session-projection, which the shell provides at runtime
 * but this package deliberately does not build against.
 */
export const timelineProjectionDefinition = {
  key: TIMELINE_PROJECTION_KEY,
  stateSchema,
  init: (): TimelineProjectionState => ({ messages: [] }),
  apply: (state: TimelineProjectionState, event: unknown): TimelineProjectionState => {
    const e = (event ?? {}) as LooseEvent
    // Fall-through structure on purpose: a replace cut can arrive ON the same
    // user/message event that carries a plugin-sourced checkpoint, so the
    // indexer must not early-return past the shadow filter below.
    let next = state
    if (e.type === 'user/message') {
      const source = e.data?.source
      const seq = typeof e.seq === 'number' ? e.seq : undefined
      if (source !== null && typeof source === 'object' && source.kind === 'user'
        && seq !== undefined && Number.isFinite(seq)) {
        // Same-seq replay (mux replays, cache re-seeds): keep the fold pure.
        if (!state.messages.some((m) => m.seq === seq)) {
          const rawTime = typeof e.time === 'number' ? e.time : typeof e.data?.time === 'number' ? e.data.time : 0
          const id = typeof e.data?.id === 'string' && e.data.id !== '' ? e.data.id : undefined
          const entry: TimelineProjectionEntry = {
            seq,
            time: rawTime,
            text: textOf(e.data?.content),
            ...(id === undefined ? {} : { id }),
          }
          next = { messages: [...state.messages, entry] }
        }
      }
    }
    // Surface replace cuts ride any surface-eligible carrier (compaction's
    // checkpoint is a user/message; rewind-style producers differ) — filter
    // shadowed entries regardless of the event type.
    return dropShadowedMessages(next, e)
  },
  wire: {
    viewSchema: stateSchema,
    view: (state: TimelineProjectionState): TimelineProjectionState => state,
  },
  stateVersion: 1,
}

/** Structural face of the host session-projection registry. */
interface SessionProjectionsRegistryFace {
  register(definition: unknown): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Host session-projection registry — provided by the
     * @deepseek-ai/dsh-session-projection plugin in the base bundle. Optional
     * here because headless or stripped deployments may not mount it.
     */
    readonly sessionProjections?: SessionProjectionsRegistryFace | undefined
  }
}

/**
 * Register the timeline projection with the host registry (when mounted).
 * Safe to call from the plugin root apply; the inject waits for the service
 * and never throws when the deployment has none.
 * @param ctx - Host context.
 */
export function registerTimelineProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (hostCtx) => {
    try {
      hostCtx.sessionProjections?.register(timelineProjectionDefinition)
    } catch (error) {
      // A registration failure must not take the plugin (or its routes) down;
      // the rail falls back to the loaded chat-node window.
      console.error('[deepseek-harness-background] timeline projection registration failed:', error)
    }
  })
}
