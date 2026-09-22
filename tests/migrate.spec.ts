// @vitest-environment node
/**
 * Legacy-settings migration source.
 *
 * dsh <= 0.1.6 stored the plugin's section in `~/.dsh/settings.yaml`. dsh
 * 0.1.7 imports that file once, by PROFILE ENTRY ID, then renames it to
 * `settings.yaml.imported`; the plugin's own `ui-background` section is not an
 * entry id, so it is logged and skipped. The renamed document is therefore the
 * one surviving copy of a user's background settings, and this module reads it
 * back. The document is user-editable, so every value is validated against the
 * section schema before it is believed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { readLegacyBackgroundSection, ensureLegacyMigration, MIGRATION_MARKER } from '../src/migrate.ts'

let home = ''

/** A fresh harness home containing the given settings documents. */
function homeWith(files: Record<string, string>): string {
  if (home) rmSync(home, { recursive: true, force: true })
  home = mkdtempSync(joinPath(tmpdir(), 'dsh-bg-legacy-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(joinPath(home, name), text, 'utf8')
  return home
}

/** The document dsh <= 0.1.6 wrote, trimmed to the fields that matter here. */
const LEGACY_DOCUMENT = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'ui-background:',
  '  enabled: true',
  '  uploadId: up-468ddc69ecb171facd87c60e',
  '  url: ""',
  '  opacity: 0.2',
  '  scrim: 0.05',
  '  panelOpacity: 0.4',
  '  blur: 4',
  '  wallpaperBlur: 0',
  '  fit: cover',
  '  timeline: true',
  'agent-default-model:',
  '  model: deepseek-v4.1-flash',
  '',
].join('\n')

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true })
  home = ''
})

describe('readLegacyBackgroundSection', () => {
  it('reads the section out of settings.yaml, typed', () => {
    const result = readLegacyBackgroundSection(homeWith({ 'settings.yaml': LEGACY_DOCUMENT }))
    expect(result?.from).toBe('settings.yaml')
    expect(result?.section).toEqual({
      enabled: true,
      uploadId: 'up-468ddc69ecb171facd87c60e',
      url: '',
      opacity: 0.2,
      scrim: 0.05,
      panelOpacity: 0.4,
      blur: 4,
      wallpaperBlur: 0,
      fit: 'cover',
      timeline: true,
    })
  })

  it('falls back to the renamed settings.yaml.imported', () => {
    const result = readLegacyBackgroundSection(homeWith({ 'settings.yaml.imported': LEGACY_DOCUMENT }))
    expect(result?.from).toBe('settings.yaml.imported')
    expect(result?.section.uploadId).toBe('up-468ddc69ecb171facd87c60e')
  })

  it('prefers the live document over the renamed one', () => {
    const result = readLegacyBackgroundSection(homeWith({
      'settings.yaml': 'ui-background:\n  opacity: 0.9\n',
      'settings.yaml.imported': LEGACY_DOCUMENT,
    }))
    expect(result?.from).toBe('settings.yaml')
    expect(result?.section.opacity).toBe(0.9)
  })

  it('returns nothing when the home holds no settings document or no section', () => {
    expect(readLegacyBackgroundSection(homeWith({}))).toBeUndefined()
    expect(readLegacyBackgroundSection(homeWith({
      'settings.yaml': 'ui-onboarding:\n  welcomeNoticeVersion: 1\n',
    }))).toBeUndefined()
    expect(readLegacyBackgroundSection(homeWith({
      'settings.yaml': 'ui-background:\n',
    }))).toBeUndefined()
  })

  it('drops unknown fields and values the schema refuses', () => {
    const result = readLegacyBackgroundSection(homeWith({
      'settings.yaml': [
        'ui-background:',
        '  lightUrl: https://old/light.png',   // legacy field, gone from the schema
        '  darkUrl: https://old/dark.png',     // legacy field, gone from the schema
        '  enabled: true',
        '  opacity: 99',                       // out of range -> schema default
        '  fit: stretch',                      // not an accepted mode -> default
        '  blur: "not a number"',              // wrong type -> default
        '  uploadId: up-1',
        '',
      ].join('\n'),
    }))
    expect(result?.section).toEqual({
      enabled: true,
      uploadId: 'up-1',
      url: '',
      opacity: 1,
      scrim: 0.25,
      panelOpacity: 0.15,
      blur: 16,
      wallpaperBlur: 0,
      fit: 'cover',
      timeline: true,
    })
  })

  it('does not read a deeper block that merely shares the field names', () => {
    const result = readLegacyBackgroundSection(homeWith({
      'settings.yaml': [
        'other-plugin:',
        '  ui-background:',
        '    enabled: true',
        '',
      ].join('\n'),
    }))
    expect(result).toBeUndefined()
  })
})

