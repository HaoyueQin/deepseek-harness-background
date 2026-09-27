// @vitest-environment jsdom
/**
 * Glass anchors against the real host DOM.
 *
 * The substring assertions in apply.spec.ts only prove the stylesheet still
 * CONTAINS an anchor — they stay green when an anchor starts matching the
 * wrong set of elements, or nothing at all. That is exactly how the
 * 0.1.7-rc.2 breakage slipped through: the host's cssModules pattern is
 * `[hash]_[local]`, so `[class*="_newSession"]` kept matching after the host
 * nested two more elements inside that button (`newSessionLabelMask` /
 * `newSessionContent` / `newSessionShortcut`) and the chrome paint landed on
 * three boxes — plus a fourth on hover.
 *
 * This file closes that gap the other way round: it parses the REAL
 * stylesheet the plugin injects, evaluates the anchors ONE BY ONE against a
 * fixture built from the host markup of the supported line, and asserts the
 * matched set. A renamed host class, a newly nested sibling, or a
 * re-introduced descendant combinator therefore fails here instead of in the
 * browser.
 *
 * Fixture class names are the host's emitted tokens (`hHd-Xa_newSession`,
 * `eGxaPq_preview`, `IP6KhG_preview`, …) as shipped in
 * `@deepseek-ai/dsh-client-ui-sidebar` / `-ui-chat` / `-ui-deliverables`
 * 0.1.7-rc.2, so the substring anchors are exercised the way the browser
 * sees them. The `@deepseek-ai/dsh-client-ui-primitives` HoverCard pod is the
 * same shape (`IP6KhG_preview` is that component's emitted token).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BACKGROUND_CSS } from '../src/client/background-css.ts'
import {
  CHANGED_FILES_HEADER, CHANGED_FILES_HEADER_HOVER, COMPOSER_CARD, COMPOSER_CARD_FILTER, STAT_DIALOGS,
} from './glass-anchors.ts'

/** One parsed rule: its comma-separated selector parts and its body. */
interface ParsedRule {
  readonly selectors: readonly string[]
  readonly body: string
}

/**
 * Split the generated stylesheet into rules.
 *
 * Comments are stripped FIRST and braces are counted rather than split on:
 * the sheet's comments contain braces and commas of their own (the block
 * headers spell selectors out), so a naive split hands back comment text as a
 * "selector" and jsdom rejects it.
 */
function parseRules(css: string): ParsedRule[] {
  const rules: ParsedRule[] = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  let start = 0
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at]
    if (char === '{') {
      depth += 1
      continue
    }
    if (char !== '}') continue
    depth -= 1
    if (depth > 0) continue
    const chunk = source.slice(start, at)
    start = at + 1
    const open = chunk.indexOf('{')
    if (open < 0) continue
    const selector = chunk.slice(0, open).trim()
    if (selector === '') continue
    rules.push({
      selectors: selector.split(',').map(part => part.trim()).filter(part => part !== ''),
      body: chunk.slice(open + 1),
    })
  }
  return rules
}

/**
 * Find ONE selector by exact text, searching every parsed rule. Anchors are
 * evaluated individually on purpose: several unrelated surfaces share one
 * declaration block, so "which rule contains this substring" answers a
 * different question than "what does this selector match".
 *
 * @param selector - the full selector part, exactly as the sheet emits it.
 * @returns the rule the selector belongs to (for its declaration body).
 */
function ruleForSelector(selector: string): ParsedRule {
  const found = parseRules(BACKGROUND_CSS).find(rule => rule.selectors.includes(selector))
  if (found === undefined) throw new Error(`the sheet no longer declares the selector: ${selector}`)
  return found
}

/** Every element one selector matches inside the current fixture. */
function matchSelector(selector: string): Element[] {
  return [...document.querySelectorAll(selector)]
}

/** The `[class*="_newSession"]` token the host emits for the button. */
const NEW_SESSION_BUTTON = 'hHd-Xa_newSession'
const NEW_SESSION_LABEL_MASK = 'hHd-Xa_newSessionLabelMask'
const NEW_SESSION_CONTENT = 'hHd-Xa_newSessionContent'
const NEW_SESSION_LABEL = 'hHd-Xa_newSessionLabel'
const NEW_SESSION_SHORTCUT = 'hHd-Xa_newSessionShortcut'

/** The HoverCard pod's emitted token, used by the changed-files hover preview. */
const HOVER_PREVIEW = 'IP6KhG_preview'

