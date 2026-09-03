/**
 * Pointer/keyboard resolution for the official turn rail — the enhancer
 * borrows the official rail and resolves a gesture to the same entry the
 * kernel would have picked.
 *
 * The official rail owns pointer input for its whole column: the marks carry
 * `pointer-events: none` and only paint, so a MOUSE gesture arrives at the
 * `<nav>` with coordinates and must be mapped back to an index by geometry.
 * A KEYBOARD gesture instead activates the focused mark button, which carries
 * no index — it is recovered from the button's position among its siblings.
 *
 * Geometry contract (dsh >= 0.1.2-alpha.3, unchanged on 0.1.2-rc.1): the rail
 * is the frame-style generation — fixed 10px pitch, marks scroll INSIDE the
 * frame, and the scroller offset is published inline as `--turn-scroll-top`.
 * The frame property is checked before mapping (never a version compare): a
 * rail that does not publish it is not the supported generation, and the
 * enhancer stands down and lets the kernel own the gesture.
 */

import type { OfficialNavigationItem, TurnRailLadderItem } from './types.ts'

/** Resting gap between neighbouring marks. */
export const TICK_SPACING_PX = 10
/** Rail padding above the first mark and below the last one, per end. */
export const RAIL_INSET_PX = 6

/**
 * The rail's own inset, read off the custom property the official component
 * publishes (`--turn-rail-inset`). Falls back to the official constant.
 * @param rail - the rail element (or null).
 */
export function railInsetOf(rail: HTMLElement | null): number {
  if (rail === null) return RAIL_INSET_PX
  const px = Number.parseFloat(rail.style.getPropertyValue('--turn-rail-inset'))
  return Number.isFinite(px) && px >= 0 ? px : RAIL_INSET_PX
}

/**
 * Whether `rail` is the frame-style rail (dsh >= 0.1.2-alpha.3): marks sit
 * at a fixed pitch and scroll INSIDE the frame, whose scroller offset the
 * component publishes inline as `--turn-scroll-top` — every render, resting
 * at `0px` included. The compressing alpha.1/2 rail never publishes that
 * property, so its presence is the generation test. The legacy port paints
 * its own `--dsbt-*` properties and can never trip this.
 * @param rail - the rail element (or null).
 */
export function isFrameRail(rail: HTMLElement | null): boolean {
  return rail !== null && rail.style.getPropertyValue('--turn-scroll-top') !== ''
}

/**
 * Resolve the entry under a pointer Y on the frame-style rail — the official
 * alpha.3 geometry verbatim (`itemAtPointer` in that generation's
 * TurnNavigator.tsx): marks live in the scrolled ladder at a fixed 10px
 * pitch, so the click offset adds the scroller offset. Read off the published
 * `--turn-scroll-top` var rather than the scroller element itself — the same
 * metric the official preview positioning uses, so any one-frame render lag
 * affects both identically.
 * @param count - number of entries the rail shows.
 * @param rail - the rail element.
 * @param clientY - pointer viewport Y.
 */
export function frameIndexAtPointer(count: number, rail: HTMLElement, clientY: number): number {
  const rect = rail.getBoundingClientRect()
  const inset = railInsetOf(rail)
  const raw = Number.parseFloat(rail.style.getPropertyValue('--turn-scroll-top'))
  const scrollTop = Number.isFinite(raw) ? raw : 0
  const offset = clientY - rect.top + scrollTop - inset
  return Math.max(0, Math.min(count - 1, Math.round(offset / TICK_SPACING_PX)))
}

/**
 * Resolve the gesture that produced a rail click to an entry index.
 *
 * Keyboard activation targets the focused mark button (recovered by its
 * position among the rail's buttons); a mouse click carries coordinates and
 * resolves through the rail geometry — the frame-style mapping over the
 * published `--turn-scroll-top`. Returns -1 when neither applies (a
 * keyboard target outside the rail, or a rail of an unsupported generation,
 * which the kernel's own handler then owns).
 *
 * Assumption: the mark ticks are the ONLY buttons under the rail — the
 * official rail renders marks exclusively and its preview tooltip carries
 * none. A future non-mark control added inside the rail would shift the
 * button index and must revisit this.
 *
 * @param rail - the rail element.
 * @param event - the click event.
 */