describe('ensureLegacyMigration', () => {
  /** A settings stub recording every write and answering with the given view. */
  function settingsStub(described: { ns: string; value?: unknown; user?: unknown }[] = []) {
    const writes: { ns: string; section: object }[] = []
    return {
      writes,
      describe: () => described,
      replace: async (ns: string, section: object) => { writes.push({ ns, section }) },
    }
  }

  const ENTRY = 'deepseek-harness-background'

  it('writes the recovered section under the entry namespace and marks it done', async () => {
    const dir = homeWith({ 'settings.yaml.imported': LEGACY_DOCUMENT })
    const settings = settingsStub()
    expect(await ensureLegacyMigration(settings, ENTRY, dir)).toEqual({ kind: 'migrated', from: 'settings.yaml.imported' })
    expect(settings.writes).toHaveLength(1)
    expect(settings.writes[0]?.ns).toBe(ENTRY)
    expect(settings.writes[0]?.section).toMatchObject({ enabled: true, opacity: 0.2 })
    expect(existsSync(joinPath(dir, 'deepseek-harness-background', MIGRATION_MARKER))).toBe(true)
  })

  it('migrates once: the marker keeps the next boot from resurrecting it', async () => {
    const dir = homeWith({ 'settings.yaml.imported': LEGACY_DOCUMENT })
    const first = settingsStub()
    await ensureLegacyMigration(first, ENTRY, dir)
    // The user resets every field to its default, deleting the entry's config
    // row — the view now reports no user layer again.
    const second = settingsStub()
    expect(await ensureLegacyMigration(second, ENTRY, dir)).toEqual({ kind: 'skipped', reason: 'already-migrated' })
    expect(second.writes).toEqual([])
  })

  it('never overwrites a target that already carries a user section', async () => {
    const dir = homeWith({ 'settings.yaml': LEGACY_DOCUMENT })
    const settings = settingsStub([{ ns: ENTRY, value: { enabled: false }, user: { enabled: false } }])
    expect(await ensureLegacyMigration(settings, ENTRY, dir))
      .toEqual({ kind: 'skipped', reason: 'target-has-user-section' })
    expect(settings.writes).toEqual([])
  })

  it('still migrates when the target reports an EMPTY user layer', async () => {
    // dsh 0.1.7's describe() reports `user: {}` — not undefined — for an entry
    // with no config row, which is exactly the fresh-upgrade state.
    const dir = homeWith({ 'settings.yaml.imported': LEGACY_DOCUMENT })
    const settings = settingsStub([{ ns: ENTRY, value: { enabled: false }, user: {} }])
    expect(await ensureLegacyMigration(settings, ENTRY, dir))
      .toEqual({ kind: 'migrated', from: 'settings.yaml.imported' })
    expect(settings.writes).toHaveLength(1)
  })

  it('skips without a marker when no legacy document holds a section', async () => {
    const dir = homeWith({})
    const settings = settingsStub()
    expect(await ensureLegacyMigration(settings, ENTRY, dir))
      .toEqual({ kind: 'skipped', reason: 'no-legacy-section' })
    expect(settings.writes).toEqual([])
    expect(existsSync(joinPath(dir, 'deepseek-harness-background', MIGRATION_MARKER))).toBe(false)
  })
})
