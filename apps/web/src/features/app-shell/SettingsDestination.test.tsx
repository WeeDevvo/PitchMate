/**
 * Unit tests for the Settings_Destination's content.
 *
 * Three things belong to this component rather than to the control it hosts:
 *
 *   - it contributes exactly one level-one heading, because the Shell_Frame
 *     renders none and the Content_Region locates and announces that heading
 *     (Requirements 1.9, 13.2, 13.12);
 *   - that heading carries the label registered for the Settings_Destination, so
 *     the heading and the destination's Primary_Navigation control cannot drift
 *     (Requirement 3.1); and
 *   - the appearance section comes first and any injected settings content after
 *     it (Requirements 12.4, 15.4).
 *
 * Document order is asserted with `compareDocumentPosition` rather than by
 * reading the rendered markup, so the assertion is about the order assistive
 * technology and the keyboard see, not about the shape of the JSX.
 *
 * Feature: app-shell
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShellThemeProvider } from './components/ShellThemeProvider';
import { SettingsDestination } from './SettingsDestination';
import { destinationLabel } from './lib/destinations';
import { APPEARANCE_GROUP_LABEL } from './lib/messages';
import { createInMemoryAppearanceStorage } from '../../theme';
import type { ReactNode } from 'react';

function renderDestination(injected?: ReactNode): void {
  render(
    <ShellThemeProvider storage={createInMemoryAppearanceStorage()}>
      <SettingsDestination>{injected}</SettingsDestination>
    </ShellThemeProvider>,
  );
}

/** Whether `first` precedes `second` in document order. */
function precedes(first: Element, second: Element): boolean {
  return (
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('SettingsDestination heading', () => {
  // Requirements 1.9, 13.2 — exactly one level-one heading, contributed here.
  it('renders exactly one level-one heading', () => {
    renderDestination();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // Requirement 3.1 — the heading is the registered label, not a restatement.
  it('heads the screen with the registered Settings label', () => {
    renderDestination();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('settings'),
    );
  });

  // Requirement 13.2 — an injected section may head itself at level two; the
  // destination still owns the only level-one heading.
  it('keeps the only level-one heading when content is injected', () => {
    renderDestination(<h2>Notifications by email</h2>);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toBeVisible();
  });
});

describe('SettingsDestination sections', () => {
  // Requirement 12.4 — the appearance section is present, as one option group.
  it('renders the appearance option group', () => {
    renderDestination();

    expect(screen.getByRole('group', { name: APPEARANCE_GROUP_LABEL })).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  // Requirements 12.4, 15.4 — heading, then appearance, then the injected slot.
  it('renders the appearance section before the injected settings content', () => {
    renderDestination(<p>Injected settings</p>);

    const heading = screen.getByRole('heading', { level: 1 });
    const appearance = screen.getByRole('group', { name: APPEARANCE_GROUP_LABEL });
    const injected = screen.getByText('Injected settings');

    expect(precedes(heading, appearance)).toBe(true);
    expect(precedes(appearance, injected)).toBe(true);
  });

  // Requirement 15.4 — nothing injected is the MVP, and it renders cleanly.
  it('renders the appearance section alone when nothing is injected', () => {
    renderDestination();

    expect(screen.getByRole('group', { name: APPEARANCE_GROUP_LABEL })).toBeVisible();
  });
});
