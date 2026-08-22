/**
 * Browser half of the background plugin: paints the background behind the
 * whole app frame, provides the settings surface (a live row inside the
 * official General settings section), and renders the conversation timeline
 * rail (DeepSeek ScrollNav style) on the same frosted-glass system. Data
 * flows through the plugin's own host route (`/api/bg-wallpaper/*`), not the
 * settings RPC. Retraction discipline mirrors the skin plugins: every
 * property and DOM node the painter owns is restored on dispose.
 */

import type { Context } from '@deepseek-ai/cordis'
import { backgroundPainter, paintBackground } from './backdrop.ts'
import { en, zh } from './locales.ts'
import { BackgroundSettingsRow } from './SettingsRow.tsx'
import { settingsClient } from './settings-client.ts'
import { TimelineRail } from './timeline.tsx'
import type {} from './types.ts'

/**
 * Service injections this entry declares: `slots` + `locale` for the settings
 * surface and the timeline slot seat, and `sessions` so the timeline rail can
 * enumerate user messages and jump between them. The settings surface itself
 * talks to the plugin's own host route over plain same-origin fetch.
 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: paint the persisted background live, register the
 * General-settings row, and mount the conversation timeline rail.
 * @param ctx - client cordis context (slots/locale/sessions injected).
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

  // Conversation timeline rail: takes a per-session dock seat only to bind
  // its lifecycle; the rail portals to body. The sessions service is handed
  // to the component through the registration's inject face — resolved
  // lazily inside the factory so a runtime-side service rebuild can never
  // leave the rail holding a stale reference.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'deepseek-harness-background.timeline',
    order: 45,
    locale: 'ui-background',
    inject: () => ({ sessionsService: ctx.sessions }),
  }, TimelineRail))

  ctx.effect(() => () => {
    unsubscribe()
    backgroundPainter.dispose()
  }, 'deepseek-harness-background: background surface')
}
