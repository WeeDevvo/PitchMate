/**
 * Property test for a selection whose write storage refuses (task 13.5).
 *
 * **Property 32: A rejected write still honours the selection for the session.**
 * *For any* appearance value selected while browser storage is unavailable or
 * rejects the write, the newly resolved theme's token values are applied to the
 * frame and the active destination content, the appearance control reports that
 * value as the selected option, that value is honoured as the appearance
 * preference for the remainder of the session, no error indication is rendered,
 * and a fresh start of the application uses `system`.
 *
 * That is Requirement 12.14 — "IF browser storage is unavailable or the write of
 * a value selected with the Appearance_Preference_Control is rejected, THEN THE
 * App_Shell SHALL apply the newly resolved Theme's token values …, SHALL report
 * the selected option as the selected option … and honour the selected value as
 * the Appearance_Preference for the remainder of the session, SHALL render no
 * error indication, and SHALL use the Appearance_Preference `system` on the next
 * start of the web application" — with Requirement 12.5 supplying the same
 * obligations for the ordinary case where the write does land, so that the
 * rejected path is asserted to cost the session *nothing* rather than merely
 * being asserted in isolation.
 *
 * ### The selection is made through the control
 *
 * Nothing here calls `setPreference`. Every selection is a pointer activation of
 * one of the {@link AppearancePreferenceControl}'s three native radios, and every
 * observation is made the way the browser exposes it: the radios' reported
 * checked state, and the Theme attribute on the element the token tables key off.
 * `setPreference` is the seam between the two, and asserting it directly would
 * only restate the implementation.
 *
 * `fireEvent.click` rather than `user-event` is deliberate: a run of this property
 * makes up to four selections and there are hundreds of runs, and the two reach
 * the same native change event on a radio. The keyboard routes to a selection —
 * arrow keys and Space — are pinned in `AppearancePreferenceControl.test.tsx`,
 * because they do not vary with what storage does.
 *
 * ### The expectation is not taken from the implementation
 *
 * {@link expectedTheme} restates Requirements 12.1, 12.2, and 12.3 in this file
 * rather than calling `resolveTheme`, which is the provider's own source of truth.
 * Likewise the expected reported option and the expected fresh-start preference
 * are tracked from the generated sequence, not read back from the provider.
 *
 * ### Four kinds of storage
 *
 * The requirement names two failing shapes — storage that is unavailable, and a
 * write that is rejected — and a privacy mode typically produces a third where the
 * read raises too. All three are generated, alongside a storage that works, so the
 * property covers the whole space rather than only the failure it is named for.
 * Each probe counts the writes attempted against it and the writes it refused, so
 * a run cannot pass by never reaching storage at all.
 *
 * ### What jsdom can see of "the token values are applied"
 *
 * The per-Theme token tables in `styles/theme.css` are keyed on
 * `:root, [data-theme='dark']` and `[data-theme='light']`, so a single attribute
 * on the document element is what switches the tokens for every descendant. jsdom
 * does not resolve `var()` references, so the assertion is that the attribute
 * carries the newly resolved Theme and that both the frame and the active
 * destination content are inside the element carrying it — which is exactly the
 * cascade reaching both. That the resolved colours are painted needs a browser.
 *
 * Feature: app-shell, Property 32: A rejected write still honours the selection for the session
 * Validates: Requirements 12.5, 12.14
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import fc from 'fast-check';

import {
  APPEARANCE_PREFERENCES,
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  THEME_ATTRIBUTE,
  type AppearancePreference,
  type Theme,
} from '../lib/theme';
import {
  createInMemoryAppearanceStorage,
  readAppearancePreference,
  type AppearanceStorage,
} from '../../../theme';
import { APPEARANCE_OPTION_LABELS } from '../lib/messages';
import { AppearancePreferenceControl } from './AppearancePreferenceControl';
import { ShellThemeProvider } from './ShellThemeProvider';

// --- The browser appearance preference ---------------------------------------

type ChangeListener = () => void;

/**
 * A controllable `matchMedia`, since jsdom implements none.
 *
 * The same stub `ShellThemeProvider.test.tsx` uses: `setPrefersLight` flips the
 * reported match state and notifies subscribers, which is a live browser
 * appearance-preference change.
 */
class MatchMediaStub {
  private prefersLight: boolean;
  private readonly listeners = new Set<ChangeListener>();

  constructor(initialPrefersLight: boolean) {
    this.prefersLight = initialPrefersLight;
  }

