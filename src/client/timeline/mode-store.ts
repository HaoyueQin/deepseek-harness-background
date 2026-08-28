/**
 * Detected-timeline-mode store — how the General-settings row learns which
 * frontend is live.
 *
 * The settings row sits in the root-scoped `settings.general.item` slot and
 * therefore has no session scope: it never receives `useChat` and cannot
 * probe the kernel itself. The session-scoped dock entry does the probing and
 * publishes the result here; the row subscribes and switches its copy between
 * "conversation timeline" (this plugin renders the rail) and "conversation
 * timeline enhancement" (the official rail exists and this plugin only
 * improves its behaviour).
 */

import type { TimelineMode } from './types.ts'

type Listener = () => void

// The store cannot know the live mode before the first session-scoped dock
// entry probes the kernel (the settings row is root-scoped and has no session
// either). 'legacy' is the conservative pre-probe default: the settings row
// briefly shows the plain "conversation timeline" label until the dock probes,
// then switches to "…enhancement" when the kernel publishes useChat. The
// flip is unavoidable — the information genuinely arrives later — and it
// happens once, right after the first session mounts.
let mode: TimelineMode = 'legacy'
const listeners = new Set<Listener>()

/** @returns the currently detected mode. */
export function timelineMode(): TimelineMode {
  return mode
}

/** Observe mode changes. @returns the disposer. */
export function subscribeTimelineMode(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Publish the detected mode (called by the session-scoped dock entry).
 * No-ops when the mode is unchanged, so a re-render cannot notify.
 * @param next - the mode to publish.
 */
export function reportTimelineMode(next: TimelineMode): void {
  if (mode === next) return
  mode = next
  for (const listener of listeners) listener()
}
