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
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { resolveHarnessHome } from '../src/harness-home.ts'
import {
  makeBackgroundRoutes, pluginHome, readBackgroundSection, storeUpload, validateSectionBody,
  type BackgroundSettingsService,
} from '../src/routes.ts'
import { BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_BLUR, DEFAULT_FIT, DEFAULT_SCRIM } from '../src/settings.ts'

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
    // Length-capped fence: real ids are 'up-' + 24 hex chars.
    expect(validateSectionBody({ uploadId: 'up-' + 'a'.repeat(65) }, freshHome())).toBe('invalid-upload-id')
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
function settingsMock(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>()
  for (const [ns, section] of Object.entries(initial)) store.set(ns, { ...section })
  return {
    get(ns: string) { return store.get(ns) },
    // The real provider reports the raw USER layer as `user` whenever the
    // document holds a section — the migration gate reads exactly that.
    describe() { return [...store].map(([ns, value]) => ({ ns, value, user: value })) },
    async update(ns: string, patch: Record<string, unknown>) {
      const current = store.get(ns) ?? {}
      store.set(ns, { ...current, ...patch })
    },
    async replace(ns: string, section: Record<string, unknown>) {
      store.set(ns, { ...section })
    },
  }
}

/**
 * In-memory settings surface shaped like dsh 0.1.7's `SettingsForms`: it
 * exposes `describe()` and `replace()` and NOTHING else — in particular no
 * `get()`, which the 0.1.7 rewrite removed. Any route that still reaches for
 * `get` must fail against this mock.
 */
function modernSettingsMock(initial: Record<string, Record<string, unknown>> = {}): unknown {
  const store = new Map<string, Record<string, unknown>>()
  for (const [ns, section] of Object.entries(initial)) store.set(ns, { ...section })
  return {
    describe() { return [...store].map(([ns, value]) => ({ ns, value })) },
    async replace(ns: string, section: Record<string, unknown>) { store.set(ns, { ...section }) },
  }
}

describe('readBackgroundSection', () => {
  it('reads through describe() so a 0.1.7 settings service without get() works', () => {
    const settings = modernSettingsMock({ [BACKGROUND_SETTINGS_NAMESPACE]: { enabled: true, opacity: 0.5 } })
    expect(readBackgroundSection(settings as never)).toMatchObject({
      enabled: true, opacity: 0.5, scrim: DEFAULT_SCRIM, fit: DEFAULT_FIT,
    })
  })

  it('resolves schema defaults when the namespace is absent', () => {
    const section = readBackgroundSection(modernSettingsMock() as never)
    expect(section.enabled).toBe(false)
    expect(section.uploadId).toBe('')
    expect(section.blur).toBe(DEFAULT_BLUR)
  })
})

describe('namespace option (0.1.7 keys the section by the profile entry id)', () => {
  it('reads and writes the supplied namespace instead of ui-background', async () => {
    const entry = 'deepseek-harness-background'
    await withServer(async (base) => {
      expect((await getSection(base)).enabled).toBe(true)
      expect(await postSection(base, { enabled: false, uploadId: '', url: '' })).toBe(200)
      expect((await getSection(base)).enabled).toBe(false)
    }, { [entry]: { enabled: true, uploadId: '', url: '' } }, entry)
  })

  it('leaves a section under the default namespace untouched when another is addressed', async () => {
    await withServer(async (base) => {
      // The 0.1.5/0.1.6 section is not the addressed one: reads fall back to
      // defaults rather than leaking the other namespace's values.
      expect((await getSection(base)).enabled).toBe(false)
    }, { [BACKGROUND_SETTINGS_NAMESPACE]: { enabled: true, uploadId: '', url: '' } }, 'deepseek-harness-background')
  })
})

/**
 * Ports Node's fetch (undici) refuses to connect to on principle, loopback
 * included (undici's `badPorts` list). A Windows dynamic port range can start
 * at 1024 — this machine's does, 1024-15000 — so `listen(0)` is handed one of
 * these often enough to flake the suite: the socket is fine, `fetch` rejects
 * the URL with "bad port".
 */
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103,
  104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143, 161, 179, 389, 427, 465, 512,
  513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697,
  10080,
])

/**
 * Listen on an OS-assigned port that fetch will actually accept: a draw inside
 * the blocked list is released and re-drawn (bounded, so a pathological range
 * fails loudly instead of spinning).
 * @param server - the server to bind (not yet listening).
 * @param host - the bind address.
 * @returns the accepted port.
 */
async function listenFetchable(server: Server, host = '127.0.0.1'): Promise<number> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise<void>((resolve) => { server.listen(0, host, resolve) })
    const port = (server.address() as AddressInfo).port
    if (!FETCH_BLOCKED_PORTS.has(port)) return port
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
  throw new Error('no fetchable port could be drawn')
}

