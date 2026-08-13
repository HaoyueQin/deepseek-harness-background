/**
 * Background entry card — the always-visible shell inside the official
 * plugin-configuration section (`settings.plugin.item` slot). The card never
 * gates on the settings transport: it is a pure entry point that opens the
 * self-drawn settings overlay (the api-proxy settings allowlist does not
 * expose third-party namespaces over the settings RPC, so the editable form
 * lives in the overlay and talks to the plugin's own host route instead).
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { overlayStore } from './overlay-store.ts'
import css from './entry-card.module.css'

/** Full component props: runtime share + locale seat (no inject face needed). */
export type BackgroundEntryCardProps =
  PropsRuntime<'settings.plugin.item'> & PropsLocale<'ui-background'>

/**
 * Render the background entry card.
 * @param props - locale copy.
 * @returns the card.
 */
export function BackgroundEntryCard({ t }: BackgroundEntryCardProps) {
  return (
    <li className={css.card}>
      <button
        type="button"
        className={css.header}
        onClick={() => { overlayStore.open() }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('background.title')}</span>
          <span className={css.description}>{t('background.entryHint')}</span>
        </span>
      </button>
    </li>
  )
}
