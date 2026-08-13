/**
 * Background settings transport — reads and writes the `ui-background`
 * section through the plugin's own same-origin HTTP route (see
 * src/routes.ts). A custom route family keeps the section usable even though
 * the api-proxy settings allowlist does not expose third-party namespaces
 * over the settings RPC. One module-level client serves the painter and the
 * settings overlay.
 */

import type { BackgroundSettings } from '../settings.ts'
import { BACKGROUND_API_PREFIX } from '../routes.ts'

/** One snapshot of the section as last seen by the transport. */
export interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'error'
  value?: BackgroundSettings
}

type Listener = () => void

/**
 * Observable settings client (getSnapshot/subscribe — the uSES currency).
 * Methods are arrow properties so React's useSyncExternalStore can call them
 * without an owning `this`.
 */
export class SettingsClient {
  private snapshot: SettingsSnapshot = { status: 'loading' }
  private readonly listeners = new Set<Listener>()

  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot = (): SettingsSnapshot => this.snapshot

  /** Observe snapshot replacements. @returns the disposer removing this listener. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** Fetch the section from the host. */
  async load(): Promise<void> {
    try {
      const response = await fetch(`${BACKGROUND_API_PREFIX}/settings`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as { ok: boolean; value?: BackgroundSettings }
      if (!body.ok || body.value === undefined) throw new Error('unexpected payload')
      this.snapshot = { status: 'ready', value: body.value }
    } catch {
      this.snapshot = { status: 'error' }
    }
    this.notify()
  }

  /**
   * Persist the section through the host route.
   * @param section - the complete next section.
   * @returns whether the host accepted the write.
   */
  async save(section: BackgroundSettings): Promise<boolean> {
    try {
      const response = await fetch(`${BACKGROUND_API_PREFIX}/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(section),
      })
      const body = await response.json() as { ok: boolean; value?: BackgroundSettings }
      if (!response.ok || !body.ok || body.value === undefined) return false
      this.snapshot = { status: 'ready', value: body.value }
      this.notify()
      return true
    } catch {
      return false
    }
  }
}

/** Shared client for the painter and the settings overlay. */
export const settingsClient = new SettingsClient()
