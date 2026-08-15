import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { greenTextToken, type Theme } from './theme'

describe('greenTextToken', () => {
  it('returns Green Dark for the light theme', () => {
    expect(greenTextToken('light')).toBe('#3E8F24')
  })

  it('returns Pitch Green for the dark theme', () => {
    expect(greenTextToken('dark')).toBe('#5BBF36')
  })

  // Feature: web-auth-screens, Property 18: Green token selection by theme
  it('returns Green Dark iff the theme is light, and Pitch Green when dark', () => {
    const themeArb: fc.Arbitrary<Theme> = fc.constantFrom<Theme>('dark', 'light')

    fc.assert(
      fc.property(themeArb, (theme) => {
        const token = greenTextToken(theme)
        // Green Dark #3E8F24 is returned if and only if the theme is 'light'.
        expect(token === '#3E8F24').toBe(theme === 'light')
        // The dark theme yields Pitch Green #5BBF36.
        if (theme === 'dark') {
          expect(token).toBe('#5BBF36')
        }
      }),
      { numRuns: 200 },
    )
  })
})
