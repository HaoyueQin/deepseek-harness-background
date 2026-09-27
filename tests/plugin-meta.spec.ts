/**
 * The shell reads plugin display metadata without evaluating plugin code: the
 * package manifest's `icon` plus `locale/<language>.json` dictionaries reached
 * through the package exports (dsh: packages/boot/app-boot/src/package-meta.ts).
 * Every rule below is one the shell enforces by throwing, and a thrown field
 * replaces the Plugins card's title with the error — so this spec pins the
 * contract against the files we actually ship, not against a fixture.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOCALE_DIR = resolve(PACKAGE_ROOT, 'locale')

/** Icon formats the shell admits. */
const ICON_MEDIA_TYPES = ['.svg', '.png', '.jpg', '.jpeg', '.webp']
/** Shell cap on raw icon bytes. */
const MAX_ICON_BYTES = 256 * 1024
/** Language ids the shell accepts as a locale filename. */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

interface Manifest {
  readonly name?: string
  readonly icon?: string
  readonly exports?: Record<string, unknown>
  readonly files?: readonly string[]
}

interface Dictionary {
  readonly language: string
  readonly meta: { readonly title?: unknown; readonly description?: unknown }
}

const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as Manifest

/** Every locale dictionary as the shell enumerates them. */
function dictionaries(): Dictionary[] {
  return readdirSync(LOCALE_DIR)
    .filter(name => name.endsWith('.json'))
    .map((name) => {
      const file = resolve(LOCALE_DIR, name)
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { meta?: Dictionary['meta'] }
      return { language: name.slice(0, -'.json'.length), meta: parsed.meta ?? {} }
    })
}

describe('plugin display metadata', () => {
  it('exports the manifest and the locale family the shell resolves by specifier', () => {
    // An unexported resource is skipped silently, so the card would fall back to
    // the package name and description instead of failing loudly.
    expect(manifest.exports?.['./package.json']).toBe('./package.json')
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
  })

  it('declares an icon the shell accepts and packs', () => {
    const icon = manifest.icon ?? ''
    expect(icon, 'package.json.icon').toBe('./icon.svg')
    expect(isAbsolute(icon)).toBe(false)
    expect(ICON_MEDIA_TYPES).toContain(extname(icon).toLowerCase())
    const file = realpathSync(resolve(PACKAGE_ROOT, icon))
    const local = relative(PACKAGE_ROOT, file)
    // The shell realpaths before comparing, so a symlink out of the package is
    // rejected even though the declared path looks local.
    expect(local === '..' || local.startsWith(`..${sep}`), 'icon stays inside the package').toBe(false)
    expect(statSync(file).isFile()).toBe(true)
    expect(statSync(file).size).toBeLessThanOrEqual(MAX_ICON_BYTES)
    // Packing decides whether the installed manifest can even see the file.
    expect(manifest.files).toContain('icon.svg')
  })

  it('ships English plus translations whose fields the shell accepts', () => {
    const entries = dictionaries()
    const languages = entries.map(entry => entry.language.toLowerCase())
    expect(languages).toContain('en')
    // The shell rejects two filenames that fold to one language id.
    expect(new Set(languages).size).toBe(languages.length)
    for (const { language, meta } of entries) {
      expect(LANGUAGE_ID.test(language), language).toBe(true)
      // textOf() demands a non-empty string, and one bad field fails the whole
      // package's metadata rather than just that language.
      expect(typeof meta.title === 'string' && meta.title.trim() !== '', `${language}: meta.title`).toBe(true)
      expect(typeof meta.description === 'string' && meta.description.trim() !== '', `${language}: meta.description`).toBe(true)
    }
    expect(manifest.files).toContain('locale/*.json')
  })
})
