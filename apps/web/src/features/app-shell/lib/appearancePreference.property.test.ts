/**
 * Property test for stored Appearance_Preference interpretation (task 13.4).
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
 * This file carries the *interpretation* half of the property — the part that is
 * pure, and so belongs beside the shell's `lib/` re-export (Requirement 14.2):
 * every stored value yields one of exactly three preferences, no value is
 * rejected, nothing raises, and the resolution downstream of it stays total.
 * The cross-context half — the `storage` event, the token values applied in
 * place, and the Appearance_Preference_Control reporting the matching option —
 * needs a rendered surface and lives in
 * `components/ShellThemeProvider.storedPreference.property.test.tsx`, as the
 * design's testing-strategy note directs for rendered-surface properties.
 *
 * ### What is imported from where
 *
 * The interpretation rule comes through the App_Shell's `./theme` re-export,
 * which resolves to the one shared implementation in `src/theme/themeResolution.ts`
 * (Requirements 15.3, 15.7) — no second copy of the rule is declared here.
 * The Appearance_Preference *store* (`readAppearancePreference` and the in-memory
 * storage helper) is not part of that pure re-export, so it is imported from the
 * shared module directly, exactly as the Theme_Provider does. Both paths reach the
 * same module; only one implementation exists.
 *
 * **Validates: Requirements 12.6, 12.15**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  APPEARANCE_PREFERENCES,
  APPEARANCE_STORAGE_KEY,
  interpretStoredPreference,
  isAppearancePreference,
  resolveTheme,
  type AppearancePreference,
} from './theme';
import {
  createInMemoryAppearanceStorage,
  readAppearancePreference,
  writeAppearancePreference,
  type AppearanceStorage,
} from '../../../theme';

// --- The rule, stated independently of the implementation -------------------

/** The three values a stored appearance value may name. */
const VALID_VALUES: readonly string[] = ['system', 'dark', 'light'];

/**
 * Requirement 12.6 in one line: the stored value when it is one of the three,
 * `system` in every other case. Written out rather than delegated to
 * `interpretStoredPreference`, so the property is not asserting the
 * implementation against itself.
 */
function expectedPreference(value: unknown): AppearancePreference {
  return typeof value === 'string' && VALID_VALUES.includes(value)
    ? (value as AppearancePreference)
    : 'system';
}

// --- Generators -------------------------------------------------------------

/**
 * Stored strings worth naming, rather than leaving to chance: the three valid
 * values, the empty string, whitespace-only text, values differing only in
 * letter case or padding, shapes a foreign writer might leave behind (JSON, a
 * quoted value, the words `null` and `undefined`), and non-ASCII text.
 */
const NAMED_STORED_STRINGS: readonly string[] = [
  // The three that are accepted as themselves.
  'system',
  'dark',
  'light',
  // Empty and whitespace-only — present in storage, naming nothing.
  '',
  ' ',
  '   ',
  '\t',
  '\n',
  ' \t\r\n ',
  // Case variants: interpretation is exact, so none of these is one of the three.
  'System',
  'SYSTEM',
  'Dark',
  'DARK',
  'Light',
  'LIGHT',
  'SySteM',
  'lIgHt',
  // Padded near-misses.
  ' light',
  'light ',
  ' dark ',
  '\tsystem\n',
  // Structured or quoted values a different writer might have stored.
  '"light"',
  "'dark'",
  '{"appearance":"light"}',
  '{"theme":"dark","source":"other-app"}',
  '["dark"]',
  'null',
  'undefined',
  'NaN',
  '0',
  '1',
  'true',
  'false',
  // Plausible-but-unregistered names.
  'auto',
  'default',
  'high-contrast',
  'chartreuse',
  // Non-ASCII and emoji, including text that means "light" in another language.
  'ライト',
  'светлый',
  'clair',
  '🌗',
  'dark🌚',
  // Something long enough to be nobody's preference.
  'light'.repeat(2000),
  'x'.repeat(10_000),
];

/**
 * Every shape the single storage key can yield: `null` for an absent value, and
 * a string for a present one. Weighted so each run mixes the named boundary
 * strings with wholly arbitrary text — including unicode, which `fc.string`'s
 * default unit already produces.
 */
const storedValueArb: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<string | null>(null) },
  { weight: 6, arbitrary: fc.constantFrom(...NAMED_STORED_STRINGS) },
  { weight: 3, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.string({ minLength: 200, maxLength: 5000 }) },
  { weight: 1, arbitrary: fc.json() },
);

/**
 * Anything at all, for the interpretation rule alone. `interpretStoredPreference`
 * takes `unknown` precisely so a caller holding a parsed value, an object, or
 * `undefined` needs no pre-step, and none of those may be rejected either.
 */
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: storedValueArb },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 3, arbitrary: fc.anything() },
);

/** Whether the browser reports an explicit light appearance preference. */
const browserPrefersLightArb: fc.Arbitrary<boolean | null | undefined> =
  fc.constantFrom(true, false, null, undefined);

// --- Storage stubs ----------------------------------------------------------

