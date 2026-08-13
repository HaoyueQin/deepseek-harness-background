/** Overlay open/close state shared by the settings entry card and the overlay. */

type Listener = () => void

/**
 * Observable overlay visibility (getSnapshot/subscribe — the uSES currency).
 * Methods are arrow properties so React's useSyncExternalStore can call them
 * without an owning `this`.
 */
export class OverlayStore {
  private visible = false
  private readonly listeners = new Set<Listener>()

  /** @returns whether the settings overlay is open. */
  getSnapshot = (): boolean => this.visible

  /** Observe visibility changes. @returns the disposer removing this listener. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Open the settings overlay. */
  open(): void {
    this.visible = true
    this.notify()
  }

  /** Close the settings overlay. */
  close(): void {
    this.visible = false
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Shared overlay store for the settings entry card and the overlay. */
export const overlayStore = new OverlayStore()
