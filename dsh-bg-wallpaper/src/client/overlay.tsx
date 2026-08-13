/**
 * Background settings overlay — the editable form for the `ui-background`
 * section, drawn by the plugin itself (registered into the `shell.overlay`
 * slot) because the api-proxy settings allowlist does not expose third-party
 * namespaces over the settings RPC. The overlay talks to the plugin's own
 * host route (`/api/bg-wallpaper/settings`) and shows a live preview of the
 * draft — what the user sees is exactly what the app paints.
 */

import { useEffect, useSyncExternalStore, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { backdropImage } from './backdrop.ts'
import { overlayStore } from './overlay-store.ts'
import { settingsClient } from './settings-client.ts'
import type { BackgroundSettings } from '../settings.ts'
import css from './overlay.module.css'

/** Full component props: runtime share + locale seat. */
export type BackgroundOverlayProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<'ui-background'>

/** Defaults mirror the host schema (also the pre-load draft fallback). */
const DEFAULTS: BackgroundSettings = {
  enabled: false,
  lightUrl: '',
  darkUrl: '',
  opacity: 1,
  scrim: 0.25,
  fit: 'cover',
}

/** Stable comparison so staged edits preview without touching the document. */
function shallowDirty(draft: BackgroundSettings, applied: BackgroundSettings): boolean {
  return (Object.keys(draft) as (keyof BackgroundSettings)[]).some(key => draft[key] !== applied[key])
}

/**
 * Render the settings overlay: a dim scrim over the whole app, a centered
 * panel with the live draft preview and the section controls.
 * @param props - locale copy.
 * @returns the overlay, or nothing while closed.
 */
export function BackgroundOverlay({ t }: BackgroundOverlayProps) {
  const open = useSyncExternalStore(overlayStore.subscribe, overlayStore.getSnapshot)
  const [applied, setApplied] = useState<BackgroundSettings | undefined>(undefined)
  const [draft, setDraft] = useState<BackgroundSettings>({ ...DEFAULTS })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  // Load the section when the overlay opens; follow external changes.
  useEffect(() => {
    if (!open) return
    void settingsClient.load().then(() => {
      const snapshot = settingsClient.getSnapshot()
      if (snapshot.status === 'ready' && snapshot.value !== undefined) {
        setApplied(snapshot.value)
        setDraft(snapshot.value)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })
  }, [open])

  if (!open) return null

  const dirty = applied === undefined || shallowDirty(draft, applied)
  const patch = (field: keyof BackgroundSettings, value: unknown): void => {
    setDraft(current => ({ ...current, [field]: value }))
    setFailed(false)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setFailed(false)
    const ok = await settingsClient.save(draft)
    if (ok) {
      setApplied({ ...draft })
    } else {
      setFailed(true)
    }
    setSaving(false)
  }

  const dark = document.body.dataset.dsDarkTheme !== undefined
  const previewStyle: React.CSSProperties = {
    backgroundImage: backdropImage(draft, dark),
    backgroundPosition: 'center',
    backgroundSize: draft.fit,
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat',
  }

  return (
    <div
      className={css.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) overlayStore.close()
      }}
    >
      <div className={css.panel} role="dialog" aria-label={t('background.title')}>
        <header className={css.panelHead}>
          <span className={css.panelTitle}>{t('background.title')}</span>
          <span className={css.panelDesc}>{t('background.description')}</span>
          <button type="button" className={css.close} onClick={() => { overlayStore.close() }} aria-label={t('background.close')}>
            ×
          </button>
        </header>

        <div className={css.preview} data-testid="bg-overlay-preview" style={previewStyle} aria-hidden="true">
          {draft.enabled && (dark ? draft.darkUrl : draft.lightUrl)
            ? null
            : <span className={css.previewEmpty}>{t('background.preview')}</span>}
        </div>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('background.enabled')}</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => { patch('enabled', event.currentTarget.checked) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('background.lightUrl')}</span>
          <input
            type="text"
            value={draft.lightUrl}
            placeholder="https://…"
            onChange={(event) => { patch('lightUrl', event.currentTarget.value) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('background.darkUrl')}</span>
          <input
            type="text"
            value={draft.darkUrl}
            placeholder="https://…"
            onChange={(event) => { patch('darkUrl', event.currentTarget.value) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('background.opacity')}</span>
          <span className={css.rangeWrap}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={draft.opacity}
              onChange={(event) => { patch('opacity', Number(event.currentTarget.value)) }}
            />
            <span className={css.rangeValue}>{Math.round(draft.opacity * 100)}%</span>
          </span>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('background.scrim')}</span>
          <span className={css.rangeWrap}>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={draft.scrim}
              onChange={(event) => { patch('scrim', Number(event.currentTarget.value)) }}
            />
            <span className={css.rangeValue}>{Math.round(draft.scrim * 100)}%</span>
          </span>
        </label>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('background.fit')}</span>
          <span className={css.segmented}>
            {(['cover', 'contain'] as const).map(fit => (
              <button
                key={fit}
                type="button"
                className={css.segment + (draft.fit === fit ? ' ' + css.segmentActive : '')}
                onClick={() => { patch('fit', fit) }}
              >
                {t(fit === 'cover' ? 'background.cover' : 'background.contain')}
              </button>
            ))}
          </span>
        </div>

        <footer className={css.footer}>
          {failed ? <span className={css.failed} role="status">{t('background.saveFailed')}</span> : null}
          <button type="button" className={css.cancel} onClick={() => { overlayStore.close() }}>
            {t('background.close')}
          </button>
          <button type="button" className={css.save} disabled={!dirty || saving} onClick={() => { void save() }}>
            {t(saving ? 'background.saving' : 'background.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
