/**
 * Unit tests for the Account_Menu's shape and the sign-out lifecycle, driven
 * through the wiring the Shell_Header actually uses (task 12.4).
 *
 * `AccountMenu.test.tsx` renders the component against a hand-built disclosure
 * controller, which is the right shape for what the component itself decides.
 * `useSignOut.test.ts` pins the state machine underneath it. This suite sits
 * between the two: the menu is mounted **through `ShellHeader`'s account slot**,
 * so the disclosure controller, the surface id, the header's focus order, and the
 * mutual-exclusion group are the real ones, and the sign-out lifecycle is observed
 * as a person meets it — as text on a control, an alert, and a menu that stays
 * open — rather than as booleans on a hook result.
 *
 * | Criterion | What it asks | Where it is asserted |
 * | --- | --- | --- |
 * | 8.2 | exactly three controls in one document order, labels of 1..24 characters, no further control | "menu shape" |
 * | 8.3 | all three reachable and activatable with Tab and Shift+Tab alone, no arrow-key/Home/End model | "keyboard reachability" |
 * | 8.5 | Escape closes, reports collapsed, returns focus to the trigger | "closing the menu" |
 * | 8.6 | a navigation control closes, reports collapsed, navigates without a full-document reload | "closing the menu" |
 * | 8.7 | an outside pointer closes, reports collapsed, leaves focus where the pointer put it | "closing the menu" |
 * | 8.9 | the Auth_Feature's sign-out is invoked, and the shell performs no navigation of its own | "sign-out lifecycle" |
 * | 8.10 | progress indicated, a second activation prevented, menu open, focus retained, until settle-or-10s | "sign-out lifecycle" |
 * | 8.11 | at 10 seconds: progress stops, the control returns, the failure is stated, the menu and its values stand, nothing navigates | "sign-out lifecycle", "poll loop" |
 * | 8.12 | resting: available, no progress indication | "sign-out lifecycle" |
 * | 8.13 | a completed sign-out cancels the scheduled unread-count calls | "poll loop" |
 *
 * ### Why the last two criteria need the real notification state machine
 *
 * Requirement 8.13 is about a *call that is never issued*, and Requirement 8.11
 * requires the displayed Notification_List and Unread_Count to survive a lapsed
 * watchdog. Neither claim can be observed against a spy: a counted callback shows
 * that the menu asked for the cancellation, not that the poll loop stopped. So the
 * final describe block mounts {@link useNotificationCentre} beside the menu and
 * wires `onSignOutComplete` to end the session for it — which is the seam the
 * shell's route table will pass in — and then advances the clock past two whole
 * poll intervals. A control run in the same block advances the same clock *without*
 * a sign-out and observes the further count call, so "no call was issued" is a
 * fact about the cancellation rather than about a loop that was never running.
 *
 * ### Time and pointers
 *
 * The watchdog is 10 seconds and the poll interval is 60, so every timing test
 * runs under `vi.useFakeTimers()` (`AbortSignal.timeout` is deliberately avoided
 * throughout the shell so these are drivable). Under a faked clock the controls
 * are activated with a bare `.click()`, which dispatches no `pointerdown` and so
 * cannot trip the outside-pointer close being tested elsewhere; the pointer and
 * keyboard tests use `userEvent` on the real clock, where a gesture's full event
 * sequence is what is under test.
 *
 * Feature: app-shell
 * Requirements: 8.2, 8.3, 8.5, 8.6, 8.7, 8.9, 8.10, 8.11, 8.12, 8.13
 */
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from '../api/notificationsApi';
import { PROFILE_ROUTE, SETTINGS_ROUTE, destinationLabel } from '../lib/destinations';
import {
  ACCOUNT_MENU_LABEL,
  SIGN_OUT_FAILED,
  SIGN_OUT_IN_PROGRESS,
  SIGN_OUT_LABEL,
} from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import { useDisclosureGroup } from '../state/useDisclosureGroup';
import { useNotificationCentre } from '../state/useNotificationCentre';
import { SIGN_OUT_WATCHDOG_MS } from '../state/useSignOut';
import { AccountMenu } from './AccountMenu';
import { ShellHeader } from './ShellHeader';

/** The surface id `ShellHeader` supplies for the account disclosure. */
const SURFACE_ID = 'shell-account-menu';

/** The shell route the menu is mounted on. */
const START_ROUTE = '/app';

/** A focusable control outside the disclosure, for the outside-pointer close. */
const OUTSIDE_LABEL = 'Outside the disclosure';

