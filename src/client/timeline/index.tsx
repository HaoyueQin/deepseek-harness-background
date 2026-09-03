/**
 * Dock-slot entry for the conversation timeline: mounts the official-rail
 * enhancer on kernels that publish the turn-navigation index.
 *
 * Supported dsh baseline: >= 0.1.2-rc.1. Every such kernel ships the official
 * turn rail (`TurnNavigator` in dsh-client-ui-chat), rendered from the very
 * index `ui-chat` publishes as a session hook (`useChat(s => s.navigation.items())`),
 * so the presence of that hook IS the presence of the official rail. This
 * plugin therefore never renders a rail of its own — it only improves the
 * official one's behaviour (smooth glide for loaded marks, standing down
 * while the kernel's own loadThrough jump is still paging).
 *
 * The hook-missing branch is a defensive no-op, not a second frontend: on
 * kernels without the official rail (everything before 0.1.2) this plugin
 * renders nothing, exactly as the supported-version contract requires
 * (README directs those users to an older plugin release).
 */

import react from 'react'
import { settingsClient } from '../settings-client.ts'
import { OfficialTimelineEnhancer } from './official-enhance.tsx'
import type { TimelineSessionsService } from './types.ts'

/** Props the dock slot delivers. */
export interface TimelineBridgeProps {
  sessionId?: string
  sessionsService?: TimelineSessionsService
  /** Kernel selector hook over the Chat snapshot; present on dsh >= 0.1.2. */
  useChat?: (selector: (snapshot: unknown) => unknown) => unknown
  /** Framework projection reader (SessionStandardProps seat). */
  useProjection?: (key: string) => unknown
  /** Locale lookup. Dictionaries interpolate `{turn}` placeholders, like the
   *  official chat namespace's own turn-navigation copy does. */
  t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * Mount the timeline frontend the running kernel supports.
 * @param props - dock slot props.
 * @returns the enhancer, or nothing on kernels without the official rail.
 */
export function TimelineBridge(props: TimelineBridgeProps): react.ReactElement | null {
  const { useChat, t, ...rest } = props

  const settings = react.useSyncExternalStore(settingsClient.subscribe, settingsClient.getSnapshot)
  // Hide only while the persisted toggle is UNKNOWN (no wrong-state flash for
  // timeline:false users); once loading settles the default-on enhancement
  // runs even if the section errored.
  const enabled = settings.value?.timeline !== false && settings.status !== 'loading'

  if (useChat === undefined) return null
  return react.createElement(OfficialTimelineEnhancer, { ...rest, useChat, enabled, t })
}

export {
  CHATVIEW_FOLLOW_ZONE_PX,
  centeredScrollTopFor,
  conversationScrollports,
  glideDurationFor,
  jumpToMessage,
  officialTargetTopFor,
  scrollFloorOf,
  settleScrollEvents,
  animateScrollTop,
  detachBottomFollow,
  waitForChatRow,
  type JumpOptions,
  type TargetTopResolver,
} from './jump.ts'
export {
  RAIL_INSET_PX,
  TICK_SPACING_PX,
  frameIndexAtPointer,
  indexForEvent,
  isFrameRail,
  mergeRailItems,
  normalizeNavigationItems,
  normalizeOutlineItems,
  railInsetOf,
} from './rail-pointer.ts'
export {
  OFFICIAL_RAIL_SELECTOR,
  OfficialTimelineEnhancer,
  type OfficialTimelineEnhancerProps,
} from './official-enhance.tsx'

/** localStorage prefix the removed key-point bookmark feature used (< 0.5). */
const MARKS_STORAGE_PREFIX = 'dsbt_marks_'

/**
 * Drop the bookmark rows pre-0.5 versions left in localStorage.
 *
 * The bookmarks are gone — the rail now reuses the official UI, which has no
 * affordance for them — so the rows are dead weight every session carried
 * forever. One-way and irreversible by design; the key prefix is owned by
 * this plugin, so nothing else can be caught in the sweep.
 */
export function clearLegacyMarks(): void {
  if (typeof window === 'undefined') return
  try {
    const stale: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key !== null && key.startsWith(MARKS_STORAGE_PREFIX)) stale.push(key)
    }
    for (const key of stale) window.localStorage.removeItem(key)
  } catch {
    /* storage unavailable (private mode, blocked origin) — nothing to clean */
  }
}
export type {
  OfficialNavigationItem,
  TimelineSessionHandle,
  TimelineSessionsService,
  TurnRailLadderItem,
} from './types.ts'
