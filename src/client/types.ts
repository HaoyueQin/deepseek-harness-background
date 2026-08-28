/**
 * Slot/locale type declarations for this plugin. The runtime sides come from
 * the shell's module table (`ui-settings-general`/`locale` plugins); this
 * package only merges the types so its row can be typed against the real
 * slot machinery. `SlotMap`/`LocaleNamespaceMap`/`Context` merges are the
 * same declaration-merge pattern the framework packages use.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SlotMap, LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One row inside the General settings section. Declared by
     * `ui-settings-general` at runtime; re-declared here (interface merge) so
     * this package can type its registration without importing that package.
     */
    'settings.general.item': { kind: 'list'; scope: 'root'; owner: BackgroundRowOwnerProps }
    /**
     * One row in the conversation input dock (above the composer card).
     * Declared by `ui-conversation` at runtime; re-declared here (interface
     * merge) so this package can mount the timeline rail without importing
     * that package. The rail portals to body, so the owner share is unused —
     * declared as an empty marker to satisfy the merge shape only.
     */
    'conversation.input.dock': { kind: 'list'; scope: 'session'; owner: TimelineInputZoneProps }
  }
}

/** Owner share of a conversation input-dock entry (unused by the timeline). */
export interface TimelineInputZoneProps {
  /** Marker field: the dock owner share carries nothing this plugin reads. */
  children?: never
}

/** Owner share of a General settings row: the section supplies nothing. */
export interface BackgroundRowOwnerProps {
  /** Marker field: row owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary keys this row's locale registration carries. */
    'ui-background': BackgroundCardLocaleKey
  }
}

/** Locale keys owned by this plugin's dictionary. */
export type BackgroundCardLocaleKey =
  | 'background.title'
  | 'background.description'
  | 'background.upload'
  | 'background.uploading'
  | 'background.uploadMediaTypes'
  | 'background.urlPlaceholder'
  | 'background.invalidUrl'
  | 'background.applyUrl'
  | 'background.enabled'
  | 'background.source'
  | 'background.effects'
  | 'background.noPreview'
  | 'background.previewGlass'
  | 'background.opacity'
  | 'background.scrim'
  | 'background.panelOpacity'
  | 'background.blur'
  | 'background.wallpaperBlur'
  | 'background.fit'
  | 'background.cover'
  | 'background.contain'
  | 'background.clear'
  | 'background.uploadFailed'
  | 'background.saveFailed'
  | 'background.timeline'
  | 'background.timelineHint'
  | 'background.timelineEnhance'
  | 'background.timelineEnhanceHint'
  | 'timeline.railLabel'
  | 'timeline.noText'
  | 'timeline.jump'

/** Cordis Context merges: the services this plugin injects. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Slot registry provided by the runtime (SlotRegistry). */
    slots: {
      /**
       * Register one entry into a declared slot; the effect lives on the
       * caller's fiber and disposes with it.
       */
      register(options: object, component: unknown): () => void
      /**
       * Install an effect for each declaration lifetime of a slot; runs the
       * callback when the slot is declared (now or later).
       */
      inject(key: string, callback: () => () => void): () => void
    }
    /** Locale service provided by the locale plugin. */
    locale: {
      /** Register one dictionary namespace; returns the disposer. */
      register(ns: string, dict: Record<string, Record<string, string>>): () => void
      /** Bind a namespace to a translate function. */
      bind(ns: string): (key: string) => string
    }
    /**
     * Sessions service provided by the client runtime. Structurally narrowed
     * to the face the timeline rail consumes (the real service carries the
     * full port API; this merge only types what this package touches).
     */
    sessions: {
      binding(sessionId: string):
        | {
            session: {
              subscribe(listener: () => void): () => void
              getSnapshot(): unknown
              loadOlder(): Promise<unknown>
            }
          }
        | undefined
    }
  }
}
