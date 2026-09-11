/**
 * Property test for cross-context adoption of a stored appearance value (task 13.4).
 *
 * **Property 30: Any stored appearance value is interpreted, never rejected.**
 *
 * *For any* value read from the single namespaced appearance storage key,
 * including an absent value, a value that is not one of `system`, `dark`, or
 * `light`, and a read that raises, the interpreted appearance preference is that
 * value when it is one of the three and `system` otherwise, no error indication
 * is rendered, and when the value changes in another browsing context the
 * interpreted preference is adopted, the newly resolved theme's token values are
 * applied without a full-document reload, and the appearance control reports the
 * matching option as selected.
 *
 * The pure interpretation rule is generalised in
 * `lib/appearancePreference.property.test.ts`. This file carries the half of the
 * property that only a rendered surface can show, and so sits beside the
 * Theme_Provider as the design's testing strategy directs: the value arriving from
 * another browsing context, the Theme landing on the *existing* document, the
 * Appearance_Preference_Control reporting the matching option, and no error
 * indication for any of it (Requirements 12.6, 12.15).
 *
 * ### What is driven and what is observed
 *
 * jsdom implements neither cross-context `storage` events nor `matchMedia`, so the
 * event is dispatched by hand — the same shape the browser delivers, including the
 * `null` key that means the whole store was cleared — and `matchMedia` is stubbed
 * per run so both browser appearance preferences are exercised.
 *
 * Nothing is asserted against `interpretStoredPreference`'s own output. Each run
 * computes the preference the requirement names from the generated value directly,
 * then checks three independent reports of it: the context value, the
 * `data-theme` attribute (through the pure resolution), and the option the control
 * reports as selected.
 *
 * "Without a full-document reload" is observed as the document element and the
 * rendered control keeping their identity across the change, and the mounted
 * subtree never re-mounting — a reload or a remount would replace all three.
 *
 * Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
 * Validates: Requirements 12.6, 12.15
 */
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import fc from 'fast-check';

import {
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  createInMemoryAppearanceStorage,
  interpretStoredPreference,
  resolveTheme,
  type AppearancePreference,
  type AppearanceStorage,
  type Theme,
} from '../../../theme';
import { AppearancePreferenceControl } from './AppearancePreferenceControl';
import { ShellThemeProvider, useShellTheme } from './ShellThemeProvider';
import { APPEARANCE_OPTION_LABELS } from '../lib/messages';

// --- The rule, stated independently of the implementation -------------------

const PREFERENCES: readonly AppearancePreference[] = ['system', 'dark', 'light'];

/** Requirement 12.6/12.15: the value when it is one of the three, else `system`. */
function expectedPreference(value: string | null): AppearancePreference {
  return value !== null && (PREFERENCES as readonly string[]).includes(value)
    ? (value as AppearancePreference)
    : 'system';
}

/** Requirement 12.1/12.2/12.3: dark-mode-first, written out rather than imported. */
function expectedTheme(
  preference: AppearancePreference,
  browserPrefersLight: boolean,
): Theme {
  if (preference === 'light') {
    return 'light';
  }
  return preference === 'system' && browserPrefersLight ? 'light' : 'dark';
}

// --- Ambient stubs ----------------------------------------------------------

/** A `matchMedia` reporting a fixed browser appearance preference. */
function installMatchMedia(prefersLight: boolean): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query === LIGHT_APPEARANCE_QUERY ? prefersLight : false,
      media: query,
      onchange: null,
      // The browser preference is fixed for a run, so subscribing is a no-op.
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

/** Storage holding `value` under the single key, or nothing when `null`. */
function storageHolding(value: string | null): AppearanceStorage {
  const storage = createInMemoryAppearanceStorage();
  if (value !== null) {
    storage.setItem(APPEARANCE_STORAGE_KEY, value);
  }
  return storage;
}

