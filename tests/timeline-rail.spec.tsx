// @vitest-environment jsdom
/**
 * Timeline dock entry: the bridge that mounts the official-rail enhancer.
 *
 * Pins the supported-dsh contract (>= 0.1.2-rc.1) at the bridge level:
 * - A kernel that publishes the official turn-navigation index (`useChat`)
 *   gets the behaviour-only enhancer — this plugin renders NO rail of its own.
 * - A kernel that does not gets nothing (defensive no-op): older dsh
 *   versions are directed by the README to an older plugin release, so the
 *   legacy ported rail is intentionally not shipped anymore.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { TimelineBridge } from '../src/client/timeline/index.tsx'
import { settingsClient } from '../src/client/settings-client.ts'
import type { BackgroundSettings } from '../src/settings.ts'

const t = (key: string): string => key

/** Write the shared settings snapshot (the dock entry reads it via uSES). */
function setSettings(status: 'loading' | 'ready' | 'error', timeline: boolean): void {
  ;(settingsClient as unknown as { snapshot: unknown }).snapshot = {
    status,
    value: { timeline } as unknown as BackgroundSettings,
  }
}

interface RenderExtra {
  useChat?: (selector: (snapshot: unknown) => unknown) => unknown
  useProjection?: (key: string) => unknown
}

function renderTimeline(sessionId: string, extra: RenderExtra = {}): void {
  render(React.createElement(TimelineBridge as never, {
    sessionId,
    sessionsService: { binding: () => undefined },
    t,
    ...extra,
  }))
}

/** A selector hook shaped like the kernel's `useChat`, over an official index. */
interface OfficialItem {
  turn: number
  anchorKey: string
  prompt: string
  response: string
}

function useChatStub(entries: readonly OfficialItem[]):
  (selector: (snapshot: unknown) => unknown) => unknown {
  return (selector) => selector({
    navigation: { items: () => entries },
    order: [], nodes: { get: () => undefined, values: () => [] },
  })
}

afterEach(() => {
  cleanup()
  document.body.style.cssText = ''
  setSettings('loading', true)
})

describe('TimelineBridge mode dispatch', () => {
  it('mounts the enhancer (rendering nothing of its own) when the official index exists', () => {
    // The official rail is already on screen; this plugin only fixes its
    // behaviour, so its own DOM must stay empty.
    setSettings('ready', true)
    expect(() => renderTimeline('s1', {
      useChat: useChatStub([
        { turn: 1, anchorKey: 'k1', prompt: 'first', response: '' },
        { turn: 2, anchorKey: 'k2', prompt: 'second', response: '' },
      ]),
    })).not.toThrow()
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })

  it('renders NOTHING on kernels without the official turn index (defensive no-op)', () => {
    // Pre-0.1.2 kernels are outside the supported range: the bridge stands
    // down instead of shipping a second ported rail (README directs those
    // users to an older plugin release).
    setSettings('ready', true)
    expect(() => renderTimeline('s1')).not.toThrow()
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })

  it('stays quiet while the persisted toggle is still loading (no wrong-state flash)', () => {
    setSettings('loading', true)
    expect(() => renderTimeline('s1', {
      useChat: useChatStub([
        { turn: 1, anchorKey: 'k1', prompt: 'first', response: '' },
        { turn: 2, anchorKey: 'k2', prompt: 'second', response: '' },
      ]),
    })).not.toThrow()
    expect(document.querySelector('.dsbt-slot')).toBeNull()
  })
})
