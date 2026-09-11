/**
 * Unit tests for the one pre-paint theme bootstrap and its injection.
 *
 * The bootstrap is a source string precisely so it can be evaluated here rather
 * than only in a browser. These tests cover the obvious stored values and the
 * injection shape; the exhaustive agreement with `resolveTheme` across every
 * stored value is Property 31 (subtask 1.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIGHT_APPEARANCE_QUERY,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
  applyThemeAttribute,
} from './themeBootstrap'
import { APPEARANCE_STORAGE_KEY } from './appearancePreference'
import { THEME_BOOTSTRAP_PLUGIN_NAME, themeBootstrapPlugin } from '../../vite.config'
import type { IndexHtmlTransformHook } from 'vite'

/** Evaluate the bootstrap exactly as the injected inline script would. */
function runBootstrap(): void {
  new Function(THEME_BOOTSTRAP_SOURCE)()
}

/** The theme the bootstrap left on the document element, if any. */
function appliedTheme(): string | null {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE)
}

/** Install a `matchMedia` reporting the given explicit light preference. */
function stubPrefersLight(prefersLight: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === LIGHT_APPEARANCE_QUERY ? prefersLight : false,
    media: query,
  }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

describe('THEME_BOOTSTRAP_SOURCE', () => {
  it('reads the one namespaced storage key rather than repeating the literal', () => {
    // Requirement 15.7 — the key is interpolated from the single declaration.
    expect(THEME_BOOTSTRAP_SOURCE).toContain(
      JSON.stringify(APPEARANCE_STORAGE_KEY),
    )
    expect(THEME_BOOTSTRAP_SOURCE).toContain(
      JSON.stringify(LIGHT_APPEARANCE_QUERY),
    )
  })

  it('applies light for a stored light preference, whatever the browser says', () => {
    // Requirements 12.3, 12.13
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'light')
    stubPrefersLight(false)

    runBootstrap()

    expect(appliedTheme()).toBe('light')
  })

  it('applies dark for a stored dark preference, whatever the browser says', () => {
    // Requirements 12.3, 12.13
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark')
    stubPrefersLight(true)

    runBootstrap()

    expect(appliedTheme()).toBe('dark')
  })

  it('follows an explicit light browser preference for the system preference', () => {
    // Requirements 12.2, 12.13
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'system')
    stubPrefersLight(true)

    runBootstrap()

    expect(appliedTheme()).toBe('light')
  })

  it('applies dark for the system preference with no explicit light preference', () => {
    // Requirements 12.1, 12.12 — dark-mode-first.
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'system')
    stubPrefersLight(false)

    runBootstrap()

    expect(appliedTheme()).toBe('dark')
  })

  it('applies dark for an absent value with no browser preference support', () => {
    // Requirement 12.13 — jsdom supplies no matchMedia here.
    runBootstrap()

    expect(appliedTheme()).toBe('dark')
  })

  it('treats an unrecognised stored value as system', () => {
    // Requirements 12.6, 12.13
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'chartreuse')
    stubPrefersLight(true)

    runBootstrap()

    expect(appliedTheme()).toBe('light')
  })

  it('applies dark when the store rejects the read', () => {
    // Requirements 12.6, 12.13 — an unreadable value still paints a theme.
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('read rejected')
      },
    })

    runBootstrap()

    expect(appliedTheme()).toBe('dark')
  })

  it('applies dark when the media query itself throws', () => {
    // Requirement 12.13 — the bootstrap never leaves the document themeless.
    vi.stubGlobal('matchMedia', () => {
      throw new Error('media query rejected')
    })

    runBootstrap()

    expect(appliedTheme()).toBe('dark')
  })
})

describe('applyThemeAttribute', () => {
  it('records the theme on the ambient document element', () => {
    expect(applyThemeAttribute('light')).toBe(true)
    expect(appliedTheme()).toBe('light')

    expect(applyThemeAttribute('dark')).toBe(true)
    expect(appliedTheme()).toBe('dark')
  })

  it('writes to a supplied target under the one attribute name', () => {
    const written: Array<[string, string]> = []
    const target = {
      setAttribute(name: string, value: string) {
        written.push([name, value])
      },
    }

    expect(applyThemeAttribute('dark', target)).toBe(true)
    expect(written).toEqual([[THEME_ATTRIBUTE, 'dark']])
  })

  it('reports failure without throwing when there is no element', () => {
    expect(applyThemeAttribute('dark', null)).toBe(false)
  })

  it('reports failure without throwing when the write is rejected', () => {
    const target = {
      setAttribute() {
        throw new Error('write rejected')
      },
    }

    expect(applyThemeAttribute('light', target)).toBe(false)
  })
})

describe('themeBootstrapPlugin', () => {
  it('injects the bootstrap source into head as one inline non-module script', () => {
    // Requirements 12.13, 15.7
    const plugin = themeBootstrapPlugin()
    expect(plugin.name).toBe(THEME_BOOTSTRAP_PLUGIN_NAME)

    const hook = plugin.transformIndexHtml as IndexHtmlTransformHook
    const result = hook.call(
      // The hook uses neither `this` nor its arguments.
      undefined as never,
      '<html><head></head><body></body></html>',
      undefined as never,
    )

    expect(Array.isArray(result)).toBe(true)
    const tags = result as Array<Record<string, unknown>>
    expect(tags).toHaveLength(1)
    expect(tags[0].tag).toBe('script')
    expect(tags[0].injectTo).toBe('head')
    expect(tags[0].children).toBe(THEME_BOOTSTRAP_SOURCE)
    // A `type` would defer the script past first paint.
    expect(tags[0].attrs).toBeUndefined()
  })
})
