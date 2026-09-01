/**
 * Background settings row — the editable form rendered inside the General
 * settings section (`settings.general.item` slot), in the same visual area as
 * the official Appearance row. Layout mirrors the reference wallpaper engine
 * picker (preview surface + grouped sections), styled with the harness alias
 * tokens so it reads as part of the settings chrome.
 *
 * Interaction model (fixes the previous jank):
 *  - Sliders STEP in 5% (or 2px/5px) increments, so dragging snaps between
 *    discrete values instead of firing dozens of sub-percent updates.
 *  - While dragging, only the CSS variables change: the slider holds its own
 *    state (no parent re-render) and the preview card repaints in isolation.
 *    React's onChange maps to the native `input` event and would fire on every
 *    step, so a commit is deferred to release (pointerup / keyup / blur) and
 *    debounced — one POST per gesture, never per tick.
 *  - A `lastSavedRef` distinguishes our own saves from external changes, so
 *    the snapshot sync can never clobber a draft the user is still editing.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import {
  BACKGROUND_API_PREFIX, BLUR_MAX, BLUR_MIN, DEFAULT_BLUR, DEFAULT_FIT,
  DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM, DEFAULT_TIMELINE,
  DEFAULT_WALLPAPER_BLUR, FIT_MODES, OPACITY_MAX, OPACITY_MIN, PANEL_OPACITY_MAX,
  PANEL_OPACITY_MIN, SCRIM_MAX, SCRIM_MIN, WALLPAPER_BLUR_MAX, type BackgroundFit,
  type BackgroundSettings,
} from '../settings.ts'
import { clearPreviewSurface, paintBackground, paintBackgroundKnob, paintPreviewSurface } from './backdrop.ts'
import { settingsClient, type SettingsSnapshot } from './settings-client.ts'
import { subscribeTimelineMode, timelineMode } from './timeline/mode-store.ts'
import css from './SettingsRow.module.css'

/** Full component props: runtime share + locale seat. */
export type BackgroundRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'ui-background'>

/** Defaults mirror the host schema (also the pre-load draft fallback). */
const DEFAULTS: BackgroundSettings = {
  enabled: false,
  uploadId: '',
  url: '',
  opacity: DEFAULT_OPACITY,
  scrim: DEFAULT_SCRIM,
  panelOpacity: DEFAULT_PANEL_OPACITY,
  blur: DEFAULT_BLUR,
  wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
  fit: DEFAULT_FIT,
  timeline: DEFAULT_TIMELINE,
}

/** The numeric field keys a slider edits. */
type NumField = 'opacity' | 'scrim' | 'panelOpacity' | 'blur' | 'wallpaperBlur'

/** Per-field slider geometry: 5% steps for ratios, fine px steps for radii so
 * the two blur sliders feel smooth near small values. Bounds come from the
 * shared settings constants so the schema boundary and the UI cannot drift. */
const SLIDER_SPEC: Record<NumField, { min: number; max: number; step: number; unit: 'percent' | 'px' }> = {
  opacity: { min: OPACITY_MIN, max: OPACITY_MAX, step: 0.05, unit: 'percent' },
  scrim: { min: SCRIM_MIN, max: SCRIM_MAX, step: 0.05, unit: 'percent' },
  panelOpacity: { min: PANEL_OPACITY_MIN, max: PANEL_OPACITY_MAX, step: 0.05, unit: 'percent' },
  blur: { min: BLUR_MIN, max: BLUR_MAX, step: 1, unit: 'px' },
  wallpaperBlur: { min: BLUR_MIN, max: WALLPAPER_BLUR_MAX, step: 2, unit: 'px' },
}

/** Derive the bare upload id from a resolve url like /api/bg-wallpaper/image/<id>. */
function stripId(url: string): string {
  const prefix = `${BACKGROUND_API_PREFIX}/image/`
  return url.startsWith(prefix) ? url.slice(prefix.length) : ''
}

/** Read the settings store (uSES-friendly). */
function readSnapshot(): SettingsSnapshot {
  return settingsClient.getSnapshot()
}

/** Field-wise equality for distinguishing our own saves from external changes. */
function sameSettings(a: BackgroundSettings, b: BackgroundSettings): boolean {
  return a.enabled === b.enabled && a.uploadId === b.uploadId && a.url === b.url
    && a.opacity === b.opacity && a.scrim === b.scrim && a.panelOpacity === b.panelOpacity
    && a.blur === b.blur && a.wallpaperBlur === b.wallpaperBlur && a.fit === b.fit
    && a.timeline === b.timeline
}

/**
 * A stepped range control. While dragging it re-renders only itself: the value
 * is local state, `onLive(name, value)` repaints (CSS variables, no React
 * state), and `onCommit()` fires once on release through a debounced save.
 */
