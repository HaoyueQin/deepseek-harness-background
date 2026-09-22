/**
 * Legacy-settings migration.
 *
 * dsh <= 0.1.6 stored this plugin's section in `~/.dsh/settings.yaml`. dsh
 * 0.1.7 imports that document once, BY PROFILE ENTRY ID, then renames it to
 * `settings.yaml.imported`; `ui-background` is not an entry id, so the section
 * is logged and skipped — the renamed file is the one surviving copy of a
 * user's background settings.
 *
 * This module reads that copy back and hands it to the 0.1.7 settings service
 * under the entry-id namespace, so an upgrade does not silently reset every
 * background. The document is user-editable, so each value is validated
 * against the section schema and a value the schema refuses is dropped (its
 * default then applies) rather than poisoning the whole migration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { BackgroundSettingsSchema } from './schema.ts'
import { BACKGROUND_SETTINGS_FIELDS, type BackgroundSettings } from './settings.ts'
import { PLUGIN_HOME_REL, resolveHarnessHome } from './harness-home.ts'

/**
 * Settings documents an older dsh left in the harness home, in precedence
 * order: the live document first, then the copy 0.1.7 renamed away.
 */
export const LEGACY_SETTINGS_FILES = ['settings.yaml', 'settings.yaml.imported'] as const

/** Marker written into the plugin home once a migration has been attempted. */
export const MIGRATION_MARKER = '.migrated-from-legacy-settings'

/** One recovered section plus the document it came from. */
export interface LegacyBackgroundSection {
  /** File name inside the harness home the section was read from. */
  from: string
  /** The section, schema-resolved (every field present). */
  section: BackgroundSettings
}

/**
 * One scalar as the settings provider's YAML writer emitted it. The section is
 * flat and holds only scalars, so this covers the whole surface; a quoted
 * scalar stays a string (a quoted `"2"` must not become the number 2).
 */
function parseScalar(raw: string): unknown {
  const text = raw.trim()
  if (text === '') return ''
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  const uncommented = text.replace(/\s+#.*$/, '')
  const numeric = Number(uncommented)
  if (uncommented !== '' && Number.isFinite(numeric)) return numeric
  return uncommented
}

/**
 * The lines of one TOP-LEVEL `namespace:` block, or undefined when the document
 * has no such key. Only the block's own indent level is returned: a deeper
 * mapping that happens to reuse the field names belongs to some other section.
 */
function sectionFields(text: string, namespace: string): Record<string, unknown> | undefined {
  const lines = text.split(/\r?\n/)
  const header = new RegExp(`^${namespace}\\s*:(?:\\s*#.*)?$`)
  const start = lines.findIndex((line) => header.test(line))
  if (start < 0) return undefined
  const fields: Record<string, unknown> = {}
  let indent: number | undefined
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const match = /^(\s+)([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (match === null) {
      if (!/^\s/.test(line)) break // the next top-level key ends the block
      continue // deeper nesting (this section is flat) — not ours to read
    }
    indent ??= match[1]?.length
    if (match[1]?.length !== indent) continue
    const key = match[2] ?? ''
    if (!(BACKGROUND_SETTINGS_FIELDS as readonly string[]).includes(key)) continue
    fields[key] = parseScalar(match[3] ?? '')
  }
  return Object.keys(fields).length === 0 ? undefined : fields
}

/** Keep one field only when the section schema accepts it. */
function acceptedFields(candidate: Record<string, unknown>): Record<string, unknown> {
  const accepted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(candidate)) {
    try {
      BackgroundSettingsSchema({ [key]: value } as unknown as BackgroundSettings)
      accepted[key] = value
    } catch {
      // A value the schema refuses is dropped; its default applies instead.
    }
  }
  return accepted
}

/**
 * Read the plugin's section out of the newest settings document that carries
 * one.
 * @param home - harness home (defaults to the resolved one).
 * @returns the schema-resolved section and its source, or undefined when no
 *   legacy document holds a usable section.
 */
export function readLegacyBackgroundSection(home: string = resolveHarnessHome()): LegacyBackgroundSection | undefined {
  for (const file of LEGACY_SETTINGS_FILES) {
    const path = joinPath(home, file)
    if (!existsSync(path)) continue
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const candidate = sectionFields(text, 'ui-background')
    if (candidate === undefined) continue
    const accepted = acceptedFields(candidate)
    if (Object.keys(accepted).length === 0) continue
    return { from: file, section: BackgroundSettingsSchema(accepted as unknown as BackgroundSettings) }
  }
  return undefined
}

/** The settings surface a migration writes through. */
export interface MigrationSettingsService {
  /** Every active namespace with its resolved value and raw user layer. */
  describe(): readonly { ns: string; value?: unknown; user?: unknown }[]
  /** Replace one namespace's user section wholesale. */
  replace(ns: string, section: object): Promise<void>
}

/**
 * Whether a descriptor actually carries a user layer. dsh 0.1.7's `describe()`
 * projects the raw user section through the form, so an entry with no config
 * row reports `user: {}` rather than leaving the field off — an empty object
 * IS the fresh-upgrade state this migration exists for.
 */
function hasUserSection(user: unknown): boolean {
  if (user === undefined || user === null) return false
  if (typeof user === 'object') return Object.keys(user as Record<string, unknown>).length > 0
  return true
}

/** What one migration attempt did. */
export type MigrationOutcome =
  | { kind: 'migrated'; from: string }
  | { kind: 'skipped'; reason: 'already-migrated' | 'target-has-user-section' | 'no-legacy-section' }

/** The plugin's own directory under the harness home. */
function pluginHome(home: string): string {
  return joinPath(home, PLUGIN_HOME_REL)
}

/**
 * Bring a pre-0.1.7 section forward into the entry-keyed document, ONCE.
 *
 * Runs lazily from the first settings read rather than from `apply`: the
 * settings service refuses a write until this plugin's fiber is ACTIVE, and a
 * route handler only ever runs once it is. The marker file is what makes it
 * one-shot — a user who resets every field to its default deletes the entry's
 * config row, and without the marker the next boot would resurrect the old
 * background.
 *
 * @param settings - the mounted settings service.
 * @param namespace - the entry-keyed namespace to write.
 * @param home - harness home (defaults to the resolved one).
 * @returns what the attempt did.
 */
export async function ensureLegacyMigration(
  settings: MigrationSettingsService,
  namespace: string,
  home: string = resolveHarnessHome(),
): Promise<MigrationOutcome> {
  const marker = joinPath(pluginHome(home), MIGRATION_MARKER)
  if (existsSync(marker)) return { kind: 'skipped', reason: 'already-migrated' }

  const descriptor = settings.describe().find((candidate) => candidate.ns === namespace)
  if (descriptor !== undefined && hasUserSection(descriptor.user)) {
    return { kind: 'skipped', reason: 'target-has-user-section' }
  }

  const legacy = readLegacyBackgroundSection(home)
  if (legacy === undefined) return { kind: 'skipped', reason: 'no-legacy-section' }

  await settings.replace(namespace, legacy.section)
  try {
    mkdirSync(pluginHome(home), { recursive: true })
    writeFileSync(marker, `${new Date().toISOString()}\n${legacy.from}\n`, 'utf8')
  } catch {
    // A read-only home costs a repeated no-op attempt, never the migration.
  }
  return { kind: 'migrated', from: legacy.from }
}
