import { describe, expect, it } from 'vitest'
import tokens from './tokens.json'

/*
 * WCAG 2.1 contrast for the design-system colour pairings, in both themes,
 * computed from tokens.json so a token change is re-checked automatically.
 * Text needs 4.5:1; focus rings, control borders and icons need 3:1.
 */

type Theme = 'dark' | 'light'

const byName = new Map(tokens.color.tokens.map((token) => [token.name, token.value]))

function resolve(name: string, theme: Theme): string {
  const value = byName.get(name)?.[theme]
  if (value === undefined) {
    throw new Error(`Unknown colour token ${name}`)
  }
  const alias = /^\{([a-z0-9-]+)\}$/.exec(value)
  return alias ? resolve(alias[1], theme) : value
}

function luminance(hex: string): number {
  const int = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string, theme: Theme): number {
  const [a, b] = [luminance(resolve(foreground, theme)), luminance(resolve(background, theme))]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

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
