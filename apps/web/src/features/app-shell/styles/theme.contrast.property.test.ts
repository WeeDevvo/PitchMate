/*
 * Property 34: Declared theme tokens meet the contrast floors in both themes.
 *
 * The token tables in `styles/theme.css` are the only place the shell writes a
 * colour, so they are the only place contrast can be established. jsdom cannot
 * help here — it resolves neither a custom property nor a `var()` reference from
 * an imported stylesheet — so this test reads `theme.css` as **source text**,
 * parses the declared values out of the `:root, [data-theme='dark']` and
 * `[data-theme='light']` tables, and computes WCAG 2.1 relative luminance and
 * contrast ratios itself.
 *
 * The existing scan (`theme.tokens.test.ts`, task 13.3) asserts that the two
 * tables declare the same token *names* and resolve every `var()` reference
 * `shell.css` makes. This file asserts the *values*: nothing here repeats that.
 *
 * ## The two floors, and which token owes which
 *
 * Requirement 12.9 puts body text and interactive controls at **4.5:1** against
 * the background they are rendered on. Requirements 12.10 and 13.4 put the focus
 * indicator at **3:1** against its adjacent colours; the same 3:1 non-text floor
 * covers borders and graphical state cues.
 *
 * Which floor a token owes therefore follows from what `shell.css` paints with
 * it, not from the token's name — so each pairing below records its usage. Every
 * text token is measured against **both** backgrounds it can land on, because the
 * frame paints `--bg` on the Content_Region and `--shell-surface` on the header
 * and the disclosure surfaces, and `--control-bg` on a hovered notification row.
 *
 * ## Two tokens are deliberately 3:1 tokens in the light Theme
 *
 * These are honoured, not "fixed":
 *
 *   1. Light `--accent-text` and `--focus-ring` are both Green Dark `#3e8f24`.
 *      Requirement 12.11 fixes green on a light surface to exactly that value,
 *      and it reaches 4.07:1 on white — above the 3:1 bar for icons, borders,
 *      large text, and UI accents, below the 4.5:1 bar for body text. The two
 *      requirements together therefore keep green out of light-Theme body copy
 *      and control labels, and `shell.css` obliges: it uses `--accent-text` only
 *      as a hover `border-color`, and `--focus-ring` only as an `outline`. Both
 *      are asserted at 3:1.
 *   2. Light `--nav-current` is Ink `#141414` rather than green for the same
 *      reason — it paints an interactive control's *label*, which owes 4.5:1,
 *      and green cannot reach that on a light surface. So `--nav-current` is
 *      asserted at 4.5:1 in both Themes.
 *
 * The dark table's stronger claims are not lost by asserting the 3:1 floor
 * uniformly for `--accent-text`: the documentation property below re-reads every
 * ratio and floor written in `theme.css`'s header comment and holds the file to
 * exactly what it claims, which for dark `--accent-text` is 4.5:1.
 *
 * ## What this file does not cover
 *
 * The last clause of Property 34 — the focus style reaching every focusable
 * control — is a stylesheet question rather than a token question. What is
 * asserted here is the half that bears on contrast: every focus indicator
 * `shell.css` declares paints `var(--focus-ring)`, so the 3:1 result proved for
 * that token is the result every declared indicator gets. Whether every control
 * of the frame declares one belongs with the per-control declared-style
 * assertions (task 10.10).
 *
 * Requirements: 12.9, 12.10, 13.4
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GREEN_DARK, PITCH_GREEN, greenTokenForSurface } from '../lib/theme'

const here = dirname(fileURLToPath(import.meta.url))
const themeCss = readFileSync(join(here, 'theme.css'), 'utf8')
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8')

type Theme = 'dark' | 'light'

const THEMES: readonly Theme[] = ['dark', 'light']

/* ------------------------------------------------------------------ *
 * WCAG 2.1 relative luminance and contrast ratio
 *
 * Computed here rather than read from a browser: the values under test are
 * source text, and the arithmetic is the definition given in WCAG 2.1
 * (Understanding SC 1.4.3 / 1.4.11).
 * ------------------------------------------------------------------ */

/** The three 0..255 sRGB channels of a `#rrggbb` value. */
function channels(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (match === null) {
    throw new Error(`not a six-digit hex colour: ${hex}`)
  }
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ]
}

/** Linearise one sRGB channel, per the WCAG 2.1 definition. */
function linearise(channel8Bit: number): number {
  const channel = channel8Bit / 255
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

/** The WCAG 2.1 relative luminance of a `#rrggbb` value, in 0..1. */
function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex)
  return (
    0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue)
  )
}

