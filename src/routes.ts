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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join as joinPath } from 'node:path'
import type { Settings } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  BACKGROUND_API_PREFIX, BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_BLUR, DEFAULT_FIT,
  DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM, type BackgroundSettings,
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
  wallpaperBlur: 0,
  fit: DEFAULT_FIT,
}

/** Accepted upload MIME type → file extension. */
const ACCEPTED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
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

/** A stored upload id is `<up-` + hex + `>`; the on-disk file appends its extension. */
function isUploadId(id: string): boolean {
  return /^up-[a-f0-9]+$/.test(id)
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
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    if (typeof host !== 'string' || host === '') return false
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

/** Resolve an upload id to its on-disk path (or "" if invalid / missing). */
function uploadPath(id: string, homeOverride?: string): string {
  // Only allow well-formed ids over the image route — the path-escape fence.
  if (!isUploadId(id)) return ''
  const dir = ensurePluginHome(homeOverride)
  // Extension is fixed to the sniffed format at write time; scan for the file.
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const candidate = joinPath(dir, `${id}.${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return ''
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
export function makeBackgroundRoutes(settings: Settings, opts: { home?: string } = {}): WebRoute[] {
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
            const body = await readJsonBody(req)
            // Server-authoritative shape checks (never trust the client to
            // clamp): the url must be a bounded http(s) string, and any
            // uploadId must be a well-formed upload id.
            if (body.url !== undefined) {
              if (typeof body.url !== 'string' || body.url.length > 4096 || (body.url !== '' && !/^https?:\/\//i.test(body.url))) {
                json(res, 400, { ok: false, error: 'invalid-url' })
                return
              }
            }
            if (body.uploadId !== undefined) {
              if (typeof body.uploadId !== 'string' || (body.uploadId !== '' && !isUploadId(body.uploadId))) {
                json(res, 400, { ok: false, error: 'invalid-upload-id' })
                return
              }
            }
            // The client posts the whole section; update merges the user layer.
            await settings.update(BACKGROUND_SETTINGS_NAMESPACE, body)
            json(res, 200, { ok: true, value: readSection() })
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
      handler: (req, res) => {
        if (!requireMethod(req, res, 'GET')) return
        const rawPath = new URL(req.url ?? '/', 'http://x').pathname
        const id = rawPath.startsWith(`${BACKGROUND_API_PREFIX}/image/`)
          ? decodeURIComponent(rawPath.slice(`${BACKGROUND_API_PREFIX}/image/`.length))
          : ''
        const abs = uploadPath(id, opts.home)
        if (abs === '') {
          json(res, 404, { ok: false, error: 'not-found' })
          return
        }
        try {
          const data = readFileSync(abs)
          const mime = mimeForPath(abs) ?? 'application/octet-stream'
          const stat = statSync(abs)
          res.writeHead(200, {
            'content-type': mime,
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
