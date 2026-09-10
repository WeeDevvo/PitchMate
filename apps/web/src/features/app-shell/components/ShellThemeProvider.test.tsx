/**
 * Unit tests for the Theme_Provider.
 *
 * Four behaviours, all of them the provider's:
 *
 *   - the initial resolution for each stored Appearance_Preference, including a
 *     value that cannot be read at all (Requirements 12.6, 12.12);
 *   - a live browser appearance-preference change while the preference is
 *     `system`, applied to the existing document with no reload
 *     (Requirement 12.7);
 *   - adoption of a value written by another browsing context through the
 *     `storage` event (Requirement 12.15);
 *   - a selection whose write was rejected, still honoured for the session
 *     (Requirements 12.5, 12.14).
 *
 * jsdom implements neither `matchMedia` nor cross-context `storage` events, so
 * both are driven directly: a controllable `matchMedia` stub (the pattern the
 * auth and landing providers' tests already use) and a hand-dispatched
 * `StorageEvent`.
 *
 * The exhaustive-over-all-inputs versions of the last two live in the property
 * tests for Properties 30 and 32 (tasks 13.4, 13.5); these pin the concrete
 * cases.
 *
 * Feature: app-shell
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  createInMemoryAppearanceStorage,
  type AppearanceStorage,
} from '../../../theme';
import { ShellThemeProvider, useShellTheme } from './ShellThemeProvider';

type ChangeListener = () => void;

/**
 * A controllable `matchMedia`. `setPrefersLight` flips the reported match state
 * and notifies subscribers, which is a live browser appearance-preference change.
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

/** Storage pre-loaded with `stored`, or holding nothing when it is `null`. */
function storageHolding(stored: string | null): AppearanceStorage {
  const storage = createInMemoryAppearanceStorage();
  if (stored !== null) {
    storage.setItem(APPEARANCE_STORAGE_KEY, stored);
  }
  return storage;
}

/** Storage whose accessors both throw — a privacy mode or a full quota. */
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

/** Reports the provider's whole context value, and can change the preference. */
function ThemeProbe(): ReactElement {
  const { theme, preference, setPreference } = useShellTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="preference">{preference}</span>
      <button type="button" onClick={() => setPreference('light')}>
        choose light
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        choose system
      </button>
    </div>
  );
}

function renderProvider(options: {
  readonly storage?: AppearanceStorage | null;
}): void {
  render(
    <ShellThemeProvider storage={options.storage}>
      <ThemeProbe />
    </ShellThemeProvider>,
  );
}

function reportedTheme(): string {
  return screen.getByTestId('theme').textContent ?? '';
}

function reportedPreference(): string {
  return screen.getByTestId('preference').textContent ?? '';
}

function appliedTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

/** A cross-context change of the stored value, as the browser would deliver it. */
function dispatchStorageEvent(key: string | null, newValue: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  });
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.documentElement.removeAttribute('data-theme');
});