/** Boot a real node:http server over the route family on an ephemeral port. */
async function withServer(
  fn: (base: string, home: string) => Promise<void>,
  initial?: Record<string, Record<string, unknown>>,
  namespace?: string,
): Promise<void> {
  const home = freshHome()
  const routes = makeBackgroundRoutes(settingsMock(initial ?? {}), { home, namespace })
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    const route = routes.find((r) => (
      r.kind === 'exact' ? r.path === url : url.startsWith(r.path)
    ))
    if (!route) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  const port = await listenFetchable(server)
  const base = `http://127.0.0.1:${port}`
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

/** GET one settings read; returns the whole JSON envelope. */
async function getSettingsBody(base: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/bg-wallpaper/settings`)
  expect(res.status).toBe(200)
  return await res.json() as Record<string, unknown>
}

/** The document dsh <= 0.1.6 wrote, as dsh 0.1.7 renamed it away. */
const LEGACY_SETTINGS_DOCUMENT = [
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
  '',
].join('\n')

describe('legacy settings migration on the first read', () => {
  const ENTRY = 'deepseek-harness-background'

  it('adopts the renamed pre-0.1.7 section and reports where it came from', async () => {
    await withServer(async (base, home) => {
      writeFileSync(joinPath(home, 'settings.yaml.imported'), LEGACY_SETTINGS_DOCUMENT, 'utf8')

      const first = await getSettingsBody(base)
      expect(first.migrated).toEqual({ from: 'settings.yaml.imported' })
      expect(first.value).toMatchObject({
        enabled: true, uploadId: 'up-468ddc69ecb171facd87c60e', opacity: 0.2, blur: 4,
      })

      // One-shot: the marker is written, so a later read reports no migration
      // and the adopted section still stands.
      const second = await getSettingsBody(base)
      expect(second.migrated).toBeUndefined()
      expect(second.value).toMatchObject({ enabled: true, opacity: 0.2 })
      expect(existsSync(joinPath(home, 'deepseek-harness-background', '.migrated-from-legacy-settings'))).toBe(true)
    }, undefined, ENTRY)
  })

  it('never overwrites a section the entry already carries', async () => {
    await withServer(async (base, home) => {
      writeFileSync(joinPath(home, 'settings.yaml.imported'), LEGACY_SETTINGS_DOCUMENT, 'utf8')
      const body = await getSettingsBody(base)
      expect(body.migrated).toBeUndefined()
      expect(body.value).toMatchObject({ opacity: 0.9 })
    }, { [ENTRY]: { enabled: false, uploadId: '', url: '', opacity: 0.9 } }, ENTRY)
  })
})

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

describe('merged-section source exclusivity (partial writes included)', () => {
  it('rejects a partial write that would leave both sources set after merging', async () => {
    await withServer(async (base, home) => {
      const id = await postUpload(base, PNG_BYTES, 'image/png')
      // The stored section references an upload…
      expect(await postSection(base, { enabled: true, uploadId: id, url: '' })).toBe(200)
      // …a url-only body passes body-level validation (the two fields are not
      // both present in the POST), but the merged section would carry BOTH
      // sources — the route must refuse it before replace commits.
      expect(await postSection(base, { url: 'https://example.com/a.jpg' })).toBe(400)
      const after = await getSection(base)
      expect(after.uploadId).toBe(id)
      expect(after.url).toBe('')
      expect(existsSync(pngPath(home, id))).toBe(true)
    })
  })

  it('still accepts full-section swaps that clear the other source', async () => {
    await withServer(async (base, home) => {
      const id = await postUpload(base, PNG_BYTES, 'image/png')
      expect(await postSection(base, { enabled: true, uploadId: id, url: '' })).toBe(200)
      expect(await postSection(base, { enabled: true, uploadId: '', url: 'https://example.com/a.jpg' })).toBe(200)
      const after = await getSection(base)
      expect(after.uploadId).toBe('')
      expect(after.url).toBe('https://example.com/a.jpg')
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
    const port = await listenFetchable(server, bindHost)
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
      // Malformed percent-escapes must not surface as an unhandled rejection.
      expect((await fetch(`${base}/api/bg-wallpaper/image/%zz`)).status).toBe(404)
      expect((await fetch(`${base}/api/bg-wallpaper/image/%2`)).status).toBe(404)
    })
  })
})

describe('validateSectionBody field pre-checks', () => {
  it('rejects a non-boolean enabled', () => {
    expect(validateSectionBody({ enabled: 'false' })).toBe('invalid-enabled')
    expect(validateSectionBody({ enabled: 1 })).toBe('invalid-enabled')
  })

  it('rejects a non-boolean timeline flag', () => {
    expect(validateSectionBody({ timeline: 'true' })).toBe('invalid-timeline')
    expect(validateSectionBody({ timeline: 1 })).toBe('invalid-timeline')
    expect(validateSectionBody({ timeline: false })).toBeNull()
  })

  it('rejects an out-of-enum fit incl. the empty string', () => {
    expect(validateSectionBody({ fit: 'fill' })).toBe('invalid-fit')
    expect(validateSectionBody({ fit: 1 })).toBe('invalid-fit')
    // '' must not slip past the pre-check into the persisted document.
    expect(validateSectionBody({ fit: '' })).toBe('invalid-fit')
  })

  it('still accepts valid enabled/fit values', () => {
    expect(validateSectionBody({ enabled: true, fit: 'contain' })).toBeNull()
  })
})