/** The WCAG 2.1 contrast ratio between two `#rrggbb` values, in 1..21. */
function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/* ------------------------------------------------------------------ *
 * Reading the declared token tables out of theme.css
 * ------------------------------------------------------------------ */

/** Drop `/* ... *\/` comments, so documentation text is never read as CSS. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The custom properties declared inside the first block matching `selector`. */
function tokenTable(css: string, selector: RegExp): Record<string, string> {
  const block = selector.exec(css)
  expect(block, `no token table found for ${String(selector)}`).not.toBeNull()
  const table: Record<string, string> = {}
  const declaration = /--([\w-]+):\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = declaration.exec(block![1])) !== null) {
    table[`--${match[1]}`] = match[2].trim().toLowerCase()
  }
  return table
}

const themeSource = withoutComments(themeCss)

const TABLES: Readonly<Record<Theme, Record<string, string>>> = {
  // The dark table is shared by `:root` and `[data-theme='dark']`, so an absent
  // or unresolved attribute renders dark (Requirements 12.1, 12.13).
  dark: tokenTable(themeSource, /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/),
  light: tokenTable(themeSource, /\[data-theme='light'\]\s*\{([^}]*)\}/),
}

/** The declared value of `token` in `theme`, failing loudly if undeclared. */
function declared(theme: Theme, token: string): string {
  const value = TABLES[theme][token]
  expect(value, `${token} is not declared in the ${theme} table`).toBeDefined()
  return value
}

/* ------------------------------------------------------------------ *
 * The declared pairings
 * ------------------------------------------------------------------ */

/** Body text and interactive control text (Requirement 12.9). */
const TEXT_FLOOR = 4.5

/** Focus indicators, borders, and graphical state cues (Requirements 12.10, 13.4). */
const NON_TEXT_FLOOR = 3

interface Pairing {
  /** The token carrying the text, indicator, border, or cue. */
  readonly foreground: string
  /** The token painting the surface it is rendered on. */
  readonly background: string
  /** The floor this pairing owes, from what `shell.css` paints with it. */
  readonly floor: typeof TEXT_FLOOR | typeof NON_TEXT_FLOOR
  /** What the pairing is, so the floor is justified rather than asserted. */
  readonly usage: string
}

const PAIRINGS: readonly Pairing[] = [
  // ---- Body text and interactive control text: 4.5:1 (Requirement 12.9) ----
  {
    foreground: '--text',
    background: '--bg',
    floor: TEXT_FLOOR,
    usage: 'frame body text on the Content_Region',
  },
  {
    foreground: '--text',
    background: '--shell-surface',
    floor: TEXT_FLOOR,
    usage:
      'Shell_Header text, the brand control, the Skip_Link, the appearance group, the see-all link, and notification-row titles on a disclosure surface',
  },
  {
    foreground: '--text',
    background: '--control-bg',
    floor: TEXT_FLOOR,
    usage: 'a notification row title while the row is hovered',
  },
  {
    foreground: '--muted-text',
    background: '--bg',
    floor: TEXT_FLOOR,
    usage: "the boundary states' body text on the Content_Region",
  },
  {
    foreground: '--muted-text',
    background: '--shell-surface',
    floor: TEXT_FLOOR,
    usage:
      'the panel empty, loading, and failure statements, the sign-out progress and failure statements, and a notification row body and metadata',
  },
  {
    foreground: '--muted-text',
    background: '--control-bg',
    floor: TEXT_FLOOR,
    usage: 'a notification row body and metadata while the row is hovered',
  },
  {
    foreground: '--control-text',
    background: '--control-bg',
    floor: TEXT_FLOOR,
    usage:
      'the labels of the navigation disclosure control, the Mark_All_Read_Control, the retry control, the three Account_Menu controls, and the boundary Home control',
  },
  {
    foreground: '--badge-text',
    background: '--badge-bg',
    floor: TEXT_FLOOR,
    usage: "the Unread_Badge's count text",
  },
  {
    // Ink in the light table precisely so this pairing can owe 4.5:1 — see the
    // header comment.
    foreground: '--nav-current',
    background: '--shell-surface',
    floor: TEXT_FLOOR,
    usage: "the active Primary_Navigation control's label",
  },

  // ---- Focus indicators, borders, and graphical cues: 3:1 (12.10, 13.4) ----
  {
    foreground: '--focus-ring',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage:
      'the focus indicator on the Content_Region and on its level-one heading',
  },
  {
    foreground: '--focus-ring',
    background: '--shell-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      'the focus indicator on every header, panel, and menu control, and on the Skip_Link',
  },
  {
    foreground: '--focus-ring',
    background: '--control-bg',
    floor: NON_TEXT_FLOOR,
    usage:
      'the focus indicator inset into a bordered control, whose own fill is its adjacent colour',
  },
  {
    foreground: '--control-border',
    background: '--control-bg',
    floor: NON_TEXT_FLOOR,
    usage:
      'the border of every bordered control against its own fill — the navigation disclosure control, the mark-all and retry controls, the Account_Menu controls, and the boundary Home control',
  },
  {
    foreground: '--control-border',
    background: '--shell-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      "the header's bottom border, the appearance group's border, the disclosure surface's border, and the see-all separator",
  },
  {
    foreground: '--control-border',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage:
      "the header's bottom border and a disclosure surface's border where the Content_Region is what lies beyond it",
  },
  {
    foreground: '--badge-bg',
    background: '--shell-surface',
    floor: NON_TEXT_FLOOR,
    usage: 'the Unread_Badge shape against the header chrome behind it',
  },
  {
    foreground: '--unread-cue',
    background: '--shell-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      'the unread dot on a Notification_Record against the disclosure surface',
  },
  {
    // 3:1 in both Themes: Requirement 12.11 fixes the light value to Green Dark,
    // which cannot reach 4.5:1 on a light surface, so `shell.css` uses this token
    // only as a hover `border-color`. The dark table's stronger 4.5:1 claim is
    // held to by the documentation property below.
    foreground: '--accent-text',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage: 'green accent emphasis and icons on the Content_Region',
  },
  {
    foreground: '--accent-text',
    background: '--shell-surface',
    floor: NON_TEXT_FLOOR,
    usage: 'green accent emphasis and icons on the header and panel chrome',
  },
  {
    foreground: '--accent-text',
    background: '--control-bg',
    floor: NON_TEXT_FLOOR,
    usage: "the hovered Account_Menu control's border",
  },
]