/**
 * The host DOM of the supported line, trimmed to the parts the whitelist
 * addresses. The glass gate attributes are set so the `body[data-dsh-bg-glass]`
 * prefix in every selector is satisfied too.
 */
function mountFixture(): void {
  document.body.setAttribute('data-dsh-bg-glass', 'on')
  document.body.setAttribute('data-dsh-bg', '')
  document.body.innerHTML = `
    <!-- sidebar: the 0.1.7-rc.2 New Session control, whose nested spans are
         the regression this file exists for -->
    <div class="hHd-Xa_root">
      <button type="button" class="${NEW_SESSION_BUTTON}" aria-label="新会话">
        <span class="${NEW_SESSION_LABEL_MASK}">
          <span class="${NEW_SESSION_CONTENT}">
            <svg width="14" height="14"></svg>
            <span class="${NEW_SESSION_LABEL} wide">新会话</span>
          </span>
        </span>
        <span class="${NEW_SESSION_SHORTCUT}" aria-hidden="true">Ctrl+N</span>
      </button>
      <span class="hHd-Xa_buildVersion">0.1.7</span>
    </div>

    <!-- conversation view: turn rail + its hover preview, code surfaces, and
         the load-earlier row. The preview is a CHILD of the rail's <nav>
         (TurnNavigator's own children array), which is what the anchor and
         the fixture both have to agree on. -->
    <div data-conversation-scroll>
      <div class="EvIC1a_older"><button type="button">加载更早</button></div>
      <div class="eGxaPq_slot">
        <nav class="eGxaPq_frame" aria-label="轮次导航">
          <div class="eGxaPq_scroller">
            <div class="eGxaPq_marks">
              <button type="button" data-index="0" class="eGxaPq_mark"></button>
              <button type="button" data-index="1" class="eGxaPq_mark"></button>
              <button type="button" data-index="2" class="eGxaPq_mark"></button>
            </div>
          </div>
          <div class="eGxaPq_preview" role="tooltip" id="rail-preview">
            <div class="eGxaPq_previewPrompt">第一轮</div>
          </div>
        </nav>
      </div>
      <div class="Xhvs7G_block" data-diff=""></div>
      <div class="md-code-block"></div>
      <div class="siJF9W_markdown"><code>inline</code></div>
    </div>

    <!-- turn deliverables: the changed-files card (header + rows), and the
         HoverCard pod the diff preview opens inside it -->
    <div class="hz8-rW_card" data-changed-files="">
      <div class="hz8-rW_header"></div>
      <ul class="hz8-rW_list">
        <li><button type="button" class="hz8-rW_row">a.ts</button></li>
      </ul>
    </div>
    <div class="${HOVER_PREVIEW}" data-changes-hover-preview="">
      <div data-diff=""></div>
    </div>

    <!-- composer: the card, and the picker menu ui-conversation renders INSIDE
         it (conversation.input.overlay) — the menu is the reason the card's
         filter lives on a pseudo-element instead of the card -->
    <div class="Nn4vBq_card" data-composer-card="">
      <div class="Nn4vBq_overlayAnchor">
        <div class="Js2fFb_menu" role="listbox" id="picker-menu">
          <button type="button" role="option">添加</button>
        </div>
      </div>
    </div>

    <!-- composer dock: the three portaled stat dialogs, plus an ordinary
         dialog that carries a plain <dl> and must stay on its official skin -->
    <div role="dialog" id="turn-usage-dialog" class="kT3vQc_panel"><dl data-turn-usage-details=""></dl></div>
    <div role="dialog" id="session-stats-dialog" class="kT3vQc_panel"><dl data-session-stats-details=""></dl></div>
    <div role="dialog" id="session-usage-dialog" class="kT3vQc_panel"><dl data-session-stats-usage=""></dl></div>
    <div role="dialog" id="settings-dialog" class="nArs4W_dialog">
      <dl><dt>主题</dt><dd>深色</dd></dl>
    </div>

    <!-- reading surfaces that must NOT be glassed -->
    <div class="nArs4W_paneCard">文件</div>
    <span class="CqQlUW_bubble" role="tooltip">提示</span>
    <span class="CqQlUW_bubble" role="tooltip" id="offline-tooltip">离线</span>
  `
}

afterEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('data-dsh-bg-glass')
  document.body.removeAttribute('data-dsh-bg')
})