/** Storage holding `value` under the single key, or nothing when `null`. */
function storageHolding(value: string | null): AppearanceStorage {
  const storage = createInMemoryAppearanceStorage();
  if (value !== null) {
    storage.setItem(APPEARANCE_STORAGE_KEY, value);
  }
  return storage;
}

/** Storage whose read raises — a privacy mode, or a locked-down embed. */
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

/**
 * Storage holding a value under a *different* key, so the read finds the single
 * appearance key absent while the store itself is perfectly healthy.
 */
function storageHoldingForeignKey(value: string): AppearanceStorage {
  const storage = createInMemoryAppearanceStorage();
  storage.setItem('pitchmate.somethingElse', value);
  return storage;
}

// --- Property 30: the interpretation half -----------------------------------

// Feature: app-shell, Property 30: Any stored appearance value is interpreted, never rejected
// Validates: Requirements 12.6, 12.15
describe('Property 30: any stored appearance value is interpreted, never rejected', () => {
  it('interprets every value as one of the three preferences, keeping the value only when it is one of them', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // Nothing raises: interpretation is total over any input, so a corrupt
        // or foreign stored value can never surface as a failure (12.6).
        let interpreted: AppearancePreference | undefined;
        expect(() => {
          interpreted = interpretStoredPreference(value);
        }).not.toThrow();

        // Single-valued, and one of exactly the three stored values.
        expect(interpreted).toBe(expectedPreference(value));
        expect(APPEARANCE_PREFERENCES).toContain(interpreted);

        // Never rejected: no `null`, no `undefined`, no sentinel escapes.
        expect(interpreted === undefined).toBe(false);

        // The value is kept exactly when it is one of the three, and the
        // fallback is `system` — not `dark`, though dark is the resolved default.
        if (isAppearancePreference(value)) {
          expect(interpreted).toBe(value);
        } else {
          expect(interpreted).toBe('system');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is idempotent and stable, so re-interpreting an interpreted value changes nothing', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const once = interpretStoredPreference(value);

        expect(interpretStoredPreference(once)).toBe(once);
        // Deterministic: the same stored value always yields the same preference,
        // which is what lets the pre-paint bootstrap and the provider agree.
        expect(interpretStoredPreference(value)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });

  it('leaves the resolution downstream of it total, whatever was stored', () => {
    fc.assert(
      fc.property(anyValueArb, browserPrefersLightArb, (value, browserPrefersLight) => {
        const theme = resolveTheme(
          interpretStoredPreference(value),
          browserPrefersLight,
        );

        // A stored value nobody recognises still yields a rendered theme, and
        // dark-mode-first means that theme is dark unless the browser says light.
        expect(theme === 'dark' || theme === 'light').toBe(true);
        if (!isAppearancePreference(value)) {
          expect(theme).toBe(browserPrefersLight === true ? 'light' : 'dark');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('reads every stored value through the store as the same interpreted preference', () => {
    fc.assert(
      fc.property(storedValueArb, (stored) => {
        // The read is the path the application actually takes at start-up: it
        // must agree with the pure rule for a present value and for an absent
        // one alike, and must not throw for either (12.6).
        let read: AppearancePreference | undefined;
        expect(() => {
          read = readAppearancePreference(storageHolding(stored));
        }).not.toThrow();

        expect(read).toBe(expectedPreference(stored));
        expect(APPEARANCE_PREFERENCES).toContain(read);
      }),
      { numRuns: 300 },
    );
  });

  it('falls back to system for a read that raises, an unavailable store, and a foreign key', () => {
    fc.assert(
      fc.property(storedValueArb, (stored) => {
        // A read that raises is an unreadable value, not a failure.
        expect(readAppearancePreference(rejectingStorage())).toBe('system');
        // No storage at all is the same case.
        expect(readAppearancePreference(null)).toBe('system');
        // A healthy store holding somebody else's key leaves ours absent.
        const foreign = stored === null ? 'light' : stored;
        expect(readAppearancePreference(storageHoldingForeignKey(foreign))).toBe(
          'system',
        );
      }),
      { numRuns: 100 },
    );
  });

  it('round-trips each of the three preferences through the single storage key', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AppearancePreference>('system', 'dark', 'light'),
        storedValueArb,
        (preference, previouslyStored) => {
          // Whatever was there before — valid, invalid, or absent — writing one
          // of the three and reading it back yields that same value, so the one
          // key is the only thing consulted.
          const storage = storageHolding(previouslyStored);

          expect(writeAppearancePreference(preference, storage)).toBe(true);
          expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe(preference);
          expect(readAppearancePreference(storage)).toBe(preference);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('holds for every named stored string, exhaustively', () => {
    // The generator reaches these by weight; running them all explicitly means a
    // shrunk counterexample is never the only place a boundary is covered.
    for (const value of NAMED_STORED_STRINGS) {
      expect(interpretStoredPreference(value)).toBe(expectedPreference(value));
      expect(readAppearancePreference(storageHolding(value))).toBe(
        expectedPreference(value),
      );
    }

    // And for the two absent shapes.
    expect(interpretStoredPreference(null)).toBe('system');
    expect(interpretStoredPreference(undefined)).toBe('system');
    expect(readAppearancePreference(storageHolding(null))).toBe('system');
  });
});