/** A pairing named the way a failure should read. */
function describePairing(theme: Theme, pairing: Pairing): string {
  return `${theme}: ${pairing.foreground} ${declared(theme, pairing.foreground)} on ${pairing.background} ${declared(theme, pairing.background)} (${pairing.usage})`
}

// Feature: app-shell, Property 34: Declared theme tokens meet the contrast floors in both themes
// Validates: Requirements 12.9, 12.10, 13.4
describe('theme tokens — Property 34: Declared theme tokens meet the contrast floors in both themes', () => {
  it('meets each pairing’s floor in both Themes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...THEMES),
        fc.constantFrom(...PAIRINGS),
        (theme, pairing) => {
          const foreground = declared(theme, pairing.foreground)
          const background = declared(theme, pairing.background)
          const ratio = contrastRatio(foreground, background)

          expect(
            ratio,
            `${describePairing(theme, pairing)} is ${ratio.toFixed(2)}:1, below ${pairing.floor}:1`,
          ).toBeGreaterThanOrEqual(pairing.floor)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('holds for every pairing in both Themes exhaustively', () => {
    // The pairing space is finite and small, so it is also checked whole: a
    // generator that never happened to draw a pairing would prove nothing about
    // it.
    const failures: string[] = []
    for (const theme of THEMES) {
      for (const pairing of PAIRINGS) {
        const ratio = contrastRatio(
          declared(theme, pairing.foreground),
          declared(theme, pairing.background),
        )
        if (ratio < pairing.floor) {
          failures.push(
            `${describePairing(theme, pairing)} = ${ratio.toFixed(2)}:1 < ${pairing.floor}:1`,
          )
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('checks a text pairing and a non-text pairing for each declared token', () => {
    // Guards the pairing table itself: a token added to `theme.css` with no
    // pairing here would otherwise pass by never being measured. The three
    // tokens with no pairing are the ones `shell.css` does not read as a colour
    // against a surface.
    const unmeasured = Object.keys(TABLES.dark).filter(
      (token) =>
        !PAIRINGS.some(
          (pairing) =>
            pairing.foreground === token || pairing.background === token,
        ),
    )
    expect(unmeasured.sort()).toEqual(['--accent-fill', '--surface'])
  })
})

/* ------------------------------------------------------------------ *
 * The header comment's own numbers
 * ------------------------------------------------------------------ */

interface DocumentedRatio {
  readonly theme: Theme
  readonly foreground: string
  readonly foregroundValue: string
  readonly background: string
  readonly ratio: number
  readonly floor: number
}

/**
 * The contrast rows written in `theme.css`'s header comment, e.g.
 * `--text  #f5f5f5 vs --bg  = 16.90:1  (>= 4.5)`.
 *
 * Parsed from the *raw* source, since they live inside the comment the token
 * parsing above strips.
 */
function documentedRatios(): readonly DocumentedRatio[] {
  const darkAt = themeCss.indexOf('DARK  (')
  const lightAt = themeCss.indexOf('LIGHT (')
  const endAt = themeCss.indexOf('### Why', lightAt)
  expect(darkAt).toBeGreaterThan(-1)
  expect(lightAt).toBeGreaterThan(darkAt)
  expect(endAt).toBeGreaterThan(lightAt)

  const sections: readonly (readonly [Theme, string])[] = [
    ['dark', themeCss.slice(darkAt, lightAt)],
    ['light', themeCss.slice(lightAt, endAt)],
  ]

  const row =
    /--([\w-]+)\s+(#[0-9a-f]{6})\s+vs\s+--([\w-]+)\s*=\s*([\d.]+):1\s*\(>=\s*([\d.]+)\)/g
  const rows: DocumentedRatio[] = []
  for (const [theme, section] of sections) {
    let match: RegExpExecArray | null
    row.lastIndex = 0
    while ((match = row.exec(section)) !== null) {
      rows.push({
        theme,
        foreground: `--${match[1]}`,
        foregroundValue: match[2].toLowerCase(),
        background: `--${match[3]}`,
        ratio: Number.parseFloat(match[4]),
        floor: Number.parseFloat(match[5]),
      })
    }
  }
  return rows
}

const DOCUMENTED = documentedRatios()

describe('theme tokens — the header comment’s documented ratios', () => {
  it('finds rows for both Themes (guards the parser itself)', () => {
    expect(DOCUMENTED.filter((row) => row.theme === 'dark').length).toBeGreaterThan(
      9,
    )
    expect(
      DOCUMENTED.filter((row) => row.theme === 'light').length,
    ).toBeGreaterThan(9)
  })

  it('documents the declared value, the computed ratio, and a floor it clears', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DOCUMENTED), (row) => {
        const label = `${row.theme}: ${row.foreground} vs ${row.background}`

        // The hex written in the comment is the hex in the table.
        expect(declared(row.theme, row.foreground), label).toBe(
          row.foregroundValue,
        )

        const computed = contrastRatio(
          declared(row.theme, row.foreground),
          declared(row.theme, row.background),
        )

        // The documented ratio is the computed one, to the two decimal places it
        // is written to.
        expect(
          Number.parseFloat(computed.toFixed(2)),
          `${label} is documented as ${row.ratio}:1 but computes to ${computed.toFixed(2)}:1`,
        ).toBeCloseTo(row.ratio, 2)

        // The documented floor is one of the two the requirements define, and the
        // pairing clears it.
        expect([NON_TEXT_FLOOR, TEXT_FLOOR], label).toContain(row.floor)
        expect(computed, label).toBeGreaterThanOrEqual(row.floor)
      }),
      { numRuns: 300 },
    )
  })

  it('holds for every documented row exhaustively', () => {
    const failures = DOCUMENTED.filter((row) => {
      const computed = contrastRatio(
        declared(row.theme, row.foreground),
        declared(row.theme, row.background),
      )
      return (
        declared(row.theme, row.foreground) !== row.foregroundValue ||
        Number.parseFloat(computed.toFixed(2)) !== row.ratio ||
        computed < row.floor
      )
    })
    expect(failures).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * The green token, and the indicator that carries the 3:1 result
 * ------------------------------------------------------------------ */

describe('theme tokens — green selection and the focus indicator', () => {
  it('declares the green token the surface luminance rule selects', () => {
    // Requirement 12.11 keyed to the surface, not the Theme: each table's
    // `--accent-text` is what `greenTokenForSurface` returns for that table's own
    // background luminance. This checks the *declared values* against the rule;
    // the rule itself is Property 33's subject.
    for (const theme of THEMES) {
      const background = declared(theme, '--bg')
      const expected = greenTokenForSurface(relativeLuminance(background))
      expect(declared(theme, '--accent-text'), `${theme} --accent-text`).toBe(
        expected.toLowerCase(),
      )
    }

    expect(declared('dark', '--accent-text')).toBe(PITCH_GREEN.toLowerCase())
    expect(declared('light', '--accent-text')).toBe(GREEN_DARK.toLowerCase())
  })

  it('paints every focus indicator shell.css declares with --focus-ring', () => {
    // Every `:focus-visible` rule of the frame resolves its outline from the one
    // token measured at 3:1 above, so the proved result is the result each
    // declared indicator gets (Requirements 12.10, 13.4). Whether every control
    // declares an indicator is asserted per control by task 10.10.
    const shellSource = withoutComments(shellCss)
    const outlines = [...shellSource.matchAll(/outline:\s*([^;]+);/g)].map(
      (match) => match[1].trim(),
    )

    expect(outlines.length).toBeGreaterThan(9)
    for (const outline of outlines) {
      expect(outline).toMatch(/^\d+px solid var\(--focus-ring\)$/)
    }
  })
})
