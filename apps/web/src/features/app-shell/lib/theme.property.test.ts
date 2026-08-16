import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  GREEN_DARK,
  GREEN_TOKEN_LUMINANCE_THRESHOLD,
  PITCH_GREEN,
  greenTextToken,
  greenTokenForSurface,
  resolveTheme,
  type ResolvableAppearancePreference,
  type Theme,
} from './theme'

/**
 * The finite core of the input space: the three stored Appearance_Preference
 * values plus the two "no stored preference" shapes the resolver admits.
 */
const CORE_PREFERENCES: readonly ResolvableAppearancePreference[] = [
  'system',
  'dark',
  'light',
  null,
  undefined,
]

/**
 * Every browser appearance preference the resolver can be handed. Only an
 * explicit `true` is an explicit light preference; `false`, `null`, and
 * `undefined` all mean the browser expresses no light preference.
 */
const BROWSER_PREFERENCES: readonly (boolean | null | undefined)[] = [
  true,
  false,
  null,
  undefined,
]

/**
 * The dark-mode-first rule stated independently of the implementation: `light`
 * in exactly two cases, `dark` in every other.
 */
function expectedTheme(
  preference: unknown,
  browserPrefersLight: boolean | null | undefined,
): Theme {
  if (preference === 'light') {
    return 'light'
  }

  if (preference === 'system' && browserPrefersLight === true) {
    return 'light'
  }

  return 'dark'
}