/** Storage whose read raises — the "cannot be read" case of Requirement 12.6. */
function rejectingStorage(): AppearanceStorage {
  return {
    getItem(): string | null {
      throw new Error('read rejected');
    },
    setItem(): void {
      throw new Error('write rejected');
    },
  };
}

// --- The harness ------------------------------------------------------------

/**
 * How many times the provider's subtree has mounted since the last render call.
 *
 * A full-document reload or a remount of the children would push this past one,
 * which is how "without a full-document reload" is observed here.
 */
let subtreeMounts = 0;

/** Reports the context value and counts its own mounts. */
function ThemeProbe(): ReactElement {
  useEffect(() => {
    subtreeMounts += 1;
  }, []);

  const { theme, preference } = useShellTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="preference">{preference}</span>
    </div>
  );
}

function renderProvider(storage: AppearanceStorage | null): void {
  subtreeMounts = 0;
  render(
    <ShellThemeProvider storage={storage}>
      <AppearancePreferenceControl />
      <ThemeProbe />
    </ShellThemeProvider>,
  );
}

function reportedPreference(): string {
  return screen.getByTestId('preference').textContent ?? '';
}

function reportedTheme(): string {
  return screen.getByTestId('theme').textContent ?? '';
}

function appliedTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

function mountCount(): number {
  return subtreeMounts;
}

function option(preference: AppearancePreference): HTMLInputElement {
  return screen.getByRole('radio', {
    name: APPEARANCE_OPTION_LABELS[preference],
  }) as HTMLInputElement;
}

/** A cross-context change of the stored value, as the browser would deliver it. */
function dispatchStorageEvent(key: string | null, newValue: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  });
}

/**
 * Assert all three reports of the interpreted preference, plus the two things
 * that must *not* happen: an error indication, and a reload.
 */
function expectAdopted(
  expected: AppearancePreference,
  browserPrefersLight: boolean,
): void {
  const theme = expectedTheme(expected, browserPrefersLight);

  // 12.15: the value is adopted, whatever it was.
  expect(reportedPreference()).toBe(expected);
  // 12.12: the newly resolved Theme, and the token table it selects, in force.
  expect(reportedTheme()).toBe(theme);
  expect(appliedTheme()).toBe(theme);

  // 12.4, 12.15: exactly the matching option reports as selected.
  expect(option(expected)).toBeChecked();
  for (const other of PREFERENCES.filter((value) => value !== expected)) {
    expect(option(other)).not.toBeChecked();
  }

  // 12.6: no error indication for any stored value, however unrecognisable.
  expect(screen.queryByRole('alert')).toBeNull();

  // No full-document reload and no remount: the subtree mounted exactly once.
  expect(mountCount()).toBe(1);
}

// --- Generators -------------------------------------------------------------

/**
 * Stored strings worth naming: the three valid values, empty and whitespace-only
 * text, case and padding near-misses, structured or foreign values, non-ASCII
 * text, and something far too long to be anybody's preference.
 */
const NAMED_STORED_STRINGS: readonly string[] = [
  'system',
  'dark',
  'light',
  '',
  ' ',
  '\t\n',
  'System',
  'DARK',
  'Light',
  'lIgHt',
  ' light',
  'dark ',
  '"light"',
  '{"appearance":"dark"}',
  'null',
  'undefined',
  'auto',
  'chartreuse',
  '0',
  'true',
  'ライト',
  '🌗',
  'x'.repeat(5000),
];

/** Every shape the single key can yield: absent, named, or arbitrary text. */
const storedValueArb: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<string | null>(null) },
  { weight: 6, arbitrary: fc.constantFrom(...NAMED_STORED_STRINGS) },
  { weight: 3, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.json() },
);

const browserPrefersLightArb: fc.Arbitrary<boolean> = fc.boolean();

// --- Setup ------------------------------------------------------------------

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  document.documentElement.removeAttribute('data-theme');
});