describe('ShellThemeProvider initial resolution', () => {
  // Requirements 12.3, 12.12 — an explicit preference wins over the browser.
  it('resolves a stored dark preference to dark whatever the browser reports', () => {
    installMatchMedia(true);

    renderProvider({ storage: storageHolding('dark') });

    expect(reportedPreference()).toBe('dark');
    expect(reportedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });

  // Requirements 12.3, 12.12.
  it('resolves a stored light preference to light whatever the browser reports', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding('light') });

    expect(reportedPreference()).toBe('light');
    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
  });

  // Requirement 12.1 — dark-mode-first: `system` with no explicit light
  // preference is dark.
  it('resolves system to dark when the browser reports no light preference', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding('system') });

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });

  // Requirement 12.2 — `system` follows an explicit light browser preference.
  it('resolves system to light when the browser reports a light preference', () => {
    installMatchMedia(true);

    renderProvider({ storage: storageHolding('system') });

    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
  });

  // Requirement 12.6 — an absent value is `system`, with no error rendered.
  it('uses system when nothing is stored', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding(null) });

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('dark');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Requirement 12.6 — an unrecognised stored value is interpreted, not rejected.
  it('uses system when the stored value is not one of the three', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding('mauve') });

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('dark');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Requirement 12.6 — storage that is absent altogether.
  it('uses system when browser storage is unavailable', () => {
    installMatchMedia(true);

    renderProvider({ storage: null });

    expect(reportedPreference()).toBe('system');
    // Still follows the browser, so an unavailable store costs no live behaviour.
    expect(reportedTheme()).toBe('light');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Requirement 12.6 — a read that raises is an unreadable value, not a failure.
  it('uses system and renders no error when the read is rejected', () => {
    installMatchMedia(false);

    renderProvider({ storage: rejectingStorage() });

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('dark');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The provider must work where `matchMedia` does not exist at all (jsdom's own
  // default, and some embeds): dark-mode-first means that is dark.
  it('resolves system to dark where matchMedia is unavailable', () => {
    // @ts-expect-error -- deliberately removing the API to model its absence.
    delete window.matchMedia;

    renderProvider({ storage: storageHolding('system') });

    expect(reportedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });
});

describe('ShellThemeProvider live browser preference changes', () => {
  // Requirement 12.7 — re-resolve live, in place, with no full-document reload.
  it('re-resolves while the preference is system and mutates the same document', () => {
    const media = installMatchMedia(false);
    const documentBefore = document;
    const rootBefore = document.documentElement;

    renderProvider({ storage: storageHolding('system') });

    expect(reportedTheme()).toBe('dark');

    act(() => {
      media.setPrefersLight(true);
    });

    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
    // Same document, same root element: nothing reloaded and nothing remounted.
    expect(document).toBe(documentBefore);
    expect(document.documentElement).toBe(rootBefore);

    act(() => {
      media.setPrefersLight(false);
    });

    expect(reportedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
    expect(document.documentElement).toBe(rootBefore);
  });

  // Requirement 12.3 — an explicit preference ignores the browser, live too.
  it('ignores a browser preference change while the preference is dark', () => {
    const media = installMatchMedia(false);

    renderProvider({ storage: storageHolding('dark') });

    act(() => {
      media.setPrefersLight(true);
    });

    expect(reportedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });
});

describe('ShellThemeProvider selection', () => {
  // Requirement 12.5 — the selection applies immediately and is written under
  // the single namespaced key.
  it('applies the newly resolved theme and persists the selected value', async () => {
    installMatchMedia(false);
    const storage = storageHolding('system');

    renderProvider({ storage });

    expect(reportedTheme()).toBe('dark');

    await act(async () => {
      screen.getByRole('button', { name: 'choose light' }).click();
    });

    expect(reportedPreference()).toBe('light');
    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light');
  });

  // Requirements 12.5, 12.14 — a rejected write changes nothing about the
  // session: the theme applies, the preference is reported, no error is rendered.
  it('honours the selection for the session when the write is rejected', async () => {
    installMatchMedia(false);
    const storage = rejectingStorage();
    const setItem = vi.spyOn(storage, 'setItem');

    renderProvider({ storage });

    await act(async () => {
      screen.getByRole('button', { name: 'choose light' }).click();
    });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(reportedPreference()).toBe('light');
    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Requirement 12.14 — the same holds where there is no storage at all.
  it('honours the selection for the session when storage is unavailable', async () => {
    installMatchMedia(false);

    renderProvider({ storage: null });

    await act(async () => {
      screen.getByRole('button', { name: 'choose light' }).click();
    });

    expect(reportedPreference()).toBe('light');
    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
  });

  // Selecting `system` hands the decision back to the browser, live.
  it('returns to following the browser when system is selected', async () => {
    const media = installMatchMedia(true);
    const storage = storageHolding('dark');

    renderProvider({ storage });

    expect(reportedTheme()).toBe('dark');

    await act(async () => {
      screen.getByRole('button', { name: 'choose system' }).click();
    });

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('light');
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('system');

    act(() => {
      media.setPrefersLight(false);
    });

    expect(reportedTheme()).toBe('dark');
  });
});

describe('ShellThemeProvider cross-context adoption', () => {
  // Requirement 12.15 — another browsing context set `light`; adopt it, in place.
  it('adopts a value written by another browsing context', () => {
    installMatchMedia(false);
    const rootBefore = document.documentElement;

    renderProvider({ storage: storageHolding('system') });

    expect(reportedTheme()).toBe('dark');

    dispatchStorageEvent(APPEARANCE_STORAGE_KEY, 'light');

    expect(reportedPreference()).toBe('light');
    expect(reportedTheme()).toBe('light');
    expect(appliedTheme()).toBe('light');
    expect(document.documentElement).toBe(rootBefore);
  });

  // Requirement 12.15 — an unrecognised adopted value is `system`, not an error.
  it('treats an unrecognised adopted value as system', () => {
    installMatchMedia(true);

    renderProvider({ storage: storageHolding('dark') });

    expect(reportedTheme()).toBe('dark');

    dispatchStorageEvent(APPEARANCE_STORAGE_KEY, 'chartreuse');

    expect(reportedPreference()).toBe('system');
    // `system` with an explicit light browser preference resolves to light.
    expect(reportedTheme()).toBe('light');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Requirement 12.15 — an absent value adopted as `system`.
  it('treats a removed value as system', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding('light') });

    expect(reportedTheme()).toBe('light');

    dispatchStorageEvent(APPEARANCE_STORAGE_KEY, null);

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('dark');
  });

  // A cleared store reports a `null` key, which removes the preference too.
  it('treats a cleared store as system', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding('light') });

    dispatchStorageEvent(null, null);

    expect(reportedPreference()).toBe('system');
    expect(reportedTheme()).toBe('dark');
  });

  // Another consumer's key on the same origin is none of the shell's business.
  it('ignores a change to a different storage key', () => {
    installMatchMedia(false);

    renderProvider({ storage: storageHolding('light') });

    dispatchStorageEvent('pitchmate.somethingElse', 'dark');

    expect(reportedPreference()).toBe('light');
    expect(reportedTheme()).toBe('light');
  });
});

describe('useShellTheme outside a provider', () => {
  it('throws, because a surface that cannot change the theme is a wiring mistake', () => {
    // React logs the render error; silence it so the expected throw is not noise.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<ThemeProbe />)).toThrow(
      /useShellTheme must be used within a ShellThemeProvider/,
    );

    consoleError.mockRestore();
  });
});
