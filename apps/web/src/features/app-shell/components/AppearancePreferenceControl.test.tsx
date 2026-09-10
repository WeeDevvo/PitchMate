/**
 * Unit tests for the Appearance_Preference_Control.
 *
 * Requirement 12.4 is a list of properties of one group of three native radios,
 * and each is asserted here as the browser would expose it rather than through an
 * implementation detail:
 *
 *   - one group, named for appearance, holding exactly three options carrying
 *     `system`, `dark`, and `light`, each with a visible label of 1 to 24
 *     characters;
 *   - exactly the option matching the current Appearance_Preference reported as
 *     selected, and the other two reported as not selected, for every one of the
 *     three values;
 *   - keyboard focus entering the group on the currently selected option;
 *   - selection by keyboard alone, with no custom key handling in the component.
 *
 * Requirement 12.5 adds that a selection applies the newly resolved Theme to the
 * mounted document with no full-document reload and writes the value under the
 * single namespaced storage key; Requirement 12.14 adds that a rejected write
 * changes none of that for the session. Both are asserted through the control,
 * because "the person selected an option and the appearance changed" is the
 * behaviour, not the provider call.
 *
 * Requirement 12.7 is asserted here too, through the control rather than only
 * through the provider: after a keyboard selection of `system` the browser
 * appearance preference is flipped and the resolved Theme has to follow it on the
 * same document, while the group keeps reporting `system` as selected. The same
 * flip must move nothing while `dark` or `light` is selected — an explicit
 * preference is the answer, not a starting point.
 *
 * The exhaustive-over-all-inputs versions live in the property tests for
 * Properties 30 and 32 (tasks 13.4, 13.5); these pin the concrete cases.
 *
 * Feature: app-shell
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  createInMemoryAppearanceStorage,
  type AppearancePreference,
  type AppearanceStorage,
} from '../../../theme';
import { AppearancePreferenceControl } from './AppearancePreferenceControl';
import { ShellThemeProvider } from './ShellThemeProvider';
import { APPEARANCE_GROUP_LABEL, APPEARANCE_OPTION_LABELS } from '../lib/messages';

type ChangeListener = () => void;

/**
 * A controllable `matchMedia`, the same stub shape the Theme_Provider's and the
 * auth and landing providers' tests use. jsdom implements no `matchMedia`, so the
 * browser appearance preference is supplied here and `setPrefersLight` flipping
 * it — notifying subscribers — is a live browser appearance-preference change
 * (Requirement 12.7).
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

/**
 * Install the stub reporting `prefersLight` and hand it back so a test can flip
 * it. One is installed for every test so resolution is decided by the
 * Appearance_Preference alone unless the test says otherwise.
 */
function installMatchMedia(prefersLight: boolean): MatchMediaStub {
  const stub = new MatchMediaStub(prefersLight);
  window.matchMedia = stub.matchMedia;
  return stub;
}

/** Storage pre-loaded with `stored`, or holding nothing when it is `null`. */
function storageHolding(stored: AppearancePreference | null): AppearanceStorage {
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

function renderControl(storage: AppearanceStorage | null): void {
  render(
    <ShellThemeProvider storage={storage}>
      <AppearancePreferenceControl />
    </ShellThemeProvider>,
  );
}

function option(preference: AppearancePreference): HTMLInputElement {
  return screen.getByRole('radio', {
    name: APPEARANCE_OPTION_LABELS[preference],
  }) as HTMLInputElement;
}

function appliedTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  installMatchMedia(false);
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.documentElement.removeAttribute('data-theme');
});

