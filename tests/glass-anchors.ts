/**
 * Canonical glass-anchor selectors, shared by the two test files that guard
 * them:
 *
 * - `apply.spec.ts` asserts the injected shell CONTAINS each anchor (it only
 *   sees the stylesheet text, mounted through the real plugin).
 * - `glass-anchors.spec.ts` evaluates each anchor against a fixture of the
 *   host markup and asserts the matched SET.
 *
 * Keeping the strings here is what stops the two guards from disagreeing:
 * a selector edited in `background-css.ts` has to be edited here too, or the
 * "contains" assertion fails and points at the constant rather than at a
 * substring buried in a test file.
 */

/** Attribute the painter sets while a wallpaper is active. */
const GATE = 'body[data-dsh-bg-glass]'

/** Chrome control: the New Session button of the sidebar. */
export const NEW_SESSION = `${GATE} button[class*="_newSession"]`

/** The bare-icon rail form of that control, exempted from the chrome paint. */
export const NEW_SESSION_COLLAPSED = `${GATE} [data-sidebar-collapsed="true"] [class*="_newSession"]`

/** Zero-height sticky wrapper around the scroll-to-bottom control. */
export const TO_BOTTOM = `${GATE} [class*="_toBottom"]:not([class*="Slot"])`

/** The "load earlier" history button (trajectory view) keeps the same recipe. */
export const HISTORY_LOAD = `${GATE} [class*="_older"] button`

/** Inline code inside the markdown host: a compound, never a descendant step. */
export const MARKDOWN_INLINE_CODE = `${GATE} [class*="_markdown"]:not(pre) > code`

/** The changed-files card a turn tail renders. */
export const CHANGED_FILES = `${GATE} [data-changed-files]`

/** The diff hover preview the changed-files rows open (HoverCard preview pod). */
export const CHANGES_HOVER_PREVIEW = `${GATE} [data-changes-hover-preview]`

/**
 * The turn rail's hover preview card.
 *
 * Anchored on the rail's SEAT — the only `nav` inside the conversation
 * scrollport, the same hook `src/client/timeline/official-enhance.tsx` uses
 * to find the rail — because 0.1.7 virtualized the rail and deleted the
 * `--turn-natural-height` inline metric the previous selector keyed on.
 */
export const TURN_RAIL_PREVIEW = `${GATE} [data-conversation-scroll] nav [role="tooltip"]`

/** Every anchor above, for a contains-all sweep in one place. */
export const GLASS_ANCHORS: readonly { readonly name: string, readonly selector: string }[] = [
  { name: 'new session', selector: NEW_SESSION },
  { name: 'new session (collapsed rail)', selector: NEW_SESSION_COLLAPSED },
  { name: 'scroll to bottom', selector: TO_BOTTOM },
  { name: 'load earlier', selector: HISTORY_LOAD },
  { name: 'markdown inline code', selector: MARKDOWN_INLINE_CODE },
  { name: 'changed files card', selector: CHANGED_FILES },
  { name: 'diff hover preview', selector: CHANGES_HOVER_PREVIEW },
  { name: 'turn rail preview', selector: TURN_RAIL_PREVIEW },
]
