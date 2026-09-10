/**
 * Unit tests for the Notification_Panel.
 *
 * These cover what this component decides, which is presentation and timing —
 * the ordering, the caps, the failure retention, and the call discipline are the
 * state machine's, covered by `state/useNotificationCentre.*`:
 *
 *   - the leading 10 records of the ordered Notification_List and the control that
 *     navigates to the Notifications_Destination (Requirement 5.12),
 *   - focus moving to the first focusable control inside the panel on opening,
 *     and to the panel itself when it has none (Requirement 5.1),
 *   - exactly one list call per opening, and none from a re-render
 *     (Requirement 4.7),
 *   - the "no notifications" statement for a list call that returned nothing, with
 *     no error indication (Requirement 5.7),
 *   - the loading indication appearing 300 ms into a list call and stopping when it
 *     settles, alongside a retained failure message (Requirement 5.8),
 *   - the retry control issuing exactly one further call per activation, for any
 *     number of activations, with none while a call awaits a response
 *     (Requirement 5.9),
 *   - the Mark_All_Read_Control's disabled rule, its progress indication, and its
 *     refusal of a second concurrent activation (Requirements 6.4, 6.8, 6.9), and
 *   - no mark-read call in consequence of a record merely being rendered
 *     (Requirement 6.12).
 *
 * The panel is wired to the *real* notification state machine over a stub
 * transport whose list and mark-all calls are settled by hand, because most of
 * what the panel renders is a consequence of when those calls settle. The panel is
 * rendered directly rather than through `Disclosure`: the surface is unmounted
 * while closed, so mounting the panel *is* opening it, and `Disclosure`'s own
 * open/close behaviour is covered by `Disclosure.test.tsx`.
 *
 * Feature: app-shell
 * Requirements: 4.7, 5.1, 5.7, 5.8, 5.9, 5.12, 6.4, 6.8, 6.9, 6.12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from '../api/notificationsApi';
import { NOTIFICATIONS_ROUTE } from '../lib/destinations';
import {
  GENERIC_NOTIFICATION_FAILURE,
  MARK_ALL_READ_IN_PROGRESS,
  MARK_ALL_READ_LABEL,
  NOTIFICATIONS_LOADING,
  NOTIFICATION_PANEL_SEE_ALL,
  NOTIFICATION_RETRY_LABEL,
  NO_NOTIFICATIONS,
} from '../lib/messages';
import { NOTIFICATION_PANEL_PREVIEW_CAP } from '../lib/notificationOrdering';
import type { NotificationRecord } from '../lib/notificationParsing';
import { NotificationCentreProvider } from '../state/NotificationCentreContext';
import { SquadScopeProvider } from '../state/SquadScopeContext';
import { LOADING_INDICATION_DELAY_MS, NotificationPanel } from './NotificationPanel';

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

  return {
    promise,
    resolve: (value) => settle?.(value),
  };
}

/**
 * A minimal authenticated {@link SessionManager}. `AuthProvider` reads only
 * `getState()` and `subscribe()`, and nothing here performs a session
 * transition.
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

interface StubTransport {
  readonly api: NotificationsApi;
  /** One entry per list call issued, newest last, each settled by the test. */
  readonly listCalls: Deferred<NotificationCallOutcome>[];
  /** One entry per mark-all-read call issued. */
  readonly markAllCalls: Deferred<CountCallOutcome>[];
  /** The identities passed to the mark-read endpoint, in call order. */
  readonly markReadCalls: string[];
  /** How many unread-count calls have been issued. */
  countCalls(): number;
}

/**
 * A Notifications_Api whose list and mark-all-read calls stay in flight until the
 * test settles them, and whose unread-count call answers `count` at once.
 */
function stubTransport(count = 0): StubTransport {
  const listCalls: Deferred<NotificationCallOutcome>[] = [];
  const markAllCalls: Deferred<CountCallOutcome>[] = [];
  const markReadCalls: string[] = [];
  let counts = 0;

  const api: NotificationsApi = {
    list: () => {
      const call = deferred<NotificationCallOutcome>();
      listCalls.push(call);
      return call.promise;
    },
    unreadCount: () => {
      counts += 1;
      return Promise.resolve<CountCallOutcome>({ kind: 'success', value: count });
    },
    markRead: ({ notificationId }) => {
      markReadCalls.push(notificationId);
      return Promise.resolve<AcknowledgementOutcome>({
        kind: 'success',
        value: undefined,
      });
    },
    markAllRead: () => {
      const call = deferred<CountCallOutcome>();
      markAllCalls.push(call);
      return call.promise;
    },
  };

  return { api, listCalls, markAllCalls, markReadCalls, countCalls: () => counts };
}

