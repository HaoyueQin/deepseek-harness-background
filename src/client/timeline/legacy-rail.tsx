/**
 * Legacy turn rail — the official `TurnNavigator` UI ported into this plugin
 * for kernels that do not publish an official turn-navigation index
 * (dsh <= 0.1.1).
 *
 * Structure, metrics and paints mirror `TurnNavigator.tsx` /
 * `TurnNavigator.module.css` from dsh-client-ui-chat; styles live in
 * ./legacy-rail-css.ts. The only differences are the ones a portaled box
 * forces:
 * - The official slot is a zero-height sticky box inside the chat scrollport;
 *   this one is a fixed box centred on the same band (the transcript minus
 *   the composer), positioned from the scrollport's live rect.
 * - The official rail reads the turn index the kernel assembles; this one
 *   reads the shared backend (./source.ts), i.e. the host projection when it
 *   exists and the loaded node window otherwise. That is why it can offer
 *   turns the chat view has not loaded yet.
 *
 * Behaviour is identical to the enhanced official rail because both run the
 * same jump engine (./jump.ts): a click glides instead of teleporting, and
 * reaching for the rail pages older history in up to its uncompressed
 * capacity with the reader's view held still.
 */

import react from 'react'
import reactDom from 'react-dom'
import { LEGACY_FOLLOW_ZONE_PX, jumpToMessage, warmHistory } from './jump.ts'
import { indexAtPointer, indexForEvent, railCapacityOf, RAIL_INSET_PX, TICK_SPACING_PX } from './rail-pointer.ts'
import { railMessages } from './source.ts'
import { TIMELINE_PROJECTION_KEY } from '../../settings.ts'
import { injectTimelineCss } from './legacy-rail-css.ts'
import type { TimelineEntry, TimelineSessionsService } from './types.ts'

if (typeof document !== 'undefined') injectTimelineCss()

/** Composer height assumed when neither the seat nor the kernel's own var is available. */
const FALLBACK_COMPOSER_PX = 152
/** The official stylesheet's own ceiling and band deduction. */
const RAIL_MAX_HEIGHT_PX = 420
const RAIL_BAND_DEDUCTION_PX = 64
/** How often the rail's host band and offset are re-measured. */
const MEASURE_INTERVAL_MS = 400

/** Component props delivered by the dock slot registration. */
export interface LegacyTimelineRailProps {
  sessionId?: string
  sessionsService?: TimelineSessionsService
  /** Framework projection reader (SessionStandardProps seat; undefined-capable). */
  useProjection?: (key: string) => unknown
  /** Whether the persisted timeline toggle is on. */
  enabled: boolean
  /** Locale lookup; the rail's copy interpolates a `{turn}` placeholder. */
  t: (key: string, params?: Record<string, string | number>) => string
}

/** Read one px-valued custom property off an element (undefined when absent). */
function cssPx(el: HTMLElement, name: string): number | undefined {
  const raw = el.style.getPropertyValue(name)
  if (raw === '') return undefined
  const px = Number.parseFloat(raw)
  return Number.isFinite(px) ? px : undefined
}

/**
 * The band the rail may occupy: the transcript the reader actually sees, i.e.
 * the scrollport minus the sticky composer stack — the official measurement,
 * taken from the kernel's own vars when it publishes them (0.1.2+) and from
 * the composer seat otherwise.
 * @param sp - the conversation scrollport.
 */
function bandOf(sp: HTMLElement): number {
  const viewport = cssPx(sp, '--dsh-conversation-viewport-height') ?? sp.clientHeight
  const seat = sp.querySelector<HTMLElement>('[data-composer-seat]')
  const composer = cssPx(sp, '--dsh-composer-height') ?? seat?.offsetHeight ?? FALLBACK_COMPOSER_PX
  return Math.max(0, Math.min(RAIL_MAX_HEIGHT_PX, viewport - composer - RAIL_BAND_DEDUCTION_PX))
}

