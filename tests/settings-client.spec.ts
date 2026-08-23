// @vitest-environment node
/**
 * Settings transport contract: save() answers a THREE-STATE result so the
 * caller can tell a committed write ('ok') from one displaced by a newer save
 * ('superseded' — its section must not be adopted back into the draft) and
 * from a rejection ('failed'). The seq guard keeps the newest snapshot; the
 * result keeps the caller honest about which kind of success it saw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsClient } from '../src/client/settings-client.ts'
import type { BackgroundSettings } from '../src/settings.ts'

const SECTION_A: BackgroundSettings = {
  enabled: true, uploadId: 'up-a', url: '', opacity: 0.3, scrim: 0.25,
  panelOpacity: 0.15, blur: 16, wallpaperBlur: 0, fit: 'cover', timeline: true,
}
const SECTION_B: BackgroundSettings = { ...SECTION_A, uploadId: 'up-b', opacity: 0.6 }

/** One JSON body as the route would serve it. */
function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsClient.save', () => {
  it("answers 'superseded' for an older save resolving after a newer one, keeping the newer snapshot", async () => {
    let releaseOlder!: (response: Response) => void
    const gatedOlder = new Promise<Response>((resolve) => { releaseOlder = resolve })
    let posts = 0
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(jsonResponse({ ok: true, value: SECTION_A }))
      posts += 1
      // The first POST hangs until released; the second answers immediately.
      return posts === 1 ? gatedOlder : Promise.resolve(jsonResponse({ ok: true, value: SECTION_B }))
    }))

    const client = new SettingsClient()
    const older = client.save(SECTION_A)
    const newer = client.save(SECTION_B)
    releaseOlder(jsonResponse({ ok: true, value: SECTION_A }))

    expect(await older).toBe('superseded')
    expect(await newer).toBe('ok')
    expect(client.getSnapshot().value).toEqual(SECTION_B)
  })

  it("answers 'failed' when the route rejects the write", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 400, json: async () => ({ ok: false }),
    } as unknown as Response)))
    const client = new SettingsClient()
    expect(await client.save(SECTION_A)).toBe('failed')
  })

  it("answers 'ok' and adopts the served section on a plain successful save", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ ok: true, value: SECTION_B }))))
    const client = new SettingsClient()
    expect(await client.save(SECTION_A)).toBe('ok')
    expect(client.getSnapshot().value).toEqual(SECTION_B)
    // The settled save releases its handle — a later flush() resolves
    // instantly instead of awaiting a stale gesture's promise forever.
    expect((client as unknown as { pending: unknown }).pending).toBeUndefined()
    await client.flush()
  })
})
