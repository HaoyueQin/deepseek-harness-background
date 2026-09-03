/**
 * Shared shapes for the official-rail enhancement — one contract for the
 * enhancer and the jump engine, so the two cannot drift apart.
 */

/**
 * One official ChatView navigation item (dsh >= 0.1.2-rc.1,
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
 * One mark of the official rail's FULL ladder (dsh >= 0.1.2-alpha.3, and the
 * same geometry on 0.1.2-rc.1): the kernel merges its loaded
 * `TurnNavigationItem`s with the host `turnOutline` projection so every turn
 * of the session renders, an unloaded one paging history through its seq when
 * clicked. Duck-typed like its source faces. This plugin only ever glides to
 * a mark it can address — a loaded one — so the ladder entry needs the anchor
 * key and nothing else; an entry without one is an outline-only turn the
 * kernel's own jump machinery owns.
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

/**
 * Session handle face the timeline needs off the runtime sessions service.
 * Structural on purpose — this plugin never builds against the kernel.
 */
export interface TimelineSessionHandle {
  subscribe(listener: () => void): () => void
  getSnapshot(): unknown
  loadOlder(): Promise<unknown>
}

/** Sessions service face (narrowed to what jumps touch). */
export interface TimelineSessionsService {
  binding(sessionId: string): { session: TimelineSessionHandle } | undefined
}
