/**
 * Dock-slot entry for the conversation timeline: detects which frontend the
 * running kernel supports and mounts exactly one of them.
 *
 * Detection is a capability check on the slot props, not a version compare:
 * the official turn rail is rendered from the very index `ui-chat` publishes
 * as a session hook (`useChat(s => s.navigation.items())`, dsh >= 0.1.2), so
 * the presence of that hook IS the presence of the official rail. Comparing
 * version strings would break on pre-releases, forks, and deployments that
 * mount a different conversation target.
 *
 * - `useChat` present -> 'enhance': the official rail stays on screen and
 *   OfficialTimelineEnhancer improves only its behaviour.
 * - `useChat` absent  -> 'legacy': no official rail exists, so this plugin
 *   renders its own port of it from the shared backend.
 *
 * The detected mode is published to ./mode-store.ts because the settings row
 * (root-scoped, no session) cannot probe the kernel itself but must switch its
 * copy between "conversation timeline" and "conversation timeline enhancement".
 */

import react from 'react'
import { settingsClient } from '../settings-client.ts'
import { LegacyTimelineRail } from './legacy-rail.tsx'
import { OfficialTimelineEnhancer } from './official-enhance.tsx'
import { reportTimelineMode } from './mode-store.ts'
import type { TimelineMode, TimelineSessionsService } from './types.ts'

/** Props the dock slot delivers. */
export interface TimelineBridgeProps {
  sessionId?: string
  sessionsService?: TimelineSessionsService
  /** Kernel selector hook over the Chat snapshot; absent before 0.1.2. */
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
 * @returns the enhancer or the legacy rail.
 */
export function TimelineBridge(props: TimelineBridgeProps): react.ReactElement {
  const { useChat, t, ...rest } = props

  const settings = react.useSyncExternalStore(settingsClient.subscribe, settingsClient.getSnapshot)
  // Hide only while the persisted toggle is UNKNOWN (no wrong-state flash for
  // timeline:false users); once loading settles the default-on rail renders
  // even if the section errored.
  const enabled = settings.value?.timeline !== false && settings.status !== 'loading'

  const mode: TimelineMode = useChat === undefined ? 'legacy' : 'enhance'
  react.useEffect(() => { reportTimelineMode(mode) }, [mode])

  if (mode === 'enhance') {
    return react.createElement(OfficialTimelineEnhancer, { ...rest, useChat, enabled, t })
  }
  return react.createElement(LegacyTimelineRail, { ...rest, enabled, t })
}

export {
  LEGACY_FOLLOW_ZONE_PX,
  CHATVIEW_FOLLOW_ZONE_PX,
  centeredScrollTopFor,
  compensatedLoadOlder,
  conversationScrollports,
  glideDurationFor,
  jumpToMessage,
  officialTargetTopFor,
  scrollFloorOf,
  settleScrollEvents,
  animateScrollTop,
  detachBottomFollow,
  waitForChatRow,
  warmHistory,
  type JumpOptions,
  type TargetTopResolver,
  type WarmOptions,
} from './jump.ts'
export {
  DEFAULT_RAIL_CAPACITY,
  RAIL_INSET_PX,
  TICK_SPACING_PX,
  frameIndexAtPointer,
  indexAtPointer,
  indexForEvent,
  isFrameRail,
  mergeRailItems,
  normalizeNavigationItems,
  normalizeOutlineItems,
  railCapacityOf,
  railInsetOf,
} from './rail-pointer.ts'
export {
  chatNodesOf,
  collectMessages,
  hiddenSeqsOfChat,
  inputAnchorKeyOf,
  normalizeProjectedTimeline,
  railMessages,
  rewindHiddenSeqsOfChat,
  rewindMarkedSeqsOfChat,
  rewindSpansOfChat,
  rewindTargetOfCommand,
  rewindTargetOfOutcome,
  TIMELINE_PROJECTION_KEY,
} from './source.ts'
export {
  OFFICIAL_RAIL_SELECTOR,
  OfficialTimelineEnhancer,
  type OfficialTimelineEnhancerProps,
} from './official-enhance.tsx'
export { LegacyTimelineRail, type LegacyTimelineRailProps } from './legacy-rail.tsx'
export { injectTimelineCss, TIMELINE_CSS, TIMELINE_CSS_TAG } from './legacy-rail-css.ts'
export { reportTimelineMode, subscribeTimelineMode, timelineMode } from './mode-store.ts'

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
  TimelineEntry,
  TimelineMode,
  TimelineSessionHandle,
  TimelineSessionsService,
  TurnRailLadderItem,
} from './types.ts'
