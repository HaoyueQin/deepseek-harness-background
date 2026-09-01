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

/**
 * One mark of the official rail's FULL ladder (dsh >= 0.1.2-alpha.3): the
 * kernel merges its loaded `TurnNavigationItem`s with the host `turnOutline`
 * projection so every turn of the session renders, an unloaded one paging
 * history through its seq when clicked. Duck-typed like its source faces.
 * This plugin only ever glides to a mark it can address — a loaded one — so
 * the ladder entry needs the anchor key and nothing else; an entry without
 * one is an outline-only turn the kernel's own jump machinery owns.
 */
export interface TurnRailLadderItem {
  /** Turn number the mark addresses. */
  readonly turn: number
  /** Bounded prompt preview (loaded window first, outline fallback). */
  readonly prompt: string
  /** Bounded response preview (loaded window first, outline fallback). */
  readonly response: string
  /** Chat anchor key; absent for an outline-only (unloaded) turn. */
  readonly anchorKey?: string
}