function ControlSlider(props: {
  name: NumField
  label: string
  value: number
  onLive: (name: NumField, value: number) => void
  onCommit: () => void
}) {
  const { name, label, value, onLive, onCommit } = props
  const spec = SLIDER_SPEC[name]
  const [local, setLocal] = useState(value)
  const localRef = useRef(value)
  const dragging = useRef(false)
  const onLiveRef = useRef(onLive)
  const onCommitRef = useRef(onCommit)
  onLiveRef.current = onLive
  onCommitRef.current = onCommit

  // Adopt an external value (load / save) when not mid-drag.
  useEffect(() => {
    if (!dragging.current && localRef.current !== value) {
      localRef.current = value
      setLocal(value)
    }
  }, [value])

  const handleLive = (e: ChangeEvent<HTMLInputElement>): void => {
    dragging.current = true
    const v = Number(e.currentTarget.value)
    localRef.current = v
    setLocal(v)
    syncTrackFill(e.currentTarget)
    onLiveRef.current(name, v)
  }

  const handleCommit = (): void => {
    if (!dragging.current) return
    dragging.current = false
    onCommitRef.current()
  }

  const text = spec.unit === 'percent'
    ? `${Math.round(local * 100)}%`
    : `${local}px`

  return (
    <div className={css.sliderRow}>
      <span className={css.sliderLabel}>{label}</span>
      <input
        type="range"
        className={css.slider}
        ref={(el) => {
          // Sync the "filled" track fraction on mount and on every external
          // value adoption (the webkit track reads --bg-fill; moz draws its
          // own ::-moz-range-progress).
          if (el) syncTrackFill(el)
        }}
        min={spec.min} max={spec.max} step={spec.step}
        value={String(local)}
        aria-label={label}
        onInput={handleLive}
        onPointerUp={handleCommit}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End'
            || e.key === 'PageUp' || e.key === 'PageDown') handleCommit()
        }}
        onBlur={handleCommit}
      />
      <span className={css.sliderValue}>{text}</span>
    </div>
  )
}

/** Write the filled-track fraction (%) of a range input into its --bg-fill
 * variable (webkit has no range-progress pseudo-element; moz draws its own). */
function syncTrackFill(el: HTMLInputElement): void {
  const min = Number(el.min)
  const max = Number(el.max)
  const value = Number(el.value)
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  el.style.setProperty('--bg-fill', `${pct}%`)
}

/**
 * The background settings row. A draft mirrors the persisted section; dragging
 * repaints the preview card and the live backdrop through CSS variables, and a
 * release commits once through the plugin's own host route.
 */
