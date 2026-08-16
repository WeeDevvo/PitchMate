/** Unit tests for the shared, pure Theme resolution module. */
import { describe, it, expect } from 'vitest'
import {
  APPEARANCE_PREFERENCES,
  GREEN_DARK,
  GREEN_TOKEN_LUMINANCE_THRESHOLD,
  PITCH_GREEN,
  greenTextToken,
  greenTokenForSurface,
  interpretStoredPreference,
  isAppearancePreference,
  resolveTheme,
} from './themeResolution'

describe('resolveTheme', () => {
  it('resolves system with no explicit light browser preference to dark', () => {
    // Requirement 12.1
    expect(resolveTheme('system', false)).toBe('dark')
    expect(resolveTheme('system', null)).toBe('dark')
    expect(resolveTheme('system')).toBe('dark')
  })

  it('resolves system with an explicit light browser preference to light', () => {
    // Requirement 12.2
    expect(resolveTheme('system', true)).toBe('light')
  })

  it('honours an explicit preference over the browser', () => {
    // Requirement 12.3
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('resolves an absent or unrecognised preference to dark', () => {
    // Requirement 14.10 — dark-mode-first for every other case.
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(undefined, true)).toBe('dark')
  })
})

describe('interpretStoredPreference', () => {
  it('keeps each of the three stored values', () => {
    for (const preference of APPEARANCE_PREFERENCES) {
      expect(interpretStoredPreference(preference)).toBe(preference)
    }
  })

  it('falls back to system for absent, malformed, and foreign values', () => {
    // Requirement 12.6 — every value is interpreted, none is rejected.
    expect(interpretStoredPreference(undefined)).toBe('system')
    expect(interpretStoredPreference(null)).toBe('system')
    expect(interpretStoredPreference('')).toBe('system')
    expect(interpretStoredPreference('LIGHT')).toBe('system')
    expect(interpretStoredPreference(0)).toBe('system')
    expect(interpretStoredPreference({ value: 'light' })).toBe('system')
  })

  it('recognises exactly the three stored values', () => {
    expect(isAppearancePreference('system')).toBe(true)
    expect(isAppearancePreference('sepia')).toBe(false)
  })
})

describe('greenTokenForSurface', () => {
  it('takes Green Dark at and above the luminance boundary', () => {
    // Requirement 12.11
    expect(greenTokenForSurface(GREEN_TOKEN_LUMINANCE_THRESHOLD)).toBe(GREEN_DARK)
    expect(greenTokenForSurface(1)).toBe(GREEN_DARK)
  })

  it('takes Pitch Green below the luminance boundary', () => {
    expect(greenTokenForSurface(0)).toBe(PITCH_GREEN)
    expect(greenTokenForSurface(0.049)).toBe(PITCH_GREEN)
  })

  it('treats a non-comparable luminance as a dark surface', () => {
    expect(greenTokenForSurface(Number.NaN)).toBe(PITCH_GREEN)
  })

  it('picks the token from the theme surface for the convenience form', () => {
    expect(greenTextToken('light')).toBe(GREEN_DARK)
    expect(greenTextToken('dark')).toBe(PITCH_GREEN)
  })
})
