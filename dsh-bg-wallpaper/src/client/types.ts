/**
 * Slot/locale type declarations for this plugin. The runtime sides come from
 * the shell's module table (`ui-layout`/`ui-settings`/`locale` plugins); this
 * package only merges the types so its card can be typed against the real
 * slot machinery. `SlotMap`/`LocaleNamespaceMap`/`Context` merges are the
 * same declaration-merge pattern the framework packages use.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SlotMap, LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One plugin's card inside the plugin configuration section. Declared by
     * `ui-settings-plugins` at runtime; re-declared here (interface merge) so
     * this package can type its registration without importing that package.
     */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: BackgroundCardOwnerProps }
    /**
     * The additive surface slot declared by `ui-layout` (AppFrame renders it
     * over every column, click-through until an entry opts into pointer
     * events). The settings overlay registers here.
     */
    'shell.overlay': { kind: 'list'; scope: 'root'; owner: BackgroundOverlayOwnerProps }
  }
}

/** Owner share of a plugin card: the section supplies nothing. */
export interface BackgroundCardOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/** Owner share of an overlay entry: the frame supplies nothing. */
export interface BackgroundOverlayOwnerProps {
  /** Marker field: overlay owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary keys this card's locale registration carries. */
    'ui-background': BackgroundCardLocaleKey
  }
}

/** Locale keys owned by this plugin's dictionary. */
export type BackgroundCardLocaleKey =
  | 'background.title'
  | 'background.description'
  | 'background.entryHint'
  | 'background.enabled'
  | 'background.lightUrl'
  | 'background.darkUrl'
  | 'background.opacity'
  | 'background.scrim'
  | 'background.fit'
  | 'background.cover'
  | 'background.contain'
  | 'background.preview'
  | 'background.unsaved'
  | 'background.save'
  | 'background.saving'
  | 'background.close'
  | 'background.discard'
  | 'background.readOnly'
  | 'background.saveFailed'
  | 'background.resetAll'

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
  }
}

/** Re-exported for type-only consumers. */
export type { Context, SlotMap, LocaleNamespaceMap }
