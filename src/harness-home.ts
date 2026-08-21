/**
 * Harness-home resolution — where the uploaded wallpaper images live.
 *
 * Mirrors the dsh launcher's precedence (see @deepseek-ai/dsh-home-paths'
 * resolveDshHome): `$DSH_HOME`, else `<homedir>/.dsh`. Kept as a tiny pure
 * function so the host half needs no out-of-tree dependency on the internal
 * home-paths package. The semantics match the official resolver: an empty or
 * whitespace-only `$DSH_HOME` counts as unset, a leading `~` / `~/` / `~\`
 * expands against the OS home, and the result is normalized with
 * path.resolve().
 */

import { homedir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'

/** First non-blank string in a candidate list, else undefined. */
export function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Expand supported tilde prefixes against the OS home (mirrors expandHomePath). */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return joinPath(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the harness home (the directory containing `profiles/`): `$DSH_HOME`
 * first, then `~/.dsh`. An empty/whitespace `$DSH_HOME` counts as unset; a
 * leading tilde expands against the OS home; the result is absolute.
 * @param env - environment (defaults to process.env).
 * @returns the normalized absolute harness home directory.
 */
export function resolveHarnessHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = firstNonBlank(env.DSH_HOME)
  const selected = fromEnv ?? joinPath(homedir(), '.dsh')
  return resolvePath(expandHomePath(selected))
}

/** Subdirectory under the harness home that this plugin owns. */
export const PLUGIN_HOME_REL = joinPath('deepseek-harness-background')