  readonly matchMedia = (query: string): MediaQueryList => {
    // Only the light-appearance query is meaningful; anything else never matches.
    const matches = (): boolean =>
      query === LIGHT_APPEARANCE_QUERY ? this.prefersLight : false;
    const listeners = this.listeners;

    return {
      get matches() {
        return matches();
      },
      media: query,
      onchange: null,
      addEventListener: (_type: 'change', listener: ChangeListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: 'change', listener: ChangeListener) => {
        listeners.delete(listener);
      },
      addListener: (listener: ChangeListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: ChangeListener) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };

  setPrefersLight(next: boolean): void {
    this.prefersLight = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function installMatchMedia(prefersLight: boolean): MatchMediaStub {
  const stub = new MatchMediaStub(prefersLight);
  window.matchMedia = stub.matchMedia;
  return stub;
}

// --- The four kinds of storage ------------------------------------------------

/**
 * `absent` is storage being unavailable, `write-rejecting` is a refused write
 * against a readable store (a full quota), `unreadable-and-unwritable` is a
 * privacy mode where both accessors raise, and `working` is the ordinary case
 * Requirement 12.5 covers — generated alongside the other three so the property
 * asserts the failing paths cost the session nothing.
 */
type StorageKind =
  | 'working'
  | 'write-rejecting'
  | 'unreadable-and-unwritable'
  | 'absent';

interface StorageProbe {
  readonly kind: StorageKind;
  /** What the provider is handed: `null` models storage being unavailable. */
  readonly storage: AppearanceStorage | null;
  /** Whether a landed write could ever be read back by a fresh start. */
  readonly persists: boolean;
  /** Writes the provider attempted against this store. */
  readonly writeAttempts: number;
  /** How many of those the store refused by raising. */
  readonly refusedWrites: number;
}

function createStorageProbe(kind: StorageKind): StorageProbe {
  const counts = { writeAttempts: 0, refusedWrites: 0 };
  const inner = createInMemoryAppearanceStorage();

  const storage: AppearanceStorage | null =
    kind === 'absent'
      ? null
      : {
          getItem: (key: string): string | null => {
            if (kind === 'unreadable-and-unwritable') {
              throw new Error('read rejected');
            }
            return inner.getItem(key);
          },
          setItem: (key: string, value: string): void => {
            counts.writeAttempts += 1;
            if (kind === 'working') {
              inner.setItem(key, value);
              return;
            }
            counts.refusedWrites += 1;
            throw new Error('write rejected');
          },
        };

  return {
    kind,
    storage,
    persists: kind === 'working',
    get writeAttempts(): number {
      return counts.writeAttempts;
    },
    get refusedWrites(): number {
      return counts.refusedWrites;
    },
  };
}

// --- The expectation, restated from the requirements -------------------------

/**
 * The Theme a preference resolves to, read from Requirements 12.1, 12.2, and
 * 12.3 rather than from `resolveTheme`: light only for an explicit `light`, or
 * for `system` with an explicit light browser preference; dark otherwise.
 */
function expectedTheme(
  preference: AppearancePreference,
  browserPrefersLight: boolean,
): Theme {
  if (preference === 'light') {
    return 'light';
  }
  if (preference === 'dark') {
    return 'dark';
  }
  return browserPrefersLight ? 'light' : 'dark';
}

/**
 * The selections that actually change the preference, and the value left standing.
 *
 * A person re-selecting the option already selected produces no change event, so
 * the provider is never asked to write. Tracking it here keeps the write counts
 * assertable without reading them back off the implementation. Every kind of
 * storage starts the session at `system` — an empty store, an unreadable one, and
 * an absent one all interpret to `system` (Requirement 12.6).
 */
function changeCount(selections: readonly AppearancePreference[]): number {
  let current: AppearancePreference = 'system';
  let changes = 0;

  for (const selection of selections) {
    if (selection !== current) {
      changes += 1;
      current = selection;
    }
  }

  return changes;
}

// --- The harness -------------------------------------------------------------

/**
 * The control inside the provider, inside a stand-in frame and destination
 * content, so "applied to the Shell_Frame and the active Destination_Content" is
 * observable as both sitting under the element the token tables key off.
 */
function Harness({
  storage,
}: {
  readonly storage: AppearanceStorage | null;
}): ReactElement {
  return (
    <ShellThemeProvider storage={storage}>
      <div data-testid="frame">
        <main data-testid="destination-content">
          <h1>Settings</h1>
          <AppearancePreferenceControl />
        </main>
      </div>
    </ShellThemeProvider>
  );
}

function renderShell(storage: AppearanceStorage | null): void {
  render(<Harness storage={storage} />);
}

function option(preference: AppearancePreference): HTMLInputElement {
  return screen.getByRole('radio', {
    name: APPEARANCE_OPTION_LABELS[preference],
  }) as HTMLInputElement;
}

/** Select an option the way a person does: a pointer activation of the radio. */
function selectOption(preference: AppearancePreference): void {
  fireEvent.click(option(preference));
}

/** The Theme recorded on the element the per-Theme token tables key off. */
function appliedTheme(): string | null {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE);
}

/**
 * Text that would read as an error indication. The harness renders only the
 * appearance group and a heading, so any match is the shell surfacing a failure.
 */
const ERROR_TEXT = /error|fail|could ?n[o']t|unable|sorry|problem|wrong/i;

function expectNoErrorSurfaced(): void {
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.body.textContent ?? '').not.toMatch(ERROR_TEXT);
}

/**
 * The whole of the per-selection half of Property 32: the option reports as
 * selected and the other two do not, the newly resolved Theme is applied to the
 * element governing both the frame and the destination content, and no error is
 * rendered.
 */
function expectSelectionHonoured(
  selection: AppearancePreference,
  browserPrefersLight: boolean,
): void {
  // 12.14: the control reports the selected value — exactly one option selected.
  for (const candidate of APPEARANCE_PREFERENCES) {
    if (candidate === selection) {
      expect(option(candidate)).toBeChecked();
    } else {
      expect(option(candidate)).not.toBeChecked();
    }
  }

  // 12.5, 12.14: the newly resolved Theme's token values are applied.
  const theme = expectedTheme(selection, browserPrefersLight);
  expect(appliedTheme()).toBe(theme);

  // ...and the cascade carrying them reaches the frame and the active
  // destination content, because both are inside the element carrying the Theme.
  const root = document.documentElement;
  expect(root.contains(screen.getByTestId('frame'))).toBe(true);
  expect(root.contains(screen.getByTestId('destination-content'))).toBe(true);

  // 12.14: nothing about a refused write is a failure the person is told about.
  expectNoErrorSurfaced();
}

/** Assert the store saw the writes the sequence implies, and refused them. */
function expectWritesAttemptedAndRefused(
  probe: StorageProbe,
  changes: number,
): void {
  if (probe.kind === 'absent') {
    // There is nothing to call, so the provider must not have tried.
    expect(probe.writeAttempts).toBe(0);
    expect(probe.refusedWrites).toBe(0);
    return;
  }

  // Best-effort persistence: one attempt per changing selection, no retry.
  expect(probe.writeAttempts).toBe(changes);
  expect(probe.refusedWrites).toBe(probe.kind === 'working' ? 0 : changes);
}

// --- Generators --------------------------------------------------------------

const preferenceArb: fc.Arbitrary<AppearancePreference> = fc.constantFrom(
  ...APPEARANCE_PREFERENCES,
);

/**
 * A sequence of selections. Length 1 covers the single selection the requirement
 * describes; longer sequences cover changing one's mind, and re-selecting the
 * option already selected (which the generator produces naturally).
 */
const selectionsArb: fc.Arbitrary<readonly AppearancePreference[]> = fc.array(
  preferenceArb,
  { minLength: 1, maxLength: 4 },
);

const storageKindArb: fc.Arbitrary<StorageKind> = fc.constantFrom(
  'working',
  'write-rejecting',
  'unreadable-and-unwritable',
  'absent',
);

/** Only the three failing shapes — the ones Requirement 12.14 is about. */
const nonPersistingKindArb: fc.Arbitrary<StorageKind> = fc.constantFrom(
  'write-rejecting',
  'unreadable-and-unwritable',
  'absent',
);

// --- Fixture lifecycle ------------------------------------------------------

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

/** Leave no rendering or Theme attribute behind for the next fast-check run. */
function resetBetweenRuns(): void {
  cleanup();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
}

// --- Properties -------------------------------------------------------------

describe('ShellThemeProvider — Property 32 (a rejected write still honours the selection)', () => {
  // Feature: app-shell, Property 32: A rejected write still honours the selection for the session
  // Validates: Requirements 12.5, 12.14
  it('applies the resolved theme, reports the option, and surfaces no error after every selection, whatever storage does', () => {
    fc.assert(
      fc.property(
        selectionsArb,
        storageKindArb,
        fc.boolean(),
        (selections, kind, browserPrefersLight) => {
          installMatchMedia(browserPrefersLight);
          const probe = createStorageProbe(kind);
          const rootBefore = document.documentElement;

          renderShell(probe.storage);
          try {
            // 12.6: every kind of store starts the session at `system`.
            expect(option('system')).toBeChecked();

            for (const selection of selections) {
              selectOption(selection);
              expectSelectionHonoured(selection, browserPrefersLight);
            }

            expectWritesAttemptedAndRefused(probe, changeCount(selections));
            // Nothing reloaded: the tokens switched under a mounted tree.
            expect(document.documentElement).toBe(rootBefore);
          } finally {
            resetBetweenRuns();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);

  // Feature: app-shell, Property 32: A rejected write still honours the selection for the session
  // Validates: Requirements 12.14
  it('honours the selected value for the remainder of the session, through a browser preference change', () => {
    fc.assert(
      fc.property(
        selectionsArb,
        storageKindArb,
        fc.boolean(),
        fc.boolean(),
        (selections, kind, browserPrefersLight, laterPrefersLight) => {
          const media = installMatchMedia(browserPrefersLight);
          const probe = createStorageProbe(kind);

          renderShell(probe.storage);
          try {
            for (const selection of selections) {
              selectOption(selection);
            }

            const standing = selections[selections.length - 1];
            expect(standing).toBeDefined();
            if (standing === undefined) {
              return;
            }

            // Something else re-renders the provider. A value whose write was
            // refused lives only in memory, so this is where losing it would show.
            // jsdom delivers no media change of its own, so the subscription is
            // driven directly, inside `act` so the re-render and its effect flush.
            act(() => {
              media.setPrefersLight(laterPrefersLight);
            });

            // 12.14: the value is still the Appearance_Preference...
            expect(option(standing)).toBeChecked();
            // ...and 12.3 still holds over it: an explicit choice ignores the
            // browser, `system` follows it.
            expectSelectionHonoured(standing, laterPrefersLight);
            // A refused write is never retried on a later re-render either.
            expectWritesAttemptedAndRefused(probe, changeCount(selections));
          } finally {
            resetBetweenRuns();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 60_000);

  // Feature: app-shell, Property 32: A rejected write still honours the selection for the session
  // Validates: Requirements 12.14
  it('uses system on a fresh start of the application after a write storage refused', () => {
    fc.assert(
      fc.property(
        selectionsArb,
        nonPersistingKindArb,
        fc.boolean(),
        (selections, kind, browserPrefersLight) => {
          installMatchMedia(browserPrefersLight);
          const probe = createStorageProbe(kind);

          renderShell(probe.storage);
          try {
            for (const selection of selections) {
              selectOption(selection);
            }
            expect(probe.persists).toBe(false);
          } finally {
            resetBetweenRuns();
          }

          // 12.14: the next start of the web application. What the pre-paint
          // bootstrap would read...
          expect(readAppearancePreference(probe.storage)).toBe('system');

          // ...and what a freshly mounted provider over the same store reports.
          renderShell(probe.storage);
          try {
            expect(option('system')).toBeChecked();
            expect(appliedTheme()).toBe(expectedTheme('system', browserPrefersLight));
            expectNoErrorSurfaced();
          } finally {
            resetBetweenRuns();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 60_000);

  // The contrast case, so the property above is known to be asserting the
  // *failure* rather than something that would hold however storage behaved:
  // a write that lands is read back by the next start (Requirement 12.5).
  // Validates: Requirements 12.5
  it('uses the persisted value on a fresh start when the write was accepted', () => {
    fc.assert(
      fc.property(selectionsArb, fc.boolean(), (selections, browserPrefersLight) => {
        installMatchMedia(browserPrefersLight);
        const probe = createStorageProbe('working');

        renderShell(probe.storage);
        try {
          for (const selection of selections) {
            selectOption(selection);
          }
        } finally {
          resetBetweenRuns();
        }

        const standing = selections[selections.length - 1];
        const persisted = probe.storage?.getItem(APPEARANCE_STORAGE_KEY) ?? null;
        // `system` selected first writes nothing, because the option was already
        // selected; anything else lands under the one namespaced key.
        const expectedFresh: AppearancePreference =
          changeCount(selections) === 0 ? 'system' : (standing as AppearancePreference);

        expect(persisted).toBe(changeCount(selections) === 0 ? null : expectedFresh);
        expect(readAppearancePreference(probe.storage)).toBe(expectedFresh);

        renderShell(probe.storage);
        try {
          expect(option(expectedFresh)).toBeChecked();
          expect(appliedTheme()).toBe(expectedTheme(expectedFresh, browserPrefersLight));
        } finally {
          resetBetweenRuns();
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
