/**
 * Unit tests for the Notification_Panel *as a disclosure* — opening it, the four
 * ways it closes, and the two states a person meets on opening.
 *
 * `NotificationPanel.test.tsx` renders the panel directly, which is the right
 * shape for what the panel itself decides. These tests instead wire the real
 * three pieces the way `ShellHeader`'s notification slot does — the
 * Notification_Indicator as the trigger, {@link Disclosure} owning the open
 * state through {@link useDisclosureGroup}, and the panel as the surface — because
 * the behaviour under test here belongs to none of them alone:
 *
 *   - opening on activation, with the expanded state reported on the indicator and
 *     keyboard focus moved into the panel (Requirement 5.1),
 *   - a second activation of the indicator closing the panel with focus returned
 *     to it (Requirement 5.2),
 *   - Escape from inside the panel closing it with focus returned to the indicator
 *     (Requirement 5.3),
 *   - an outside pointer activation closing it, reporting the collapsed state, and
 *     leaving focus where the pointer put it rather than on the indicator
 *     (Requirement 5.14),
 *   - the "no notifications" statement for an opening whose list returned nothing,
 *     with no error indication (Requirement 5.7), and
 *   - the loading indication appearing 300 ms into a *re-opening's* list call,
 *     alongside the failure message retained from the previous opening
 *     (Requirement 5.8) — a coexistence only reachable across a close and a
 *     re-open, since the message lives in the state machine and the panel does not.
 *
 * The notification state machine is the real one, over a stub transport: the count
 * answers at once, and the list either answers at once or is left in flight for
 * the test to settle by hand.
 *
 * Feature: app-shell
 * Requirements: 5.1, 5.2, 5.3, 5.7, 5.8, 5.14
 */
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from '../api/notificationsApi';
import {
  GENERIC_NOTIFICATION_FAILURE,
  NOTIFICATIONS_LOADING,
  NO_NOTIFICATIONS,
} from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import { NotificationCentreProvider } from '../state/NotificationCentreContext';
import { SquadScopeProvider } from '../state/SquadScopeContext';
import { useDisclosureGroup } from '../state/useDisclosureGroup';
import { Disclosure } from './Disclosure';
import { NotificationIndicator } from './NotificationIndicator';
import { LOADING_INDICATION_DELAY_MS, NotificationPanel } from './NotificationPanel';

/** The surface id the Shell_Header supplies for the notification disclosure. */
const SURFACE_ID = 'shell-notification-panel';

/** A focusable control outside the disclosure, for the outside-pointer close. */
const OUTSIDE_LABEL = 'Outside the disclosure';

/** The creation instant the records below carry: 12 March 2025, 18:00 UTC. */
const CREATED_AT_MS = Date.UTC(2025, 2, 12, 18, 0, 0);

/** Five minutes later, so every relative time label lands in the minutes band. */
const NOW_MS = CREATED_AT_MS + 5 * 60_000;

// --- Test doubles -----------------------------------------------------------

/** A promise a test settles by hand, so a call can be left in flight. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, resolve: (value) => settle?.(value) };
}

/**
 * A minimal authenticated {@link SessionManager}. `AuthProvider` reads only
 * `getState()` and `subscribe()`, and nothing here performs a session transition.
 */
function authenticatedSessionManager(): SessionManager {
  return {
    bootstrap: vi.fn((): AuthState => 'authenticated'),
    establish: vi.fn(),
    getState: vi.fn((): AuthState => 'authenticated'),
    getAccessTokenForRequest: vi.fn(async () => ({ token: 'stub' })),
    signOut: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
  } as unknown as SessionManager;
}

/** A well-formed Notification_Record; the index decides its text and instant. */
function notification(index: number): NotificationRecord {
  const digit = String(index % 10).repeat(4);

  return {
    notificationId: `0000${digit}-1111-4111-8111-11111111${String(index).padStart(4, '0')}`,
    type: { kind: 'catalogued', value: 'match-confirmed' },
    squadId: '22222222-2222-4222-8222-222222222222',
    title: `Notification ${index}`,
    body: `Body ${index}`,
    createdAtMs: CREATED_AT_MS - index * 1_000,
    readState: 'unread',
  };
}

/** `count` records, newest first once ordered. */
function notifications(count: number): NotificationRecord[] {
  return Array.from({ length: count }, (_, index) => notification(index + 1));
}

interface StubTransport {
  readonly api: NotificationsApi;
  /** One entry per list call left in flight, newest last. Empty while auto-answering. */
  readonly listCalls: Deferred<NotificationCallOutcome>[];
}

interface StubOptions {
  /** The Unread_Count the transport reports, answered at once. */
  readonly count?: number;
  /**
   * What the list endpoint answers: records at once, or `'deferred'` to leave
   * every list call in flight for the test to settle.
   */
  readonly records?: readonly NotificationRecord[] | 'deferred';
}

