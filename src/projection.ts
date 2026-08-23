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
 * - Rewind (surface replace) drops the cut user messages so the rail matches
 *   what the conversation still shows; compaction is NOT a cut (its marker is
 *   plugin-sourced and never passes the user filter).
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
 * A surface replace cuts nodes out of the model-visible surface (the rewind
 * command's empty marker does this). Drop indexed user messages whose seq is
 * shadowed so the rail matches the cut.
 */
function dropShadowedMessages(state: TimelineProjectionState, event: LooseEvent): TimelineProjectionState {
  if ((event as { surfaceOp?: unknown }).surfaceOp !== 'replace') return state
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
    if (e.type === 'user/message') {
      const source = e.data?.source
      if (source === null || typeof source !== 'object' || source.kind !== 'user') return state
      const seq = typeof e.seq === 'number' ? e.seq : undefined
      if (seq === undefined || !Number.isFinite(seq)) return state
      const rawTime = typeof e.time === 'number' ? e.time : typeof e.data?.time === 'number' ? e.data.time : 0
      const id = typeof e.data?.id === 'string' && e.data.id !== '' ? e.data.id : undefined
      // Same-seq replay (mux replays, cache re-seeds): keep the fold pure.
      if (state.messages.some((m) => m.seq === seq)) return state
      const entry: TimelineProjectionEntry = {
        seq,
        time: rawTime,
        text: textOf(e.data?.content),
        ...(id === undefined ? {} : { id }),
      }
      return { messages: [...state.messages, entry] }
    }
    if (e.type === 'assistant/message') return dropShadowedMessages(state, e)
    return state
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
