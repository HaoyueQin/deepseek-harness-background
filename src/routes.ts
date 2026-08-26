/**
 * Host HTTP routes for the background plugin — the browser half talks to the
 * host through plain same-origin endpoints (no settings RPC involved, so the
 * api-proxy's settings allowlist cannot shadow the namespace). The section
 * still lives in the official settings document: reads/writes go through
 * `ctx.settings` in-process, which the allowlist only gates at the RPC
 * boundary.
 *
 * Route family (`/api/bg-wallpaper`):
 *   GET  /settings        read the section
 *   POST /settings        write the section (cross-site fenced)
 *   POST /upload          accept an uploaded image body, store it under the
 *                         harness home, return its content-addressed url
 *   GET  /image/<id>      serve a stored upload (path-escape fenced)
 *
 * Same pattern as dsh-web-ui's `/api/skin-center` and `/api/pet` families.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join as joinPath } from 'node:path'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  BACKGROUND_API_PREFIX, BACKGROUND_SETTINGS_FIELDS, BACKGROUND_SETTINGS_NAMESPACE,
  BLUR_MAX, BLUR_MIN, DEFAULT_BLUR, DEFAULT_FIT,
  DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM, DEFAULT_TIMELINE,
  DEFAULT_WALLPAPER_BLUR, OPACITY_MAX, OPACITY_MIN, PANEL_OPACITY_MAX, PANEL_OPACITY_MIN,
  SCRIM_MAX, SCRIM_MIN, WALLPAPER_BLUR_MAX,
  FIT_MODES, type BackgroundFit,
  type BackgroundSettings,
} from './settings.ts'
import { PLUGIN_HOME_REL, resolveHarnessHome } from './harness-home.ts'

/** Re-export the shared API prefix for host-side consumers. */
export { BACKGROUND_API_PREFIX } from './settings.ts'

/** Resolved section when the stored document has no user layer. */
const DEFAULTS: BackgroundSettings = {
  enabled: false,
  uploadId: '',
  url: '',
  opacity: DEFAULT_OPACITY,
  scrim: DEFAULT_SCRIM,
  panelOpacity: DEFAULT_PANEL_OPACITY,
  blur: DEFAULT_BLUR,
  wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
  fit: DEFAULT_FIT,
  timeline: DEFAULT_TIMELINE,
}

/** Keep only the schema's known fields (see BACKGROUND_SETTINGS_FIELDS). */
function pickKnown(section: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const src = section as Record<string, unknown>
  for (const key of BACKGROUND_SETTINGS_FIELDS) {
    if (key in src) out[key] = src[key]
  }
  return out
}

/** Accepted upload MIME type → file extension. */
const ACCEPTED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Numeric knob bounds — same ranges as the schema, duplicated here so the
 * POST route can reject out-of-range numbers before they reach the schema's
 * JSON layer (that layer runs `Number(...)` on string inputs, which silently
 * coerces e.g. `"2"` into `2` instead of rejecting the body). */
const NUM_BOUNDS: Record<string, { min: number; max: number }> = {
  opacity: { min: OPACITY_MIN, max: OPACITY_MAX },
  scrim: { min: SCRIM_MIN, max: SCRIM_MAX },
  panelOpacity: { min: PANEL_OPACITY_MIN, max: PANEL_OPACITY_MAX },
  blur: { min: BLUR_MIN, max: BLUR_MAX },
  wallpaperBlur: { min: BLUR_MIN, max: WALLPAPER_BLUR_MAX },
}

/** Magic-byte signatures for the accepted formats (first bytes). */
function sniffImage(bytes: Uint8Array): string | null {
  // JPEG: FF D8 FF  (normalizes to 'jpg'; canonical on-disk extension)
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png'
  // WebP: 52 49 46 46 .... 57 45 42 50 at offset 8
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  // GIF87a / GIF89a: 47 49 46 38
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  return null
}

/** Per-upload size cap (20 MiB). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** A stored upload id is `<up-` + hex + `>`; the on-disk file appends its extension.
 * Length-capped (ids are 'up-' + 24 hex chars today): the cap keeps the
 * path-escape fence from admitting absurdly long filesystem probes. */
