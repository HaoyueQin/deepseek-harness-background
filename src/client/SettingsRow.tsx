/**
 * Background settings row — the editable form rendered inside the General
 * settings section (`settings.general.item` slot), in the same visual area as
 * the official Appearance row. Live-preview sliders write the draft straight
 * to the painter; commits persist through the plugin's own host route.
 */

import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BACKGROUND_API_PREFIX, DEFAULT_BLUR, DEFAULT_FIT, DEFAULT_OPACITY,
  DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM, FIT_MODES, type BackgroundFit,
  type BackgroundSettings,
} from '../settings.ts'
import { paintBackground } from './backdrop.ts'
import { settingsClient, type SettingsSnapshot } from './settings-client.ts'

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
  wallpaperBlur: 0,
  fit: DEFAULT_FIT,
}

/** The numeric field keys a slider edits. */
type NumField = 'opacity' | 'scrim' | 'panelOpacity' | 'blur' | 'wallpaperBlur'

/** Derive the bare upload id from a resolve url like /api/bg-wallpaper/image/<id>. */
function stripId(url: string): string {
  const prefix = `${BACKGROUND_API_PREFIX}/image/`
  return url.startsWith(prefix) ? url.slice(prefix.length) : ''
}

/** Read the settings store (uSES-friendly). */
function readSnapshot(): SettingsSnapshot {
  return settingsClient.getSnapshot()
}

/**
 * The live-preview settings row. A local draft mirrors the persisted section;
 * dragging any slider repaints the draft immediately (via `paintBackground`),
 * while the persisted snapshot only updates once the user finishes / saves.
 *
 * Concurrency handling: `draftRef` always holds the latest draft so handlers
 * never read a stale closure value, and `busyRef` tracks in-flight edits so
 * the `useEffect` snapshot sync does not clobber a draft the user is actively
 * dragging.
 */
export function BackgroundSettingsRow({ t }: BackgroundRowProps) {
  const snapshot = useSyncExternalStore(settingsClient.subscribe, readSnapshot)
  const [draft, setDraft] = useState<BackgroundSettings>(DEFAULTS)
  const [uploading, setUploading] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const draftRef = useRef<BackgroundSettings>(DEFAULTS)
  // True while the user is mid-edit (dragging/uploading): hold off snapshot sync.
  const busyRef = useRef(false)

  /** Synchronize both state and ref; repaint live. */
  const updateDraft = (next: BackgroundSettings): void => {
    const withEnabled = { ...next, enabled: true }
    draftRef.current = withEnabled
    setDraft(withEnabled)
    paintBackground(withEnabled)
  }

  /** Set the draft without enabling (used by Clear) and repaint. */
  const overrideDraft = (next: BackgroundSettings): void => {
    busyRef.current = true
    draftRef.current = next
    setDraft(next)
    paintBackground(next)
  }

  /** Persist the current ref draft; on success adopt the server value as draft. */
  const commit = async (source?: BackgroundSettings): Promise<void> => {
    const section = source ?? draftRef.current
    const ok = await settingsClient.save(section)
    busyRef.current = false
    setError(ok ? '' : t('background.saveFailed'))
    if (ok) {
      // Adopt the just-saved value so it never regress against a stale snapshot.
      draftRef.current = section
      setDraft(section)
      if (!section.uploadId) setUrlText(section.url)
    }
  }

  // Sync the draft from the persisted value when it changes externally, but
  // never overwrite a draft the user is mid-editing.
  useEffect(() => {
    if (snapshot.status === 'ready' && snapshot.value && !busyRef.current) {
      draftRef.current = snapshot.value
      setDraft(snapshot.value)
      setUrlText(snapshot.value.uploadId ? '' : snapshot.value.url)
    }
  }, [snapshot])

  /** Apply one numeric draft change and commit on release. */
  const setNum = (key: NumField, value: number, commitOnRelease: boolean): void => {
    const next = { ...draftRef.current, [key]: value }
    updateDraft(next)
    if (commitOnRelease) void commit(next)
  }

  /** Slider helper: live preview on onInput, persist on release (onChange). */
  const slider = (key: NumField, min: number, max: number, label: string): ReactNode => {
    const value = (draft[key] as number) ?? 0
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ minWidth: 88 }}>{label}</span>
        <input
          type="range"
          min={min} max={max} step="0.01"
          value={String(value)}
          onInput={(e) => setNum(key, Number(e.currentTarget.value), false)}
          onChange={(e) => setNum(key, Number(e.currentTarget.value), true)}
        />
        <span style={{ minWidth: 34, textAlign: 'right' }}>{key === 'opacity' || key === 'scrim' || key === 'panelOpacity' ? `${Math.round(value * 100)}%` : `${Math.round(value)}px`}</span>
      </div>
    )
  }

  const handleFile = async (file?: File): Promise<void> => {
    if (!file) return
    busyRef.current = true
    setUploading(true)
    setError('')
    try {
      const url = await settingsClient.upload(file, false)
      if (url === null) {
        setError(t('background.uploadFailed'))
        return
      }
      const next: BackgroundSettings = { ...draftRef.current, uploadId: stripId(url), url: '' }
      updateDraft(next)
      await commit(next)
      setUrlText('')
    } finally {
      busyRef.current = false
      setUploading(false)
    }
  }

  const handleUrlSubmit = (): void => {
    const url = urlText.trim()
    if (!/^https?:\/\//i.test(url)) {
      setError(t('background.saveFailed'))
      return
    }
    const next: BackgroundSettings = { ...draftRef.current, uploadId: '', url }
    updateDraft(next)
    void commit(next)
  }

  const handleClear = (): void => {
    const next: BackgroundSettings = { ...draftRef.current, uploadId: '', url: '', enabled: false }
    overrideDraft(next)
    void commit(next)
  }

  const fitRow = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ minWidth: 88 }}>{t('background.fit')}</span>
      {FIT_MODES.map((mode) => (
        <button key={mode} onClick={() => {
          const next = { ...draftRef.current, fit: mode as BackgroundFit }
          updateDraft(next)
          void commit(next)
        }} style={{ opacity: draft.fit === mode ? 1 : 0.5 }}>
          {t(mode === 'cover' ? 'background.cover' : 'background.contain')}
        </button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0', width: '100%' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="file"
          ref={fileInput}
          hidden
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => void handleFile(e.currentTarget.files?.[0])}
        />
        <button onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? t('background.uploading') : t('background.upload')}
        </button>
        <span style={{ opacity: 0.6, marginLeft: 4 }}>{t('background.uploadMinetypes')}</span>
        {draft.uploadId && (
          <span style={{ opacity: 0.8 }}>✓ {t('background.enabled')}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={urlText}
          placeholder={t('background.urlPlaceholder')}
          onKeyDown={(e) => { if (e.key === 'Enter') handleUrlSubmit() }}
          onChange={(e) => setUrlText(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button onClick={handleUrlSubmit} disabled={!urlText.trim()}>
          {t('background.applyUrl')}
        </button>
      </div>

      {slider('opacity', 0, 1, t('background.opacity'))}
      {slider('scrim', 0, 0.95, t('background.scrim'))}
      {slider('panelOpacity', 0, 1, t('background.panelOpacity'))}
      {slider('blur', 0, 40, t('background.blur'))}
      {slider('wallpaperBlur', 0, 60, t('background.wallpaperBlur'))}
      {fitRow}

      {error && <span style={{ color: 'red' }}>{error}</span>}

      {(draft.uploadId || draft.url) && (
        <button onClick={handleClear}>{t('background.clear')}</button>
      )}
    </div>
  )
}