describe('chrome buttons', () => {
  it('paints exactly the New Session button, never its inner label spans', () => {
    mountFixture()
    const selector = 'body[data-dsh-bg-glass] button[class*="_newSession"]'
    const hits = matchSelector(selector)

    // The 0.1.7-rc.2 regression: the substring anchor also caught
    // `_newSessionContent` (full width) and `_newSessionShortcut` (opacity 0,
    // so it appeared only on hover) — extra boxes inside the control.
    expect(hits.map(element => element.tagName)).toEqual(['BUTTON'])
    expect(hits[0]!.className).toBe(NEW_SESSION_BUTTON)
    for (const span of [NEW_SESSION_LABEL_MASK, NEW_SESSION_CONTENT, NEW_SESSION_LABEL, NEW_SESSION_SHORTCUT]) {
      expect(hits.some(element => element.classList.contains(span)), span).toBe(false)
    }
    // The rule still fills with the composer token and carries the chain.
    const body = ruleForSelector(selector).body.replace(/\s+/g, ' ')
    expect(body).toContain('background-color: var(--dsw-specific-input-major)')
    expect(body).toContain('backdrop-filter: blur(var(--bg-glass-blur')
  })

  it('keys the collapsed-rail exemption on the frame attribute', () => {
    mountFixture()
    const collapsed = 'body[data-dsh-bg-glass] [data-sidebar-collapsed="true"] [class*="_newSession"]'
    // Expanded: the exemption applies to nothing.
    expect(matchSelector(collapsed)).toEqual([])
    const frame = document.createElement('div')
    frame.setAttribute('data-sidebar-collapsed', 'true')
    document.body.appendChild(frame)
    frame.appendChild(document.querySelector(`.${NEW_SESSION_BUTTON}`)!)
    // The exemption is the BARE-ICON rail form: it deliberately keeps the
    // substring (not an element test) so every span inside the control is
    // silenced too — that is the point of the rule.
    expect(matchSelector(collapsed)).toHaveLength(5)
    const body = ruleForSelector(collapsed).body.replace(/\s+/g, ' ')
    expect(body).toContain('background-color: transparent')
  })
})

describe('turn deliverables and the rail', () => {
  it('paints the changed-files card and the hover diff preview it opens', () => {
    mountFixture()
    for (const anchor of ['data-changed-files', 'data-changes-hover-preview']) {
      const selector = `body[data-dsh-bg-glass] [${anchor}]`
      const hits = matchSelector(selector)
      expect(hits, anchor).toHaveLength(1)
      expect(hits[0]!.hasAttribute(anchor), anchor).toBe(true)
      // Both paint an official OPAQUE token, so the rule must take the fill.
      const body = ruleForSelector(selector).body.replace(/\s+/g, ' ')
      expect(body, anchor).toContain('background-color: var(--dsw-specific-input-major)')
      expect(body, anchor).toContain('backdrop-filter: blur(var(--bg-glass-blur')
    }
  })

  it('paints the turn-rail hover preview through the scrollport seat', () => {
    mountFixture()
    const selector = 'body[data-dsh-bg-glass] [data-conversation-scroll] nav [role="tooltip"]'
    const hits = matchSelector(selector)

    // Exactly the preview card: the rail's own <nav> carries no glass. The
    // old anchor keyed on `--turn-natural-height`, an inline style 0.1.7
    // deleted when it virtualized the rail — it matched nothing at all.
    expect(hits.map(element => element.getAttribute('role'))).toEqual(['tooltip'])
    expect(hits[0]!.id).toBe('rail-preview')
    expect(hits.some(element => element.tagName === 'NAV')).toBe(false)
    // No SELECTOR may key on the metric 0.1.7 deleted with the virtualization
    // (the comment above is free to name it as history).
    for (const selector of parseRules(BACKGROUND_CSS).flatMap(rule => rule.selectors)) {
      expect(selector, selector).not.toContain('--turn-natural-height')
    }
  })

  it('leaves every other tooltip in the app on its official paint', () => {
    mountFixture()
    const selector = 'body[data-dsh-bg-glass] [data-conversation-scroll] nav [role="tooltip"]'
    const covered = new Set(matchSelector(selector))
    const offline = document.getElementById('offline-tooltip')!
    expect(covered.has(offline)).toBe(false)
    // The bubble anchor deliberately excludes role="tooltip" wholesale.
    const bubble = 'body[data-dsh-bg-glass] [class*="_bubble"]:not([role="tooltip"])'
    expect(matchSelector(bubble)).toEqual([])
  })
})

