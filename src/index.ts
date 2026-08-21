/**
 * Host registration for the background plugin: registers the `ui-background`
 * settings namespace (the section lives in the official settings document)
 * and mounts the same-origin HTTP routes the browser half reads, writes and
 * uploads through — a custom route family keeps the section usable even
 * though the api-proxy's settings allowlist does not expose third-party
 * namespaces over the settings RPC.
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema } from './schema.ts'
import { makeBackgroundRoutes } from './routes.ts'

export {
  BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema, FIT_MODES,
  DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM,
  OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  type BackgroundFit, type BackgroundSettings,
} from './schema.ts'
export { BACKGROUND_API_PREFIX, makeBackgroundRoutes } from './routes.ts'
export { resolveHarnessHome, PLUGIN_HOME_REL } from './harness-home.ts'

const BACKGROUND_NAMESPACE = settingsNamespace(BACKGROUND_SETTINGS_NAMESPACE)

/**
 * Register the durable background section and its API routes when the Host
 * settings/webServer services are composed. Effect timing is `live`: the
 * browser half repaints through the route without a restart.
 * @param ctx - Host context that may acquire the settings and webServer services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'webServer'], (hostCtx) => {
    // Idempotence fence: the settings service registers its namespace effect
    // on the *provider's* fiber (not this plugin's), so a re-run of this
    // inject callback (HMR hot-replace, or a settings/webServer service
    // rebuild) would throw "already registered" and take the routes down
    // with it. Skip when our namespace is already registered — the routes
    // below still need re-mounting because they live on this plugin fiber.
    const alreadyRegistered = hostCtx.settings.describe().some(
      (descriptor) => descriptor.ns === BACKGROUND_SETTINGS_NAMESPACE,
    )
    if (!alreadyRegistered) {
      hostCtx.settings.register(BACKGROUND_NAMESPACE, BackgroundSettingsSchema, {
        applies: 'live',
      })
    }
    // Route failures are logged, never thrown — the plugin must not take the
    // web server down when the route family cannot mount.
    try {
      for (const route of makeBackgroundRoutes(hostCtx.settings)) {
        hostCtx.effect(() => hostCtx.webServer.register(route), 'deepseek-harness-background: settings route')
      }
    } catch (error) {
      console.error('[deepseek-harness-background] route registration failed:', error)
    }
  })
}
