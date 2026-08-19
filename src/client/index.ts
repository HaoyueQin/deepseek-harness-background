/**
 * Browser half of the background plugin: paints the background behind the
 * whole app frame and provides the settings surface — a live row inside the
 * official General settings section (next to the Appearance row). Data flows
 * through the plugin's own host route (`/api/bg-wallpaper/*`), not the
 * settings RPC, because the api-proxy settings allowlist does not expose
 * third-party namespaces. Retraction discipline mirrors the skin plugins:
 * every property and DOM node the painter owns is restored on dispose.
 */

import type { Context } from '@deepseek-ai/cordis'
import { backgroundPainter, paintBackground } from './backdrop.ts'
import { en, zh } from './locales.ts'
import { BackgroundSettingsRow } from './SettingsRow.tsx'
import { settingsClient } from './settings-client.ts'
import type {} from './types.ts'

/**
 * Service injections this entry declares: the `slots` (runtime) and `locale`
 * services only — the settings surface talks to the plugin's own host route
 * over plain same-origin fetch, so no settings/connection service is needed.
 */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: paint the persisted background live and register the
 * General-settings row.
 * @param ctx - client cordis context (slots/locale injected).
 */
export function apply(ctx: Context): void {
  // Paint from the plugin's own transport; repaint on every snapshot change.
  const paint = (): void => {
    const snapshot = settingsClient.getSnapshot()
    const value = snapshot.status === 'ready' ? snapshot.value : undefined
    if (value === undefined || !value.enabled) {
      backgroundPainter.dispose()
      return
    }
    paintBackground(value)
  }
  const unsubscribe = settingsClient.subscribe(paint)
  void settingsClient.load()

  ctx.effect(() => ctx.locale.register('ui-background', { zh, en }), 'deepseek-harness-background: dictionaries')

  // Live settings row in the General section (same slot as the Appearance row).
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'deepseek-harness-background',
    order: 600,
    locale: 'ui-background',
  }, BackgroundSettingsRow))

  ctx.effect(() => () => {
    unsubscribe()
    backgroundPainter.dispose()
  }, 'deepseek-harness-background: background surface')
}