/** The clamped default Poll_Interval, in milliseconds (Requirement 4.6). */
const POLL_INTERVAL_MS = 60_000;

/** The three fixed labels, in the document order Requirement 8.2 sets. */
const CONTROL_LABELS: readonly string[] = [
  destinationLabel('profile'),
  destinationLabel('settings'),
  SIGN_OUT_LABEL,
];

// --- Rendering ---------------------------------------------------------------

/** Reports the router's current path, so a navigation is observable. */
function PathReadout(): ReactElement {
  const { pathname } = useLocation();
  return <p data-testid="pathname">{pathname}</p>;
}

interface HeaderHarnessProps {
  readonly signOut: () => Promise<void>;
  readonly onSignOutComplete?: () => void;
}

/**
 * The menu in its real setting: `ShellHeader`'s account slot, which owns the
 * disclosure group and the surface id, with a focusable control outside the
 * header so "outside both the menu and its trigger" has somewhere real to point.
 */
function HeaderHarness({ signOut, onSignOutComplete }: HeaderHarnessProps): ReactElement {
  return (
    <>
      <ShellHeader
        account={({ disclosure }) => (
          <AccountMenu
            disclosure={disclosure}
            signOut={signOut}
            onSignOutComplete={onSignOutComplete}
          />
        )}
      />
      <button type="button">{OUTSIDE_LABEL}</button>
      <PathReadout />
    </>
  );
}

function renderHeader(props: HeaderHarnessProps): void {
  render(
    <MemoryRouter initialEntries={[START_ROUTE]}>
      <HeaderHarness {...props} />
    </MemoryRouter>,
  );
}

/** A sign-out that never settles, so the pending window stays open. */
function neverSettles(): () => Promise<void> {
  return () => new Promise<void>(() => {});
}

// --- Queries -----------------------------------------------------------------

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: ACCOUNT_MENU_LABEL });
}

/** The disclosure surface, or `null` while the menu is collapsed. */
function surface(): HTMLElement | null {
  return document.getElementById(SURFACE_ID);
}

/** Every interactive element inside the surface, in document order. */
function menuControls(): HTMLElement[] {
  return Array.from(
    surface()?.querySelectorAll<HTMLElement>(
      'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [tabindex]',
    ) ?? [],
  );
}

function signOutControl(): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(SIGN_OUT_LABEL, 'u') });
}

function navigationControl(id: 'profile' | 'settings'): HTMLElement {
  return screen.getByRole('link', { name: destinationLabel(id) });
}

function outsideControl(): HTMLElement {
  return screen.getByRole('button', { name: OUTSIDE_LABEL });
}

function failureAlert(): HTMLElement | null {
  return screen.queryByRole('alert');
}

function currentPath(): string {
  return screen.getByTestId('pathname').textContent ?? '';
}

/** Whether the menu reports, and renders, the open state. */
function isOpen(): boolean {
  return trigger().getAttribute('aria-expanded') === 'true' && surface() !== null;
}

// --- Driving ------------------------------------------------------------------

/**
 * Activate a control without a pointer gesture.
 *
 * `HTMLElement.click()` dispatches no `pointerdown`, so it cannot trip the
 * outside-pointer close, and it needs no timer advancement — both of which matter
 * under the faked clock the sign-out tests run on.
 */
function activate(element: HTMLElement): void {
  act(() => {
    element.click();
  });
}

