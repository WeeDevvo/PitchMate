/**
 * Unit tests for the Account_Menu.
 *
 * These cover what this component itself decides, and deliberately stop there:
 *
 *   - the trigger's fixed name, its collapsed first render, and the absence of any
 *     account detail on it or in the surface (Requirements 8.1, 8.4),
 *   - exactly three controls in the fixed document order, each an ordinary
 *     focusable control with no widget role and no arrow-key focus model
 *     (Requirements 8.2, 8.3),
 *   - the one behaviour not inherited from `Disclosure`: activating a navigation
 *     control closes the menu, returns focus to the trigger, and navigates
 *     client-side (Requirement 8.6),
 *   - how the Sign_Out_Control *presents* the three states the hook reports —
 *     resting, pending, failed (Requirements 8.10, 8.11, 8.12).
 *
 * The Escape and outside-pointer closes belong to `Disclosure` and are asserted in
 * `Disclosure.test.tsx`; the sign-out lifecycle — the single flight, the 10-second
 * watchdog, poll cancellation on completion — belongs to `useSignOut` and is
 * asserted in its own tests and by task 12.4. Property 27 (no account detail, over
 * any established session) is task 12.3.
 *
 * Feature: app-shell
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { AccountMenu } from './AccountMenu';
import { PROFILE_ROUTE, SETTINGS_ROUTE, destinationLabel } from '../lib/destinations';
import {
  ACCOUNT_MENU_LABEL,
  SIGN_OUT_FAILED,
  SIGN_OUT_IN_PROGRESS,
  SIGN_OUT_LABEL,
} from '../lib/messages';
import { useDisclosureGroup } from '../state/useDisclosureGroup';

/** The surface id the Shell_Header supplies for the account disclosure. */
const SURFACE_ID = 'shell-account-menu';

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
function Harness({ signOut }: { readonly signOut: () => Promise<void> }): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <>
      {/* A control before the trigger, so Shift+Tab out of the surface is
          observable and the frame's focus order is realistic. */}
      <button type="button">Before</button>
      <AccountMenu
        disclosure={{
          surfaceId: SURFACE_ID,
          open: open === 'account',
          requestOpen: () => toggle('account'),
          requestClose: () => close('account'),
        }}
        signOut={signOut}
      />
      <button type="button">After</button>
      <PathReadout />
    </>
  );
}

function renderMenu(signOut: () => Promise<void> = async () => {}): void {
  render(
    <MemoryRouter initialEntries={['/app']}>
      <Harness signOut={signOut} />
    </MemoryRouter>,
  );
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: ACCOUNT_MENU_LABEL });
}

function surface(): HTMLElement {
  const element = document.getElementById(SURFACE_ID);
  if (element === null) {
    throw new Error('The Account_Menu surface is not rendered.');
  }
  return element;
}

/** Every interactive element inside the surface, in document order. */
function menuControls(): HTMLElement[] {
  return Array.from(
    surface().querySelectorAll<HTMLElement>(
      'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [tabindex]',
    ),
  );
}

function signOutControl(): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(SIGN_OUT_LABEL, 'u') });
}