/** A well-formed Notification_Record; each caller overrides what it is about. */
function notification(index: number, readState: 'read' | 'unread' = 'unread'): NotificationRecord {
  const digit = String(index % 10).repeat(4);

  return {
    notificationId: `0000${digit}-1111-4111-8111-11111111${String(index).padStart(4, '0')}`,
    type: { kind: 'catalogued', value: 'match-confirmed' },
    squadId: '22222222-2222-4222-8222-222222222222',
    title: `Notification ${index}`,
    body: `Body ${index}`,
    // Descending order comes out of the state machine; the instants differ so the
    // ordering is decided by them rather than by identity.
    createdAtMs: CREATED_AT_MS - index * 1_000,
    readState,
  };
}

/** `count` records, newest first once ordered. */
function notifications(count: number, readState: 'read' | 'unread' = 'unread'): NotificationRecord[] {
  return Array.from({ length: count }, (_, index) => notification(index + 1, readState));
}

// --- Rendering --------------------------------------------------------------

interface Rendered {
  readonly transport: StubTransport;
  /** Settle the newest list call as a success carrying `records`. */
  resolveList(records: readonly NotificationRecord[]): Promise<void>;
  /** Settle the newest list call as a failure. */
  failList(): Promise<void>;
  /** Settle the newest mark-all-read call as a success. */
  resolveMarkAll(): Promise<void>;
}