function isUploadId(id: string): boolean {
  return /^up-[a-f0-9]{1,64}$/.test(id)
}

/** One JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Require the method or answer 405. */
function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/**
 * Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch; a
 * cross-site fetch is always rejected, and an `Origin` that does not match
 * the request `Host` is rejected. Requests without either header (curl, node
 * http) pass — this is a local single-user tool, and the fence only targets
 * the cross-site browser vector.
 *
 * The `Host` itself must also be a loopback name: under a DNS-rebinding
 * attack the attacker's page resolves their own domain to 127.0.0.1, so both
 * `Origin` and `Host` carry the attacker's hostname and the self-consistency
 * check above alone would admit them. The web server binds loopback (or is
 * deliberately exposed on 0.0.0.0 by its operator), so accepting only
 * 127.0.0.1 / localhost / [::1] keeps every legitimate same-origin client
 * working while refusing rebounded ones.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function isLoopbackHost(host: string): boolean {
  // Strip the port. A bare IPv4/hostname ends at the first colon; a bracketed
  // IPv6 literal (`[::1]:8080`, what browsers actually send) keeps up to the
  // closing bracket — stripping at the first colon would leave `[::1]` intact
  // but `[::1]:8080` unstrippable, so the bracket form is handled first.
  let bare = host
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end !== -1) bare = host.slice(0, end + 1)
  } else {
    const colon = host.indexOf(':')
    if (colon !== -1) bare = host.slice(0, colon)
  }
  return LOOPBACK_HOSTS.has(bare) || LOOPBACK_HOSTS.has(host)
}

function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const host = req.headers.host
  if (typeof host !== 'string' || !isLoopbackHost(host)) return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return true
}

/** Read the raw request body (bounded; rejects without destroying the socket
 * so the caller can still write a clean error response). */
function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        req.pause()
        reject(new Error('body-too-large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

/** Read the request body as JSON (bounded; rejects without destroying the socket). */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        tooLarge = true
        req.pause()
        reject(new Error('body-too-large'))
        return
      }
      parts.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return
      try {
        const text = Buffer.concat(parts).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text) as Record<string, unknown>)
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Validate a client-posted section body. Returns an error code when the body
 * must be rejected, or null when it may be written. Beyond shape checks this
 * enforces the section's exclusivity contract (`uploadId` and `url` are
 * alternative sources — at most one may be set) and that a referenced upload
 * actually exists on disk, so a stale id cannot render a blank backdrop.
 * @param body - the parsed JSON body.
 * @param home - the plugin home used to resolve upload ids (tests inject a surrogate).
 * @returns an error code, or null when the body is acceptable.
 */
