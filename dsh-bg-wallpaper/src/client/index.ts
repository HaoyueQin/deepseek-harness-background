/**
 * Browser half of the background-image plugin: paints the body background
 * behind the whole app frame and provides the settings surface — an entry
 * card inside the official plugin-configuration section plus a self-drawn
 * settings overlay. Data flows through the plugin's own host route
 * (`/api/bg-wallpaper/settings`), not the settings RPC, because the
 * api-proxy settings allowlist does not expose third-party namespaces.
 * Retraction discipline mirrors the skin plugins: every property write is
 * restored to its prior value on dispose, and the `data-ds-dark-theme`
 * observer is disconnected.
 */

import type { Context } from '@deepseek-ai/cordis'
import { backdropImage } from './backdrop.ts'
import { BackgroundEntryCard } from './entry-card.tsx'
import { en, zh } from './locales.ts'
import { BackgroundOverlay } from './overlay.tsx'
import { settingsClient } from './settings-client.ts'
import type {} from './types.ts'
import type { BackgroundSettings } from '../settings.ts'

/** Body properties this plugin owns while active. */
const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

/**
 * Render the user background behind the app frame. `body` and the frame's
 * `--dsw-alias-bg-base` paint the base surface; the center column has no
 * background of its own, so the image shows through every column. Light art
 * gets a white readability veil, dark art a black one, at the user-chosen
 * strength; the veil swaps live with the `data-ds-dark-theme` attribute the
 * theme system toggles.
 */
export class BackgroundPainter {
  private readonly previous = new Map<string, string>()
  private observer: MutationObserver | undefined
  private settings: BackgroundSettings | undefined

  /**
   * (Re)apply the background from the latest settings; idempotent.
   * @param settings - resolved background section.
   */
  apply(settings: BackgroundSettings): void {
    if (this.settings === undefined) {
      const body = document.body
      for (const prop of BACKDROP_PROPERTIES) {
        this.previous.set(prop, body.style.getPropertyValue(prop))
      }
      this.observer = new MutationObserver(() => this.paint())
      this.observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    }
    this.settings = settings
    this.paint()
  }

  /** Repaint with the current settings; no-op while inactive. */
  paint(): void {
    const settings = this.settings
    if (settings === undefined) return
    const body = document.body
    const dark = body.dataset.dsDarkTheme !== undefined
    body.style.setProperty('background-image', backdropImage(settings, dark))
    body.style.setProperty('background-position', 'center')
    body.style.setProperty('background-size', settings.fit)
    body.style.setProperty('background-attachment', 'fixed')
    body.style.setProperty('background-repeat', 'no-repeat')
  }

  /** Restore every owned property and stop observing the theme attribute. */
  dispose(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.settings = undefined
    for (const [prop, value] of this.previous) {
      document.body.style.setProperty(prop, value)
    }
    this.previous.clear()
  }
}

/**
 * Service injections this entry declares: the `slots` (runtime) and `locale`
 * services only — the settings surface talks to the plugin's own host route
 * over plain same-origin fetch, so no settings/connection service is needed.
 * Mirrors the framework choreography: the package manifest (dsh.client.inject)
 * pins the module-table dependencies and this declaration names the cordis
 * services `apply` reads.
 */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: paint the background live and register the settings
 * surface (entry card + overlay).
 * @param ctx - client cordis context (slots/locale injected).
 */
export function apply(ctx: Context): void {
  const painter = new BackgroundPainter()

  // Paint from the plugin's own transport; repaint on every snapshot change.
  const paint = (): void => {
    const snapshot = settingsClient.getSnapshot()
    const value = snapshot.status === 'ready' ? snapshot.value : undefined
    if (value === undefined || !value.enabled) {
      painter.dispose()
      return
    }
    painter.apply(value)
  }
  const unsubscribe = settingsClient.subscribe(paint)
  void settingsClient.load()

  ctx.effect(() => ctx.locale.register('ui-background', { zh, en }), 'dsh-bg-wallpaper: dictionaries')

  // Entry card in the official plugin-configuration section.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'ui-bg-wallpaper',
    order: 0,
    locale: 'ui-background',
  }, BackgroundEntryCard))

  // Settings overlay floating above the whole app frame.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'ui-bg-wallpaper-overlay',
    order: 0,
    locale: 'ui-background',
  }, BackgroundOverlay))

  ctx.effect(() => () => {
    unsubscribe()
    painter.dispose()
  }, 'dsh-bg-wallpaper: background surface')
}