export function BackgroundSettingsRow({ t }: BackgroundRowProps) {
  const snapshot = useSyncExternalStore(settingsClient.subscribe, readSnapshot)
  // Which timeline frontend is live: this row has no session scope and cannot
  // probe the kernel itself, so it reads what the dock entry detected.
  const navMode = useSyncExternalStore(subscribeTimelineMode, timelineMode)
  const timelineLabelKey = navMode === 'legacy'
    ? 'background.timeline'
    : 'background.timelineEnhance'
  const timelineHintKey = navMode === 'narrow'
    ? 'background.timelineEnhanceNarrowHint'
    : navMode === 'enhance'
      ? 'background.timelineEnhanceHint'
      : 'background.timelineHint'
  const [draft, setDraft] = useState<BackgroundSettings>(DEFAULTS)
  const [uploading, setUploading] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  // The latest draft, read by every handler (never a stale closure).
  const draftRef = useRef<BackgroundSettings>(DEFAULTS)
  // True while a drag/gesture is in flight: hold off snapshot sync.
  const editingRef = useRef(false)
  // The last section this row saved; external changes are snapshots that differ.
  const lastSavedRef = useRef<BackgroundSettings | null>(null)
  // True while an edit has not yet reached the host (drives flush-on-unmount).
  const dirtyRef = useRef(false)
  const commitTimer = useRef<number | undefined>(undefined)
  const editingTimer = useRef<number | undefined>(undefined)

  /** Repaint the live backdrop + preview card from one draft (no React state). */
  const paintLive = useCallback((next: BackgroundSettings): void => {
    paintBackground(next)
    if (previewRef.current) paintPreviewSurface(previewRef.current, next)
  }, [])

  /** Mark the row as being edited; clears after a quiet 600ms window. */
  const markEditing = useCallback((): void => {
    editingRef.current = true
    clearTimeout(editingTimer.current)
    editingTimer.current = window.setTimeout(() => { editingRef.current = false }, 600)
  }, [])

  /** Slider live handler (stable identity for the memoized sliders). */
  const onLive = useCallback((key: NumField, value: number): void => {
    const next = { ...draftRef.current, [key]: value }
    draftRef.current = next
    markEditing()
    // Hot path: every knob repaints through the painter's single-variable
    // writer (no DOM layer churn); panelOpacity goes through the knob path
    // too — it repaints only the glass surface tokens instead of re-running
    // the full apply.
    paintBackgroundKnob(key, value)
    if (previewRef.current) paintPreviewSurface(previewRef.current, next)
  }, [markEditing])

  /** Persist one section through the host route and adopt it on success. */
  const saveNow = useCallback(async (next: BackgroundSettings): Promise<void> => {
    dirtyRef.current = true
    const result = await settingsClient.save(next)
    if (result === 'failed') {
      // A failed save has settled (no in-flight write left to flush), so the
      // dirty flag must drop with it — keeping it would make the unmount
      // flush wait for a long-settled promise and re-run saveNow on a draft
      // the host already rejected.
      dirtyRef.current = false
      setError(t('background.saveFailed'))
      return
    }
    // A superseded save lost to a newer in-flight one, which now owns BOTH
    // the snapshot adoption and the dirty flag (cleared when IT commits).
    // Clearing the flag here would strand that write, and adopting this
    // response would resurrect an outdated section — so keep it set.
    if (result === 'superseded') return
    dirtyRef.current = false
    setError('')
    lastSavedRef.current = next
    draftRef.current = next
    setDraft(next)
    if (!next.uploadId) setUrlText(next.url)
  }, [t])

  // The latest saveNow, readable from stable callbacks and the unmount
  // cleanup (never a stale closure).
  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow

  /** Debounced commit: one POST per drag gesture, from the latest draft. */
  const onCommit = useCallback((): void => {
    clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => {
      // Reset before saving: a fired timer must never look like an armed one,
      // or the unmount flush would re-save an already-committed gesture.
      commitTimer.current = undefined
      void saveNowRef.current(draftRef.current)
    }, 120)
  }, [])

  // Sync the draft from the persisted value when it changes externally, but
  // never overwrite a draft the user is mid-editing.
  useEffect(() => {
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    const saved = lastSavedRef.current
    const external = saved === null || !sameSettings(saved, snapshot.value)
    if (external && !editingRef.current) {
      lastSavedRef.current = snapshot.value
      draftRef.current = snapshot.value
      setDraft(snapshot.value)
      setUrlText(snapshot.value.uploadId ? '' : snapshot.value.url)
      if (previewRef.current) paintPreviewSurface(previewRef.current, snapshot.value)
    }
  }, [snapshot])

  // Teardown: a pending debounced commit must not die with the row. If the
  // timer is still armed, fire the save NOW (the timer callback would never
  // run after unmount, and dirtyRef is only set inside saveNow — clearing
  // the timer alone would silently drop the last slider adjustment). Then
  // wait out any save already in flight. The effect runs once per mount:
  // saveNow is reached through its ref, so an identity change mid-session
  // cannot re-trigger this teardown, and editingRef is reset so a cleared
  // editing window can never block snapshot sync forever.
  useEffect(() => () => {
    clearTimeout(editingTimer.current)
    editingRef.current = false
    if (commitTimer.current !== undefined) {
      clearTimeout(commitTimer.current)
      commitTimer.current = undefined
      void saveNowRef.current(draftRef.current)
    }
    if (dirtyRef.current) void settingsClient.flush()
  }, [])

  const handleFile = async (file?: File): Promise<void> => {
    if (!file) return
    markEditing()
    setUploading(true)
    setError('')
    try {
      const url = await settingsClient.upload(file)
      if (url === null) {
        setError(t('background.uploadFailed'))
        return
      }
      const next: BackgroundSettings = { ...draftRef.current, uploadId: stripId(url), url: '', enabled: true }
      draftRef.current = next
      setDraft(next)
      setUrlText('')
      paintLive(next)
      await saveNow(next)
    } finally {
      setUploading(false)
    }
  }

  const handleUrlSubmit = (): void => {
    const url = urlText.trim()
    if (!/^https?:\/\//i.test(url)) {
      setError(t('background.invalidUrl'))
      return
    }
    markEditing()
    const next: BackgroundSettings = { ...draftRef.current, uploadId: '', url, enabled: true }
    draftRef.current = next
    setDraft(next)
    paintLive(next)
    void saveNow(next)
  }

  const handleClear = (): void => {
    const next: BackgroundSettings = { ...draftRef.current, uploadId: '', url: '', enabled: false }
    draftRef.current = next
    setDraft(next)
    setUrlText('')
    if (previewRef.current) clearPreviewSurface(previewRef.current)
    paintBackground(next)
    void saveNow(next)
  }

  const handleFit = (mode: BackgroundFit): void => {
    markEditing()
    const next: BackgroundSettings = { ...draftRef.current, fit: mode }
    draftRef.current = next
    setDraft(next)
    paintLive(next)
    void saveNow(next)
  }

  const handleTimelineToggle = (): void => {
    markEditing()
    const next: BackgroundSettings = { ...draftRef.current, timeline: !draftRef.current.timeline }
    draftRef.current = next
    setDraft(next)
    // The rail reads the shared snapshot itself; no painter repaint needed.
    void saveNow(next)
  }

  const sourceUrl = draft.uploadId ? `${BACKGROUND_API_PREFIX}/image/${draft.uploadId}` : draft.url
  const hasImage = sourceUrl !== ''

  return (
    <div className={css.row}>
      <div className={css.header}>
        <div className={css.titleRow}>
          <div className={css.title}>{t('background.title')}</div>
          {hasImage && (
            <button type="button" className={clsx(css.btn, css.btnDanger, css.clearBtn)} onClick={handleClear}>
              {t('background.clear')}
            </button>
          )}
        </div>
        <div className={css.desc}>{t('background.description')}</div>
      </div>

      {/* Live preview surface: image + theme-aware scrim + frosted glass bubble. */}
      <div className={css.preview} ref={previewRef}>
        {hasImage
          ? (
            <>
              <img className={css.previewImg} src={sourceUrl} alt="" draggable={false} referrerPolicy="no-referrer" />
              <div className={css.previewScrim} />
              <div className={css.previewGlass}>
                <span className={css.previewGlassText}>{t('background.previewGlass')}</span>
              </div>
            </>
          )
          : (
            <div className={css.previewEmpty}>{t('background.noPreview')}</div>
          )}
      </div>

      {/* Image source: upload or paste an http(s) link. */}
      <div className={css.section}>
        <div className={css.sectionLabel}>{t('background.source')}</div>
        <div className={css.sourceRow}>
          <input
            type="file"
            ref={fileInput}
            hidden
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => {
              void handleFile(e.currentTarget.files?.[0])
              e.currentTarget.value = ''
            }}
          />
          <button
            type="button"
            className={clsx(css.btn, css.btnPrimary)}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? t('background.uploading') : t('background.upload')}
          </button>
          <span className={css.hint}>{t('background.uploadMediaTypes')}</span>
          {draft.uploadId && <span className={css.enabledBadge}>✓ {t('background.enabled')}</span>}
        </div>
        <div className={css.urlRow}>
          <input
            className={css.urlInput}
            value={urlText}
            placeholder={t('background.urlPlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUrlSubmit() }}
            onChange={(e) => setUrlText(e.currentTarget.value)}
          />
          <button
            type="button"
            className={css.btn}
            disabled={!urlText.trim()}
            onClick={handleUrlSubmit}
          >
            {t('background.applyUrl')}
          </button>
        </div>
      </div>

      {/* Effects: stepped sliders + fit segmented control. */}
      <div className={css.section}>
        <div className={css.sectionLabel}>{t('background.effects')}</div>
        <ControlSlider name="opacity" label={t('background.opacity')} value={draft.opacity} onLive={onLive} onCommit={onCommit} />
        <ControlSlider name="scrim" label={t('background.scrim')} value={draft.scrim} onLive={onLive} onCommit={onCommit} />
        <ControlSlider name="panelOpacity" label={t('background.panelOpacity')} value={draft.panelOpacity} onLive={onLive} onCommit={onCommit} />
        <ControlSlider name="blur" label={t('background.blur')} value={draft.blur} onLive={onLive} onCommit={onCommit} />
        <ControlSlider name="wallpaperBlur" label={t('background.wallpaperBlur')} value={draft.wallpaperBlur} onLive={onLive} onCommit={onCommit} />
        <div className={css.segRow}>
          <span className={css.segLabel}>{t('background.fit')}</span>
          <div className={css.segGroup} role="group" aria-label={t('background.fit')}>
            {FIT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={clsx(css.segBtn, draft.fit === mode && css.segActive)}
                onClick={() => handleFit(mode)}
              >
                {t(mode === 'cover' ? 'background.cover' : 'background.contain')}
              </button>
            ))}
          </div>
        </div>
        <div className={css.segRow}>
          <span className={css.segLabel}>{t(timelineLabelKey)}</span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.timeline}
            aria-label={t(timelineLabelKey)}
            title={t(timelineHintKey)}
            className={css.switch}
            onClick={handleTimelineToggle}
          >
            <span className={css.switchKnob} />
          </button>
          <span className={css.hint}>{t(timelineHintKey)}</span>
        </div>
      </div>

      {error && <div className={css.error} role="alert">{error}</div>}

      {hasImage && (
        <div className={css.clearRow}>
          <button type="button" className={clsx(css.btn, css.btnDanger)} onClick={handleClear}>
            {t('background.clear')}
          </button>
        </div>
      )}
    </div>
  )
}
