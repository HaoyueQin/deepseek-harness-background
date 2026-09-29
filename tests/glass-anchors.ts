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

/**
 * The changed-files card's header row.
 *
 * Its official fill is the opaque `--changes-fill` static neutral, which hid
 * the glass card behind it; clearing that one fill hands the surface back to
 * the card. The anchor is the header ELEMENT, not the card's child position: a
 * multi-file card renders the header as its first child, but a single-file
 * card renders that same header through the HoverCard primitive, which wraps
 * its anchor in a span — so a child-position anchor reached only the wrapper
 * and left the real header's fill in place.
 */
export const CHANGED_FILES_HEADER = `${GATE} [data-changed-files] button[class*="_header"]`

/** The header's own hover/focus feedback, on the rows' translucent token. */
export const CHANGED_FILES_HEADER_HOVER = `${CHANGED_FILES_HEADER}:hover:not(:disabled)`

/**
 * The deliverable grid's file card (`[data-presented-file]`).
 *
 * It paints `--deliverable-fill`, a static neutral that no overridden token
 * reaches, so it needs the explicit fill — and its own hover restates that
 * fill from the other static neutral, which is why the hover anchor exists.
 */
export const PRESENTED_FILE = `${GATE} [data-presented-file]`

/** The delivered file card's hover fill. */
export const PRESENTED_FILE_HOVER = `${PRESENTED_FILE}:hover`

/**
 * The sidebar account notice (the bonus card), portaled onto `document.body`.
 *
 * It already paints an overridden token (`--dsw-specific-input-major`) but
 * ships no filter of its own, so the rule adds only the shared sheen and
 * exposure chain. The host has no data attribute for it: the `aside` plus its
 * own `role="status"` copy is the anchor, and the direct-child step keeps the
 * rule on the portaled body child rather than a nested status region.
 */
export const ACCOUNT_NOTICE = `${GATE} > aside:has(> [role="status"])`

/**
 * The Platform overlay's ground in the Account settings (usage / top-up).
 *
 * This anchor is the INVERSE of every other one: it exists to keep a surface
 * OPAQUE. The isolated native Platform view paints with `--dsw-alias-bg-base`,
 * the token the painter sets to `transparent`, so its 48px return bar went
 * see-through while the native child below it stayed opaque. Gated on
 * `data-dsh-bg`, not on the glass gate: a fully opaque panel setting must not
 * hand this surface back to transparency.
 */
export const PLATFORM_OVERLAY = 'body[data-dsh-bg] [role="dialog"][aria-modal="true"]:has(> header[data-window-drag])'

/** The same ground in the dark scheme. */
export const PLATFORM_OVERLAY_DARK = 'body[data-ds-dark-theme][data-dsh-bg] [role="dialog"][aria-modal="true"]:has(> header[data-window-drag])'

/**
 * The present tool's result box.
 *
 * It paints `--dsw-alias-bg-layer-1`, the token the painter keeps opaque on
 * purpose (it backs the settings UI and the dialogs), so it needs the explicit
 * fill. The anchor is the row's own `data-tool` mark plus the element the fill
 * sits on — never a class hash.
 */
export const PRESENT_OUTPUT = `${GATE} [data-tool="present"] pre`

/** The schedule_create transcript card: the delivery card's static neutral. */
export const SCHEDULE_CREATE_CARD = `${GATE} [data-tool="schedule_create"]`

/** The schedule card's own hover repaints that static neutral. */
export const SCHEDULE_CREATE_HOVER = `${SCHEDULE_CREATE_CARD}:hover`

/**
 * The turn-trigger attribution card.
 *
 * 0.2.0-rc.2 split its fill per scheme: `--dsw-alias-turn-trigger-bg` is the
 * painter's overridden code-block token in light but an untouched interactive
 * token in dark, which left the same card translucent in one scheme and opaque
 * in the other. The rule gives it one explicit fill instead.
 */
export const TURN_TRIGGER = `${GATE} [data-turn-trigger]`

/** The turn-trigger card's hover, kept on that same glass fill. */
export const TURN_TRIGGER_HOVER = `${TURN_TRIGGER}:hover`

/**
 * The composer card.
 *
 * It carries the fill and the sheen, deliberately NOT the filter: Chromium
 * makes any element with a backdrop-filter a Backdrop Root, and the picker menu
 * this card hosts is an absolutely positioned CHILD (ui-conversation renders
 * `conversation.input.overlay` inside `[data-composer-card]`), so inside that
 * root the menu could sample the card's own paint only and read as flat
 * transparency over the wallpaper.
 */
export const COMPOSER_CARD = `${GATE} [data-composer-card]`

/**
 * The pseudo-element that carries the composer card's filter instead.
 *
 * It is not an ancestor of the hosted menu, so the menu keeps its own wallpaper
 * backdrop and blurs the wallpaper again. Verified in Chromium: the menu's
 * backdrop goes from crisp to blurred, with the card's own frost unchanged.
 */
export const COMPOSER_CARD_FILTER = `${COMPOSER_CARD}::before`

/**
 * The portaled stat dialogs (turn time, session stats, token usage).
 *
 * They reach `document.body`, so unlike the picker menu they do blur the
 * wallpaper; the rule only adds the shared sheen and exposure chain, because
 * the official 40px blur under a flat 58% fill still reads as plain
 * transparency on a soft wallpaper. Each anchor is the panel's own detail list,
 * so the `:has()` keeps this from being a blanket dialog rule.
 */
export const STAT_DIALOGS: readonly { readonly name: string, readonly selector: string }[] = [
  { name: 'turn usage dialog', selector: `${GATE} [role="dialog"]:has([data-turn-usage-details])` },
  { name: 'session stats dialog', selector: `${GATE} [role="dialog"]:has([data-session-stats-details])` },
  { name: 'session token usage dialog', selector: `${GATE} [role="dialog"]:has([data-session-stats-usage])` },
]

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
  { name: 'changed files header', selector: CHANGED_FILES_HEADER },
  { name: 'presented file card', selector: PRESENTED_FILE },
  { name: 'present output', selector: PRESENT_OUTPUT },
  { name: 'schedule_create card', selector: SCHEDULE_CREATE_CARD },
  { name: 'turn trigger card', selector: TURN_TRIGGER },
  { name: 'account notice', selector: ACCOUNT_NOTICE },
  { name: 'composer card', selector: COMPOSER_CARD },
  { name: 'composer card filter', selector: COMPOSER_CARD_FILTER },
  ...STAT_DIALOGS.map(entry => ({ name: entry.name, selector: entry.selector })),
  { name: 'diff hover preview', selector: CHANGES_HOVER_PREVIEW },
  { name: 'turn rail preview', selector: TURN_RAIL_PREVIEW },
]
