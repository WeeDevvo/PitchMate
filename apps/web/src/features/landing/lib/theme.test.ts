import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  resolveTheme,
  greenTextToken,
  type AppearancePreference,
  type Theme,
} from './theme'

describe('resolveTheme', () => {
  it('returns light only for an explicit light preference', () => {
    expect(resolveTheme('light')).toBe('light')
  })

  it('returns dark for an explicit dark preference', () => {
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('returns dark when the preference is unresolvable (null)', () => {
    expect(resolveTheme(null)).toBe('dark')
  })

  // Feature: marketing-landing-page, Property 1: Theme resolution favours dark
  it('resolves to light iff the preference is explicitly light, else dark', () => {
    // Arbitrary over the resolvable preference space ('light' | 'dark' | null)
    // plus stray/arbitrary values that should behave as non-light => dark.
    const strayValue = fc
      .anything()
      .filter((v) => v !== 'light') as fc.Arbitrary<AppearancePreference>

    const prefArb: fc.Arbitrary<AppearancePreference> = fc.oneof(
      fc.constantFrom<AppearancePreference>('light', 'dark', null),
      strayValue,
    )

    fc.assert(
      fc.property(prefArb, (pref) => {
        const theme = resolveTheme(pref)
        if (pref === 'light') {
          expect(theme).toBe('light')
        } else {
          expect(theme).toBe('dark')
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('greenTextToken', () => {
  it('returns Green Dark for the light theme', () => {
    expect(greenTextToken('light')).toBe('#3E8F24')
  })

  it('returns Pitch Green for the dark theme', () => {
    expect(greenTextToken('dark')).toBe('#5BBF36')
  })

  // Feature: marketing-landing-page, Property 2: Green text/icon token depends on theme
  it('returns Green Dark for light and Pitch Green for dark across all themes', () => {
    const themeArb: fc.Arbitrary<Theme> = fc.constantFrom<Theme>('dark', 'light')

    fc.assert(
      fc.property(themeArb, (theme) => {
        const token = greenTextToken(theme)
        if (theme === 'light') {
          expect(token).toBe('#3E8F24')
        } else {
          expect(token).toBe('#5BBF36')
        }
      }),
      { numRuns: 200 },
    )
  })
})