/** Let settled promises deliver and the resulting React updates apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 16; round += 1) {
      await Promise.resolve();
    }
  });
}

/** Move the faked clock, applying whatever the elapsed timers set in motion. */
async function advanceClock(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Open the menu and put keyboard focus on the Sign_Out_Control. */
function openMenuAndFocusSignOut(): HTMLElement {
  activate(trigger());
  const control = signOutControl();
  act(() => {
    control.focus();
  });
  return control;
}

// --- Menu shape (Requirement 8.2) --------------------------------------------

describe('Account_Menu shape (Requirement 8.2)', () => {
  it('presents exactly three controls, in one document order, and no further control', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());

    expect(menuControls().map((control) => control.textContent)).toEqual(CONTROL_LABELS);
    expect(menuControls()).toHaveLength(3);
    // The order is the registry's, so the two navigation controls reach the
    // Destinations they are named for.
    expect(navigationControl('profile')).toHaveAttribute('href', PROFILE_ROUTE);
    expect(navigationControl('settings')).toHaveAttribute('href', SETTINGS_ROUTE);
  });

  it('labels each control with 1 to 24 visible characters', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());

    for (const control of menuControls()) {
      const label = control.textContent ?? '';
      expect(label.trim()).not.toBe('');
      expect(label.length).toBeGreaterThanOrEqual(1);
      expect(label.length).toBeLessThanOrEqual(24);
    }
  });

  it('still presents exactly three controls while a sign-out is in progress', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: neverSettles() });

    await user.click(trigger());
    await user.click(signOutControl());

    // The progress indication is text beside the label, not a fourth control.
    expect(signOutControl()).toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(menuControls()).toHaveLength(3);
    expect(menuControls().map((control) => control.getAttribute('data-account-control'))).toEqual([
      'profile',
      'settings',
      'sign-out',
    ]);
  });

  it('still presents exactly three controls once a sign-out has failed', async () => {
    const user = userEvent.setup();
    renderHeader({
      signOut: async () => {
        throw new Error('stuck');
      },
    });

    await user.click(trigger());
    await user.click(signOutControl());

    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_OUT_FAILED);
    // The alert is a statement, not a retry control: the Sign_Out_Control is the
    // way to try again, so the menu still presents three controls.
    expect(menuControls()).toHaveLength(3);
  });
});

// --- Keyboard reachability (Requirement 8.3) ---------------------------------

describe('Account_Menu keyboard reachability (Requirement 8.3)', () => {
  it('reaches all three controls, and leaves the surface, with Tab alone', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    trigger().focus();
    await user.keyboard('{Enter}');
    expect(isOpen()).toBe(true);
    // The trigger keeps focus on opening: nothing here moves it into the surface.
    expect(trigger()).toHaveFocus();

    await user.tab();
    expect(navigationControl('profile')).toHaveFocus();
    await user.tab();
    expect(navigationControl('settings')).toHaveFocus();
    await user.tab();
    expect(signOutControl()).toHaveFocus();

    // Tab out of the surface reaches the next control of the document, and leaves
    // the surface open (Requirement 13.6) — this is a disclosure, not a dialog.
    await user.tab();
    expect(outsideControl()).toHaveFocus();
    expect(isOpen()).toBe(true);
  });

  it('returns to the trigger with Shift+Tab alone', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());
    signOutControl().focus();

    await user.tab({ shift: true });
    expect(navigationControl('settings')).toHaveFocus();
    await user.tab({ shift: true });
    expect(navigationControl('profile')).toHaveFocus();
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
  });

  it('activates each control from the keyboard alone', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(neverSettles());
    renderHeader({ signOut });

    // The Sign_Out_Control, reached by Tab and activated with Space.
    trigger().focus();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.tab();
    await user.tab();
    expect(signOutControl()).toHaveFocus();
    await user.keyboard(' ');
    expect(signOut).toHaveBeenCalledTimes(1);

    // A navigation control, reached by Shift+Tab and activated with Enter.
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(navigationControl('profile')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(currentPath()).toBe(PROFILE_ROUTE);
  });

  it('requires no arrow-key, Home-key, or End-key focus model', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());

    // No ARIA menu contract is claimed, so no roving-tabindex model is implied…
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(surface()?.getAttribute('role')).toBeNull();
    // …and nothing has been removed from, or forced into, the tab sequence.
    for (const control of menuControls()) {
      expect(control).not.toHaveAttribute('tabindex');
    }

    // The keys an ARIA menu would commit to move no focus here, and close nothing:
    // they are not part of this component's interface in either direction.
    navigationControl('profile').focus();
    for (const key of ['{ArrowDown}', '{ArrowUp}', '{Home}', '{End}', '{ArrowRight}', '{ArrowLeft}']) {
      await user.keyboard(key);
      expect(navigationControl('profile')).toHaveFocus();
      expect(isOpen()).toBe(true);
    }
  });
});

// --- Closing the menu (Requirements 8.5, 8.6, 8.7) --------------------------

