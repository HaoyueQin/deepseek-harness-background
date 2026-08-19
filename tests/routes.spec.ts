// @vitest-environment node
/**
 * Host route helpers contract: harness-home resolution precedence, and the
 * upload pipeline's validation (declared-MIME + magic-byte agreement),
 * content-addressing, and pruning — the section write deletes the superseded
 * upload file, so switching images or clearing the background never leaves
 * orphaned files behind. Uses a surrogate home dir so tests never touch the
 * real harness home.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import type { Settings } from '@deepseek-ai/dsh-settings'
import { resolveHarnessHome } from '../src/harness-home.ts'
import { makeBackgroundRoutes, pluginHome, storeUpload, validateSectionBody } from '../src/routes.ts'
import { BACKGROUND_SETTINGS_NAMESPACE } from '../src/settings.ts'

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

describe('validateSectionBody', () => {
  it('accepts a url-only section', () => {
    expect(validateSectionBody({ url: 'https://example.com/a.jpg' }, freshHome())).toBeNull()
  })

  it('rejects an invalid url shape', () => {
    expect(validateSectionBody({ url: 'javascript:alert(1)' }, freshHome())).toBe('invalid-url')
    expect(validateSectionBody({ url: 42 }, freshHome())).toBe('invalid-url')
  })

  it('rejects a malformed upload id', () => {
    expect(validateSectionBody({ uploadId: '../../etc/passwd' }, freshHome())).toBe('invalid-upload-id')
  })

  it('rejects a well-formed upload id that does not exist on disk', () => {
    expect(validateSectionBody({ uploadId: 'up-' + 'a'.repeat(24) }, freshHome())).toBe('upload-not-found')
  })

  it('accepts a stored upload id', () => {
    const home = freshHome()
    const { id } = storeUpload(PNG_BYTES, 'image/png', home)
    expect(validateSectionBody({ uploadId: id }, home)).toBeNull()
  })

  it('rejects setting both url and uploadId (exclusive sources)', () => {
    const home = freshHome()
    const { id } = storeUpload(PNG_BYTES, 'image/png', home)
    expect(validateSectionBody({ url: 'https://example.com/a.jpg', uploadId: id }, home))
      .toBe('mutually-exclusive-source')
  })

  it('rejects out-of-range numeric knobs before the schema layer', () => {
    expect(validateSectionBody({ scrim: 1.2 }, freshHome())).toBe('invalid-range')
    expect(validateSectionBody({ opacity: -0.1 }, freshHome())).toBe('invalid-range')
    expect(validateSectionBody({ blur: 100 }, freshHome())).toBe('invalid-range')
    expect(validateSectionBody({ wallpaperBlur: 61 }, freshHome())).toBe('invalid-range')
    expect(validateSectionBody({ panelOpacity: 2 }, freshHome())).toBe('invalid-range')
  })

  it('rejects non-finite and string-typed numeric knobs (no coercion)', () => {
    expect(validateSectionBody({ scrim: Number.NaN }, freshHome())).toBe('invalid-range')
    expect(validateSectionBody({ scrim: Number.POSITIVE_INFINITY }, freshHome())).toBe('invalid-range')
    // A string "2" must not silently become 2 (the schema's JSON layer coerces).
    expect(validateSectionBody({ blur: '2' }, freshHome())).toBe('invalid-range')
  })
})

/** In-memory settings provider exposing only what the route family uses. */
function settingsMock(initial: Record<string, unknown>): Settings {
  const store = new Map<string, Record<string, unknown>>()
  if (Object.keys(initial).length > 0) store.set(BACKGROUND_SETTINGS_NAMESPACE, initial)
  return {
    get(ns: string) { return store.get(ns) },
    async update(ns: string, patch: Record<string, unknown>) {
      const current = store.get(ns) ?? {}
      store.set(ns, { ...current, ...patch })
    },
  } as unknown as Settings
}

/** Boot a real node:http server over the route family on an ephemeral port. */
async function withServer(fn: (base: string, home: string) => Promise<void>): Promise<void> {
  const home = freshHome()
  const routes = makeBackgroundRoutes(settingsMock({}), { home })
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    const route = routes.find((r) => (
      r.kind === 'exact' ? r.path === url : url.startsWith(r.path)
    ))
    if (!route) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await fn(base, home)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** POST one upload and return its stored id. */
async function postUpload(base: string, bytes: Buffer, mime: string): Promise<string> {
  const res = await fetch(`${base}/api/bg-wallpaper/upload`, {
    method: 'POST',
    headers: { 'content-type': mime },
    body: new Uint8Array(bytes),
  })
  expect(res.status).toBe(200)
  const body = await res.json() as { ok: boolean; id?: string }
  expect(body.ok).toBe(true)
  return body.id as string
}

/** POST one section write; returns the status. */
async function postSection(base: string, section: object): Promise<number> {
  const res = await fetch(`${base}/api/bg-wallpaper/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(section),
  })
  return res.status
}

/** The on-disk path of a stored PNG upload (extension fixed by the sniffer). */
function pngPath(home: string, id: string): string {
  return joinPath(home, 'deepseek-harness-background', `${id}.png`)
}

describe('upload pruning (swap / clear deletes the superseded file)', () => {
  it('deletes the replaced upload when the section switches to a new image', async () => {
    await withServer(async (base, home) => {
      const first = await postUpload(base, PNG_BYTES, 'image/png')
      const second = await postUpload(base, PNG_BYTES, 'image/png')
      // The section references the first upload…
      expect(await postSection(base, { enabled: true, uploadId: first, url: '' })).toBe(200)
      expect(existsSync(pngPath(home, first))).toBe(true)

      // …then switches to the second: the superseded first file is pruned.
      expect(await postSection(base, { enabled: true, uploadId: second, url: '' })).toBe(200)
      expect(existsSync(pngPath(home, first))).toBe(false)
      expect(existsSync(pngPath(home, second))).toBe(true)
    })
  })

  it('deletes the referenced upload when the background is cleared', async () => {
    await withServer(async (base, home) => {
      const id = await postUpload(base, PNG_BYTES, 'image/png')
      expect(await postSection(base, { enabled: true, uploadId: id, url: '' })).toBe(200)
      expect(existsSync(pngPath(home, id))).toBe(true)

      expect(await postSection(base, { enabled: false, uploadId: '', url: '' })).toBe(200)
      expect(existsSync(pngPath(home, id))).toBe(false)
    })
  })

  it('keeps the upload while the same id stays referenced', async () => {
    await withServer(async (base, home) => {
      const id = await postUpload(base, PNG_BYTES, 'image/png')
      expect(await postSection(base, { enabled: true, uploadId: id, url: '' })).toBe(200)
      // A later write that still references the same id (only opacity changed)
      // must not prune the file.
      expect(await postSection(base, { enabled: true, uploadId: id, url: '', opacity: 0.5 })).toBe(200)
      expect(existsSync(pngPath(home, id))).toBe(true)
    })
  })

  it('does not prune when a section write fails validation', async () => {
    await withServer(async (base, home) => {
      const id = await postUpload(base, PNG_BYTES, 'image/png')
      expect(await postSection(base, { enabled: true, uploadId: id, url: '' })).toBe(200)
      // The write is rejected (out-of-range knob); the referenced file stays.
      expect(await postSection(base, { enabled: true, uploadId: '', url: 'https://x/a.png', scrim: 2 })).toBe(400)
      expect(existsSync(pngPath(home, id))).toBe(true)
    })
  })
})