// --- Property 30: the cross-context half ------------------------------------

describe('Property 30: any stored appearance value is interpreted, never rejected', () => {
  // Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
  // Validates: Requirements 12.6
  it('interprets whatever is already stored at start-up, reporting it and rendering no error', () => {
    fc.assert(
      fc.property(storedValueArb, browserPrefersLightArb, (stored, prefersLight) => {
        installMatchMedia(prefersLight);
        document.documentElement.removeAttribute('data-theme');

        try {
          renderProvider(storageHolding(stored));

          expectAdopted(expectedPreference(stored), prefersLight);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 60_000);

  // Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
  // Validates: Requirements 12.6
  it('uses system with no error when the stored value cannot be read at all', () => {
    fc.assert(
      fc.property(browserPrefersLightArb, (prefersLight) => {
        installMatchMedia(prefersLight);
        document.documentElement.removeAttribute('data-theme');

        try {
          // A read that raises, and a store that is not there at all.
          renderProvider(rejectingStorage());
          expectAdopted('system', prefersLight);
          cleanup();

          renderProvider(null);
          expectAdopted('system', prefersLight);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  // Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
  // Validates: Requirements 12.15
  it('adopts any value another browsing context writes, in place, and reports the matching option', () => {
    fc.assert(
      fc.property(
        storedValueArb,
        storedValueArb,
        browserPrefersLightArb,
        (initial, changed, prefersLight) => {
          installMatchMedia(prefersLight);
          document.documentElement.removeAttribute('data-theme');

          try {
            renderProvider(storageHolding(initial));

            const rootBefore = document.documentElement;
            const documentBefore = document;
            const controlBefore = option('system');

            expectAdopted(expectedPreference(initial), prefersLight);

            dispatchStorageEvent(APPEARANCE_STORAGE_KEY, changed);

            // 12.15: the changed value is adopted and reported three ways, with
            // an unrecognised or removed value treated as `system`.
            expectAdopted(expectedPreference(changed), prefersLight);

            // 12.15: applied to the existing document, without a full-document
            // reload — the same document, the same root element, and the same
            // control element as before the change.
            expect(document).toBe(documentBefore);
            expect(document.documentElement).toBe(rootBefore);
            expect(option('system')).toBe(controlBefore);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
  // Validates: Requirements 12.15
  it('treats a cleared store as system and leaves another consumer\'s key alone', () => {
    fc.assert(
      fc.property(storedValueArb, browserPrefersLightArb, (initial, prefersLight) => {
        installMatchMedia(prefersLight);
        document.documentElement.removeAttribute('data-theme');

        try {
          renderProvider(storageHolding(initial));

          // Some other consumer's key on the same origin changes nothing.
          dispatchStorageEvent('pitchmate.somethingElse', 'light');
          expectAdopted(expectedPreference(initial), prefersLight);

          // A `null` key means the whole store was cleared, which takes the
          // Appearance_Preference with it: `system`, not an error.
          dispatchStorageEvent(null, null);
          expectAdopted('system', prefersLight);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 120_000);

  // Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
  // Validates: Requirements 12.6, 12.15
  it('agrees with the shared interpretation and resolution for every adopted value', () => {
    fc.assert(
      fc.property(storedValueArb, browserPrefersLightArb, (changed, prefersLight) => {
        installMatchMedia(prefersLight);
        document.documentElement.removeAttribute('data-theme');

        try {
          renderProvider(storageHolding('dark'));
          dispatchStorageEvent(APPEARANCE_STORAGE_KEY, changed);

          // The rendered surface and the shared module cannot disagree: the one
          // implementation decides for the provider, the control, and the
          // pre-paint bootstrap alike (Requirements 12.12, 15.7).
          const shared = interpretStoredPreference(changed);
          expect(reportedPreference()).toBe(shared);
          expect(appliedTheme()).toBe(resolveTheme(shared, prefersLight));
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);
});
