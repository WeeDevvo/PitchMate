import { describe, expect, it } from 'vitest'
import { tokenContrast as contrast, type DesignTheme as Theme } from './contrast'

/*
 * WCAG 2.1 contrast for the design-system colour pairings, in both themes,
 * computed from tokens.json so a token change is re-checked automatically.
 * Text needs 4.5:1; focus rings, control borders and icons need 3:1.
 */

const GROUNDS = ['bg', 'surface', 'surface-raised', 'surface-overlay']

const pairs = (foregrounds: string[], backgrounds: string[]) =>
  foregrounds.flatMap((fg) => backgrounds.map((bg) => [fg, bg] as const))

const TEXT_PAIRS = [
  ...pairs(['text-primary', 'text-secondary', 'text-muted'], [...GROUNDS, 'surface-sunken']),
  ...pairs(
    [
      'accent-text',
      'result-win-text',
      'result-loss-text',
      'result-draw-text',
      'provisional-text',
      'danger-text',
      'info-text',
      'bib-text',
    ],
    GROUNDS,
  ),
  ...pairs(['on-accent'], ['accent-fill', 'accent-fill-hover', 'accent-fill-pressed', 'highlight']),
  ...pairs(['on-result'], ['result-win', 'result-loss', 'result-draw', 'danger', 'danger-hover']),
  ['accent-on-subtle', 'accent-subtle'],
  // Tinted grounds: state chips, banners, sync pills and avatar tints.
  ['info-text', 'info-subtle'],
  ['result-win-text', 'result-win-subtle'],
  ['result-loss-text', 'result-loss-subtle'],
  ['result-draw-text', 'result-draw-subtle'],
  ['text-primary', 'surface-pressed'],
  ['text-secondary', 'surface-hover'],
  ['on-result', 'info'],
  ['on-bib', 'bib'],
  ['on-team-a', 'team-a'],
  ['on-team-b', 'team-b'],
  ['text-inverse', 'surface-inverse'],
] as const

const NON_TEXT_PAIRS = [
  ...pairs(['focus-ring', 'border-control', 'accent-icon'], GROUNDS),
] as const

describe.each<Theme>(['dark', 'light'])('%s theme', (theme) => {
  it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (foreground, background) => {
    expect(contrast(foreground, background, theme)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s is at least 3:1', (foreground, background) => {
    expect(contrast(foreground, background, theme)).toBeGreaterThanOrEqual(3)
  })
})
