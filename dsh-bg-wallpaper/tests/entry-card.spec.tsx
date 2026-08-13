// @vitest-environment jsdom
/**
 * BackgroundEntryCard: the always-visible shell in the official plugin
 * configuration section — never gates on the settings transport, opens the
 * settings overlay on click.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BackgroundEntryCard } from '../src/client/entry-card.tsx'
import { overlayStore } from '../src/client/overlay-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  overlayStore.close()
})

describe('BackgroundEntryCard', () => {
  it('shows the title and hint without any transport dependency', () => {
    render(<BackgroundEntryCard t={(key) => en[key as keyof typeof en] ?? key} />)
    expect(screen.getByText('Custom Background')).toBeTruthy()
    expect(screen.getByText('Open the background image settings')).toBeTruthy()
  })

  it('opens the settings overlay on click', () => {
    render(<BackgroundEntryCard t={(key) => en[key as keyof typeof en] ?? key} />)
    expect(overlayStore.getSnapshot()).toBe(false)
    fireEvent.click(screen.getByText('Custom Background'))
    expect(overlayStore.getSnapshot()).toBe(true)
  })
})
