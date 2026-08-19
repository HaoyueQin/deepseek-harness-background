/**
 * Harness-home resolution — where the uploaded wallpaper images live.
 *
 * Mirrors the dsh launcher's precedence (see apps/cli reference and the
 * skin-center harness-home.ts in dsh-web-ui): an explicit `--home`-formatted
 * override, else `$DSH_HOME`, else `<homedir>/.dsh`. Kept as a tiny pure
 * function so the host half needs no out-of-tree dependency on the internal
 * home-paths package.
 */

import { homedir } from 'node:os'
import { join as joinPath } from 'node:path'

/** First non-blank string in a candidate list, else undefined. */
export function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Resolve the harness home (the directory containing `profiles/`): explicit
 * override wins, then `$DSH_HOME`, then `~/.dsh`.
 * @param env - environment (defaults to process.env).
 * @returns the absolute harness home directory.
 */
export function resolveHarnessHome(env: NodeJS.ProcessEnv = process.env): string {
  return firstNonBlank(env.DSH_HOME) ?? joinPath(homedir(), '.dsh')
}

/** Subdirectory under the harness home that this plugin owns. */
export const PLUGIN_HOME_REL = joinPath('deepseek-harness-background')
