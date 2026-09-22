// @vitest-environment node
/**
 * Host `apply()` across the two settings generations.
 *
 * dsh 0.1.5/0.1.6 mount a `SettingsProvider` (register/get/replace) and the
 * plugin owns a `ui-background` namespace. dsh 0.1.7 replaced it with
 * `SettingsForms` (configure/describe/update/replace/mutate): the namespace is
 * the profile entry id and the schema comes from the plugin's exported
 * `Config`, so `register()` is gone. Both generations must still mount the
 * same route family, against the namespace that generation actually keys on.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apply } from '../src/index.ts'
import { BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema } from '../src/schema.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Entry id the profile patch inserts for this plugin (0.1.7's namespace). */
const ENTRY_ID = 'deepseek-harness-background'

/** Everything the host half touched, per mounted generation. */
interface Harness {
  routes: WebRoute[]
  registered: { ns: string; schema: unknown }[]
  configured: { auto?: boolean }[]
}

/**
 * Mount the host half over a settings surface. `legacy` decides whether the
 * surface carries `register()` (0.1.5/0.1.6) or `configure()` (0.1.7).
 */
async function mountHost(initial: Record<string, Record<string, unknown>>, legacy: boolean): Promise<Harness> {
  const store = new Map<string, Record<string, unknown>>()
  for (const [ns, section] of Object.entries(initial)) store.set(ns, { ...section })
  const harness: Harness = { routes: [], registered: [], configured: [] }
  // Legacy `describe()` lists REGISTERED namespaces; 0.1.7's lists active
  // profile entries. Both resolve their value out of the same document store.
  const registeredNamespaces = new Set<string>()
  const settings: Record<string, unknown> = {
    describe() {
      const namespaces = legacy ? [...registeredNamespaces] : [...store.keys()]
      return namespaces.map((ns) => ({ ns, value: store.get(ns) }))
    },
    async replace(ns: string, section: Record<string, unknown>) { store.set(ns, { ...section }) },
    async update(ns: string, patch: Record<string, unknown>) {
      store.set(ns, { ...(store.get(ns) ?? {}), ...patch })
    },
  }
  if (legacy) {
    settings.register = (ns: string, schema: unknown) => {
      registeredNamespaces.add(ns)
      harness.registered.push({ ns, schema })
      return { get: () => store.get(ns) }
    }
  } else {
    // A faithful stand-in for the real service: it is a class instance whose
    // methods read their own state, so a DETACHED call (`const f = x.configure;
    // f()`) must fail exactly as the real one does.
    settings.configure = function (this: unknown, presentation: { auto?: boolean }) {
      if (this !== settings) throw new TypeError("Cannot read properties of undefined (reading 'presentations')")
      harness.configured.push(presentation)
      return () => {}
    }
  }
  const ctx = new Context()
  ctx.provide('settings', settings as never)
  ctx.provide('webServer', {
    register: (route: WebRoute) => {
      harness.routes.push(route)
      return () => {}
    },
  } as never)
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  return harness
}

/** The settings route out of a mounted family. */
function settingsRoute(harness: Harness): WebRoute {
  const route = harness.routes.find((candidate) => candidate.path.endsWith('/settings'))
  if (route === undefined) throw new Error('settings route was not mounted')
  return route
}

/** Drive one GET through the mounted settings route. */
async function getSection(harness: Harness): Promise<Record<string, unknown>> {
  let status = 0
  let body = ''
  const res = {
    writeHead: (code: number) => { status = code; return res },
    end: (chunk?: string) => { body = chunk ?? ''; return res },
  } as unknown as ServerResponse
  const req = { method: 'GET', headers: { host: '127.0.0.1:3290' } } as unknown as IncomingMessage
  await settingsRoute(harness).handler(req, res)
  expect(status).toBe(200)
  return (JSON.parse(body) as { value: Record<string, unknown> }).value
}

const SECTION = { enabled: true, uploadId: 'up-1', url: '', opacity: 0.4 }

describe('host module surface', () => {
  it('exports the volatile Config the 0.1.7 loader projects into the settings form', async () => {
    const hostModule = await import('../src/index.ts')
    const config = hostModule.Config as unknown as { dict?: Record<string, { meta: { volatile?: boolean } }> }
    expect(config).toBeDefined()
    // Every field must be volatile or `settings.replace(entryId, ...)` refuses
    // the write. This is the export the Loader reads off the entry's module.
    expect(Object.values(config.dict ?? {}).every((field) => field.meta.volatile === true)).toBe(true)
  })
})

describe('host apply over dsh 0.1.5/0.1.6 (SettingsProvider)', () => {
  it('registers the ui-background namespace and serves it over the routes', async () => {
    const harness = await mountHost({ [BACKGROUND_SETTINGS_NAMESPACE]: SECTION }, true)
    expect(harness.registered.map((entry) => entry.ns)).toEqual([BACKGROUND_SETTINGS_NAMESPACE])
    expect(harness.registered[0]?.schema).toBe(BackgroundSettingsSchema)
    expect(harness.configured).toEqual([])
    expect(await getSection(harness)).toMatchObject(SECTION)
  })

  it('skips a second registration when the namespace already stands (HMR re-run)', async () => {
    const settings = {
      describe: () => [{ ns: BACKGROUND_SETTINGS_NAMESPACE, value: SECTION }],
      replace: async () => {},
      register: vi.fn(),
    }
    const ctx = new Context()
    ctx.provide('settings', settings as never)
    ctx.provide('webServer', { register: () => () => {} } as never)
    const mounted = ctx.plugin({ apply })
    await mounted.await()
    expect(settings.register).not.toHaveBeenCalled()
    await mounted.dispose()
  })
})

describe('host apply over dsh 0.1.7 (SettingsForms)', () => {
  it('never calls register, suppresses the auto page, and serves the entry namespace', async () => {
    const harness = await mountHost({ [ENTRY_ID]: SECTION }, false)
    expect(harness.registered).toEqual([])
    expect(harness.configured).toEqual([{ auto: false }])
    // The routes resolve the entry id (no loader entry in this harness, so the
    // documented fallback is the plugin's own package name).
    expect(await getSection(harness)).toMatchObject(SECTION)
  })
})
