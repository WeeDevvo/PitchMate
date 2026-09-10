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
 * The exhaustive-over-all-inputs versions live in the property tests for
 * Properties 30 and 32 (tasks 13.4, 13.5); these pin the concrete cases.
 *
 * Feature: app-shell
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

/**
 * A `matchMedia` reporting no explicit light browser preference.
 *
 * Installed for every test so resolution is decided by the Appearance_Preference
 * alone — jsdom's own implementation reports the same thing, but pinning it keeps
 * these tests independent of that.
 */
function installMatchMedia(prefersLight: boolean): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query === LIGHT_APPEARANCE_QUERY ? prefersLight : false,
      media: query,
      onchange: null,
      // Nothing here changes the reported preference, so subscribing is a no-op.
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
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
