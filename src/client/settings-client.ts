/**
 * Background settings transport — reads and writes the `ui-background`
 * section, and uploads local images, through the plugin's own same-origin
 * HTTP routes (see src/routes.ts). A custom route family keeps the section
 * usable even though the api-proxy settings allowlist does not expose
 * third-party namespaces over the settings RPC. One module-level client
 * serves the painter and the settings row.
 */

import type { BackgroundSettings } from '../settings.ts'
import { BACKGROUND_API_PREFIX } from '../settings.ts'

/** One snapshot of the section as last seen by the transport. */
export interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'error'
  value?: BackgroundSettings
}

type Listener = () => void

/** Outcome of one save attempt: committed, displaced by a newer save (the
 * caller must not adopt its own section back into the draft), or rejected. */
export type SaveResult = 'ok' | 'superseded' | 'failed'

/**
 * Observable settings client (getSnapshot/subscribe — the uSES currency).
 * Methods are arrow properties so React's useSyncExternalStore can call them
 * without an owning `this`.
 */
export class SettingsClient {
  private snapshot: SettingsSnapshot = { status: 'loading' }
  private readonly listeners = new Set<Listener>()
  /** Monotonic request id; the latest save wins even when POSTs interleave. */
  private saveSeq = 0
  /** Pending save promise (used by the row's flush-on-unmount). */
  private pending: Promise<SaveResult> | undefined

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

  /** Await any in-flight save (used before teardown so edits are not dropped). */
  async flush(): Promise<void> {
    await this.pending
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
   * Persist the section through the host route. Concurrent calls are
   * serialized by a request sequence: an older save that resolves after a
   * newer one answers 'superseded' instead of 'ok', so the caller can never
   * mistake a stale write for success and adopt its outdated section.
   * @param section - the complete next section.
   * @returns whether the write committed, was displaced by a newer save, or failed.
   */
  async save(section: BackgroundSettings): Promise<SaveResult> {
    const seq = ++this.saveSeq
    const run = async (): Promise<SaveResult> => {
      try {
        const response = await fetch(`${BACKGROUND_API_PREFIX}/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(section),
        })
        const body = await response.json() as { ok: boolean; value?: BackgroundSettings }
        if (!response.ok || !body.ok || body.value === undefined) return 'failed'
        // Discard the response of a superseded save — it reflects an older
        // document that must not overwrite the latest one.
        if (seq !== this.saveSeq) return 'superseded'
        this.snapshot = { status: 'ready', value: body.value }
        this.notify()
        return 'ok'
      } catch {
        return 'failed'
      }
    }
    const promise = run()
    this.pending = promise
    // Release the handle once settled so flush() never awaits a stale save
    // from a long-finished gesture (a later flush then resolves instantly).
    void promise.then(() => {
      if (this.pending === promise) this.pending = undefined
    })
    return promise
  }

  /**
   * Upload a local image file; on success stores its id into the snapshot and
   * returns the resolved background url (or null on failure).
   * @param file - the chosen image file.
   * @returns the resolved image url, or null.
   */
  async upload(file: File): Promise<string | null> {
    try {
      const response = await fetch(`${BACKGROUND_API_PREFIX}/upload`, {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      })
      const body = await response.json() as { ok: boolean; id?: string; url?: string }
      if (!response.ok || !body.ok || body.id === undefined || body.url === undefined) return null
      return body.url ?? null
    } catch {
      return null
    }
  }
}

/** Shared client for the painter and the settings row. */
export const settingsClient = new SettingsClient()
