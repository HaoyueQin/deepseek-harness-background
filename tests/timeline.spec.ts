// @vitest-environment jsdom
/**
 * Timeline rail helpers: message normalization from chat-node snapshots,
 * anchor-key resolution, and the geometry contracts — one shared outer height
 * for both states (no jump on expand) and a bounded expanding width.
 */
import { describe, expect, it } from 'vitest'
import {
  collectMessages, normalizeMessage, railHeightFor, railWidthFor, resolveAnchorKey,
} from '../src/client/timeline.tsx'

describe('timeline data collection', () => {
  it('normalizes valid entries and rejects malformed ones', () => {
    expect(normalizeMessage({ seq: 3, time: 12, text: 'hi', key: '13:input-messagea' }))
      .toEqual({ seq: 3, time: 12, text: 'hi', key: '13:input-messagea' })
    expect(normalizeMessage(null)).toBeNull()
    expect(normalizeMessage({ time: 1, text: 'x' })).toBeNull()
    expect(normalizeMessage({ seq: '9', text: 'x' })).toBeNull()
    // Missing time/text degrade to defaults instead of dropping the row.
    expect(normalizeMessage({ seq: 1 })).toEqual({ seq: 1, time: 0, text: '' })
  })

  it('collects user nodes sorted by seq and extracts preview text', () => {
    const snapshot = {
      chat: {
        nodes: new Map<string, object>([
          ['b', { kind: 'user', key: '13:input-messageb', anchorSeq: 7, data: { time: 2, content: [{ type: 'text', text: 'second' }] } }],
          ['a', { kind: 'user', key: '13:input-messagea', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'first' }, { type: 'image' }] } }],
          ['x', { kind: 'assistant', key: '14:assistant-x', anchorSeq: 3, data: { time: 1, content: [] } }],
          ['y', { kind: 'user', key: 'broken', data: {} }],
        ]),
      },
    }
    const messages = collectMessages(snapshot)
    expect(messages.map((m) => m.text)).toEqual(['first', 'second'])
    expect(messages.map((m) => m.key)).toEqual(['13:input-messagea', '13:input-messageb'])
  })

  it('returns an empty list for shapeless snapshots', () => {
    expect(collectMessages(undefined)).toEqual([])
    expect(collectMessages({})).toEqual([])
    expect(collectMessages({ chat: {} })).toEqual([])
  })

  it('resolves anchor keys only from well-formed entries', () => {
    expect(resolveAnchorKey({ seq: 1, time: 0, text: '', key: '13:input-messagez' })).toBe('13:input-messagez')
    expect(resolveAnchorKey({ seq: 1, time: 0, text: '' })).toBeUndefined()
  })
})

describe('timeline geometry contract', () => {
  it('gives both states one identical, clamped outer height (no expand jump)', () => {
    expect(railHeightFor(2)).toBe(140)
    expect(railHeightFor(4)).toBe(158)
    expect(railHeightFor(9)).toBe(300)
    expect(railHeightFor(50)).toBe(300)
  })

  it('widens past 240 only for long sessions, else fits the measured title', () => {
    expect(railWidthFor(Array.from({ length: 9 }, (_, i) => `question ${i}`))).toBe(240)
    // jsdom has no 2d context: measurement falls back to the minimum width.
    expect(railWidthFor(['hi'])).toBe(96)
  })
})
