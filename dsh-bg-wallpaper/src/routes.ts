/**
 * Host HTTP routes for the background plugin — the browser half talks to the
 * host through plain same-origin endpoints (no settings RPC involved, so the
 * api-proxy's settings allowlist cannot shadow the namespace). The section
 * still lives in the official settings document: reads/writes go through
 * `ctx.settings` in-process, which the allowlist only gates at the RPC
 * boundary. Same pattern as dsh-web-ui's `/api/skin-center` and `/api/pet`
 * route families.
 *
 * `/api/bg-wallpaper/settings` writes the user's configuration, so the route
 * rejects cross-site requests (Sec-Fetch-Site / Origin fence) — a malicious
 * webpage must not be able to change the user's background through a
 * localhost CSRF post.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Settings } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_SCRIM,
  type BackgroundSettings,
} from './settings.ts'

/** Browser-facing base path of the background API. */
export const BACKGROUND_API_PREFIX = '/api/bg-wallpaper'

/** Resolved section when the stored document has no user layer. */
const DEFAULTS: BackgroundSettings = {
  enabled: false,
  lightUrl: '',
  darkUrl: '',
  opacity: DEFAULT_OPACITY,
  scrim: DEFAULT_SCRIM,
  fit: DEFAULT_FIT,
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

/** Read the raw request body (JSON, bounded). */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text) as Record<string, unknown>)
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** One background API route family over the settings provider. */
export function makeBackgroundRoutes(settings: Settings): WebRoute[] {
  const readSection = (): BackgroundSettings => {
    const section = settings.get(BACKGROUND_SETTINGS_NAMESPACE) as BackgroundSettings | undefined
    return section ?? { ...DEFAULTS }
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
          if (!requireMethod(req, res, 'POST')) return
          try {
            const body = await readJsonBody(req)
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
  ]
}
