// @vitest-environment jsdom
/**
 * Timeline rail helpers: message normalization from chat-node snapshots,
 * anchor-key resolution, and the geometry contracts — one shared outer height
 * for both states (no jump on expand) and a bounded expanding width.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectMessages, filterVisibleMessages, hiddenSeqsOfChat, markKeyOf, normalizeMessage,
  railHeightFor, railWidthFor, readMarks, resolveAnchorKey, rewindTargetOfOutcome,
  writeMarks, MARKS_STORAGE_PREFIX,
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

  it('drops user messages hidden by a rewind command node', () => {
    const snapshot = {
      chat: {
        nodes: new Map<string, object>([
          ['u1', { kind: 'user', key: 'k1', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'kept' }] } }],
          // A successful rewind cutting the span [4..6] (source event seq 6).
          ['r', {
            kind: 'command', key: 'cmd', anchorSeq: undefined,
            data: { name: 'rewind', seq: 7, outcome: { kind: 'success', sourceEventSeq: 6, text: 'rewound to target 4' } },
          }],
          ['u2', { kind: 'user', key: 'k2', anchorSeq: 5, data: { time: 2, content: [{ type: 'text', text: 'rewound away' }] } }],
          ['u3', { kind: 'user', key: 'k3', anchorSeq: 9, data: { time: 3, content: [{ type: 'text', text: 'after' }] } }],
        ]),
      },
    }
    const messages = collectMessages(snapshot)
    expect(messages.map((m) => m.text)).toEqual(['kept', 'after'])
  })

  it('hides the target of a rewind preview/dry-run command directly', () => {
    const snapshot = {
      chat: {
        nodes: new Map<string, object>([
          ['p', { kind: 'command', key: 'p', data: { name: 'rewind', seq: 12, args: { preview: true } } }],
          ['u', { kind: 'user', key: 'k', anchorSeq: 12, data: { time: 1, content: [{ type: 'text', text: 'gone' }] } }],
        ]),
      },
    }
    expect(collectMessages(snapshot)).toEqual([])
  })
})

describe('timeline bookmarks', () => {
  afterEach(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(MARKS_STORAGE_PREFIX)) window.localStorage.removeItem(key)
    }
  })

  it('builds stable bookmark keys (id, then key, then seq)', () => {
    expect(markKeyOf({ id: 'a' })).toBe('id:a')
    expect(markKeyOf({ key: '13:x' })).toBe('key:13:x')
    expect(markKeyOf({ seq: 7 })).toBe('seq:7')
    expect(markKeyOf(null)).toBe('')
    expect(markKeyOf(undefined)).toBe('')
  })

  it('persists and reads marks per session in localStorage', () => {
    writeMarks('sess-1', ['key:a', 'seq:3'])
    expect(readMarks('sess-1')).toEqual(['key:a', 'seq:3'])
    expect(window.localStorage.getItem(MARKS_STORAGE_PREFIX + 'sess-1')).toBe(JSON.stringify(['key:a', 'seq:3']))
    // Another session has its own namespace.
    expect(readMarks('sess-2')).toEqual([])
    // Writing an empty list clears the storage entry.
    writeMarks('sess-1', [])
    expect(readMarks('sess-1')).toEqual([])
    expect(window.localStorage.getItem(MARKS_STORAGE_PREFIX + 'sess-1')).toBeNull()
  })

  it('tolerates corrupt stored marks', () => {
    window.localStorage.setItem(MARKS_STORAGE_PREFIX + 'bad', '{oops')
    expect(readMarks('bad')).toEqual([])
    window.localStorage.setItem(MARKS_STORAGE_PREFIX + 'bad', JSON.stringify({ nope: 1 }))
    expect(readMarks('bad')).toEqual([])
  })
})

describe('rewind filtering helpers', () => {
  it('parses rewind targets from outcome text', () => {
    expect(rewindTargetOfOutcome('rewound to target 4 of 9')).toBe(4)
    expect(rewindTargetOfOutcome('session rewound #12')).toBe(12)
    expect(rewindTargetOfOutcome('nothing here')).toBeUndefined()
    expect(rewindTargetOfOutcome(undefined)).toBeUndefined()
  })

  it('computes hidden seqs from successful and preview rewind commands', () => {
    const chat = {
      nodes: new Map<string, object>([
        ['r1', { kind: 'command', data: { name: 'rewind', seq: 7, outcome: { kind: 'success', sourceEventSeq: 6, text: 'rewound to target 4' } } }],
        ['r2', { kind: 'command', data: { name: 'rewind', seq: 20, args: { dryRun: true } } }],
        ['other', { kind: 'command', data: { name: 'compact', seq: 30 } }],
      ]),
    }
    const hidden = hiddenSeqsOfChat(chat)
    expect(hidden.has(7)).toBe(true) // the command row itself
    expect(hidden.has(20)).toBe(true) // preview target
    expect(hidden.has(30)).toBe(false)
  })

  it('filters messages by the hidden set', () => {
    const msgs = [
      { seq: 1, time: 0, text: 'a' },
      { seq: 2, time: 0, text: 'b' },
    ]
    expect(filterVisibleMessages(msgs, new Set([2]))).toEqual([{ seq: 1, time: 0, text: 'a' }])
    expect(filterVisibleMessages(msgs, new Set())).toEqual(msgs)
  })
})

describe('timeline geometry contract', () => {
  it('gives both states one identical, clamped outer height (no expand jump)', () => {
    expect(railHeightFor(2)).toBe(140)
    expect(railHeightFor(4)).toBe(158)
    expect(railHeightFor(9)).toBe(300)
    expect(railHeightFor(50)).toBe(300)
  })

  it('widens past 260 only for long sessions, else fits the measured title', () => {
    expect(railWidthFor(Array.from({ length: 9 }, (_, i) => `question ${i}`))).toBe(260)
    // jsdom has no 2d context: measurement falls back to the minimum width.
    expect(railWidthFor(['hi'])).toBe(96)
  })
})