describe('AppearancePreferenceControl group shape', () => {
  // Requirement 12.4 — one group, named for appearance, and the three options
  // live inside it.
  it('renders exactly three options in one group named for appearance', () => {
    renderControl(storageHolding('system'));

    const group = screen.getByRole('group', { name: APPEARANCE_GROUP_LABEL });
    const radios = screen.getAllByRole('radio');

    expect(radios).toHaveLength(3);
    for (const radio of radios) {
      expect(group).toContainElement(radio);
    }
  });

  // Requirement 12.4 — the group's accessible name names appearance whatever the
  // current value is: the name identifies the group's subject, so it cannot be
  // derived from the selection.
  it.each(['system', 'dark', 'light'] as const)(
    'names the group for appearance while the preference is %s',
    (preference) => {
      renderControl(storageHolding(preference));

      expect(screen.getByRole('group', { name: APPEARANCE_GROUP_LABEL })).toBeInTheDocument();
      expect(screen.getAllByRole('group')).toHaveLength(1);
    },
  );

  // Requirement 12.4 — the three options carry exactly the three stored values,
  // in the shared module's presentation order.
  it('carries the values system, dark, and light', () => {
    renderControl(storageHolding('system'));

    const values = screen
      .getAllByRole('radio')
      .map((radio) => (radio as HTMLInputElement).value);

    expect(values).toEqual(['system', 'dark', 'light']);
  });

  // Requirement 12.4 — mutual exclusivity is the shared `name`, not code: one
  // group name across all three options means the browser deselects the others.
  it('places all three options in a single radio group', () => {
    renderControl(storageHolding('system'));

    const names = new Set(
      screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).name),
    );

    expect(names.size).toBe(1);
  });

  // Requirement 12.4 — a visible text label of 1 to 24 characters on each option.
  it('gives each option a visible label of 1 to 24 characters', () => {
    renderControl(storageHolding('system'));

    for (const preference of ['system', 'dark', 'light'] as const) {
      const label = APPEARANCE_OPTION_LABELS[preference];
      expect(label.length).toBeGreaterThanOrEqual(1);
      expect(label.length).toBeLessThanOrEqual(24);
      expect(screen.getByText(label)).toBeVisible();
    }
  });
});

