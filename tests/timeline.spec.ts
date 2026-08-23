// @vitest-environment jsdom
/**
 * Timeline rail helpers: message normalization from chat-node snapshots,
 * anchor-key resolution, and the geometry contracts — one shared outer height
 * for both states (no jump on expand) and a bounded expanding width.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectMessages, hiddenSeqsOfChat, inputAnchorKeyOf, markKeyOf,
  normalizeProjectedTimeline, railHeightFor, railMessages, railWidthFor,
  readMarks, resolveAnchorKey, rewindTargetOfOutcome,
  writeMarks, MARKS_STORAGE_PREFIX, TIMELINE_PROJECTION_KEY,
} from '../src/client/timeline.tsx'
import { timelineProjectionDefinition, type TimelineProjectionState } from '../src/projection.ts'

describe('timeline data collection', () => {
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

  it('builds stable bookmark keys (message key, then anchor seq)', () => {
    expect(markKeyOf({ key: '13:x' })).toBe('key:13:x')
    expect(markKeyOf({ seq: 7 })).toBe('seq:7')
    // Entries with neither key nor numeric seq are not markable.
    expect(markKeyOf({ id: 'a' })).toBe('')
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

describe('projection data source', () => {
  it('rebuilds chat anchor keys with the engine formula (13:input-message<id>)', () => {
    expect(inputAnchorKeyOf('m1')).toBe('13:input-messagem1')
    expect(inputAnchorKeyOf('abc')).toBe('13:input-messageabc')
    expect(TIMELINE_PROJECTION_KEY).toBe('bgTimeline')
  })

  it('normalizes projected wire values: shapes, caps, sorts, dedupes', () => {
    const value = {
      messages: [
        { seq: 7, time: 2, text: 'second', id: 'b' },
        { seq: 2, time: 1, text: 'first '.repeat(30), id: 'a' }, // over-cap text
        { seq: 7, time: 9, text: 'dupe' },                      // same-seq replay
        { seq: 'bad', time: 1, text: 'nope' },                  // invalid seq
        null,
      ],
    }
    const messages = normalizeProjectedTimeline(value)
    expect(messages.map((m) => m.seq)).toEqual([2, 7])
    expect(messages[0]).toMatchObject({ seq: 2, key: '13:input-messagea' })
    expect(messages[0]?.text?.length ?? 0).toBeLessThanOrEqual(80)
    expect(messages[1]).toMatchObject({ seq: 7, key: '13:input-messageb' })
  })

  it('returns empty for absent or malformed projection values', () => {
    expect(normalizeProjectedTimeline(undefined)).toEqual([])
    expect(normalizeProjectedTimeline(null)).toEqual([])
    expect(normalizeProjectedTimeline({ nope: 1 })).toEqual([])
    expect(normalizeProjectedTimeline({ messages: 'x' })).toEqual([])
  })

  it('prefers the projection (whole session) over the loaded node window', () => {
    const snapshot = {
      chat: { nodes: new Map<string, object>([
        ['a', { kind: 'user', key: 'k1', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'loaded' }] } }],
      ]) },
    }
    const projected = { messages: [
      { seq: 2, time: 1, text: 'loaded', id: 'a' },
      { seq: 40, time: 2, text: 'unloaded tail question', id: 'z' },
    ] }
    const messages = railMessages(snapshot, projected)
    expect(messages.map((m) => m.text)).toEqual(['loaded', 'unloaded tail question'])
    expect(messages[1]?.key).toBe('13:input-messagez')
  })

  it('falls back to the node window when the projection is empty', () => {
    const snapshot = {
      chat: { nodes: new Map<string, object>([
        ['a', { kind: 'user', key: 'k1', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'only' }] } }],
      ]) },
    }
    expect(railMessages(snapshot, undefined).map((m) => m.text)).toEqual(['only'])
    expect(railMessages(snapshot, { messages: [] }).map((m) => m.text)).toEqual(['only'])
  })

  it('applies locally-known rewind hiding on top of the projection', () => {
    const snapshot = {
      chat: { nodes: new Map<string, object>([
        ['r', { kind: 'command', key: 'cmd', data: { name: 'rewind', seq: 6, outcome: { kind: 'success', sourceEventSeq: 5, text: 'rewound to target 3' } } }],
      ]) },
    }
    const projected = { messages: [
      { seq: 2, time: 1, text: 'kept', id: 'a' },
      { seq: 4, time: 2, text: 'rewound away', id: 'b' },
    ] }
    expect(railMessages(snapshot, projected).map((m) => m.text)).toEqual(['kept'])
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

describe('bgTimeline projection fold (host)', () => {
  const def = timelineProjectionDefinition
  const fold = (events: unknown[]): TimelineProjectionState =>
    events.reduce<TimelineProjectionState>(
      (state, event) => def.apply(state, event) as TimelineProjectionState,
      def.init(),
    )

  const userEvent = (seq: number, id: string, text: string): unknown => ({
    type: 'user/message', seq, time: seq,
    data: { id, time: seq, content: [{ type: 'text', text }], source: { kind: 'user' } },
  })

  it('indexes direct user turns and skips plugin-sourced context rows', () => {
    const state = fold([
      userEvent(2, 'a', 'first'),
      { type: 'user/message', seq: 4, time: 4, data: { id: 'ctx', time: 4, content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'fixture' } } },
    ])
    expect(state.messages.map((m) => m.seq)).toEqual([2])
  })

  it('drops messages shadowed by an OBJECT-form surface replace on any carrier', () => {
    // Regression: the port compared the whole surfaceOp to the string
    // 'replace'; core types define replace as { op: 'replace', start, end },
    // so the filter never fired and compacted/rewound questions lingered.
    const state = fold([
      userEvent(2, 'a', 'kept'),
      userEvent(5, 'b', 'compacted away'),
      // Compaction checkpoint — the replace rides a user/message event.
      { type: 'user/message', seq: 9, time: 9,
        surfaceOp: { op: 'replace', start: 3, end: 8 },
        sourceEventSeqs: [3, 8, 5],
        data: { id: 'cp', time: 9, content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'plugin', plugin: 'compact' } } },
      // A rewind-style producer riding assistant/message.
      { type: 'assistant/message', seq: 12, time: 12,
        surfaceOp: { op: 'replace', start: 9, end: 11 },
        sourceEventSeqs: [2],
        data: {} },
    ])
    expect(state.messages).toEqual([])
  })

  it('keeps the index intact for plain append ops', () => {
    const state = fold([
      userEvent(2, 'a', 'kept'),
      { type: 'assistant/message', seq: 3, time: 3, surfaceOp: 'append', sourceEventSeqs: [2], data: {} },
    ])
    expect(state.messages.map((m) => m.seq)).toEqual([2])
  })

  it('answers TIMELINE_PROJECTION_KEY bgTimeline through the shared constant', () => {
    expect(def.key).toBe(TIMELINE_PROJECTION_KEY)
  })
})
