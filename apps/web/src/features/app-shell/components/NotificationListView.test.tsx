/**
 * Unit tests for the Notifications_Destination's content.
 *
 * These cover what this surface decides, which is deliberately little — the
 * ordering, the cap, and the call discipline belong to the state machine and to
 * `lib/notificationOrdering.ts`, each tested beside its own module:
 *
 *   - the single level-one heading carrying the Destination's registered label,
 *     which is what makes `/app/notifications` reachable without an injected
 *     component (Requirements 3.9, 13.2),
 *   - every record of the ordered Notification_List rather than the panel's
 *     leading 10, up to the Notification_List_Cap of 200, newest first
 *     (Requirements 5.4, 5.12),
 *   - the "no notifications" statement for a call that *returned* nothing, and the
 *     fixed failure message — never the empty statement — for one that failed
 *     (Requirements 5.7, 7.7), and
 *   - one list call on arriving with nothing loaded, none when a list is already
 *     loaded, and none from a re-render (Requirements 4.7, 11.11).
 *
 * The surface is wired to the *real* notification state machine over a stub
 * transport whose list call is settled by hand, because what it displays is a
 * consequence of when that call settles and with what.
 *
 * Feature: app-shell
 * Requirements: 3.9, 5.4, 5.7, 5.12
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from '../api/notificationsApi';
import { destinationLabel } from '../lib/destinations';
import { GENERIC_NOTIFICATION_FAILURE, NO_NOTIFICATIONS } from '../lib/messages';
import { NOTIFICATION_LIST_CAP } from '../lib/notificationOrdering';
import type { NotificationRecord } from '../lib/notificationParsing';
import { NotificationCentreProvider } from '../state/NotificationCentreContext';
import { SquadScopeProvider } from '../state/SquadScopeContext';
import { NotificationListView } from './NotificationListView';

/** The creation instant the records below are spaced back from: 12 March 2025. */
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

interface StubTransport {
  readonly api: NotificationsApi;
  /** One entry per list call issued, newest last, each settled by the test. */
  readonly listCalls: Deferred<NotificationCallOutcome>[];
  /** The identities passed to the mark-read endpoint, in call order. */
  readonly markReadCalls: string[];
}

/**
 * A Notifications_Api whose list call stays in flight until the test settles it,
 * and whose unread-count call answers 0 at once.
 */
function stubTransport(): StubTransport {
  const listCalls: Deferred<NotificationCallOutcome>[] = [];
  const markReadCalls: string[] = [];

  const api: NotificationsApi = {
    list: () => {
      const call = deferred<NotificationCallOutcome>();
      listCalls.push(call);
      return call.promise;
    },
    unreadCount: () => Promise.resolve<CountCallOutcome>({ kind: 'success', value: 0 }),
    markRead: ({ notificationId }) => {
      markReadCalls.push(notificationId);
      return Promise.resolve<AcknowledgementOutcome>({
        kind: 'success',
        value: undefined,
      });
    },
    markAllRead: () => Promise.resolve<CountCallOutcome>({ kind: 'success', value: 0 }),
  };

  return { api, listCalls, markReadCalls };
}

/**
 * A well-formed Notification_Record. Index 1 is the newest, so the supplied order
 * and the ordered order coincide and a wrong order is visible in the rendering.
 */
function notification(index: number): NotificationRecord {
  const identity = `0000000${String(index).padStart(4, '0')}`;

  return {
    notificationId: `${identity}-1111-4111-8111-111111111111`,
    type: { kind: 'catalogued', value: 'match-confirmed' },
    squadId: '22222222-2222-4222-8222-222222222222',
    title: `Notification ${index}`,
    body: `Body ${index}`,
    createdAtMs: CREATED_AT_MS - index * 1_000,
    readState: 'unread',
  };
}

/** `count` records, newest first. */
function notifications(count: number): NotificationRecord[] {
  return Array.from({ length: count }, (_, index) => notification(index + 1));
}

// --- Rendering --------------------------------------------------------------

interface Rendered {
  readonly transport: StubTransport;
  /** Settle the newest list call as a success carrying `records`. */
  resolveList(records: readonly NotificationRecord[]): Promise<void>;
  /** Settle the newest list call as a failure. */
  failList(): Promise<void>;
  /** Re-render the destination without remounting it. */
  rerender(): void;
}