export function indexForEvent(rail: HTMLElement, event: MouseEvent): number {
  const target = event.target
  if (target instanceof Element) {
    const button = target.closest('button')
    if (button !== null && rail.contains(button)) {
      const index = Array.from(rail.querySelectorAll('button')).indexOf(button)
      if (index >= 0) return index
    }
  }
  const count = rail.querySelectorAll('button').length
  if (count === 0) return -1
  // The frame-style geometry is the only supported generation (dsh >=
  // 0.1.2-alpha.3, unchanged on 0.1.2-rc.1). A rail that does not publish
  // `--turn-scroll-top` is not the supported rail: stand down (-1) so the
  // kernel's own handler owns the gesture untouched.
  return isFrameRail(rail) ? frameIndexAtPointer(count, rail, event.clientY) : -1
}

/**
 * Validate the official navigation array crossing the slot boundary. The
 * value is produced by the kernel and may be absent, partial, or from an
 * older build, so every field is checked before use.
 * @param value - the raw `useChat(s => s.navigation.items())` result.
 */
export function normalizeNavigationItems(value: unknown): OfficialNavigationItem[] {
  if (!Array.isArray(value)) return []
  const out: OfficialNavigationItem[] = []
  const seen = new Set<number>()
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as { turn?: unknown; anchorKey?: unknown; prompt?: unknown; response?: unknown }
    if (typeof rec.turn !== 'number' || !Number.isFinite(rec.turn)) continue
    if (typeof rec.anchorKey !== 'string' || rec.anchorKey === '') continue
    if (seen.has(rec.turn)) continue
    seen.add(rec.turn)
    out.push({
      turn: rec.turn,
      anchorKey: rec.anchorKey,
      prompt: typeof rec.prompt === 'string' ? rec.prompt : '',
      response: typeof rec.response === 'string' ? rec.response : '',
    })
  }
  return out
}

/* ---- Full-ladder merge (dsh >= 0.1.2-alpha.3) ---------------------------- */

/**
 * Validate one `turnOutline` wire value into its entries. The value is the
 * host projection's wire view (an array of `{ turn, seq, prompt, response }`
 * — see `dsh-session-turn-outline`) read through `useProjection`, so it may
 * be absent (pre-baseline, or an older kernel that never registers the key —
 * which reads `undefined`), partial, or damaged. `turn` and `seq` are the
 * load-bearing fields — a mark cannot exist or page without them — and a
 * damaged one drops the entry; the previews are decorative and degrade to ''.
 * @param value - the raw `useProjection('turnOutline')` value.
 */
export function normalizeOutlineItems(value: unknown): { turn: number; seq: number; prompt: string; response: string }[] {
  if (!Array.isArray(value)) return []
  const out: { turn: number; seq: number; prompt: string; response: string }[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as { turn?: unknown; seq?: unknown; prompt?: unknown; response?: unknown }
    if (typeof rec.turn !== 'number' || !Number.isSafeInteger(rec.turn) || rec.turn < 0) continue
    if (typeof rec.seq !== 'number' || !Number.isSafeInteger(rec.seq) || rec.seq < 0) continue
    out.push({
      turn: rec.turn,
      seq: rec.seq,
      prompt: typeof rec.prompt === 'string' ? rec.prompt : '',
      response: typeof rec.response === 'string' ? rec.response : '',
    })
  }
  return out
}

/**
 * Rebuild the rail's full mark ladder exactly as the official ChatView does
 * (a mirror of `mergeTurnRailItems` in dsh-client-ui-chat): outline entries
 * seed every known turn as unloaded, loaded items then override with their
 * anchor key and richer previews, ascending by turn. The enhancer maps a
 * click to a mark by INDEX, so its ladder must match the RENDERED marks —
 * which are exactly this merge on an alpha.3 kernel; without the outline
 * value the merge degrades to the loaded items (the alpha.1/2 ladder).
 * @param loaded - the validated loaded-window items.
 * @param outline - the raw turnOutline wire value.
 */
export function mergeRailItems(loaded: OfficialNavigationItem[], outline: unknown): TurnRailLadderItem[] {
  const byTurn = new Map<number, TurnRailLadderItem>()
  for (const entry of normalizeOutlineItems(outline)) {
    byTurn.set(entry.turn, { turn: entry.turn, prompt: entry.prompt, response: entry.response })
  }
  for (const item of loaded) {
    const preview = byTurn.get(item.turn)
    byTurn.set(item.turn, {
      turn: item.turn,
      prompt: item.prompt !== '' ? item.prompt : preview?.prompt ?? '',
      response: item.response !== '' ? item.response : preview?.response ?? '',
      anchorKey: item.anchorKey,
    })
  }
  if (byTurn.size === 0) return []
  return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
}

