/** Unit tests for the single Appearance_Preference store. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  createInMemoryAppearanceStorage,
  readAppearancePreference,
  writeAppearancePreference,
  type AppearanceStorage,
} from './appearancePreference'
import { APPEARANCE_PREFERENCES } from './themeResolution'

/** A storage whose every access is rejected, modelling a blocked store. */
const throwingStorage: AppearanceStorage = {
  getItem() {
    throw new Error('read rejected')
  },
  setItem() {
    throw new Error('write rejected')
  },
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('APPEARANCE_STORAGE_KEY', () => {
  it('is the one namespaced key', () => {
    // Requirements 12.5, 15.7
    expect(APPEARANCE_STORAGE_KEY).toBe('pitchmate.appearance')
  })
})

describe('readAppearancePreference', () => {
  it('yields system when storage is unavailable', () => {
    // Requirement 12.6
    expect(readAppearancePreference(null)).toBe('system')
  })

  it('yields system when the ambient storage is absent', () => {
    // Requirement 12.6 — e.g. a non-browser or locked-down context.
    vi.stubGlobal('localStorage', undefined)
    expect(readAppearancePreference()).toBe('system')
  })

  it('yields system when the read is rejected, surfacing no error', () => {
    // Requirement 12.6
    expect(() => readAppearancePreference(throwingStorage)).not.toThrow()
    expect(readAppearancePreference(throwingStorage)).toBe('system')
  })

  it('yields system when the key is absent', () => {
    // Requirement 12.6
    expect(readAppearancePreference(createInMemoryAppearanceStorage())).toBe(
      'system',
    )
  })

  it('yields system for a malformed stored value', () => {
    // Requirement 12.6 — anything outside the three known values.
    for (const malformed of ['', 'sepia', 'DARK', '{"theme":"light"}', ' light']) {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, malformed)
      expect(readAppearancePreference()).toBe('system')
    }
  })

  it('yields each stored preference value unchanged', () => {
    // Requirement 12.5
    for (const preference of APPEARANCE_PREFERENCES) {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, preference)
      expect(readAppearancePreference()).toBe(preference)
    }
  })
})

describe('writeAppearancePreference', () => {
  it('persists the bare value under the one key and reports success', () => {
    // Requirement 12.5 — bare value so the pre-paint bootstrap needs no parsing.
    expect(writeAppearancePreference('light')).toBe(true)
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light')
  })

  it('round-trips every preference value', () => {
    // Requirement 12.5
    for (const preference of APPEARANCE_PREFERENCES) {
      expect(writeAppearancePreference(preference)).toBe(true)
      expect(readAppearancePreference()).toBe(preference)
    }
  })

  it('reports failure without throwing when the write is rejected', () => {
    // Requirement 12.14 — the selection is honoured in memory only.
    expect(() => writeAppearancePreference('dark', throwingStorage)).not.toThrow()
    expect(writeAppearancePreference('dark', throwingStorage)).toBe(false)
  })

  it('reports failure when storage is unavailable, leaving the next start at system', () => {
    // Requirement 12.14
    expect(writeAppearancePreference('light', null)).toBe(false)
    expect(readAppearancePreference(null)).toBe('system')
  })
})