describe('Account_Menu closing (Requirements 8.5, 8.6, 8.7)', () => {
  it.each([
    ['the trigger', () => trigger()],
    ['the Profile control', () => navigationControl('profile')],
    ['the Sign out control', () => signOutControl()],
  ])('closes on Escape pressed from %s and returns focus to the trigger', async (_name, focused) => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());
    focused().focus();

    await user.keyboard('{Escape}');

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(surface()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes on Escape while a sign-out is in progress, without navigating', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(neverSettles());
    renderHeader({ signOut });

    await user.click(trigger());
    await user.click(signOutControl());
    expect(signOutControl()).toHaveTextContent(SIGN_OUT_IN_PROGRESS);

    await user.keyboard('{Escape}');

    // Escape is unconditional (Requirement 8.5); the sign-out is the
    // Auth_Feature's business and the shell navigates nowhere of its own accord.
    expect(surface()).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(currentPath()).toBe(START_ROUTE);
  });

  it('closes on an outside pointer activation and leaves focus where the pointer put it', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());
    expect(isOpen()).toBe(true);

    const outside = outsideControl();
    await user.click(outside);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(surface()).toBeNull();
    // 8.7: focus stays with the pointer's target rather than returning.
    expect(outside).toHaveFocus();
    expect(trigger()).not.toHaveFocus();
  });

  it('closes on an outside pointer activation on a non-focusable region without taking focus back', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());
    await user.click(screen.getByTestId('pathname'));

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).not.toHaveFocus();
  });

  it('stays open for a pointer activation on the trigger-and-surface container', async () => {
    const user = userEvent.setup();
    renderHeader({ signOut: async () => {} });

    await user.click(trigger());
    // Inside the disclosure but not on a control: only the outside-pointer rule
    // could act on it, and it must not.
    const inside = surface()?.querySelector<HTMLElement>('ul');
    expect(inside).not.toBeNull();
    await user.click(inside as HTMLElement);

    expect(isOpen()).toBe(true);
  });

  it.each([
    ['profile', PROFILE_ROUTE],
    ['settings', SETTINGS_ROUTE],
  ] as const)(
    'closes, reports collapsed, and navigates client-side from the %s control',
    async (id, path) => {
      const user = userEvent.setup();
      renderHeader({ signOut: async () => {} });
      await user.click(trigger());
      // A full-document reload would replace every node, so the header's identity
      // before and after the navigation is what "without a reload" is measured by.
      const header = screen.getByRole('banner');

      await user.click(navigationControl(id));

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(surface()).toBeNull();
      expect(trigger()).toHaveFocus();
      expect(currentPath()).toBe(path);
      expect(screen.getByRole('banner')).toBe(header);
    },
  );
});

// --- The sign-out lifecycle (Requirements 8.9–8.12) -------------------------

