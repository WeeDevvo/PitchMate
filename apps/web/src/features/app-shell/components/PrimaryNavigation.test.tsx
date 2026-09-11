/**
 * Unit tests for the Primary_Navigation's contents.
 *
 * These cover what this component itself decides:
 *
 *   - one control per registered Destination, carrying that Destination's visible
 *     label and route path, and no control for anything unregistered
 *     (Requirement 3.3),
 *   - client-side navigation to the activated Destination's path
 *     (Requirements 3.4, 1.3),
 *   - exactly one control marked as the current page, from the pure resolver, and
 *     none while the requested path resolves to nothing
 *     (Requirements 3.5, 3.10, 3.11),
 *   - the one behaviour not inherited from `Disclosure`: activating a destination
 *     control while the compact list is expanded collapses it and returns
 *     keyboard focus to the disclosure control (Requirement 1.12).
 *
 * The component renders no navigation landmark of its own — the Shell_Header owns
 * it (Requirement 1.5) — so the harness supplies neither, and asserts as much.
 * The full Compact_Layout/Wide_Layout matrix, the breakpoint crossing, and the
 * declared target sizes are asserted by the layout tests (task 10.10), and the
 * exhaustive active-marking property by task 10.7.
 *
 * Feature: app-shell
 */
import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { PrimaryNavigation } from './PrimaryNavigation';
import { SHELL_DESTINATIONS } from '../lib/destinations';
import { PRIMARY_NAVIGATION_TOGGLE } from '../lib/messages';
import { useDisclosureGroup } from '../state/useDisclosureGroup';
import type { ShellLayout } from '../state/useViewportLayout';

/** The surface id the Shell_Header supplies for the navigation disclosure. */
const SURFACE_ID = 'shell-primary-navigation';

/** Reports the router's current path, so a navigation is observable. */
function PathReadout(): ReactElement {
  const { pathname } = useLocation();
  return <p data-testid="pathname">{pathname}</p>;
}

/**
 * Wires the component the way the Shell_Header does: the open state lives in the
 * frame's disclosure group, and the four-member controller maps onto
 * `Disclosure`'s controlled props.
 */
function Harness({ layout }: { readonly layout: ShellLayout }): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <>
      <PrimaryNavigation
        layout={layout}
        disclosure={{
          surfaceId: SURFACE_ID,
          open: open === 'navigation',
          requestOpen: () => toggle('navigation'),
          requestClose: () => close('navigation'),
        }}
      />
      <PathReadout />
    </>
  );
}

function renderNavigation(layout: ShellLayout, path = '/app'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness layout={layout} />
    </MemoryRouter>,
  );
}

function toggleControl(): HTMLElement {
  return screen.getByRole('button', { name: PRIMARY_NAVIGATION_TOGGLE });
}

/** Every rendered destination control, in document order. */
function destinationControls(): HTMLElement[] {
  return screen.getAllByRole('link');
}

/** The `data-destination` of every control marked as the current page. */
function currentDestinations(): (string | null)[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[aria-current="page"]'),
    (element) => element.getAttribute('data-destination'),
  );
}

describe('PrimaryNavigation destination controls', () => {
  // Requirement 3.3 — one control per registered Destination, each labelled with
  // that Destination's visible label, and no control beyond the registry.
  it('renders exactly one labelled control per registered destination', () => {
    renderNavigation('wide');

    const controls = destinationControls();

    expect(controls).toHaveLength(SHELL_DESTINATIONS.length);
    expect(controls.map((control) => control.textContent)).toEqual(
      SHELL_DESTINATIONS.map((destination) => destination.label),
    );
  });

  // Requirement 3.3 — each control targets its own registered route path, so no
  // control can point at an unregistered path.
  it('targets each destination route path exactly once', () => {
    renderNavigation('wide');

    const targets = destinationControls().map((control) => control.getAttribute('href'));

    expect(targets).toEqual(SHELL_DESTINATIONS.map((destination) => destination.path));
    expect(new Set(targets).size).toBe(SHELL_DESTINATIONS.length);
  });

  // Requirement 1.5 — the navigation landmark belongs to the Shell_Header, so
  // this component must not contribute one.
  it('renders no navigation landmark of its own', () => {
    renderNavigation('wide');

    expect(screen.queryByRole('navigation')).toBeNull();
  });

  // Requirements 3.4, 1.3 — activating a control navigates client-side.
  it('navigates to the activated destination without leaving the router', async () => {
    const user = userEvent.setup();
    renderNavigation('wide');

    await user.click(screen.getByRole('link', { name: 'Settings' }));

    expect(screen.getByTestId('pathname').textContent).toBe('/app/settings');
    // The controls are still the same mounted list — no document reload.
    expect(destinationControls()).toHaveLength(SHELL_DESTINATIONS.length);
  });
});

describe('PrimaryNavigation active marking', () => {
  // Requirement 3.5 — exactly one control marked as the current page.
  it.each(SHELL_DESTINATIONS.map((destination) => [destination.id, destination.path] as const))(
    'marks only the %s control while its route path is requested',
    (id, path) => {
      renderNavigation('wide', path);

      expect(currentDestinations()).toEqual([id]);
    },
  );

  // Requirement 3.11 — the Destination matching the greater number of whole
  // segments wins, so Home is not current while a nested path is requested.
  it('marks the nested destination rather than home for a path beneath it', () => {
    renderNavigation('wide', '/app/settings/appearance');

    expect(currentDestinations()).toEqual(['settings']);
  });

  // Requirement 3.13 — case and a single trailing separator resolve identically.
  it('marks the same control for a differently cased, trailing-slashed path', () => {
    renderNavigation('wide', '/app/Profile/');

    expect(currentDestinations()).toEqual(['profile']);
  });

  // Requirement 3.10 — a path under `/app` resolving to no Destination marks
  // nothing at all.
  it('marks no control while the requested path resolves to nothing', () => {
    renderNavigation('wide', '/app/nowhere');

    expect(currentDestinations()).toEqual([]);
    expect(destinationControls()).toHaveLength(SHELL_DESTINATIONS.length);
  });
});

describe('PrimaryNavigation compact collapse on navigation', () => {
  // Requirement 1.12 — activating a destination control while the compact list is
  // expanded collapses the list and returns keyboard focus to the disclosure
  // control. `Disclosure` moves no focus for an activation close, so this is the
  // component's own behaviour.
  it('collapses and returns focus to the disclosure control on activation', async () => {
    const user = userEvent.setup();
    renderNavigation('compact');

    await user.click(toggleControl());
    expect(toggleControl()).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('link', { name: 'Notifications' }));

    expect(screen.getByTestId('pathname').textContent).toBe('/app/notifications');
    expect(toggleControl()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(SURFACE_ID)).toBeNull();
    expect(document.activeElement).toBe(toggleControl());
  });
});