function stubTransport({ count = 0, records = [] }: StubOptions): StubTransport {
  const listCalls: Deferred<NotificationCallOutcome>[] = [];

  const api: NotificationsApi = {
    list: () => {
      if (records === 'deferred') {
        const call = deferred<NotificationCallOutcome>();
        listCalls.push(call);
        return call.promise;
      }
      return Promise.resolve<NotificationCallOutcome>({
        kind: 'success',
        value: [...records],
      });
    },
    unreadCount: () =>
      Promise.resolve<CountCallOutcome>({ kind: 'success', value: count }),
    markRead: () =>
      Promise.resolve<AcknowledgementOutcome>({ kind: 'success', value: undefined }),
    markAllRead: () =>
      Promise.resolve<CountCallOutcome>({ kind: 'success', value: 0 }),
  };

  return { api, listCalls };
}

// --- Rendering --------------------------------------------------------------

/**
 * The Shell_Header's notification slot, reproduced: one disclosure group owning
 * the open state, the indicator as the trigger, the panel as the surface. A
 * focusable control sits outside the disclosure so "outside both the panel and the
 * indicator" has somewhere real to point at.
 */
function Harness(): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <div>
      <Disclosure
        id={SURFACE_ID}
        open={open === 'notifications'}
        onRequestOpen={() => toggle('notifications')}
        onRequestClose={() => close('notifications')}
        trigger={(triggerProps) => <NotificationIndicator {...triggerProps} />}
      >
        <NotificationPanel onNavigate={() => close('notifications')} />
      </Disclosure>
      <button type="button">{OUTSIDE_LABEL}</button>
    </div>
  );
}

interface Rendered {
  readonly transport: StubTransport;
  /** Settle the newest list call as a success carrying `records`. */
  resolveList(records: readonly NotificationRecord[]): Promise<void>;
  /** Settle the newest list call as a failure. */
  failList(): Promise<void>;
}

function renderWiredPanel(options: StubOptions = {}): Rendered {
  const transport = stubTransport(options);

  render(
    <MemoryRouter>
      <AuthProvider manager={authenticatedSessionManager()}>
        <SquadScopeProvider>
          <NotificationCentreProvider
            api={transport.api}
            signOut={vi.fn()}
            now={() => NOW_MS}
          >
            <Harness />
          </NotificationCentreProvider>
        </SquadScopeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );

  const settle = async (settler: () => void): Promise<void> => {
    await act(async () => {
      settler();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const newest = (): Deferred<NotificationCallOutcome> => {
    const call = transport.listCalls.at(-1);
    if (call === undefined) {
      throw new Error('No list call has been issued.');
    }
    return call;
  };

  return {
    transport,
    resolveList: (records) =>
      settle(() => newest().resolve({ kind: 'success', value: [...records] })),
    failList: () => settle(() => newest().resolve({ kind: 'failure' })),
  };
}

// --- Queries ----------------------------------------------------------------

/** The Notification_Indicator, whatever count its accessible name reports. */
function indicator(): HTMLElement {
  return screen.getByRole('button', { name: /^Notifications,/ });
}

/** The Notification_Panel, or `null` while the surface is collapsed. */
function panel(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Notifications' });
}

/** The disclosure surface element the indicator's `aria-controls` names. */
function surface(): HTMLElement | null {
  return document.getElementById(SURFACE_ID);
}

function outsideControl(): HTMLElement {
  return screen.getByRole('button', { name: OUTSIDE_LABEL });
}

function loadingIndication(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-shell-notification-loading]');
}

function failureMessage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-shell-notification-failure]');
}

/** Flush the microtasks the immediately-answered count and list calls settle in. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Activate the indicator without a pointer gesture.
 *
 * A bare `click()` dispatches no `pointerdown`, which keeps the open/close under
 * test free of the outside-pointer path — and it works under fake timers, where
 * `userEvent` would need its own timer advancement.
 */
function activateIndicator(): void {
  act(() => {
    indicator().click();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe('NotificationPanel opening (Requirement 5.1)', () => {
  it('opens the panel and reports the expanded state on the indicator', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    expect(panel()).toBeNull();
    expect(indicator()).toHaveAttribute('aria-expanded', 'false');

    await user.click(indicator());

    expect(panel()).toBeInTheDocument();
    expect(indicator()).toHaveAttribute('aria-expanded', 'true');
    // The state the indicator reports names the surface actually rendered.
    expect(indicator()).toHaveAttribute('aria-controls', SURFACE_ID);
    expect(surface()).toContainElement(panel());
  });

  it('moves keyboard focus to the first focusable control inside the panel', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());

    const opened = panel();
    expect(opened).not.toBeNull();
    const first = opened?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(first).toHaveFocus();
    expect(opened?.contains(document.activeElement)).toBe(true);
  });

  it('opens from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    indicator().focus();
    await user.keyboard('{Enter}');

    expect(panel()).toBeInTheDocument();
    expect(panel()?.contains(document.activeElement)).toBe(true);
  });
});