describe('composer card backdrop root', () => {
  it('keeps the filter on the pseudo-element, never on the card itself', () => {
    mountFixture()
    // A filter on the card made it a Backdrop Root: the picker menu it hosts
    // could then sample the card's own paint only, and rendered as flat
    // transparency over the wallpaper instead of frosted glass.
    expect(ruleForSelector(COMPOSER_CARD).body).not.toContain('backdrop-filter')
    const filter = ruleForSelector(COMPOSER_CARD_FILTER).body
    expect(filter).toContain('backdrop-filter')
    expect(filter).toContain('position: absolute')
    expect(filter).toContain('z-index: -1')
    // The pseudo-element inherits the card's rounding so it covers it exactly.
    expect(filter).toContain('border-radius: inherit')
  })

  it('leaves the picker menu the card hosts on its official skin', () => {
    mountFixture()
    const menu = document.getElementById('picker-menu')!
    for (const selector of parseRules(BACKGROUND_CSS).flatMap(rule => rule.selectors)) {
      // Any hit here is a blanket rule creeping back in: the menu keeps the
      // official material and now blurs the wallpaper on its own.
      expect(menu.matches(selector), selector).toBe(false)
    }
  })
})

describe('changed-files glass card', () => {
  it('clears the header fill and leaves the rows alone', () => {
    mountFixture()
    const hits = matchSelector(CHANGED_FILES_HEADER)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.className).toBe('hz8-rW_header')
    // The official fill is the opaque --changes-fill static neutral; clearing
    // it is what lets the glass card surface show through.
    expect(ruleForSelector(CHANGED_FILES_HEADER).body).toContain('background-color: transparent')
    // The header's own hover feedback moves to the rows' translucent token.
    expect(ruleForSelector(CHANGED_FILES_HEADER_HOVER).body)
      .toContain('var(--dsw-alias-interactive-bg-hover)')
  })
})

describe('docked stat dialogs', () => {
  it('glasses exactly the stat panels, never an ordinary dialog', () => {
    mountFixture()
    const ids: Record<string, string> = {
      'turn usage dialog': 'turn-usage-dialog',
      'session stats dialog': 'session-stats-dialog',
      'session token usage dialog': 'session-usage-dialog',
    }
    for (const { name, selector } of STAT_DIALOGS) {
      expect(matchSelector(selector).map(element => element.id), name).toEqual([ids[name]])
      expect(ruleForSelector(selector).body, name).toContain('backdrop-filter')
    }
    // The anchor is the panel's own detail list, so a dialog that carries a
    // plain <dl> (the settings shell) stays on the official menu skin.
    const settings = document.getElementById('settings-dialog')!
    for (const { name, selector } of STAT_DIALOGS) expect(settings.matches(selector), name).toBe(false)
  })
})

describe('selector hygiene', () => {
  it('keeps the inline-code rule a compound on the markdown host', () => {
    mountFixture()
    // A stray space before `:not(pre)` turned this into a DESCENDANT step,
    // widening it from "code directly inside pre-direct children of the
    // markdown host" to any nested <code> under it.
    const selector = 'body[data-dsh-bg-glass] [class*="_markdown"]:not(pre) > code'
    expect(parseRules(BACKGROUND_CSS).flatMap(rule => rule.selectors)).toContain(selector)
    expect(BACKGROUND_CSS).not.toContain('[class*="_markdown"] :not(pre)')
    const hits = matchSelector(selector)
    expect(hits.map(element => element.textContent)).toEqual(['inline'])
  })

  it('evaluates every glass selector against the fixture without an error', () => {
    mountFixture()
    const selectors = parseRules(BACKGROUND_CSS)
      .filter(rule => rule.body.includes('backdrop-filter'))
      .flatMap(rule => rule.selectors)
    expect(selectors.length).toBeGreaterThan(10)
    for (const selector of selectors) {
      expect(() => document.querySelectorAll(selector), selector).not.toThrow()
    }
  })

  it('never leaves a reading surface inside the painted set', () => {
    mountFixture()
    const painted = new Set<string>()
    for (const selector of parseRules(BACKGROUND_CSS)
      .filter(rule => rule.body.includes('background-color') || rule.body.includes('backdrop-filter'))
      .flatMap(rule => rule.selectors)) {
      for (const element of document.querySelectorAll(selector)) painted.add(element.className + '|' + element.tagName)
    }
    for (const className of ['nArs4W_paneCard', 'CqQlUW_bubble']) {
      for (const element of document.querySelectorAll(`.${className}`)) {
        expect(painted.has(element.className + '|' + element.tagName), className).toBe(false)
      }
    }
  })
})
