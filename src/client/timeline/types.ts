/**
 * Shared shapes for the conversation timeline — one contract for both
 * frontends (the official rail enhancer and the legacy ported rail), so the
 * two cannot drift apart.
 */

/**
 * Which frontend owns the rail.
 * - 'enhance': the running kernel publishes the official turn-navigation
 *   index (`useChat(s => s.navigation.items())`, dsh >= 0.1.2). The official
 *   rail stays on screen untouched; this plugin only improves its behaviour.
 * - 'legacy': no official rail exists. This plugin renders its own port of
 *   the official rail from the same backend.
 */
export type TimelineMode = 'enhance' | 'legacy'

/** One entry in the conversation timeline — a user question. */
export interface TimelineEntry {
  /** Durable event seq (sort order + rewind filtering). */
  seq: number
  /** Event time (ms epoch). */
  time: number
  /** Preview text (capped). */
  text: string
  /** Chat row anchor key; absent when the entry cannot be jumped to. */
  anchorKey?: string
}

/**
 * Session handle face the timeline needs off the runtime sessions service.
 * Structural on purpose — this plugin never builds against the kernel.
 */
export interface TimelineSessionHandle {
  subscribe(listener: () => void): () => void
  getSnapshot(): unknown
  loadOlder(): Promise<unknown>
}

/** Sessions service face (narrowed to what data collection and jumps touch). */
export interface TimelineSessionsService {
  binding(sessionId: string): { session: TimelineSessionHandle } | undefined
}

/**
 * One official ChatView navigation item (dsh >= 0.1.2,
 * `TurnNavigationItem` in `dsh-client-ui-chat`). Duck-typed: the array
 * crosses the slot boundary as `unknown` and is validated before use.
 */
export interface OfficialNavigationItem {
  /** Turn number the item addresses. */
  turn: number
  /** Stable conversation-context key the official rail scrolls to. */
  anchorKey: string
  /** Bounded prompt preview; empty when the loaded window starts mid-turn. */
  prompt: string
  /** Bounded assistant-response preview; empty until the turn answers. */
  response: string
}