describe('NotificationPanel close by the indicator (Requirement 5.2)', () => {
  it('closes the panel and returns focus to the indicator', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    expect(panel()).toBeInTheDocument();

    await user.click(indicator());

    expect(panel()).toBeNull();
    expect(surface()).toBeNull();
    expect(indicator()).toHaveAttribute('aria-expanded', 'false');
    expect(indicator()).toHaveFocus();
  });

  it('closes from the keyboard with focus on the indicator', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    // Back to the trigger the way Requirement 13.6 allows, then activate it.
    indicator().focus();
    await user.keyboard(' ');

    expect(panel()).toBeNull();
    expect(indicator()).toHaveFocus();
  });
});

describe('NotificationPanel close by Escape (Requirement 5.3)', () => {
  it('closes and returns focus to the indicator from the focus the opening gave', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    expect(panel()?.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');

    expect(panel()).toBeNull();
    expect(indicator()).toHaveAttribute('aria-expanded', 'false');
    expect(indicator()).toHaveFocus();
  });

  it('closes and returns focus from a control deeper inside the panel', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    await user.tab();
    const moved = document.activeElement;
    expect(panel()?.contains(moved)).toBe(true);
    expect(moved).not.toBe(indicator());

    await user.keyboard('{Escape}');

    expect(panel()).toBeNull();
    expect(indicator()).toHaveFocus();
  });
});

describe('NotificationPanel close by an outside pointer (Requirement 5.14)', () => {
  it('closes and leaves focus where the pointer put it', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    expect(panel()).toBeInTheDocument();

    const outside = outsideControl();
    await user.click(outside);

    expect(panel()).toBeNull();
    expect(indicator()).toHaveAttribute('aria-expanded', 'false');
    // 5.14: focus stays with the pointer's target rather than returning.
    expect(outside).toHaveFocus();
    expect(indicator()).not.toHaveFocus();
  });

  it('stays open for a pointer activation inside the panel', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    // The panel's own heading: inside the surface, and not a control, so nothing
    // but the outside-pointer rule could act on it.
    await user.click(screen.getByRole('heading', { name: 'Notifications' }));

    expect(panel()).toBeInTheDocument();
    expect(indicator()).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays open for a pointer activation on the indicator itself', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 2, records: notifications(2) });
    await flush();

    await user.click(indicator());
    const badge = document.querySelector<HTMLElement>('[data-unread-badge]');
    expect(badge).not.toBeNull();

    // A pointer landing on the badge is inside the indicator, so the outside rule
    // must not fire; the trigger's own toggle is what closes the panel here.
    await user.click(badge as HTMLElement);

    expect(panel()).toBeNull();
    expect(indicator()).toHaveFocus();
  });
});

describe('NotificationPanel empty state on opening (Requirement 5.7)', () => {
  it('states that there are no notifications, with no error indication', async () => {
    const user = userEvent.setup();
    renderWiredPanel({ count: 0, records: [] });
    await flush();

    await user.click(indicator());

    expect(await screen.findByText(NO_NOTIFICATIONS)).toBeInTheDocument();
    expect(failureMessage()).toBeNull();
    expect(screen.queryByText(GENERIC_NOTIFICATION_FAILURE)).toBeNull();
  });
});

describe('NotificationPanel loading indication on re-opening (Requirement 5.8)', () => {
  it('displays the indication 300 ms in, alongside the retained failure message', async () => {
    vi.useFakeTimers();
    const rendered = renderWiredPanel({ count: 1, records: 'deferred' });
    await flush();

    // A first opening whose list call fails, leaving the message behind.
    activateIndicator();
    await rendered.failList();
    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);
    expect(loadingIndication()).toBeNull();

    // Closed, so the panel — and its loading timer — is gone entirely.
    activateIndicator();
    expect(panel()).toBeNull();

    // Re-opened: a fresh list call, with the earlier failure still on the record.
    activateIndicator();
    expect(panel()).toBeInTheDocument();
    expect(rendered.transport.listCalls).toHaveLength(2);
    expect(loadingIndication()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATION_DELAY_MS - 1);
    });
    expect(loadingIndication()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    // 5.8: both regions, until the awaited call resolves.
    expect(loadingIndication()).toHaveTextContent(NOTIFICATIONS_LOADING);
    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);

    await rendered.resolveList([]);

    expect(loadingIndication()).toBeNull();
    expect(failureMessage()).toBeNull();
    expect(screen.getByText(NO_NOTIFICATIONS)).toBeInTheDocument();
  });
});
