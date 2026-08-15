import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { resolveTheme, type AppearancePreference } from './theme'

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

  // Feature: web-auth-screens, Property 17: Theme resolution is dark-mode-first
  it('resolves to light iff the preference is explicitly light, else dark', () => {
    // Arbitrary over the resolvable preference space ('light' | 'dark' | null)
    // plus stray/arbitrary values that must behave as non-light => dark.
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
