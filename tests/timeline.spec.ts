// @vitest-environment jsdom
/**
 * Timeline rail helpers: message normalization from chat-node snapshots,
 * anchor-key resolution, and the geometry contracts — one shared outer height
 * for both states (no jump on expand) and a bounded expanding width.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  chatNodesOf, collectMessages, hiddenSeqsOfChat, inputAnchorKeyOf,
  normalizeProjectedTimeline, railMessages,
  rewindMarkedSeqsOfChat, rewindTargetOfCommand, rewindTargetOfOutcome,
  TIMELINE_PROJECTION_KEY,
} from '../src/client/timeline/index.tsx'
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
    expect(messages.map((m) => m.anchorKey)).toEqual(['13:input-messagea', '13:input-messageb'])
  })

  it('returns an empty list for shapeless snapshots', () => {
    expect(collectMessages(undefined)).toEqual([])
    expect(collectMessages({})).toEqual([])
    expect(collectMessages({ chat: {} })).toEqual([])
  })

  it('resolves anchor keys only from well-formed entries', () => {
    expect(normalizeProjectedTimeline({ messages: [{ seq: 1, id: 'z' }] })[0]?.anchorKey)
      .toBe('13:input-messagez')
    // No durable id -> no rebuilt anchor key, so the mark cannot jump.
    expect(normalizeProjectedTimeline({ messages: [{ seq: 1 }] })[0]?.anchorKey).toBeUndefined()
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

describe('node window enumeration (both kernel generations)', () => {
  it('reads the legacy session snapshot (chat.nodes Map)', () => {
    const nodes = new Map<string, object>([['a', { kind: 'user' }]])
    expect(chatNodesOf({ chat: { nodes } })).toHaveLength(1)
  })

  it('reads the 0.1.2 Chat snapshot (nodes.values() store)', () => {
    // Regression: 0.1.2 dropped `session.getSnapshot().chat` entirely and
    // moved the Chat view to `{ order, nodes: { values() } }`, so the old
    // reader returned nothing and the rail silently disappeared.
    const snapshot = {
      order: ['a', 'b'],
      nodes: { values: () => [{ kind: 'user', key: 'a' }, { kind: 'assistant-step', key: 'b' }] },
    }
    expect(chatNodesOf(snapshot).map((n) => n.key)).toEqual(['a', 'b'])
  })

  it('returns empty for shapeless snapshots', () => {
    expect(chatNodesOf(undefined)).toEqual([])
    expect(chatNodesOf({})).toEqual([])
    expect(chatNodesOf({ chat: {} })).toEqual([])
    expect(chatNodesOf({ nodes: { values: 'nope' } })).toEqual([])
  })

  it('drops nodes the conversation hid (0.1.2 visibility flag)', () => {
    const nodes = new Map<string, object>([
      ['a', { kind: 'user', key: 'a', anchorSeq: 1, data: { time: 1, content: [{ type: 'text', text: 'shown' }] } }],
      ['b', { kind: 'user', key: 'b', anchorSeq: 2, visibility: 'hidden', data: { time: 2, content: [{ type: 'text', text: 'hidden' }] } }],
    ])
    expect(collectMessages({ chat: { nodes } }).map((m) => m.text)).toEqual(['shown'])
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
    expect(messages[0]).toMatchObject({ seq: 2, anchorKey: '13:input-messagea' })
    expect(messages[0]?.text?.length ?? 0).toBeLessThanOrEqual(80)
    expect(messages[1]).toMatchObject({ seq: 7, anchorKey: '13:input-messageb' })
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
    expect(messages[1]?.anchorKey).toBe('13:input-messagez')
  })

  it('merges: the window fills early entries a degraded projection lost', () => {
    // Regression: the rail used the projection ALONE whenever it was
    // non-empty, so a projection that lost its baseline (plugin hot-reloaded
    // after the session tail page seeded the client) silently hid the early
    // questions the loaded window still held.
    const snapshot = {
      chat: { nodes: new Map<string, object>([
        ['a', { kind: 'user', key: 'k-early', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'early' }] } }],
        ['b', { kind: 'user', key: 'k-late', anchorSeq: 9, data: { time: 2, content: [{ type: 'text', text: 'late' }] } }],
      ]) },
    }
    const projected = { messages: [
      // Early entry missing from the degraded projection; the late one present.
      { seq: 9, time: 2, text: 'late', id: 'b' },
    ] }
    const messages = railMessages(snapshot, projected)
    expect(messages.map((m) => m.seq)).toEqual([2, 9])
    expect(messages.map((m) => m.text)).toEqual(['early', 'late'])
    expect(messages[0]?.anchorKey).toBe('k-early')
  })

  it('merges: window entries lend their real anchor key to projected entries without a durable id', () => {
    // Early events without an id produce projection entries with no key and
    // can never jump; the same question loaded in the window carries its real
    // key — borrow it so the row stays clickable.
    const snapshot = {
      chat: { nodes: new Map<string, object>([
        ['a', { kind: 'user', key: '13:input-messageold', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'old question' }] } }],
      ]) },
    }
    const projected = { messages: [
      { seq: 2, time: 1, text: 'old question' }, // no id -> no key
    ] }
    const messages = railMessages(snapshot, projected)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.anchorKey).toBe('13:input-messageold')
  })

  it('fast path: a complete projection stays authoritative over the window (no per-token merge work)', () => {
    // The window holds the SAME seqs as the projection; the projection's
    // text/keys must win and the window must not replace anything (the gate
    // returns the projection untouched — the streaming hot path).
    const snapshot = {
      chat: { nodes: new Map<string, object>([
        ['a', { kind: 'user', key: 'k1', anchorSeq: 2, data: { time: 1, content: [{ type: 'text', text: 'window copy' }] } }],
      ]) },
    }
    const projected = { messages: [
      { seq: 2, time: 1, text: 'projection copy', id: 'a' },
    ] }
    const messages = railMessages(snapshot, projected)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('projection copy')
    expect(messages[0]?.anchorKey).toBe('13:input-messagea')
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

describe('rewind target resolution (v0.1.5 hardening)', () => {
  it('parses rewind targets from the multi-pattern outcome forms', () => {
    expect(rewindTargetOfOutcome('已撤回 seq 42 及之后的内容')).toBe(42)
    expect(rewindTargetOfOutcome('Withdrawn seq 42 ...')).toBe(42)
    expect(rewindTargetOfOutcome('session rewound to seq 36')).toBe(36)
    expect(rewindTargetOfOutcome('rewound to target 4 of 9')).toBe(4)
    expect(rewindTargetOfOutcome('session rewound #12')).toBe(12)
    expect(rewindTargetOfOutcome('nothing here')).toBeUndefined()
    expect(rewindTargetOfOutcome(undefined)).toBeUndefined()
  })

  it('prefers structured fields over outcome text (rewindTargetOfCommand)', () => {
    expect(rewindTargetOfCommand({ outcome: { targetSeq: 5 } })).toBe(5)
    expect(rewindTargetOfCommand({ outcome: { target: 6 } })).toBe(6)
    expect(rewindTargetOfCommand({ args: { targetSeq: 7 } })).toBe(7)
    expect(rewindTargetOfCommand({ seq: 9, args: { seq: 8 } })).toBe(8)
    // args.seq equal to the command's own seq is ignored.
    expect(rewindTargetOfCommand({ seq: 9, args: { seq: 9 } })).toBeUndefined()
    expect(rewindTargetOfCommand({ args: { raw: '@42' } })).toBe(42)
    expect(rewindTargetOfCommand({ args: { '0': '#33' } })).toBe(33)
    expect(rewindTargetOfCommand({ args: ['27'] })).toBe(27)
    expect(rewindTargetOfCommand({ args: { target: 'seq 11' } })).toBe(11)
    // Falls back to the outcome text when nothing structured exists.
    expect(rewindTargetOfCommand({ outcome: { text: '已撤回 seq 10' } })).toBe(10)
    expect(rewindTargetOfCommand(null)).toBeUndefined()
    expect(rewindTargetOfCommand(undefined)).toBeUndefined()
  })

  it('collects node-level rewind-hidden markers from all three producer positions', () => {
    const chat = {
      nodes: new Map<string, object>([
        ['a', { kind: 'user', anchorSeq: 1, data: { attributes: { 'data-dsh-rewind-hidden': true } } }],
        ['b', { kind: 'user', anchorSeq: 2, data: { 'data-dsh-rewind-hidden': true } }],
        ['c', { kind: 'user', anchorSeq: 3, rewindHidden: true, data: {} }],
        ['d', { kind: 'user', anchorSeq: 4, data: {} }],
      ]),
    }
    const marked = rewindMarkedSeqsOfChat(chat)
    expect(marked.has(1)).toBe(true)
    expect(marked.has(2)).toBe(true)
    expect(marked.has(3)).toBe(true)
    expect(marked.has(4)).toBe(false)
    // The aggregate hidden set includes marked nodes too.
    expect(hiddenSeqsOfChat(chat).has(2)).toBe(true)
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