function renderPanel(count = 0): Rendered {
  const transport = stubTransport(count);

  const tree = (
    <MemoryRouter>
      <AuthProvider manager={authenticatedSessionManager()}>
        <SquadScopeProvider>
          <NotificationCentreProvider
            api={transport.api}
            signOut={vi.fn()}
            now={() => NOW_MS}
          >
            <NotificationPanel />
          </NotificationCentreProvider>
        </SquadScopeProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  render(tree);

  const settle = async (settler: () => void): Promise<void> => {
    await act(async () => {
      settler();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const newest = <T,>(calls: Deferred<T>[]): Deferred<T> => {
    const call = calls.at(-1);
    if (call === undefined) {
      throw new Error('No call has been issued.');
    }
    return call;
  };

  return {
    transport,
    resolveList: (records) =>
      settle(() =>
        newest(transport.listCalls).resolve({ kind: 'success', value: [...records] }),
      ),
    failList: () => settle(() => newest(transport.listCalls).resolve({ kind: 'failure' })),
    resolveMarkAll: () =>
      settle(() => newest(transport.markAllCalls).resolve({ kind: 'success', value: 0 })),
  };
}

/** Flush the microtasks the unread-count call settles in. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function panel(): HTMLElement {
  return screen.getByRole('group', { name: 'Notifications' });
}

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.shell-notification-row'),
  );
}

function markAllControl(): HTMLElement {
  return screen.getByRole('button', {
    name: new RegExp(`${MARK_ALL_READ_LABEL}|${MARK_ALL_READ_IN_PROGRESS}`),
  });
}

function loadingIndication(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-shell-notification-loading]');
}

function failureMessage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-shell-notification-failure]');
}

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe('NotificationPanel records and destination control (Requirement 5.12)', () => {
  it('displays at most the leading 10 records of the ordered list', async () => {
    const rendered = renderPanel(12);

    await rendered.resolveList(notifications(12));

    expect(rows()).toHaveLength(NOTIFICATION_PANEL_PREVIEW_CAP);
    // The leading records of the ordering — newest first — and not the tail.
    expect(rows()[0]).toHaveTextContent('Notification 1');
    expect(screen.queryByText('Notification 11')).toBeNull();
    expect(screen.queryByText('Notification 12')).toBeNull();
  });

  it('displays every record when fewer than the preview cap are returned', async () => {
    const rendered = renderPanel(3);

    await rendered.resolveList(notifications(3));

    expect(rows()).toHaveLength(3);
  });

  it('displays a control that navigates to the Notifications destination', async () => {
    renderPanel();
    await flush();

    expect(
      screen.getByRole('link', { name: NOTIFICATION_PANEL_SEE_ALL }),
    ).toHaveAttribute('href', NOTIFICATIONS_ROUTE);
  });
});

describe('NotificationPanel focus on opening (Requirement 5.1)', () => {
  it('moves focus to the first focusable control inside the panel', async () => {
    renderPanel(3);

    // Read the focusable controls as they stand *at the instant of opening*: the
    // panel focuses the first of them then, and deliberately not again as the
    // count and the records arrive.
    const focusable = Array.from(
      panel().querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

    expect(focusable.length).toBeGreaterThan(0);
    expect(focusable[0]).toHaveFocus();

    await flush();
  });

  it('skips a disabled leading control rather than focusing it', async () => {
    // At the instant of opening no count has been accepted and no record is
    // displayed, so the Mark_All_Read_Control is disabled (Requirement 6.9) and
    // cannot take focus. The control after it does.
    renderPanel(0);
    await flush();

    expect(markAllControl()).toBeDisabled();
    expect(markAllControl()).not.toHaveFocus();
    expect(screen.getByRole('link', { name: NOTIFICATION_PANEL_SEE_ALL })).toHaveFocus();
  });

  it('leaves focus inside the panel', async () => {
    renderPanel(3);
    await flush();

    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('does not move focus again when the records arrive', async () => {
    const rendered = renderPanel(3);
    await flush();

    // Someone has moved focus on within the panel before the list settled.
    const seeAll = screen.getByRole('link', { name: NOTIFICATION_PANEL_SEE_ALL });
    seeAll.focus();

    await rendered.resolveList(notifications(3));

    expect(seeAll).toHaveFocus();
  });
});

describe('NotificationPanel call discipline on opening (Requirement 4.7)', () => {
  it('issues exactly one list call for one opening', async () => {
    const rendered = renderPanel(2);
    await flush();

    expect(rendered.transport.listCalls).toHaveLength(1);
    // The opening asks for the count as well. *How many* requests that becomes is
    // the state machine's single-flight rule (Requirement 4.11), not the panel's:
    // here the panel's opening and the machine's own mount coincide, so the
    // mount call is in flight and the opening's is coalesced behind it.
    expect(rendered.transport.countCalls()).toBeGreaterThanOrEqual(1);
  });

  it('issues no further list call in consequence of a re-render', async () => {
    const rendered = renderPanel(2);
    await flush();

    // Settling the list re-renders the panel with its records; a re-render owes
    // no further call.
    await rendered.resolveList(notifications(2));

    expect(rendered.transport.listCalls).toHaveLength(1);
  });
});

describe('NotificationPanel empty state (Requirement 5.7)', () => {
  it('states that there are no notifications, with no error indication', async () => {
    const rendered = renderPanel();

    await rendered.resolveList([]);

    expect(screen.getByText(NO_NOTIFICATIONS)).toBeInTheDocument();
    expect(failureMessage()).toBeNull();
    expect(screen.queryByText(GENERIC_NOTIFICATION_FAILURE)).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('does not state that there are no notifications while the call is awaited', async () => {
    renderPanel();
    await flush();

    expect(screen.queryByText(NO_NOTIFICATIONS)).toBeNull();
  });

  it('does not state that there are no notifications for a failed call', async () => {
    const rendered = renderPanel();

    await rendered.failList();

    expect(screen.queryByText(NO_NOTIFICATIONS)).toBeNull();
    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);
  });
});

describe('NotificationPanel loading indication (Requirement 5.8)', () => {
  it('displays the indication 300 ms after the list call is issued', async () => {
    vi.useFakeTimers();
    renderPanel();

    expect(loadingIndication()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATION_DELAY_MS - 1);
    });
    expect(loadingIndication()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(loadingIndication()).toHaveTextContent(NOTIFICATIONS_LOADING);
  });

  it('stops displaying the indication when the call resolves', async () => {
    vi.useFakeTimers();
    const rendered = renderPanel();

    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATION_DELAY_MS);
    });
    expect(loadingIndication()).not.toBeNull();

    await rendered.resolveList(notifications(1));

    expect(loadingIndication()).toBeNull();
  });

  it('displays a retained failure message alongside the indication', async () => {
    vi.useFakeTimers();
    const rendered = renderPanel();

    // A first call fails, leaving the message and the retry control displayed.
    await rendered.failList();
    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);
    expect(loadingIndication()).toBeNull();

    // The retry issues a second call, which is left in flight.
    act(() => {
      screen.getByRole('button', { name: NOTIFICATION_RETRY_LABEL }).click();
    });
    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATION_DELAY_MS);
    });

    // 5.8: both are displayed until the awaited call resolves.
    expect(loadingIndication()).toHaveTextContent(NOTIFICATIONS_LOADING);
    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);

    await rendered.resolveList([]);

    expect(loadingIndication()).toBeNull();
    expect(failureMessage()).toBeNull();
  });
});

describe('NotificationPanel retry control (Requirement 5.9)', () => {
  it('is presented only while a call has failed', async () => {
    const rendered = renderPanel(2);
    await flush();

    // Nothing has failed yet, so there is nothing to retry.
    expect(screen.queryByRole('button', { name: NOTIFICATION_RETRY_LABEL })).toBeNull();

    await rendered.failList();
    const retry = screen.getByRole('button', { name: NOTIFICATION_RETRY_LABEL });
    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);

    // A retry that succeeds clears the message and the control with it.
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    await rendered.resolveList(notifications(2));

    expect(rows()).toHaveLength(2);
    expect(failureMessage()).toBeNull();
    expect(screen.queryByRole('button', { name: NOTIFICATION_RETRY_LABEL })).toBeNull();
  });

  it('issues exactly one further list call per activation', async () => {
    const rendered = renderPanel();

    await rendered.failList();
    expect(rendered.transport.listCalls).toHaveLength(1);

    const retry = screen.getByRole('button', { name: NOTIFICATION_RETRY_LABEL });

    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    expect(rendered.transport.listCalls).toHaveLength(2);

    // 5.9: available for any number of activations. This second one follows a
    // second failure, so no call is awaiting a response.
    await rendered.failList();
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    expect(rendered.transport.listCalls).toHaveLength(3);
  });

  it('issues no further call while a call is awaiting a response', async () => {
    const rendered = renderPanel();

    await rendered.failList();

    const retry = screen.getByRole('button', { name: NOTIFICATION_RETRY_LABEL });
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    expect(rendered.transport.listCalls).toHaveLength(2);

    // The second call is still in flight, so these change nothing.
    await act(async () => {
      retry.click();
      retry.click();
      await Promise.resolve();
    });

    expect(rendered.transport.listCalls).toHaveLength(2);
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    // Still focusable, so the person who activated it keeps their focus position.
    expect(retry).not.toBeDisabled();
  });

  it('issues no automatic retry of its own', async () => {
    vi.useFakeTimers();
    const rendered = renderPanel();

    await rendered.failList();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(rendered.transport.listCalls).toHaveLength(1);
  });
});

describe('NotificationPanel mark-all-read control (Requirements 6.4, 6.8, 6.9)', () => {
  it('is disabled while the count is 0 and every displayed record is read', async () => {
    const rendered = renderPanel(0);

    await rendered.resolveList(notifications(2, 'read'));

    expect(markAllControl()).toBeDisabled();
  });

  it('is available while the count is 1 or greater', async () => {
    const rendered = renderPanel(1);

    await rendered.resolveList(notifications(2, 'read'));

    // 6.9: unread records absent from the displayed list stay markable.
    expect(markAllControl()).toBeEnabled();
  });

  it('calls the mark-all-read endpoint and leaves the display unchanged until it resolves', async () => {
    const rendered = renderPanel(2);
    await rendered.resolveList(notifications(2));

    await act(async () => {
      markAllControl().click();
      await Promise.resolve();
    });

    // 6.4: the call is issued and nothing displayed has changed yet.
    expect(rendered.transport.markAllCalls).toHaveLength(1);
    expect(rows().every((row) => row.dataset.unread === 'true')).toBe(true);

    // 6.8: progress is reported on the control itself, in words.
    const control = markAllControl();
    expect(control).toHaveTextContent(MARK_ALL_READ_IN_PROGRESS);
    expect(control).toHaveAttribute('aria-busy', 'true');
    expect(control).toHaveAttribute('aria-disabled', 'true');

    await rendered.resolveMarkAll();

    expect(rows().every((row) => row.dataset.unread === 'false')).toBe(true);
    expect(markAllControl()).toHaveTextContent(MARK_ALL_READ_LABEL);
  });

  it('prevents a second concurrent activation', async () => {
    const rendered = renderPanel(2);
    await rendered.resolveList(notifications(2));

    await act(async () => {
      markAllControl().click();
      markAllControl().click();
      markAllControl().click();
      await Promise.resolve();
    });

    expect(rendered.transport.markAllCalls).toHaveLength(1);
  });
});

describe('NotificationPanel implicit marking (Requirement 6.12)', () => {
  it('issues no mark-read call for records it merely renders', async () => {
    const rendered = renderPanel(3);

    await rendered.resolveList(notifications(3));

    expect(rows()).toHaveLength(3);
    expect(rendered.transport.markReadCalls).toEqual([]);
  });

  it('issues one mark-read call for an activated record', async () => {
    const rendered = renderPanel(3);
    await rendered.resolveList(notifications(3));

    const first = rows()[0];
    await act(async () => {
      first.click();
      await Promise.resolve();
    });

    expect(rendered.transport.markReadCalls).toEqual([first.dataset.notificationId]);
    expect(panel()).toBeInTheDocument();
  });
});
