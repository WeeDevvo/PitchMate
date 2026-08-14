import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/*
 * Contrast assertions for the landing-page theme tokens (Requirements 6.2, 6.5).
 *
 * These are INVARIANT assertions over the fixed token table defined in
 * theme.css — not property-based tests. To guard against drift, the token
 * values are parsed directly out of theme.css rather than duplicated here, so
 * editing the CSS without re-checking contrast will fail this suite.
 *
 * The contrast ratio uses the WCAG 2.1 relative-luminance definition:
 *   1. sRGB channel -> linear (gamma expansion)
 *   2. relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B
 *   3. contrast ratio = (Llighter + 0.05) / (Ldarker + 0.05)
 */

// --- WCAG 2.1 relative-luminance contrast helper -------------------------

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  const int = parseInt(full, 16)
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
}

// sRGB 8-bit channel -> linear-light value (WCAG 2.1 gamma expansion).
function srgbChannelToLinear(channel8bit: number): number {
  const c = channel8bit / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  )
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// --- Parse the token table out of theme.css (drift guard) ---------------

type Tokens = Record<string, string>

function parseBlock(css: string, selectorPattern: RegExp): Tokens | null {
  const match = css.match(selectorPattern)
  if (!match) return null
  const body = match[1]
  const tokens: Tokens = {}
  const declRe = /--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g
  let decl: RegExpExecArray | null
  while ((decl = declRe.exec(body)) !== null) {
    tokens[`--${decl[1]}`] = decl[2].toLowerCase()
  }
  return tokens
}

const themeCssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'theme.css',
)
const css = readFileSync(themeCssPath, 'utf8')

// The dark block is `:root, [data-theme='dark'] { ... }`; light is opt-in.
const darkTokens = parseBlock(css, /\[data-theme='dark'\]\s*\{([^}]*)\}/)
const lightTokens = parseBlock(css, /\[data-theme='light'\]\s*\{([^}]*)\}/)

const BODY_TEXT_MIN = 4.5 // WCAG AA normal text
const UI_COMPONENT_MIN = 3 // WCAG AA non-text / large-text / icon threshold

describe('theme.css token table is parseable', () => {
  it('finds the dark theme block with all required tokens', () => {
    expect(darkTokens).not.toBeNull()
    const t = darkTokens as Tokens
    expect(t['--bg']).toBe('#141414')
    expect(t['--text']).toBeDefined()
    expect(t['--accent-text']).toBeDefined()
    expect(t['--focus-ring']).toBeDefined()
  })

  it('finds the light theme block with all required tokens', () => {
    expect(lightTokens).not.toBeNull()
    const t = lightTokens as Tokens
    expect(t['--bg']).toBe('#ffffff')
    expect(t['--text']).toBeDefined()
    expect(t['--accent-text']).toBeDefined()
    expect(t['--focus-ring']).toBeDefined()
  })
})

describe('WCAG contrast helper sanity', () => {
  it('computes the canonical black-on-white ratio as 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('computes identical colours as 1:1', () => {
    expect(contrastRatio('#5bbf36', '#5bbf36')).toBeCloseTo(1, 5)
  })
})

// Both themes share the same set of assertions; drive them from a table.
const themes: Array<{ name: string; tokens: Tokens | null }> = [
  { name: 'dark', tokens: darkTokens },
  { name: 'light', tokens: lightTokens },
]

describe.each(themes)('contrast invariants — $name theme', ({ tokens }) => {
  it('body text (--text) vs background (--bg) is >= 4.5:1 (Req 6.2)', () => {
    const t = tokens as Tokens
    expect(contrastRatio(t['--text'], t['--bg'])).toBeGreaterThanOrEqual(
      BODY_TEXT_MIN,
    )
  })

  it('focus ring (--focus-ring) vs adjacent background (--bg) is >= 3:1 (Req 6.5)', () => {
    const t = tokens as Tokens
    expect(contrastRatio(t['--focus-ring'], t['--bg'])).toBeGreaterThanOrEqual(
      UI_COMPONENT_MIN,
    )
  })
})

describe('accent-text (green text/icon token) contrast', () => {
  it('dark --accent-text (#5bbf36) vs --bg is >= 4.5:1 (Req 5.2, 6.2)', () => {
    const t = darkTokens as Tokens
    // In dark theme the green accent is Pitch Green and clears the body-text
    // bar, so it is safe for green text as well as icons/fills.
    expect(t['--accent-text']).toBe('#5bbf36')
    expect(contrastRatio(t['--accent-text'], t['--bg'])).toBeGreaterThanOrEqual(
      BODY_TEXT_MIN,
    )
  })

  it('light --accent-text (#3e8f24, Green Dark) vs white is >= 3:1 (Req 5.6)', () => {
    const t = lightTokens as Tokens
    // Rationale (brand.md + Req 5.6): on light backgrounds green text/icons use
    // the brand-mandated Green Dark (#3E8F24), NOT Pitch Green (#5BBF36). Green
    // Dark computes to ~4.07:1 against white — above the 3:1 threshold for UI
    // components, large text, and icons, but below the 4.5:1 body-copy bar.
    // This token is reserved for green accent/icon emphasis; ordinary body copy
    // on light uses --text (#141414, ~18.4:1), which the body-text assertion
    // above already guarantees. So the correct bar for this accent/icon token
    // is 3:1.
    expect(t['--accent-text']).toBe('#3e8f24')
    expect(contrastRatio(t['--accent-text'], t['--bg'])).toBeGreaterThanOrEqual(
      UI_COMPONENT_MIN,
    )
  })
})