// Feature: app-shell, Property 29: Theme resolution is dark-mode-first
// Validates: Requirements 12.1, 12.2, 12.3, 12.12, 14.10
describe('resolveTheme — Property 29: Theme resolution is dark-mode-first', () => {
  it('resolves to light only for an explicit light preference or system with an explicit light browser preference', () => {
    // Constrain to the shapes a caller can actually hold — the three stored
    // values and the two absent forms — then widen with stray values of any
    // type, since an unrecognised preference must also fall to dark.
    const preferenceArb: fc.Arbitrary<ResolvableAppearancePreference> = fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...CORE_PREFERENCES) },
      {
        weight: 1,
        arbitrary: fc.anything() as fc.Arbitrary<ResolvableAppearancePreference>,
      },
    )

    const browserArb: fc.Arbitrary<boolean | null | undefined> =
      fc.constantFrom(...BROWSER_PREFERENCES)

    fc.assert(
      fc.property(preferenceArb, browserArb, (preference, browserPrefersLight) => {
        const theme = resolveTheme(preference, browserPrefersLight)

        expect(theme).toBe(expectedTheme(preference, browserPrefersLight))

        // The resolution is single-valued and total: one of exactly two themes,
        // and light only under the two admitted conditions.
        expect(theme === 'dark' || theme === 'light').toBe(true)
        if (theme === 'light') {
          expect(
            preference === 'light' ||
              (preference === 'system' && browserPrefersLight === true),
          ).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('holds across every combination of the finite core input space', () => {
    for (const preference of CORE_PREFERENCES) {
      for (const browserPrefersLight of BROWSER_PREFERENCES) {
        expect(resolveTheme(preference, browserPrefersLight)).toBe(
          expectedTheme(preference, browserPrefersLight),
        )
      }
    }

    // Omitting the browser preference entirely is the same as no explicit light
    // preference, so only 'light' pulls away from dark.
    for (const preference of CORE_PREFERENCES) {
      expect(resolveTheme(preference)).toBe(
        preference === 'light' ? 'light' : 'dark',
      )
    }
  })
})

/**
 * The two themes a surface can be rendered inside. The green token must not
 * depend on this value at all — it is generated only to demonstrate that.
 */
const THEMES: readonly Theme[] = ['dark', 'light']

/**
 * Luminances worth naming: the ends of the 0..1 range, the 0.05 boundary
 * itself, and the values immediately either side of it. `fc.double` alone will
 * essentially never land on the boundary, so it is supplied explicitly.
 */
const BOUNDARY_LUMINANCES: readonly number[] = [
  0,
  Number.MIN_VALUE,
  0.0499,
  GREEN_TOKEN_LUMINANCE_THRESHOLD - Number.EPSILON,
  GREEN_TOKEN_LUMINANCE_THRESHOLD,
  GREEN_TOKEN_LUMINANCE_THRESHOLD + Number.EPSILON,
  0.0501,
  0.5,
  1,
]

/**
 * The whole 0..1 relative-luminance range, weighted towards the boundary
 * values so each run exercises both sides of the threshold and the threshold
 * itself rather than only the wide-open middle.
 */
const luminanceArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.double({ min: 0, max: 1, noNaN: true }),
  },
  { weight: 2, arbitrary: fc.constantFrom(...BOUNDARY_LUMINANCES) },
)

// Feature: app-shell, Property 33: The green token is chosen from surface luminance alone
// Validates: Requirements 12.11
describe('greenTokenForSurface — Property 33: The green token is chosen from surface luminance alone', () => {
  it('takes Green Dark at or above 0.05 and Pitch Green below it, whichever theme is active', () => {
    fc.assert(
      fc.property(luminanceArb, fc.constantFrom(...THEMES), (luminance, theme) => {
        const token = greenTokenForSurface(luminance)

        // The rule, stated independently of the implementation.
        expect(token).toBe(
          luminance >= GREEN_TOKEN_LUMINANCE_THRESHOLD ? GREEN_DARK : PITCH_GREEN,
        )

        // Single-valued: one of exactly the two brand green tokens.
        expect(token === PITCH_GREEN || token === GREEN_DARK).toBe(true)

        // The active theme is not an input, so resolving the theme alongside the
        // surface cannot change the outcome. Green on a dark card inside the
        // light theme still takes the dark-surface token.
        expect(greenTokenForSurface(luminance)).toBe(token)
        void resolveTheme(theme)
        expect(greenTokenForSurface(luminance)).toBe(token)
      }),
      { numRuns: 300 },
    )
  })

  it('disagrees with the active theme whenever the surface disagrees with it', () => {
    // A dark surface inside the light theme, and a light surface inside the dark
    // theme: the token follows the surface, not the theme it sits inside.
    const darkSurfaceArb = fc.double({
      min: 0,
      max: GREEN_TOKEN_LUMINANCE_THRESHOLD,
      maxExcluded: true,
      noNaN: true,
    })
    const lightSurfaceArb = fc.double({
      min: GREEN_TOKEN_LUMINANCE_THRESHOLD,
      max: 1,
      noNaN: true,
    })

    fc.assert(
      fc.property(
        darkSurfaceArb,
        lightSurfaceArb,
        fc.constantFrom(...THEMES),
        (darkSurface, lightSurface, theme) => {
          // Resolving the theme first proves the active theme is available and
          // still irrelevant to the outcome.
          expect(resolveTheme(theme)).toBe(theme === 'light' ? 'light' : 'dark')

          expect(greenTokenForSurface(darkSurface)).toBe(PITCH_GREEN)
          expect(greenTokenForSurface(lightSurface)).toBe(GREEN_DARK)

          // The two surfaces take different tokens under one and the same
          // theme, so the theme cannot be what decides.
          expect(greenTokenForSurface(darkSurface)).not.toBe(
            greenTokenForSurface(lightSurface),
          )
        },
      ),
      { numRuns: 300 },
    )
  })

  it('holds at every named boundary luminance', () => {
    expect(greenTokenForSurface(0)).toBe(PITCH_GREEN)
    expect(greenTokenForSurface(0.0499)).toBe(PITCH_GREEN)
    expect(
      greenTokenForSurface(GREEN_TOKEN_LUMINANCE_THRESHOLD - Number.EPSILON),
    ).toBe(PITCH_GREEN)
    expect(greenTokenForSurface(GREEN_TOKEN_LUMINANCE_THRESHOLD)).toBe(GREEN_DARK)
    expect(
      greenTokenForSurface(GREEN_TOKEN_LUMINANCE_THRESHOLD + Number.EPSILON),
    ).toBe(GREEN_DARK)
    expect(greenTokenForSurface(1)).toBe(GREEN_DARK)
  })

  it('selects the theme-surface token through the same luminance rule', () => {
    // The convenience form for green on a theme's own background is defined
    // through the surface rule, so it must agree with it: the light theme's
    // background is a light surface, the dark theme's is a dark surface.
    expect(greenTextToken('dark')).toBe(PITCH_GREEN)
    expect(greenTextToken('light')).toBe(GREEN_DARK)
  })
})