function renderDestination(): Rendered {
  const transport = stubTransport();

  const tree = (
    <AuthProvider manager={authenticatedSessionManager()}>
      <SquadScopeProvider>
        <NotificationCentreProvider
          api={transport.api}
          signOut={vi.fn()}
          now={() => NOW_MS}
        >
          <NotificationListView />
        </NotificationCentreProvider>
      </SquadScopeProvider>
    </AuthProvider>
  );

  const rendered = render(tree);

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
    rerender: () => rendered.rerender(tree),
  };
}

/** Flush the microtasks the unread-count call settles in. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.shell-notification-row'),
  );
}

function failureMessage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-shell-notification-list-failure]');
}

// --- Tests ------------------------------------------------------------------

describe('NotificationListView heading (Requirements 3.9, 13.2)', () => {
  it('contributes exactly one level-one heading carrying the destination label', async () => {
    renderDestination();
    await flush();

    const headings = screen.getAllByRole('heading', { level: 1 });

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(destinationLabel('notifications'));
  });
});

describe('NotificationListView records (Requirements 5.4, 5.12)', () => {
  it('displays every returned record, not the panel preview', async () => {
    const rendered = renderDestination();

    // More than the panel's preview of 10, so a preview slice would be visible.
    await rendered.resolveList(notifications(12));

    expect(rows()).toHaveLength(12);
    expect(screen.getByText('Notification 11')).toBeInTheDocument();
    expect(screen.getByText('Notification 12')).toBeInTheDocument();
  });

  it('displays the records newest first', async () => {
    const rendered = renderDestination();

    // Supplied oldest first; the ordering is by creation instant descending, so
    // the rendering must invert what was returned.
    await rendered.resolveList([...notifications(3)].reverse());

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Notification 1'),
      expect.stringContaining('Notification 2'),
      expect.stringContaining('Notification 3'),
    ]);
  });

  it('displays at most the Notification_List_Cap of 200 records', async () => {
    const rendered = renderDestination();

    await rendered.resolveList(notifications(NOTIFICATION_LIST_CAP + 50));

    expect(rows()).toHaveLength(NOTIFICATION_LIST_CAP);
    // The kept records are the newest 200; the oldest 50 are discarded, and no
    // error indication is displayed for the discarding.
    expect(screen.getByText(`Notification ${NOTIFICATION_LIST_CAP}`)).toBeInTheDocument();
    expect(screen.queryByText(`Notification ${NOTIFICATION_LIST_CAP + 1}`)).toBeNull();
    expect(screen.queryByText(`Notification ${NOTIFICATION_LIST_CAP + 50}`)).toBeNull();
    expect(failureMessage()).toBeNull();
  });

  it('marks a record read when a person activates its control', async () => {
    const rendered = renderDestination();
    await rendered.resolveList(notifications(2));

    await userEvent.click(rows()[0]);

    expect(rendered.transport.markReadCalls).toEqual([
      notification(1).notificationId,
    ]);
  });
});

describe('NotificationListView empty and failed listings (Requirements 5.7, 7.7)', () => {
  it('states that there are no notifications when the call returns none', async () => {
    const rendered = renderDestination();

    await rendered.resolveList([]);

    expect(screen.getByText(NO_NOTIFICATIONS)).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(failureMessage()).toBeNull();
  });

  it('displays the fixed failure message and no empty statement when the call fails', async () => {
    const rendered = renderDestination();

    await rendered.failList();

    expect(failureMessage()).toHaveTextContent(GENERIC_NOTIFICATION_FAILURE);
    expect(screen.queryByText(NO_NOTIFICATIONS)).toBeNull();
  });
});

describe('NotificationListView list calls (Requirements 4.7, 11.11)', () => {
  it('issues exactly one list call on arriving, and none from a re-render', async () => {
    const rendered = renderDestination();
    await flush();

    expect(rendered.transport.listCalls).toHaveLength(1);

    rendered.rerender();
    await flush();

    expect(rendered.transport.listCalls).toHaveLength(1);
  });

  it('issues no further list call once a listing has been displayed', async () => {
    const rendered = renderDestination();

    await rendered.resolveList(notifications(2));
    rendered.rerender();
    await flush();

    expect(rendered.transport.listCalls).toHaveLength(1);
  });

  it('issues no further list call after a failed one while it stays mounted', async () => {
    const rendered = renderDestination();

    await rendered.failList();
    rendered.rerender();
    await flush();

    // 11.11: nothing retries itself; a further call comes from an activation.
    expect(rendered.transport.listCalls).toHaveLength(1);
  });
});
