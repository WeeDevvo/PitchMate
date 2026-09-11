/**
 * Property test for the one pre-paint theme bootstrap (subtask 1.7).
 *
 * **Property 31: The pre-paint bootstrap agrees with the pure resolution**
 *
 * *For any* stored appearance value and any browser appearance preference,
 * evaluating the single pre-paint theme bootstrap applies to the document
 * exactly the theme the pure resolution function yields for that interpreted
 * preference and browser preference, and it raises no exception for an absent
 * value, an invalid value, or an unreadable storage.
 *
 * The bootstrap is a source string precisely so it can be evaluated outside a
 * browser: `new Function(THEME_BOOTSTRAP_SOURCE)()` runs the same text the
 * injected inline `<script>` runs, against jsdom's `window`. The example-based
 * cases live in `src/theme/themeBootstrap.test.ts`; this file generalises them
 * over arbitrary stored values and every browser preference state, so the
 * bootstrap's hand-written ES5 branch table cannot drift from `resolveTheme`.
 *
 * Everything is imported through the App_Shell's re-export (`./theme`), which
 * resolves to the one shared module in `src/theme` (Requirements 15.3, 15.7).
 *
 * **Validates: Requirements 12.13**
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

import {
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
  interpretStoredPreference,
  resolveTheme,
} from './theme'

// --- The two inputs the bootstrap reads -------------------------------------

/** What the single namespaced storage key yields on this run. */
type StorageCase =
  | { readonly kind: 'absent' }
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'unreadable' }

/**
 * What the browser reports about its appearance preference.
 *
 * `none` is a browser that expresses no preference (neither media query
 * matches), `unsupported` is one with no `matchMedia` at all, and `throwing` is
 * a privacy mode or locked-down embed where the query itself raises. All three
 * mean "no explicit light preference", which is what `resolveTheme` is told.
 */
type BrowserCase = 'light' | 'dark' | 'none' | 'unsupported' | 'throwing'

/** The raw value `interpretStoredPreference` sees for a storage case. */
function storedValue(storage: StorageCase): string | null {
  return storage.kind === 'value' ? storage.value : null
}

/** True iff the browser reports an *explicit* light appearance preference. */
function browserPrefersLight(browser: BrowserCase): boolean {
  return browser === 'light'
}

// --- Ambient setup ----------------------------------------------------------

/** Install the storage the bootstrap will read from. */
function installStorage(storage: StorageCase): void {
  if (storage.kind === 'unreadable') {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('read rejected')
      },
      setItem() {
        throw new Error('write rejected')
      },
    })
    return
  }

  localStorage.clear()
  if (storage.kind === 'value') {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, storage.value)
  }
}

/** Install the `matchMedia` the bootstrap will consult. */
function installMatchMedia(browser: BrowserCase): void {
  if (browser === 'unsupported') {
    vi.stubGlobal('matchMedia', undefined)
    return
  }

  if (browser === 'throwing') {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('media query rejected')
    })
    return
  }

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === LIGHT_APPEARANCE_QUERY && browser === 'light',
    media: query,
  }))
}

/**
 * Evaluate the bootstrap exactly as the injected inline script would, and
 * report the theme it left on the document element.
 *
 * The ambient globals are restored before returning so one iteration cannot
 * leak into the next.
 */
function runBootstrap(storage: StorageCase, browser: BrowserCase): string | null {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)

  try {
    installStorage(storage)
    installMatchMedia(browser)
    new Function(THEME_BOOTSTRAP_SOURCE)()
    return document.documentElement.getAttribute(THEME_ATTRIBUTE)
  } finally {
    vi.unstubAllGlobals()
    localStorage.clear()
  }
}

// --- Generators -------------------------------------------------------------

/**
 * Stored values, biased towards the boundary between recognised and
 * unrecognised: the three valid values, near-misses that differ only in case or
 * whitespace, shapes a foreign writer might leave behind, and arbitrary text.
 */
const storageCase: fc.Arbitrary<StorageCase> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<StorageCase>({ kind: 'absent' }) },
  { weight: 1, arbitrary: fc.constant<StorageCase>({ kind: 'unreadable' }) },
  {
    weight: 3,
    arbitrary: fc
      .constantFrom('system', 'dark', 'light')
      .map((value) => ({ kind: 'value', value }) as StorageCase),
  },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom(
        'System',
        'DARK',
        'Light',
        ' light',
        'dark ',
        '',
        'null',
        'undefined',
        '"light"',
        '{"appearance":"light"}',
        'auto',
        'chartreuse',
      )
      .map((value) => ({ kind: 'value', value }) as StorageCase),
  },
  {
    weight: 2,
    arbitrary: fc
      .string()
      .map((value) => ({ kind: 'value', value }) as StorageCase),
  },
)

const browserCase: fc.Arbitrary<BrowserCase> = fc.constantFrom<BrowserCase>(
  'light',
  'dark',
  'none',
  'unsupported',
  'throwing',
)

// --- Property 31 ------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

describe('Property 31: the pre-paint bootstrap agrees with the pure resolution', () => {
  it('applies exactly the theme resolveTheme yields, for every stored value and browser preference', () => {
    fc.assert(
      fc.property(storageCase, browserCase, (storage, browser) => {
        const expected = resolveTheme(
          interpretStoredPreference(storedValue(storage)),
          browserPrefersLight(browser),
        )

        // Raises no exception for an absent, invalid, or unreadable value, and
        // never leaves the document without a theme (Requirement 12.13).
        const applied = runBootstrap(storage, browser)

        expect(applied).toBe(expected)
        expect(applied === 'dark' || applied === 'light').toBe(true)
      }),
      { numRuns: 300 },
    )
  })
})