export function validateSectionBody(body: Record<string, unknown>, home?: string): string | null {
  const url = body.url
  const uploadId = body.uploadId
  if (url !== undefined) {
    if (typeof url !== 'string' || url.length > 4096 || (url !== '' && !/^https?:\/\//i.test(url))) {
      return 'invalid-url'
    }
  }
  if (uploadId !== undefined) {
    if (typeof uploadId !== 'string' || (uploadId !== '' && !isUploadId(uploadId))) {
      return 'invalid-upload-id'
    }
    if (uploadId !== '' && typeof url === 'string' && url !== '') {
      return 'mutually-exclusive-source'
    }
    if (uploadId !== '' && uploadPath(uploadId, home) === '') {
      return 'upload-not-found'
    }
  }
  // Numeric knobs must be finite numbers inside their schema bounds (see
  // NUM_BOUNDS). Rejecting here keeps string coercion — `"2"` becoming `2` —
  // from silently bypassing the schema's range check.
  for (const [key, { min, max }] of Object.entries(NUM_BOUNDS)) {
    const raw = body[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
      return 'invalid-range'
    }
  }
  // The remaining fields get the same explicit treatment so every rejected
  // body answers with a stable error code instead of the schema layer's raw
  // ValidationError text. (Measured on @deepseek-ai/schemastery 3.18.1: it
  // does reject non-boolean/non-enum values — this is message consistency,
  // not a coercion fix.)
  const enabled = body.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') return 'invalid-enabled'
  const timeline = body.timeline
  if (timeline !== undefined && typeof timeline !== 'boolean') return 'invalid-timeline'
  const fit = body.fit
  if (fit !== undefined && !FIT_MODES.includes(fit as BackgroundFit)) {
    return 'invalid-fit'
  }
  return null
}

/**
 * The directory this plugin owns under the harness home. `homeOverride`
 * injects a surrogate for tests; default resolves via process.env.
 */
export function pluginHome(homeOverride?: string): string {
  return joinPath(homeOverride ?? resolveHarnessHome(), PLUGIN_HOME_REL)
}

/** Ensure and return the uploads directory. */
export function ensurePluginHome(homeOverride?: string): string {
  const dir = pluginHome(homeOverride)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Stores a validated image body under the plugin home, content-addressed by a
 * fresh random id. Returns the id and the browser-facing url.
 */
export function storeUpload(bytes: Buffer, mime: string, homeOverride?: string): { id: string; url: string } {
  const declaredExt = ACCEPTED_TYPES[mime]
  const sniffed = sniffImage(bytes)
  // Unambiguous: the declared MIME must be a known image and must agree with
  // the detected signature (mirroring dsh-avatar's triple-check policy).
  if (declaredExt === undefined || sniffed === null || declaredExt !== sniffed) {
    throw new Error('unsupported-or-mismatched-image')
  }
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('upload-too-large')
  const id = 'up-' + randomBytes(12).toString('hex')
  const dir = ensurePluginHome(homeOverride)
  writeFileSync(joinPath(dir, `${id}.${sniffed}`), bytes)
  return { id, url: `${BACKGROUND_API_PREFIX}/image/${id}` }
}

/** Resolve an upload id to its on-disk path (or "" if invalid / missing).
 * Read-only: unlike the write path this never creates the plugin home, so a
 * GET cannot pay for (or race) a mkdirSync on every request. */
function uploadPath(id: string, homeOverride?: string): string {
  // Only allow well-formed ids over the image route — the path-escape fence.
  if (!isUploadId(id)) return ''
  const dir = pluginHome(homeOverride)
  // Extension is fixed to the sniffed format at write time (jpg/png/webp/gif);
  // scan for the file.
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const candidate = joinPath(dir, `${id}.${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return ''
}

/**
 * Delete one stored upload file. Missing files are ignored; only well-formed
 * upload ids reach the disk (the same path-escape fence as uploadPath).
 */
export function deleteUploadFile(id: string, homeOverride?: string): void {
  if (!isUploadId(id)) return
  const abs = uploadPath(id, homeOverride)
  if (abs === '') return
  try {
    unlinkSync(abs)
  } catch {
    // A file that vanished between the existence check and the unlink is
    // already gone — treat as success.
  }
}

/** MIME for a stored file path. */
function mimeForPath(path: string): string | undefined {
  const ext = extname(path).slice(1)
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return undefined
}

/** One background API route family over the settings provider + home. */
export function makeBackgroundRoutes(settings: SettingsProvider, opts: { home?: string } = {}): WebRoute[] {
  const readSection = (): BackgroundSettings => {
    const section = settings.get(BACKGROUND_SETTINGS_NAMESPACE) as BackgroundSettings | undefined
    return { ...DEFAULTS, ...section }
  }

  return [
    {
      kind: 'exact',
      path: `${BACKGROUND_API_PREFIX}/settings`,
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
          return
        }
        if (req.method === 'GET') {
          json(res, 200, { ok: true, value: readSection() })
          return
        }
        if (req.method === 'POST') {
          try {
            // Snapshot the section before the write: when the posted section
            // replaces its upload source, the superseded file is pruned after
            // the update commits (never on validation failure).
            const before = readSection()
            const body = await readJsonBody(req)
            // Server-authoritative shape checks (never trust the client to
            // clamp): the url must be a bounded http(s) string, any uploadId
            // must be a well-formed id that exists on disk, and the two
            // sources are mutually exclusive.
            const validationError = validateSectionBody(body, opts.home)
            if (validationError !== null) {
              json(res, 400, { ok: false, error: validationError })
              return
            }
            // The client posts the whole section. The write replaces the user
            // layer (merge of the current known fields + the posted ones)
            // rather than merging blindly: the settings layer keeps unknown
            // keys in the document, so a merge-only write would let legacy
            // fields (e.g. the old lightUrl/darkUrl pair) linger forever.
            const merged = { ...pickKnown(readSection()), ...pickKnown(body) }
            // Exclusivity is a property of the MERGED section, not of the
            // posted body alone: a partial write ({ url } only) over a stored
            // uploadId would otherwise leave both sources set — the browser
            // resolves uploads first, so the fresh url could never paint.
            if (merged.uploadId !== '' && merged.url !== '') {
              json(res, 400, { ok: false, error: 'mutually-exclusive-source' })
              return
            }
            await settings.replace(BACKGROUND_SETTINGS_NAMESPACE, merged)
            const after = readSection()
            // Prune the replaced upload: switching images (or clearing) must
            // not leave the old file on disk forever. Only the *previous*
            // upload id is ever removed — new ids are content-addressed and
            // unique, so a concurrent upload can never be a prune victim.
            if (before.uploadId !== '' && before.uploadId !== after.uploadId) {
              deleteUploadFile(before.uploadId, opts.home)
            }
            json(res, 200, { ok: true, value: after })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    {
      kind: 'exact',
      path: `${BACKGROUND_API_PREFIX}/upload`,
      handler: async (req, res) => {
        if (!isSameOriginRequest(req)) {
          json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
          return
        }
        if (!requireMethod(req, res, 'POST')) return
        const mime = req.headers['content-type']?.split(';')[0]?.trim() ?? ''
        if (!ACCEPTED_TYPES[mime]) {
          json(res, 400, { ok: false, error: 'unsupported-media-type' })
          return
        }
        // Reject before buffering: an unreadable body must not be consumed
        // (otherwise the 400 below would race the request stream and the
        // socket could drop before the response flushes).
        if (req.readableAborted || req.destroyed) {
          json(res, 400, { ok: false, error: 'request-aborted' })
          return
        }
        try {
          const body = await readRawBody(req, MAX_UPLOAD_BYTES + 1)
          if (body.length === 0) {
            json(res, 400, { ok: false, error: 'empty-body' })
            return
          }
          const { id, url } = storeUpload(body, mime, opts.home)
          json(res, 200, { ok: true, id, url })
        } catch (error) {
          json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'prefix',
      path: `${BACKGROUND_API_PREFIX}/image`,
      handler: async (req, res) => {
        // Same-origin fence like the write routes: a cross-site page must not
        // be able to load (probe) locally stored uploads through <img> tags.
        if (!isSameOriginRequest(req)) {
          json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
          return
        }
        if (!requireMethod(req, res, 'GET')) return
        const rawPath = new URL(req.url ?? '/', 'http://x').pathname
        // decodeURIComponent throws URIError on malformed escapes (e.g. '%zz');
        // answer 404 instead of an unhandled rejection.
        let id = ''
        try {
          id = rawPath.startsWith(`${BACKGROUND_API_PREFIX}/image/`)
            ? decodeURIComponent(rawPath.slice(`${BACKGROUND_API_PREFIX}/image/`.length))
            : ''
        } catch {
          json(res, 404, { ok: false, error: 'not-found' })
          return
        }
        const abs = uploadPath(id, opts.home)
        if (abs === '') {
          json(res, 404, { ok: false, error: 'not-found' })
          return
        }
        try {
          const data = await readFile(abs)
          const mime = mimeForPath(abs) ?? 'application/octet-stream'
          const stat = statSync(abs)
          res.writeHead(200, {
            'content-type': mime,
            // The bytes are sniffed at write time, but pin the interpretation
            // anyway so a future storage change can never turn a stored file
            // into an executable document.
            'x-content-type-options': 'nosniff',
            'content-length': String(data.length),
            'last-modified': stat.mtime.toUTCString(),
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(data)
        } catch {
          json(res, 404, { ok: false, error: 'not-found' })
        }
      },
    },
  ]
}