/** Tick metrics for one count, mirroring the official `railSize`. */
function railSize(count: number): react.CSSProperties {
  return {
    ['--dsbt-natural-h' as string]: `${(count - 1) * TICK_SPACING_PX + 2 * RAIL_INSET_PX}px`,
    ['--dsbt-inset' as string]: `${RAIL_INSET_PX}px`,
  }
}

/** Position of one tick, mirroring the official `itemPosition`. */
function tickPosition(index: number, count: number): react.CSSProperties {
  const ratio = count <= 1 ? 0 : index / (count - 1)
  return {
    ['--dsbt-natural' as string]: `${index * TICK_SPACING_PX}px`,
    ['--dsbt-ratio' as string]: `${ratio * 100}%`,
  }
}

/**
 * The legacy turn rail.
 * @param props - dock slot props plus the enabled gate.
 * @returns the portaled rail, or null when it must not render.
 */
export function LegacyTimelineRail(props: LegacyTimelineRailProps): react.ReactElement | null {
  const { sessionId, sessionsService, useProjection, enabled, t } = props

  const session = sessionId !== undefined && sessionsService !== undefined
    ? sessionsService.binding(sessionId)?.session
    : undefined
  // SessionFace methods are prototype methods reading "this"; React invokes
  // store callbacks as bare functions, so keep the receiver via closures.
  // Identity stays stable per session so uSES does not resubscribe per render.
  const subscribeSession = react.useCallback(
    (listener: () => void) => session === undefined ? () => {} : session.subscribe(listener),
    [session],
  )
  const snapshotSession = react.useCallback(
    () => session === undefined ? undefined : session.getSnapshot(),
    [session],
  )
  const nodeSnapshot = react.useSyncExternalStore(subscribeSession, snapshotSession)

  const projected = useProjection === undefined ? undefined : useProjection(TIMELINE_PROJECTION_KEY)
  const entries = react.useMemo(() => railMessages(nodeSnapshot, projected), [nodeSnapshot, projected])

  const [activeIndex, setActiveIndex] = react.useState(-1)
  const [previewIndex, setPreviewIndex] = react.useState(-1)
  const [rightOffset, setRightOffset] = react.useState(16)
  const [band, setBand] = react.useState(RAIL_MAX_HEIGHT_PX)
  const aliveRef = react.useRef(true)
  const warmingRef = react.useRef(false)
  const railRef = react.useRef<HTMLElement | null>(null)

  react.useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const entriesRef = react.useRef(entries)
  entriesRef.current = entries

  // Reading position: the entry nearest the 40% line of the scrollport.
  react.useEffect(() => {
    if (entries.length === 0) return
    const indexByKey = new Map<string, number>()
    entries.forEach((entry, index) => {
      if (entry.anchorKey !== undefined) indexByKey.set(entry.anchorKey, index)
    })
    const sp = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (sp === null) return
    const rows = sp.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')
    let frame = 0
    const measure = (): void => {
      frame = 0
      const rect = sp.getBoundingClientRect()
      if (rect.height === 0) return
      const line = rect.top + rect.height * 0.4
      let best = -1
      let bestDist = Infinity
      for (const row of rows) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null) continue
        const index = indexByKey.get(key)
        if (index === undefined) continue
        const r = row.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - line)
        if (dist < bestDist) {
          bestDist = dist
          best = index
        }
      }
      setActiveIndex(best)
    }
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }
    sp.addEventListener('scroll', schedule, { passive: true })
    const timer = window.setInterval(schedule, 2000)
    schedule()
    return () => {
      sp.removeEventListener('scroll', schedule)
      window.clearInterval(timer)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [entries])

  // Band and right offset follow the live conversation geometry.
  react.useEffect(() => {
    let raf = 0
    const measure = (): void => {
      raf = 0
      const sp = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      if (sp === null) return
      const rect = sp.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      setBand(bandOf(sp))
      const next = Math.max(8, Math.round(window.innerWidth - rect.right + 12))
      setRightOffset((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    const schedule = (): void => {
      if (raf === 0) raf = window.requestAnimationFrame(measure)
    }
    const sp = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const ro = typeof ResizeObserver === 'function' && sp !== null ? new ResizeObserver(schedule) : null
    if (ro !== null && sp !== null) ro.observe(sp)
    window.addEventListener('resize', schedule)
    const timer = window.setInterval(schedule, MEASURE_INTERVAL_MS)
    measure()
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      window.clearInterval(timer)
    }
  }, [])

  const navigate = react.useCallback((entry: TimelineEntry): void => {
    if (entry.anchorKey === undefined) return
    if (sessionsService === undefined || sessionId === undefined) return
    void jumpToMessage(sessionsService, sessionId, entry.anchorKey, {
      followZonePx: LEGACY_FOLLOW_ZONE_PX,
    }).catch(() => {})
  }, [sessionsService, sessionId])

  // Warm-up: page older history in up to the rail's uncompressed capacity so
  // turns behind "load earlier" become reachable. Triggered by the reader
  // reaching for the rail, never on open.
  const warm = react.useCallback(async (): Promise<void> => {
    if (session === undefined) return
    if (warmingRef.current) return
    const sp = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (sp === null) return
    warmingRef.current = true
    try {
      await warmHistory(session, sp, {
        followZonePx: LEGACY_FOLLOW_ZONE_PX,
        alive: () => aliveRef.current,
        countOf: () => entriesRef.current.length,
        capacity: railCapacityOf(railRef.current),
      })
    } finally {
      warmingRef.current = false
    }
  }, [session])

  // The official rail renders from two turns; a lone question has nothing to
  // navigate between.
  if (!enabled || sessionId === undefined || sessionsService === undefined || entries.length < 2) {
    return null
  }

  const count = entries.length
  const preview = previewIndex >= 0 && previewIndex < count ? entries[previewIndex] : undefined

  return reactDom.createPortal(
    <div className="dsbt-slot" style={{ right: rightOffset }}>
      <nav
        className="dsbt-rail"
        ref={railRef}
        style={{ ...railSize(count), ['--dsbt-band' as string]: `${band}px` }}
        aria-label={t('timeline.railLabel')}
        onPointerMove={(event) => {
          setPreviewIndex(indexAtPointer(count, event.currentTarget, event.clientY))
        }}
        onPointerLeave={() => { setPreviewIndex(-1) }}
        onPointerEnter={() => { void warm() }}
        onFocus={() => { void warm() }}
        onClick={(event) => {
          const index = indexForEvent(event.currentTarget, event.nativeEvent)
          const entry = entries[index]
          if (entry !== undefined) navigate(entry)
        }}
      >
        <div className="dsbt-marks">
          {entries.map((entry, index) => {
            const active = index === activeIndex
            const showingPreview = index === previewIndex
            const cls = active
              ? 'dsbt-mark dsbt-markActive'
              : showingPreview ? 'dsbt-mark dsbt-markPreview' : 'dsbt-mark'
            return (
              <div key={entry.seq} className="dsbt-markPosition" style={tickPosition(index, count)}>
                <button
                  type="button"
                  className={cls}
                  disabled={entry.anchorKey === undefined}
                  aria-label={t('timeline.jump', { turn: index + 1 })}
                  aria-current={active ? 'true' : undefined}
                  onFocus={() => { setPreviewIndex(index) }}
                  onBlur={() => { setPreviewIndex(-1) }}
                />
              </div>
            )
          })}
        </div>
        {preview !== undefined && (
          <div
            role="tooltip"
            className="dsbt-preview"
            style={tickPosition(previewIndex, count)}
          >
            {preview.text === '' ? t('timeline.noText') : preview.text}
          </div>
        )}
      </nav>
    </div>,
    document.body,
  )
}