describe('AccountMenu', () => {
  // Validates: Requirements 8.1 — one trigger, fixed name, collapsed first render.
  it('renders one collapsed trigger carrying the fixed account menu name', () => {
    renderMenu();

    const control = trigger();
    expect(control).toHaveAccessibleName(ACCOUNT_MENU_LABEL);
    expect(control).toHaveTextContent(ACCOUNT_MENU_LABEL);
    expect(control).toHaveAttribute('aria-expanded', 'false');
    expect(control).toHaveAttribute('aria-controls', SURFACE_ID);
    // The surface is unmounted while collapsed, so nothing inside it is reachable.
    expect(document.getElementById(SURFACE_ID)).toBeNull();
  });

  // Validates: Requirements 8.4 — no account name, email address, or avatar.
  it('discloses no account detail on the trigger or in the open menu', async () => {
    const user = userEvent.setup();
    renderMenu();

    expect(screen.queryByRole('img')).toBeNull();
    await user.click(trigger());

    const region = surface();
    expect(region.querySelectorAll('img')).toHaveLength(0);
    expect(screen.queryByRole('img')).toBeNull();
    // Every displayed string is one of the three fixed labels.
    expect(region.textContent).toBe(
      `${destinationLabel('profile')}${destinationLabel('settings')}${SIGN_OUT_LABEL}`,
    );
  });

  // Validates: Requirements 8.2 — exactly three controls, in this document order.
  it('presents exactly three controls in order: Profile, Settings, Sign out', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(trigger());

    expect(menuControls().map((control) => control.textContent)).toEqual([
      destinationLabel('profile'),
      destinationLabel('settings'),
      SIGN_OUT_LABEL,
    ]);
    expect(
      menuControls().map((control) => control.getAttribute('data-account-control')),
    ).toEqual(['profile', 'settings', 'sign-out']);

    // The two navigation controls carry their Destination's route path.
    expect(screen.getByRole('link', { name: destinationLabel('profile') })).toHaveAttribute(
      'href',
      PROFILE_ROUTE,
    );
    expect(screen.getByRole('link', { name: destinationLabel('settings') })).toHaveAttribute(
      'href',
      SETTINGS_ROUTE,
    );
  });

  // Validates: Requirements 8.3 — Tab and Shift+Tab alone, and no menu role.
  it('reaches every control with Tab and Shift+Tab and claims no menu widget role', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(trigger());

    // No ARIA menu contract is claimed, so no arrow-key model is implied.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(surface().getAttribute('role')).toBeNull();
    // Nothing has been removed from, or forced into, the tab sequence.
    for (const control of menuControls()) {
      expect(control).not.toHaveAttribute('tabindex');
    }

    // Forwards from the trigger, in document order.
    trigger().focus();
    await user.tab();
    expect(screen.getByRole('link', { name: destinationLabel('profile') })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: destinationLabel('settings') })).toHaveFocus();
    await user.tab();
    expect(signOutControl()).toHaveFocus();
    // Tab out leaves the surface, and leaves it open (Requirement 13.6).
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    // And backwards, to the trigger.
    await user.tab({ shift: true });
    expect(signOutControl()).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: destinationLabel('profile') })).toHaveFocus();
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
  });

  // Validates: Requirements 8.6 — a navigation control closes, focuses, navigates.
  it.each([
    ['profile', PROFILE_ROUTE],
    ['settings', SETTINGS_ROUTE],
  ] as const)(
    'closes the menu, returns focus to the trigger, and navigates from the %s control',
    async (id, path) => {
      const user = userEvent.setup();
      renderMenu();
      await user.click(trigger());

      await user.click(screen.getByRole('link', { name: destinationLabel(id) }));

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(document.getElementById(SURFACE_ID)).toBeNull();
      expect(trigger()).toHaveFocus();
      // Client-side: the router moved, and the trigger kept its DOM node.
      expect(screen.getByTestId('pathname')).toHaveTextContent(path);
    },
  );

  // Validates: Requirements 8.9, 8.12 — delegation, and the resting presentation.
  it('renders the sign-out control available and delegates the sign-out on activation', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => {});
    renderMenu(signOut);
    await user.click(trigger());

    const control = signOutControl();
    expect(control).not.toBeDisabled();
    expect(control).not.toHaveAttribute('aria-disabled');
    expect(control).not.toHaveAttribute('aria-busy');
    expect(control).not.toHaveTextContent(SIGN_OUT_IN_PROGRESS);

    await user.click(control);

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  // Validates: Requirements 8.10 — progress, one flight, focus and menu retained.
  it('indicates progress, refuses a second activation, and keeps the menu open', async () => {
    const user = userEvent.setup();
    // Never settles, so the sign-out stays in progress for the whole assertion.
    const signOut = vi.fn(() => new Promise<void>(() => {}));
    renderMenu(signOut);
    await user.click(trigger());
    await user.click(signOutControl());

    await waitFor(() => {
      expect(signOutControl()).toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    });
    const control = signOutControl();
    expect(control).toHaveAttribute('aria-busy', 'true');
    expect(control).toHaveAttribute('aria-disabled', 'true');
    // Not `disabled`: the control must keep the focus it was activated with.
    expect(control).not.toBeDisabled();
    expect(control).toHaveFocus();
    // The menu stays open, with all three controls still present.
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(menuControls()).toHaveLength(3);

    await user.click(control);

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  // Validates: Requirements 8.11 — the failure indication, and the control back.
  it('surfaces the failure message and hands the control back when the sign-out does not complete', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => {
      throw new Error('stuck');
    });
    renderMenu(signOut);
    await user.click(trigger());
    await user.click(signOutControl());

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent(SIGN_OUT_FAILED);

    const control = signOutControl();
    // Available again, with no progress indication, and describing the failure.
    expect(control).not.toHaveAttribute('aria-disabled');
    expect(control).not.toHaveAttribute('aria-busy');
    expect(control).not.toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(control).toHaveAttribute('aria-describedby', message.id);
    // The menu is still open, and the message added no fourth control.
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(menuControls()).toHaveLength(3);

    // A further activation is delegated again.
    await user.click(control);
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
