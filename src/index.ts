/**
 * Host registration for the background plugin.
 *
 * Two settings generations are supported from one artifact:
 *
 * - dsh 0.1.5/0.1.6 mount a `SettingsProvider`: the plugin OWNS the
 *   `ui-background` namespace, registers its schema on it, and reads the
 *   resolved value back.
 * - dsh 0.1.7 replaced that class with `SettingsForms`: the namespace IS the
 *   profile entry id, the schema comes from this module's exported `Config`,
 *   and `register`/`get` no longer exist (reads go through `describe`).
 *
 * Both generations still get the same same-origin HTTP route family the
 * browser half reads, writes and uploads through — a custom route family
 * keeps the section usable even though the api-proxy's settings allowlist
 * does not expose third-party namespaces over the settings RPC.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `ctx.settings` (and, transitively, the settings service
// surface) into the Cordis Context. No runtime import — the service is
// reached through `ctx.inject` below.
import type {} from '@deepseek-ai/dsh-settings'
import { BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema } from './schema.ts'
import { makeBackgroundRoutes, type BackgroundSettingsService } from './routes.ts'

export {
  BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema, Config, FIT_MODES,
  DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM,
  OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  type BackgroundFit, type BackgroundSettings,
} from './schema.ts'
export {
  BACKGROUND_API_PREFIX, makeBackgroundRoutes, readBackgroundSection,
  type BackgroundSettingsService,
} from './routes.ts'
export { resolveHarnessHome, PLUGIN_HOME_REL } from './harness-home.ts'

/**
 * Entry id this plugin's bundle patch inserts into the profile. From dsh
 * 0.1.7 on it doubles as the settings namespace, and it is the documented
 * fallback when the running kernel exposes no Loader entry (a bare
 * `ctx.plugin()` mount in tests, or a future loader that moves the handle).
 */
export const BACKGROUND_ENTRY_ID = 'deepseek-harness-background'

/**
 * The host settings service, narrowed to the members the two generations
 * share plus the two generation-specific ones. `register` exists only on
 * 0.1.5/0.1.6's provider; `configure` only on 0.1.7's forms service.
 */
export interface BackgroundSettingsRegistration extends BackgroundSettingsService {
  /** 0.1.5/0.1.6: register a namespace schema; absent on 0.1.7. */
  register?(ns: string, schema: unknown, options?: { applies: string }): unknown
  /** 0.1.7: own this plugin instance's settings-page policy. */
  configure?(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/** The Loader entry handle, read structurally: the plugin takes no runtime
 * dependency on the Loader package, and the read is defensive throughout. */
interface LoaderFiberFace {
  entry?: { options?: { id?: string } }
}

/**
 * Whether the mounted settings service is the pre-0.1.7 provider. The one
 * generation test: `register` was removed in the 0.1.7 rewrite, so its
 * presence IS the older generation (never a version compare).
 * @param settings - the mounted settings service.
 */
export function isLegacySettingsService(settings: BackgroundSettingsRegistration): boolean {
  return typeof settings.register === 'function'
}

/**
 * The namespace the section lives under on the running generation: the
 * plugin-owned `ui-background` on 0.1.5/0.1.6, the profile entry id from
 * 0.1.7 on.
 * @param settings - the mounted settings service.
 * @param entryId - this plugin's Loader entry id, when the kernel exposes one.
 */
export function resolveBackgroundNamespace(settings: BackgroundSettingsRegistration, entryId?: string): string {
  return isLegacySettingsService(settings) ? BACKGROUND_SETTINGS_NAMESPACE : entryId ?? BACKGROUND_ENTRY_ID
}

/**
 * Register the durable background section and its API routes when the Host
 * settings/webServer services are composed. Effect timing is `live`: the
 * browser half repaints through the route without a restart.
 * @param ctx - Host context that may acquire the settings and webServer services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'webServer'], (hostCtx) => {
    const settings = hostCtx.settings as unknown as BackgroundSettingsRegistration
    const entryId = (ctx.fiber as unknown as LoaderFiberFace).entry?.options?.id
    const namespace = resolveBackgroundNamespace(settings, entryId)

    if (isLegacySettingsService(settings)) {
      // Idempotence fence: the settings service registers its namespace effect
      // on the *provider's* fiber (not this plugin's), so a re-run of this
      // inject callback (HMR hot-replace, or a settings/webServer service
      // rebuild) would throw "already registered" and take the routes down
      // with it. Skip when our namespace is already registered — the routes
      // below still need re-mounting because they live on this plugin fiber.
      const alreadyRegistered = settings.describe().some(
        (descriptor) => descriptor.ns === namespace,
      )
      if (!alreadyRegistered) {
        settings.register?.(namespace, BackgroundSettingsSchema, { applies: 'live' })
      }
    } else {
      // 0.1.7+: the exported `Config` already supplies this entry's schema, so
      // there is nothing to register. Claim the page policy instead: the
      // plugin ships its own row in the General section, and the auto-generated
      // page would expose the internal uploadId/url fields as raw inputs.
      // The call stays a METHOD call on `settings` — the service is a class
      // instance, so detaching it into a bare function loses `this`.
      const configure = settings.configure
      if (typeof configure === 'function') {
        hostCtx.effect(() => {
          const dispose = settings.configure?.({ auto: false }, ctx.fiber)
          return () => { dispose?.() }
        }, 'deepseek-harness-background: settings presentation')
      }
    }

    // Route failures are logged, never thrown — the plugin must not take the
    // web server down when the route family cannot mount.
    try {
      for (const route of makeBackgroundRoutes(settings, { namespace })) {
        hostCtx.effect(() => hostCtx.webServer.register(route), 'deepseek-harness-background: settings route')
      }
    } catch (error) {
      console.error('[deepseek-harness-background] route registration failed:', error)
    }
  })
}
