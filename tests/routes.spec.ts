// @vitest-environment node
/**
 * Host route helpers contract: harness-home resolution precedence, and the
 * upload pipeline's validation (declared-MIME + magic-byte agreement) and
 * content-addressing. Uses a surrogate home dir so tests never touch the real
 * harness home.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { resolveHarnessHome } from '../src/harness-home.ts'
import { pluginHome, storeUpload } from '../src/routes.ts'

/** Minimal valid PNG: 8-byte signature + IHDR chunk header (content trivial). */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
])

/** A minimal valid JPEG byte prefix (SOI + APP0 marker). */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a

/** A temp home for this test; removed after the suite. */
let tempHome = ''

function freshHome(): string {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true })
  tempHome = mkdtempSync(joinPath(tmpdir(), 'dsh-bg-home-'))
  return tempHome
}

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true })
})

describe('resolveHarnessHome', () => {
  it('prefers $DSH_HOME over the homedir fallback', () => {
    const env = { DSH_HOME: 'C:/custom/dsh' } as NodeJS.ProcessEnv
    expect(resolveHarnessHome(env)).toBe('C:/custom/dsh')
  })

  it('falls back to ~/.dsh when DSH_HOME is unset or blank', () => {
    expect(resolveHarnessHome({ DSH_HOME: '' } as NodeJS.ProcessEnv)).toMatch(/\.dsh$/)
    expect(resolveHarnessHome({} as NodeJS.ProcessEnv)).toMatch(/\.dsh$/)
  })
})

describe('pluginHome', () => {
  it('resolves under the harness home', () => {
    const home = freshHome()
    expect(pluginHome(home)).toBe(joinPath(home, 'deepseek-harness-background'))
  })
})

describe('storeUpload', () => {
  it('stores a valid image under a content-addressed id', () => {
    const home = freshHome()
    const { id, url } = storeUpload(PNG_BYTES, 'image/png', home)
    expect(id).toMatch(/^up-[a-f0-9]+$/)
    expect(url).toBe(`/api/bg-wallpaper/image/${id}`)
    const files = readdirSync(joinPath(home, 'deepseek-harness-background'))
    expect(files.length).toBe(1)
    expect(files[0]).toBe(`${id}.png`)
  })

  it('accepts a valid GIF', () => {
    const home = freshHome()
    const { id } = storeUpload(GIF_BYTES, 'image/gif', home)
    const files = readdirSync(joinPath(home, 'deepseek-harness-background'))
    expect(files[0]).toBe(`${id}.gif`)
  })

  it('accepts a valid JPEG and normalizes the on-disk extension to jpg', () => {
    const home = freshHome()
    const { id } = storeUpload(JPEG_BYTES, 'image/jpeg', home)
    const files = readdirSync(joinPath(home, 'deepseek-harness-background'))
    expect(files[0]).toBe(`${id}.jpg`)
  })

  it('rejects a MIME/signature mismatch', () => {
    const home = freshHome()
    expect(() => storeUpload(GIF_BYTES, 'image/png', home)).toThrow()
  })

  it('rejects an unknown declared MIME', () => {
    const home = freshHome()
    expect(() => storeUpload(PNG_BYTES, 'text/html', home)).toThrow()
  })

  it('rejects a non-image body', () => {
    const home = freshHome()
    expect(() => storeUpload(Buffer.from('not-an-image'), 'image/png', home)).toThrow()
  })
})
