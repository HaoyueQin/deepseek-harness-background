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
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
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
    expect(resolveHarnessHome(env)).toBe(resolvePath('C:/custom/dsh'))
  })

  it('expands a leading tilde against the OS home (official expandHomePath semantics)', () => {
    const env = { DSH_HOME: '~/my-dsh' } as NodeJS.ProcessEnv
    expect(resolveHarnessHome(env)).toBe(joinPath(homedir(), 'my-dsh'))
    const winEnv = { DSH_HOME: '~\\my-dsh' } as NodeJS.ProcessEnv
    expect(resolveHarnessHome(winEnv)).toBe(joinPath(homedir(), 'my-dsh'))
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

/** In-memory settings provider exposing only what the route family uses.
 * `initial` maps namespace → section, like the real provider's document. */
function settingsMock(initial: Record<string, Record<string, unknown>> = {}): SettingsProvider {
  const store = new Map<string, Record<string, unknown>>()
  for (const [ns, section] of Object.entries(initial)) store.set(ns, { ...section })
  return {
    get(ns: string) { return store.get(ns) },
    async update(ns: string, patch: Record<string, unknown>) {
      const current = store.get(ns) ?? {}
      store.set(ns, { ...current, ...patch })
    },
    async replace(ns: string, section: Record<string, unknown>) {
      store.set(ns, { ...section })
    },
  } as unknown as SettingsProvider
}

/** Boot a real node:http server over the route family on an ephemeral port. */
async function withServer(
  fn: (base: string, home: string) => Promise<void>,
  initial?: Record<string, Record<string, unknown>>,
): Promise<void> {
  const home = freshHome()
  const routes = makeBackgroundRoutes(settingsMock(initial ?? {}), { home })
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

/** GET one section read; returns the parsed value. */
async function getSection(base: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/bg-wallpaper/settings`)
  expect(res.status).toBe(200)
  const body = await res.json() as { ok: boolean; value?: Record<string, unknown> }
  expect(body.ok).toBe(true)
  return body.value as Record<string, unknown>
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

describe('section write scrubs legacy unknown fields', () => {
  /** A user document written by an older plugin version: carries lightUrl/darkUrl. */
  const legacyInitial = {
    [BACKGROUND_SETTINGS_NAMESPACE]: {
      enabled: true, lightUrl: '', darkUrl: '', opacity: 0.6,
      uploadId: '', url: '', scrim: 0.4, panelOpacity: 0.3,
      blur: 3, wallpaperBlur: 0, fit: 'cover',
    },
  }

  it('clears fields the current schema no longer knows', async () => {
    // The settings layer keeps unknown keys in the user document, so only a
    // scrubbed replace removes them.
    await withServer(async (base) => {
      const before = await getSection(base)
      expect(before).toHaveProperty('lightUrl')
      expect(before).toHaveProperty('darkUrl')

      expect(await postSection(base, { enabled: true, uploadId: '', url: '', opacity: 0.5 })).toBe(200)

      const after = await getSection(base)
      expect(after).not.toHaveProperty('lightUrl')
      expect(after).not.toHaveProperty('darkUrl')
      expect(after.opacity).toBe(0.5)
    }, legacyInitial)
  })

  it('keeps known fields the posted section does not mention', async () => {
    await withServer(async (base) => {
      expect(await postSection(base, { enabled: true, uploadId: '', url: '', opacity: 0.5 })).toBe(200)
      // The untouched knobs keep their stored values (partial writes still merge).
      const after = await getSection(base)
      expect(after.opacity).toBe(0.5)
      expect(after.scrim).toBe(0.4)
      expect(after.blur).toBe(3)
    }, legacyInitial)
  })
})

/** GET /settings through the raw node:http client, which (unlike fetch/undici)
 * sends the given Host header verbatim — the only way to simulate a browser
 * whose Host differs from the connection target. Resolves with the status. */
function rawGetSettings(port: number, connectHost: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: connectHost, port, path: '/api/bg-wallpaper/settings', method: 'GET', headers },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('request fence (loopback host allowlist)', () => {
  /** One settings route over a server bound to `bindHost`, torn down after `fn`. */
  async function withFenceServer(
    fn: (port: number) => Promise<void>,
    bindHost = '127.0.0.1',
  ): Promise<void> {
    const home = freshHome()
    const routes = makeBackgroundRoutes(settingsMock(), { home })
    const server = createServer((req, res) => {
      void routes[0]?.handler(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, bindHost, resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await fn(port)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('rejects a non-loopback Host even when Origin is self-consistent (DNS rebinding)', async () => {
    await withFenceServer(async (port) => {
      // Origin matches Host and sec-fetch-site is same-origin — the old
      // self-consistency check alone would admit this; the loopback
      // allowlist must refuse it.
      const status = await rawGetSettings(port, '127.0.0.1', {
        host: 'attacker.example:8080', origin: 'http://attacker.example:8080', 'sec-fetch-site': 'same-origin',
      })
      expect(status).toBe(403)
    })
  })

  it('accepts a bracketed IPv6 loopback Host with port ([::1]:<port>)', async () => {
    // Bind ::1 for real and connect over it: node:http then sends the Host a
    // browser would (`[::1]:<port>`), exercising the bracket-stripping path.
    await withFenceServer(async (port) => {
      const status = await rawGetSettings(port, '::1', {
        origin: `http://[::1]:${port}`, 'sec-fetch-site': 'same-origin',
      })
      expect(status).toBe(200)
    }, '::1')
  })

  it('rejects a bracketed non-loopback Host with port', async () => {
    await withFenceServer(async (port) => {
      const status = await rawGetSettings(port, '127.0.0.1', {
        host: '[attacker.example]:8080', origin: 'http://attacker.example:8080', 'sec-fetch-site': 'same-origin',
      })
      expect(status).toBe(403)
    })
  })

  it('accepts a loopback Host with no Origin header (curl-style)', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/bg-wallpaper/settings`)
      expect(res.status).toBe(200)
    })
  })

  it('accepts a same-origin browser request on a loopback Host', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/bg-wallpaper/settings`, {
        headers: { origin: base, 'sec-fetch-site': 'same-origin' },
      })
      expect(res.status).toBe(200)
    })
  })
})

describe('image route (serve stored uploads)', () => {
  it('serves a stored upload as its sniffed image type with nosniff', async () => {
    await withServer(async (base) => {
      const id = await postUpload(base, PNG_BYTES, 'image/png')
      const res = await fetch(`${base}/api/bg-wallpaper/image/${id}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    })
  })

  it('answers 404 for an unknown or malformed id', async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/api/bg-wallpaper/image/up-${'a'.repeat(24)}`)).status).toBe(404)
      expect((await fetch(`${base}/api/bg-wallpaper/image/..%2Fetc%2Fpasswd`)).status).toBe(404)
    })
  })
})

describe('validateSectionBody field pre-checks', () => {
  it('rejects a non-boolean enabled', () => {
    expect(validateSectionBody({ enabled: 'false' })).toBe('invalid-enabled')
    expect(validateSectionBody({ enabled: 1 })).toBe('invalid-enabled')
  })

  it('rejects an out-of-enum fit', () => {
    expect(validateSectionBody({ fit: 'fill' })).toBe('invalid-fit')
    expect(validateSectionBody({ fit: 1 })).toBe('invalid-fit')
  })

  it('still accepts valid enabled/fit values', () => {
    expect(validateSectionBody({ enabled: true, fit: 'contain' })).toBeNull()
  })
})