describe('Account_Menu sign-out lifecycle (Requirements 8.9, 8.10, 8.11, 8.12)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 8.12: available, with no progress indication and nothing said.
  it('rests with the control available and no progress indication', () => {
    const signOut = vi.fn(async () => {});
    renderHeader({ signOut });

    activate(trigger());

    const control = signOutControl();
    expect(control).not.toBeDisabled();
    expect(control).not.toHaveAttribute('aria-disabled');
    expect(control).not.toHaveAttribute('aria-busy');
    expect(control).not.toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(failureAlert()).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  // 8.9: the Auth_Feature's sign-out is invoked, and nothing else happens.
  it('delegates the activation and performs no navigation of its own', async () => {
    const signOut = vi.fn(async () => {});
    renderHeader({ signOut });

    const control = openMenuAndFocusSignOut();
    activate(control);
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    // The Auth_Feature navigates after its own sign-out; the shell does not.
    expect(currentPath()).toBe(START_ROUTE);
    expect(failureAlert()).toBeNull();
  });

  // 8.10: in progress from the activation until the earlier of settle and 10s.
  it('indicates progress, keeps the menu open, and retains focus on the control', async () => {
    renderHeader({ signOut: neverSettles() });

    const control = openMenuAndFocusSignOut();
    activate(control);
    await flush();

    const pendingControl = signOutControl();
    expect(pendingControl).toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(pendingControl).toHaveAttribute('aria-busy', 'true');
    expect(pendingControl).toHaveAttribute('aria-disabled', 'true');
    // Not `disabled`, which would drop the focus the requirement says is retained.
    expect(pendingControl).not.toBeDisabled();
    expect(pendingControl).toHaveFocus();
    expect(isOpen()).toBe(true);

    // A moment before the watchdog, all of that still holds.
    await advanceClock(SIGN_OUT_WATCHDOG_MS - 1);
    expect(signOutControl()).toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(signOutControl()).toHaveFocus();
    expect(isOpen()).toBe(true);
    expect(failureAlert()).toBeNull();
  });

  // 8.10: a second concurrent activation is prevented.
  it('refuses a second activation while a sign-out is in progress', async () => {
    const signOut = vi.fn(neverSettles());
    renderHeader({ signOut });

    const control = openMenuAndFocusSignOut();
    activate(control);
    await flush();

    activate(signOutControl());
    await advanceClock(SIGN_OUT_WATCHDOG_MS - 1);
    activate(signOutControl());
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  // 8.10: the indication ends when the invoked navigation settles.
  it('stops indicating progress when the sign-out completes', async () => {
    const onSignOutComplete = vi.fn();
    renderHeader({ signOut: async () => {}, onSignOutComplete });

    const control = openMenuAndFocusSignOut();
    activate(control);
    await flush();

    expect(signOutControl()).not.toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(signOutControl()).not.toHaveAttribute('aria-busy');
    expect(failureAlert()).toBeNull();
    expect(onSignOutComplete).toHaveBeenCalledTimes(1);

    // The watchdog belonging to a settled activation says nothing later on.
    await advanceClock(SIGN_OUT_WATCHDOG_MS * 2);
    expect(failureAlert()).toBeNull();
    expect(onSignOutComplete).toHaveBeenCalledTimes(1);
  });

  // 8.11: the watchdog hands the control back, states the failure, navigates nowhere.
  it('hands the control back and states the failure 10 seconds after the activation', async () => {
    const signOut = vi.fn(neverSettles());
    const onSignOutComplete = vi.fn();
    renderHeader({ signOut, onSignOutComplete });

    const control = openMenuAndFocusSignOut();
    activate(control);
    await flush();
    await advanceClock(SIGN_OUT_WATCHDOG_MS - 1);
    expect(failureAlert()).toBeNull();

    await advanceClock(1);

    const alert = failureAlert();
    expect(alert).toHaveTextContent(SIGN_OUT_FAILED);
    const returned = signOutControl();
    expect(returned).not.toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(returned).not.toHaveAttribute('aria-disabled');
    expect(returned).not.toHaveAttribute('aria-busy');
    expect(returned).toHaveAttribute('aria-describedby', alert?.id);
    // The menu stands, focus stands, and nothing was navigated or invoked twice.
    expect(isOpen()).toBe(true);
    expect(returned).toHaveFocus();
    expect(currentPath()).toBe(START_ROUTE);
    expect(signOut).toHaveBeenCalledTimes(1);
    // The sign-out never completed, so no completion was reported.
    expect(onSignOutComplete).not.toHaveBeenCalled();
  });

  // 8.11: available for a further activation once the watchdog has lapsed.
  it('accepts a further activation after the watchdog, clearing the message', async () => {
    const signOut = vi.fn(neverSettles());
    renderHeader({ signOut });

    const control = openMenuAndFocusSignOut();
    activate(control);
    await flush();
    await advanceClock(SIGN_OUT_WATCHDOG_MS);
    expect(failureAlert()).toHaveTextContent(SIGN_OUT_FAILED);

    activate(signOutControl());
    await flush();

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(signOutControl()).toHaveTextContent(SIGN_OUT_IN_PROGRESS);
    expect(failureAlert()).toBeNull();
  });
});

// --- Poll cancellation and retained values (Requirements 8.11, 8.13) --------

/** A recording Notifications_Api that answers every call at once. */
interface RecordingApi {
  readonly api: NotificationsApi;
  countCalls(): number;
  listCalls(): number;
}

function recordingApi(unreadCount: number, records: readonly NotificationRecord[]): RecordingApi {
  let counts = 0;
  let lists = 0;

  const api: NotificationsApi = {
    list: () => {
      lists += 1;
      return Promise.resolve<NotificationCallOutcome>({ kind: 'success', value: [...records] });
    },
    unreadCount: () => {
      counts += 1;
      return Promise.resolve<CountCallOutcome>({ kind: 'success', value: unreadCount });
    },
    markRead: () =>
      Promise.resolve<AcknowledgementOutcome>({ kind: 'success', value: undefined }),
    markAllRead: () => Promise.resolve<CountCallOutcome>({ kind: 'success', value: 0 }),
  };

  return { api, countCalls: () => counts, listCalls: () => lists };
}

/** One well-formed Notification_Record. */
function notification(index: number): NotificationRecord {
  return {
    notificationId: `0000000${index}-1111-4111-8111-111111111111`,
    type: { kind: 'catalogued', value: 'match-confirmed' },
    squadId: '22222222-2222-4222-8222-222222222222',
    title: `Notification ${index}`,
    body: `Body ${index}`,
    createdAtMs: Date.UTC(2025, 2, 12, 18, 0, 0) - index * 1_000,
    readState: 'unread',
  };
}

interface PollHarnessProps {
  readonly api: NotificationsApi;
  readonly signOut: () => Promise<void>;
}

/**
 * The menu beside the real notification state machine.
 *
 * `onSignOutComplete` ends the session for the machine, which is the seam the
 * shell's route table supplies: the machine has no "stop polling" method of its
 * own, and an ended session is exactly the condition under which it cancels the
 * scheduled unread-count calls (Requirements 4.9, 8.13). A control in the surface
 * loads the Notification_List the way the Notification_Panel's opening does, so
 * the values Requirement 8.11 says are retained are on screen to begin with.
 */
function PollLoopHarness({ api, signOut }: PollHarnessProps): ReactElement {
  const [sessionEnded, setSessionEnded] = useState(false);
  const centre = useNotificationCentre({
    api,
    // The machine's own handover sign-out, which nothing in these tests reaches.
    signOut: () => undefined,
    authState: sessionEnded ? 'unauthenticated' : 'authenticated',
  });
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <>
      <p data-testid="unread-count">{centre.unreadCount}</p>
      <p data-testid="record-count">{centre.records.length}</p>
      <button
        type="button"
        onClick={() => {
          centre.notifyPanelOpened();
        }}
      >
        Load notifications
      </button>
      <AccountMenu
        disclosure={{
          surfaceId: SURFACE_ID,
          open: open === 'account',
          requestOpen: () => toggle('account'),
          requestClose: () => close('account'),
        }}
        signOut={signOut}
        onSignOutComplete={() => {
          setSessionEnded(true);
        }}
      />
      <PathReadout />
    </>
  );
}

describe('Account_Menu poll cancellation (Requirements 8.11, 8.13)', () => {
  const UNREAD_COUNT = 3;
  const RECORDS = [notification(1), notification(2)];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Mount the harness with its mount count call and its list already settled. */
  async function renderPollLoop(signOut: () => Promise<void>): Promise<RecordingApi> {
    const recording = recordingApi(UNREAD_COUNT, RECORDS);
    render(
      <MemoryRouter initialEntries={[START_ROUTE]}>
        <PollLoopHarness api={recording.api} signOut={signOut} />
      </MemoryRouter>,
    );
    await flush();

    // Load the list, so the displayed values Requirement 8.11 protects exist.
    activate(screen.getByRole('button', { name: 'Load notifications' }));
    await flush();

    expect(screen.getByTestId('unread-count')).toHaveTextContent(String(UNREAD_COUNT));
    expect(screen.getByTestId('record-count')).toHaveTextContent(String(RECORDS.length));
    expect(recording.listCalls()).toBeGreaterThanOrEqual(1);

    return recording;
  }

  // The control run: the loop is genuinely live, so a later "no further call"
  // observation is about the cancellation rather than about an inert harness.
  it('keeps polling while no sign-out has completed', async () => {
    const recording = await renderPollLoop(async () => {});
    const before = recording.countCalls();

    await advanceClock(POLL_INTERVAL_MS);

    expect(recording.countCalls()).toBe(before + 1);
  });

  // 8.13: a completed sign-out cancels the scheduled unread-count calls.
  it('issues no further unread-count call once the sign-out completes', async () => {
    const recording = await renderPollLoop(async () => {});
    const before = recording.countCalls();

    activate(trigger());
    activate(signOutControl());
    await flush();

    // Two whole poll intervals: nothing was left scheduled.
    await advanceClock(POLL_INTERVAL_MS * 2);

    expect(recording.countCalls()).toBe(before);
  });

  // 8.11: a lapsed watchdog cancels nothing — the session may well still be live,
  // and the displayed Notification_List and Unread_Count are retained.
  it('keeps the menu, the list, and the count while the watchdog lapses', async () => {
    const recording = await renderPollLoop(neverSettles());
    const before = recording.countCalls();

    activate(trigger());
    const control = signOutControl();
    act(() => {
      control.focus();
    });
    activate(control);
    await flush();
    await advanceClock(SIGN_OUT_WATCHDOG_MS);

    expect(failureAlert()).toHaveTextContent(SIGN_OUT_FAILED);
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('unread-count')).toHaveTextContent(String(UNREAD_COUNT));
    expect(screen.getByTestId('record-count')).toHaveTextContent(String(RECORDS.length));
    expect(currentPath()).toBe(START_ROUTE);
    // The loop was never cancelled, because the sign-out never completed.
    await advanceClock(POLL_INTERVAL_MS);
    expect(recording.countCalls()).toBeGreaterThan(before);
  });
});