describe('AppearancePreferenceControl reported selection', () => {
  // Requirement 12.4 — for each of the three values, exactly that option reports
  // as selected and the other two report as not selected.
  it.each(['system', 'dark', 'light'] as const)(
    'reports only the %s option as selected while that is the preference',
    (preference) => {
      renderControl(storageHolding(preference));

      for (const candidate of ['system', 'dark', 'light'] as const) {
        if (candidate === preference) {
          expect(option(candidate)).toBeChecked();
        } else {
          expect(option(candidate)).not.toBeChecked();
        }
      }
    },
  );

  // Requirement 12.6 — an unreadable preference is `system`, and the control
  // reports it like any other value rather than reporting nothing selected.
  it('reports the system option as selected when the stored value cannot be read', () => {
    renderControl(rejectingStorage());

    expect(option('system')).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AppearancePreferenceControl keyboard operation', () => {
  // Requirement 12.4 — keyboard focus enters the group on the currently selected
  // option, which is the native behaviour of a radio group with one checked
  // member. Asserted for a value that is *not* first in the group, so passing
  // cannot be an accident of document order.
  it.each(['system', 'dark', 'light'] as const)(
    'enters the group on the selected option while the preference is %s',
    async (preference) => {
      const user = userEvent.setup();
      renderControl(storageHolding(preference));

      await user.tab();

      expect(option(preference)).toHaveFocus();
    },
  );

  // Requirement 12.4, 12.5 — selectable by keyboard alone, and the selection
  // applies the newly resolved Theme.
  it('selects the next option with an arrow key and applies that theme', async () => {
    const user = userEvent.setup();
    const storage = storageHolding('dark');
    renderControl(storage);

    expect(appliedTheme()).toBe('dark');

    await user.tab();
    await user.keyboard('{ArrowDown}');

    expect(option('light')).toBeChecked();
    expect(option('dark')).not.toBeChecked();
    expect(appliedTheme()).toBe('light');
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light');
  });

  // The same by Space on a focused option, which is the other keyboard route to a
  // selection (Requirement 12.4).
  it('selects a focused option with the space key', async () => {
    const user = userEvent.setup();
    renderControl(storageHolding('system'));

    option('light').focus();
    await user.keyboard('[Space]');

    expect(option('light')).toBeChecked();
    expect(appliedTheme()).toBe('light');
  });

  // Requirements 12.4, 12.5 — each of the three values is reachable and
  // selectable by keyboard alone, and reaching it changes the reported selection
  // and applies the newly resolved Theme.
  //
  // Every case starts from a *different* value and moves by one arrow step, so
  // the group is never already on the target and no case depends on arrow
  // navigation wrapping round the ends.
  it.each([
    { target: 'system', from: 'dark', key: '{ArrowUp}', theme: 'dark' },
    { target: 'dark', from: 'system', key: '{ArrowDown}', theme: 'dark' },
    { target: 'light', from: 'dark', key: '{ArrowDown}', theme: 'light' },
  ] as const)(
    'selects $target by keyboard from $from and applies the resolved theme',
    async ({ target, from, key, theme }) => {
      const user = userEvent.setup();
      const storage = storageHolding(from);
      renderControl(storage);

      await user.tab();
      await user.keyboard(key);

      for (const candidate of ['system', 'dark', 'light'] as const) {
        if (candidate === target) {
          expect(option(candidate)).toBeChecked();
        } else {
          expect(option(candidate)).not.toBeChecked();
        }
      }
      expect(appliedTheme()).toBe(theme);
      expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe(target);
    },
  );

  // Requirements 12.2, 12.5 — `system` is not a synonym for `dark`: selecting it
  // by keyboard while the browser reports an explicit light preference applies
  // light, which is what distinguishes the two options' outcomes.
  it('applies light when system is selected by keyboard and the browser prefers light', async () => {
    const user = userEvent.setup();
    installMatchMedia(true);
    const storage = storageHolding('dark');
    renderControl(storage);

    expect(appliedTheme()).toBe('dark');

    await user.tab();
    await user.keyboard('{ArrowUp}');

    expect(option('system')).toBeChecked();
    expect(appliedTheme()).toBe('light');
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('system');
  });
});

describe('AppearancePreferenceControl live theme re-resolution', () => {
  // Requirement 12.7 — with `system` selected through the control, a browser
  // appearance-preference change re-resolves the Theme on the mounted document.
  // The root element is the same one throughout: the tokens switch under a
  // mounted tree, with no full-document reload.
  it('follows a browser preference change after system is selected by keyboard', async () => {
    const user = userEvent.setup();
    const media = installMatchMedia(false);
    const rootBefore = document.documentElement;
    renderControl(storageHolding('dark'));

    await user.tab();
    await user.keyboard('{ArrowUp}');

    expect(option('system')).toBeChecked();
    expect(appliedTheme()).toBe('dark');

    act(() => {
      media.setPrefersLight(true);
    });

    expect(appliedTheme()).toBe('light');
    // The selection is the person's, not the browser's: it still reports `system`.
    expect(option('system')).toBeChecked();
    expect(document.documentElement).toBe(rootBefore);

    act(() => {
      media.setPrefersLight(false);
    });

    expect(appliedTheme()).toBe('dark');
    expect(option('system')).toBeChecked();
    expect(document.documentElement).toBe(rootBefore);
  });

  // Requirements 12.3, 12.7 — an explicitly selected value is the answer, so the
  // same flip moves neither the applied Theme nor the reported selection.
  it.each([
    { preference: 'dark', theme: 'dark' },
    { preference: 'light', theme: 'light' },
  ] as const)(
    'ignores a browser preference change while $preference is selected',
    ({ preference, theme }) => {
      const media = installMatchMedia(false);
      renderControl(storageHolding(preference));

      expect(appliedTheme()).toBe(theme);

      act(() => {
        media.setPrefersLight(true);
      });

      expect(appliedTheme()).toBe(theme);
      expect(option(preference)).toBeChecked();
    },
  );

  // Requirement 12.7 — the live behaviour is the preference's, not the mount's:
  // a group that started on `system` follows the browser without anyone touching
  // the control.
  it('follows a browser preference change while system is the stored preference', () => {
    const media = installMatchMedia(true);
    renderControl(storageHolding('system'));

    expect(option('system')).toBeChecked();
    expect(appliedTheme()).toBe('light');

    act(() => {
      media.setPrefersLight(false);
    });

    expect(appliedTheme()).toBe('dark');
    expect(option('system')).toBeChecked();
  });
});

describe('AppearancePreferenceControl selection by pointer', () => {
  // Requirement 12.5 — the newly resolved Theme lands on the mounted document,
  // in place: same document, same root element, nothing reloaded.
  it('applies the newly resolved theme without replacing the document', async () => {
    const user = userEvent.setup();
    const storage = storageHolding('dark');
    const rootBefore = document.documentElement;
    renderControl(storage);

    await user.click(option('light'));

    expect(option('light')).toBeChecked();
    expect(appliedTheme()).toBe('light');
    expect(document.documentElement).toBe(rootBefore);
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light');
  });

  // Requirement 12.14 — a rejected write costs the session nothing: the Theme
  // applies, the option keeps reporting as selected, and no error is rendered.
  it('keeps reporting a selection whose write was rejected', async () => {
    const user = userEvent.setup();
    renderControl(rejectingStorage());

    await user.click(option('light'));

    expect(option('light')).toBeChecked();
    expect(option('system')).not.toBeChecked();
    expect(appliedTheme()).toBe('light');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The same where there is no storage at all (Requirement 12.14).
  it('keeps reporting a selection made with no storage available', async () => {
    const user = userEvent.setup();
    renderControl(null);

    await user.click(option('light'));

    expect(option('light')).toBeChecked();
    expect(appliedTheme()).toBe('light');
  });
});
