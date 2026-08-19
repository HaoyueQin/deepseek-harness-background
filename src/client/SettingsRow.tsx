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
  BACKGROUND_API_PREFIX, DEFAULT_FIT, FIT_MODES, type BackgroundFit,
  type BackgroundSettings,
} from '../settings.ts'
import { clearPreviewSurface, paintBackground, paintPreviewSurface } from './backdrop.ts'
import { settingsClient, type SettingsSnapshot } from './settings-client.ts'
import css from './SettingsRow.module.css'

/** Full component props: runtime share + locale seat. */
export type BackgroundRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'ui-background'>

/** Defaults mirror the host schema (also the pre-load draft fallback). */
const DEFAULTS: BackgroundSettings = {
  enabled: false,
  uploadId: '',
  url: '',
  opacity: 1,
  scrim: 0.25,
  panelOpacity: 0.15,
  blur: 16,
  wallpaperBlur: 0,
  fit: DEFAULT_FIT,
}

/** The numeric field keys a slider edits. */
type NumField = 'opacity' | 'scrim' | 'panelOpacity' | 'blur' | 'wallpaperBlur'

/** Per-field slider geometry: 5% steps for ratios, coarse px steps for radii. */
const SLIDER_SPEC: Record<NumField, { min: number; max: number; step: number; unit: 'percent' | 'px' }> = {
  opacity: { min: 0, max: 1, step: 0.05, unit: 'percent' },
  scrim: { min: 0, max: 0.95, step: 0.05, unit: 'percent' },
  panelOpacity: { min: 0, max: 1, step: 0.05, unit: 'percent' },
  blur: { min: 0, max: 40, step: 2, unit: 'px' },
  wallpaperBlur: { min: 0, max: 60, step: 5, unit: 'px' },
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

/**
 * The background settings row. A draft mirrors the persisted section; dragging
 * repaints the preview card and the live backdrop through CSS variables, and a
 * release commits once through the plugin's own host route.
 */
export function BackgroundSettingsRow({ t }: BackgroundRowProps) {
  const snapshot = useSyncExternalStore(settingsClient.subscribe, readSnapshot)
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
    paintLive(next)
  }, [markEditing, paintLive])

  /** Persist one section through the host route and adopt it on success. */
  const saveNow = useCallback(async (next: BackgroundSettings): Promise<void> => {
    const ok = await settingsClient.save(next)
    setError(ok ? '' : t('background.saveFailed'))
    if (ok) {
      lastSavedRef.current = next
      draftRef.current = next
      setDraft(next)
      if (!next.uploadId) setUrlText(next.url)
    }
  }, [t])

  /** Debounced commit: one POST per drag gesture, from the latest draft. */
  const onCommit = useCallback((): void => {
    clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => { void saveNow(draftRef.current) }, 120)
  }, [saveNow])

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

  // Teardown: clear the debounce timers when the row unmounts.
  useEffect(() => () => {
    clearTimeout(commitTimer.current)
    clearTimeout(editingTimer.current)
  }, [])

  const handleFile = async (file?: File): Promise<void> => {
    if (!file) return
    markEditing()
    setUploading(true)
    setError('')
    try {
      const url = await settingsClient.upload(file, false)
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
      setError(t('background.saveFailed'))
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

  const sourceUrl = draft.uploadId ? `${BACKGROUND_API_PREFIX}/image/${draft.uploadId}` : draft.url
  const hasImage = sourceUrl !== ''

  return (
    <div className={css.row}>
      <div className={css.header}>
        <div className={css.title}>{t('background.title')}</div>
        <div className={css.desc}>{t('background.description')}</div>
      </div>

      {/* Live preview surface: image + theme-aware scrim + frosted glass bubble. */}
      <div className={css.preview} ref={previewRef}>
        {hasImage
          ? (
            <>
              <img className={css.previewImg} src={sourceUrl} alt="" draggable={false} />
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
          <span className={css.hint}>{t('background.uploadMinetypes')}</span>
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
