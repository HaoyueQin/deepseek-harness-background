/**
 * Pointer/keyboard resolution for the official turn rail — shared by the
 * enhancer (which borrows the official rail) and the legacy port (which
 * renders an identical one), so both resolve a gesture to the same entry.
 *
 * The official rail owns pointer input for its whole column: the marks carry
 * `pointer-events: none` and only paint, so a MOUSE gesture arrives at the
 * `<nav>` with coordinates and must be mapped back to an index by geometry.
 * A KEYBOARD gesture instead activates the focused mark button, which carries
 * no index — it is recovered from the button's position among its siblings.
 */

import type { OfficialNavigationItem, TimelineEntry } from './types.ts'

/** Resting gap between neighbouring marks before the rail compresses to fit. */
export const TICK_SPACING_PX = 10
/** Rail padding above the first mark and below the last one, per end. */
export const RAIL_INSET_PX = 6
/** Fallback capacity when the rail has not been measured yet. */
export const DEFAULT_RAIL_CAPACITY = 41

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
 * How many marks the rail can show before it starts compressing them.
 *
 * Past this count the official stylesheet clamps the rail's height and every
 * mark switches from its fixed 10px spacing to a percentage position, so the
 * column degrades into a solid bar the reader cannot aim at. Filling the rail
 * exactly to this capacity is therefore free extra reach; going past it is
 * not.
 *
 * @param rail - the rail element (or null).
 */
export function railCapacityOf(rail: HTMLElement | null): number {
  if (rail === null) return DEFAULT_RAIL_CAPACITY
  const usable = rail.clientHeight - 2 * railInsetOf(rail)
  if (!Number.isFinite(usable) || usable <= 0) return DEFAULT_RAIL_CAPACITY
  return Math.max(2, Math.floor(usable / TICK_SPACING_PX) + 1)
}

/**
 * Resolve the entry under a pointer Y — the official geometry verbatim
 * (`itemAtPointer` in TurnNavigator.tsx), so this plugin lands on exactly the
 * mark the official rail would have picked.
 * @param count - number of entries the rail shows.
 * @param rail - the rail element.
 * @param clientY - pointer viewport Y.
 */
export function indexAtPointer(count: number, rail: HTMLElement, clientY: number): number {
  const rect = rail.getBoundingClientRect()
  const inset = railInsetOf(rail)
  const usableHeight = Math.max(1, rect.height - 2 * inset)
  const ratio = Math.max(0, Math.min(1, (clientY - rect.top - inset) / usableHeight))
  return Math.round(ratio * (count - 1))
}

/**
 * Resolve the gesture that produced a rail click to an entry index.
 *
 * Keyboard activation targets the focused mark button (recovered by its
 * position among the rail's buttons); a mouse click carries coordinates and
 * resolves through the rail geometry. Returns -1 when neither applies.
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
  return count === 0 ? -1 : indexAtPointer(count, rail, event.clientY)
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

/** Extract the preview text of one entry, whatever produced it. */
export function entryTextOf(entry: TimelineEntry | OfficialNavigationItem): string {
  return 'text' in entry ? entry.text : entry.prompt
}
