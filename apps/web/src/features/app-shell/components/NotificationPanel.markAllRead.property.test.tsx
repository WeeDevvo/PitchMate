/**
 * Property test for mark-all-read (task 11.4).
 *
 * **Property 14: Mark-all-read clears the count and enables only while something
 * is unread.** *For any* notification list with any unread count, applying the
 * mark-all-read transition yields an unread count of 0 and a list in which every
 * record's read state is `read`, irrespective of the count value the backend
 * returned; and *for any* pair of displayed list and displayed count, the
 * mark-all-read control is rendered disabled exactly when the count is 0 and
 * every displayed record is read, and available for activation whenever the count
 * is 1 or greater.
 *
 * That is Requirement 6.5 — "SHALL set the displayed Read_State of every displayed
 * Notification_Record to `read` and SHALL set the displayed Unread_Count to 0 …
 * irrespective of the count value returned by that endpoint" — Requirement 14.6's
 * statement of the same invariant over the pure transition, and Requirement 6.9's
 * disabled rule: "WHILE the displayed Unread_Count is 0 and every displayed
 * Notification_Record has a Read_State of `read` … a disabled state, and WHILE the
 * displayed Unread_Count is 1 or greater … available for activation".
 *
 * ### Why the property is asserted in two places
 *
 * The invariant has a pure half and a rendered half, and the requirements put them
 * in different modules on purpose. Requirement 14.6 asks for the count-to-0 rule as
 * a property of `applyMarkAllRead`, so the first block below calls that function
 * directly — `lib/readStateTransitions.property.test.ts` carries Property 13 and
 * deliberately leaves this invariant here, asserting only that a repeated
 * application is a no-op. Requirements 6.5 and 6.9 are about what a person sees, so
 * the remaining blocks drive the real Notification_Panel over the real state
 * machine and read the rendered control and rows.
 *
 * ### The displayed count is read through the same context the shell reads
 *
 * The panel renders no count — the Unread_Badge lives on the
 * Notification_Indicator — so a probe component beside the panel reads
 * `unreadCount` from {@link useNotificationCentreContext}, which is the identical
 * value the indicator formats. That keeps this file about mark-all-read rather than
 * about badge formatting, which is Property 15's subject.
 *
 * ### Expectations are re-derived, not read off the implementation
 *
 * The disabled expectation is computed here from the criterion's own words —
 * `count === 0 && every displayed record is read` — over the generated pair, not
 * from `centre.markAllReadDisabled`, so a change to the derivation cannot drag the
 * expectation along with it. Generated lists stay at or below the panel's preview
 * cap of 10 so that "every displayed record" is unambiguous: with a longer list the
 * panel displays the leading 10 while the criterion's count covers the whole
 * Squad_Scope, and the two readings of "displayed" would diverge.
 *
 * The count the mark-all-read endpoint returns is generated adversarially — a large
 * count, a negative one, a fraction, `NaN` — because Requirement 6.5's "irrespective
 * of the count value returned" is exactly the case where trusting the response
 * would leave a non-zero count behind after a successful mark-all-read.
 *
 * Named examples of the same behaviour (one disabled case, one enabled case, the
 * progress indication, the second-activation refusal) live in
 * `NotificationPanel.test.tsx`; this file is the generator-driven property at well
 * above the 100-iteration floor Requirement 14.2 sets.
 *
 * Feature: app-shell, Property 14: Mark-all-read clears the count and enables only while something is unread
 * Validates: Requirements 6.5, 6.9, 14.6
 */
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fc from 'fast-check';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from '../api/notificationsApi';
import {
  MARK_ALL_READ_IN_PROGRESS,
  MARK_ALL_READ_LABEL,
} from '../lib/messages';
import { NOTIFICATION_PANEL_PREVIEW_CAP } from '../lib/notificationOrdering';
import type {
  NotificationRecord,
  NotificationType,
  ReadState,
} from '../lib/notificationParsing';
import {
  applyMarkAllRead,
  type ReadStateView,
} from '../lib/readStateTransitions';
import {
  NotificationCentreProvider,
  useNotificationCentreContext,
} from '../state/NotificationCentreContext';
import { SquadScopeProvider } from '../state/SquadScopeContext';
import { NotificationPanel } from './NotificationPanel';

/** The largest Unread_Count an accepted count response can carry (`int32` max). */
const MAX_COUNT = 2_147_483_647;

/** The creation instant the generated records are spaced back from. */
const CREATED_AT_MS = Date.UTC(2025, 2, 12, 18, 0, 0);

/** Five minutes on, so every relative time label lands in the minutes band. */
const NOW_MS = CREATED_AT_MS + 5 * 60_000;

// --- Expectations read from the acceptance criteria ---------------------------

/**
 * Requirement 6.9's condition for the disabled state, in the criterion's own
 * terms: the displayed Unread_Count is 0 *and* every displayed
 * Notification_Record has a Read_State of `read`.
 */
function shouldBeDisabled(
  records: readonly NotificationRecord[],
  unreadCount: number,
): boolean {
  return (
    unreadCount === 0 && records.every((record) => record.readState === 'read')
  );
}

// --- Generators ---------------------------------------------------------------

const readStateArb: fc.Arbitrary<ReadState> = fc.constantFrom(
  'unread' as const,
  'read' as const,
);

const typeArb: fc.Arbitrary<NotificationType> = fc.oneof(
  fc
    .constantFrom(
      'member-joined' as const,
      'match-drafted' as const,
      'match-confirmed' as const,
      'teams-rolled' as const,
      'result-posted' as const,
    )
    .map((value) => ({ kind: 'catalogued', value }) as const),
  fc
    .integer({ min: 8, max: 64 })
    .map((code) => ({ kind: 'unrecognised', code }) as const),
);

/** The per-record values that vary; identity and instant come from the position. */
const recordDraftArb: fc.Arbitrary<{
  readonly readState: ReadState;
  readonly type: NotificationType;
  readonly body: string;
}> = fc.record({
  readState: readStateArb,
  type: typeArb,
  body: fc.string({ minLength: 0, maxLength: 24 }),
});

/**
 * A displayed Notification_List of at most the panel's preview cap, so that "every
 * displayed record" means the same thing to the criterion and to the panel: with a
 * longer list the panel displays the leading 10 while the count covers the whole
 * Squad_Scope.
 *
 * Identities are distinct and the creation instants strictly descending, so the
 * ordering the machine applies is decided by the instants rather than left to
 * tie-breaking.
 *
 * The all-read and all-unread shapes are drawn deliberately rather than left to
 * chance: an all-read list is one half of Requirement 6.9's disabled condition, and
 * an all-unread list is the ordinary case Requirement 6.5 acts on.
 */
const recordsArb: fc.Arbitrary<NotificationRecord[]> = fc
  .tuple(
    fc.array(recordDraftArb, {
      minLength: 0,
      maxLength: NOTIFICATION_PANEL_PREVIEW_CAP,
    }),
    fc.constantFrom('mixed' as const, 'all-read' as const, 'all-unread' as const),
  )
  .map(([drafts, shape]) =>
    drafts.map((draft, index): NotificationRecord => {
      const position = index + 1;

      return {
        notificationId: `0000000${position % 10}-1111-4111-8111-${String(
          position,
        ).padStart(12, '0')}`,
        type: draft.type,
        squadId: '22222222-2222-4222-8222-222222222222',
        title: `Notification ${position}`,
        body: draft.body,
        createdAtMs: CREATED_AT_MS - position * 1_000,
        readState:
          shape === 'mixed'
            ? draft.readState
            : shape === 'all-read'
              ? 'read'
              : 'unread',
      };
    }),
  );

/**
 * A displayed Unread_Count. The named values are the boundaries the criteria speak
 * about — 0 is the disabled condition's half, 1 is the "available for activation"
 * threshold — and the count is deliberately allowed to disagree with the displayed
 * list, since it covers the whole Squad_Scope while the list is capped.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(0, 1, 2, 99, 100, MAX_COUNT) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 20 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: MAX_COUNT }) },
);

/**
 * A count the mark-all-read endpoint might answer with, including values no
 * accepted response should carry: Requirement 6.5 holds irrespective of it.
 */
const returnedCountArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(0, 1, 7, 99, 100, MAX_COUNT) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(-1, -MAX_COUNT, 0.5, 5.5, Number.NaN),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: MAX_COUNT }) },
);

// --- Test doubles -------------------------------------------------------------

/** A promise this test settles by hand, so a call can be left in flight. */
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
 * How many microtask turns each settling drains. A settled call runs through the
 * facade's promise, the machine's settle path, and React's update, so one turn is
 * not enough; draining an already-empty queue costs nothing.
 */
const MICROTASK_ROUNDS = 16;

async function drain(): Promise<void> {
  for (let round = 0; round < MICROTASK_ROUNDS; round += 1) {
    await Promise.resolve();
  }
}

/** Let every resolved promise deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    await drain();
  });
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

/**
 * A Notifications_Api that answers the list and unread-count calls at once with
 * the generated pair, and leaves every mark-all-read call in flight until this
 * test settles it — the pessimistic half of Requirement 6.4 is only observable
 * while the call is unanswered.
 */
function stubTransport(
  records: readonly NotificationRecord[],
  count: number,
): {
  readonly api: NotificationsApi;
  readonly markAllCalls: Deferred<CountCallOutcome>[];
} {
  const markAllCalls: Deferred<CountCallOutcome>[] = [];

  const api: NotificationsApi = {
    list: () =>
      Promise.resolve<NotificationCallOutcome>({
        kind: 'success',
        value: records.map((record) => ({ ...record })),
      }),
    unreadCount: () =>
      Promise.resolve<CountCallOutcome>({ kind: 'success', value: count }),
    markRead: () =>
      Promise.resolve<AcknowledgementOutcome>({
        kind: 'success',
        value: undefined,
      }),
    markAllRead: () => {
      const call = deferred<CountCallOutcome>();
      markAllCalls.push(call);
      return call.promise;
    },
  };

  return { api, markAllCalls };
}

/**
 * Reports the displayed Unread_Count — the same value the Notification_Indicator
 * formats into the Unread_Badge — so this file can assert Requirement 6.5's "SHALL
 * set the displayed Unread_Count to 0" without depending on badge formatting.
 */
function UnreadCountProbe(): ReactElement {
  const { unreadCount } = useNotificationCentreContext();

  return <span data-testid="displayed-unread-count">{String(unreadCount)}</span>;
}

// --- Rendering ----------------------------------------------------------------

interface PanelHarness {
  /** How many mark-all-read calls have been issued. */
  markAllCallCount(): number;
  /** The Mark_All_Read_Control. */
  control(): HTMLButtonElement;
  /** The displayed Notification_Rows, in display order. */
  rows(): HTMLElement[];
  /** The displayed Unread_Count. */
  displayedCount(): number;
  /** Activate the Mark_All_Read_Control. */
  activate(): Promise<void>;
  /** Settle the newest mark-all-read call as a success carrying `returned`. */
  succeed(returned: number): Promise<void>;
}

/**
 * Mount the real Notification_Panel over the real state machine with the generated
 * list and count already displayed.
 */
async function renderPanel(
  records: readonly NotificationRecord[],
  count: number,
): Promise<PanelHarness> {
  const transport = stubTransport(records, count);

  render(
    <MemoryRouter>
      <AuthProvider manager={authenticatedSessionManager()}>
        <SquadScopeProvider>
          <NotificationCentreProvider
            api={transport.api}
            signOut={vi.fn()}
            now={() => NOW_MS}
          >
            <NotificationPanel />
            <UnreadCountProbe />
          </NotificationCentreProvider>
        </SquadScopeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );

  // The mount count call, the opening's count call, and the opening's list call
  // all settle immediately, so the generated pair is displayed from here on.
  await flush();

  const control = (): HTMLButtonElement =>
    screen.getByRole('button', {
      name: new RegExp(`${MARK_ALL_READ_LABEL}|${MARK_ALL_READ_IN_PROGRESS}`),
    }) as HTMLButtonElement;

  return {
    markAllCallCount: () => transport.markAllCalls.length,
    control,
    rows: () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.shell-notification-row'),
      ),
    displayedCount: () =>
      Number(screen.getByTestId('displayed-unread-count').textContent),
    activate: async () => {
      await act(async () => {
        control().click();
        await drain();
      });
    },
    succeed: async (returned) => {
      const call = transport.markAllCalls.at(-1);
      if (call === undefined) {
        throw new Error('No mark-all-read call has been issued.');
      }
      await act(async () => {
        call.resolve({ kind: 'success', value: returned });
        await drain();
      });
    },
  };
}

// --- The property -------------------------------------------------------------

// Feature: app-shell, Property 14: Mark-all-read clears the count and enables only
// while something is unread
// Validates: Requirement 14.6
describe('applyMarkAllRead — the count reaches 0 and every record becomes read', () => {
  it('yields a count of 0 and a fully read list for any list and any count', () => {
    fc.assert(
      fc.property(recordsArb, countArb, (records, unreadCount) => {
        const result = applyMarkAllRead({ records, unreadCount });

        // Requirement 14.6's invariant, stated as the criterion states it.
        expect(result.unreadCount).toBe(0);
        expect(result.records.every((record) => record.readState === 'read')).toBe(
          true,
        );
        expect(result.records).toHaveLength(records.length);
      }),
      { numRuns: 500 },
    );
  });

  it('reaches that result irrespective of the count the endpoint returned', () => {
    fc.assert(
      fc.property(
        recordsArb,
        countArb,
        returnedCountArb,
        (records, unreadCount, returned) => {
          const before: ReadStateView = { records, unreadCount };
          const asIfTrusted: ReadStateView = { records, unreadCount: returned };

          // Requirement 6.5: the count the endpoint answered with cannot change
          // where the transition lands — which is why the shell does not subtract
          // it. The displayed list is a capped window on the Squad_Scope, so
          // subtracting would leave a non-zero count behind.
          expect(applyMarkAllRead(before).unreadCount).toBe(0);
          expect(applyMarkAllRead(asIfTrusted).unreadCount).toBe(0);
          expect(applyMarkAllRead(asIfTrusted).records).toEqual(
            applyMarkAllRead(before).records,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: app-shell, Property 14: Mark-all-read clears the count and enables only
// while something is unread
// Validates: Requirement 6.5
describe('NotificationPanel mark-all-read clears the displayed count', () => {
  it('displays every record as read and a count of 0 after a successful call, whatever count it returned', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb,
        countArb,
        returnedCountArb,
        async (records, unreadCount, returned) => {
          try {
            const panel = await renderPanel(records, unreadCount);

            // Nothing to activate when the criterion says the control is disabled;
            // that case is the next block's subject.
            fc.pre(!shouldBeDisabled(records, unreadCount));

            await panel.activate();
            expect(panel.markAllCallCount()).toBe(1);

            // 6.4: pessimistic — the displayed values stand until the call
            // resolves, so the change asserted below is the response's doing.
            expect(panel.displayedCount()).toBe(unreadCount);

            await panel.succeed(returned);

            // 6.5: every displayed Read_State is `read` and the displayed count is
            // 0, irrespective of the returned count.
            expect(panel.displayedCount()).toBe(0);
            expect(
              panel.rows().every((row) => row.dataset.unread === 'false'),
            ).toBe(true);
            expect(panel.rows()).toHaveLength(records.length);

            // The operation is over, so the progress indication is gone.
            expect(panel.control()).toHaveTextContent(MARK_ALL_READ_LABEL);
            expect(panel.control()).not.toHaveAttribute('aria-busy');
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaves the control disabled once the count is 0 and every displayed record is read', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb,
        countArb,
        returnedCountArb,
        async (records, unreadCount, returned) => {
          try {
            const panel = await renderPanel(records, unreadCount);

            fc.pre(!shouldBeDisabled(records, unreadCount));

            await panel.activate();
            await panel.succeed(returned);

            // 6.9 read against the state 6.5 just produced: nothing displayed is
            // unread and the count is 0, so there is nothing left to mark.
            expect(panel.control()).toBeDisabled();
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: app-shell, Property 14: Mark-all-read clears the count and enables only
// while something is unread
// Validates: Requirement 6.9
describe('NotificationPanel mark-all-read control availability', () => {
  it('is disabled exactly when the count is 0 and every displayed record is read', async () => {
    await fc.assert(
      fc.asyncProperty(recordsArb, countArb, async (records, unreadCount) => {
        try {
          const panel = await renderPanel(records, unreadCount);

          // The expectation comes from Requirement 6.9's own words over the
          // generated pair, not from the machine's derivation.
          expect(panel.control().disabled).toBe(
            shouldBeDisabled(records, unreadCount),
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('is available for activation whenever the count is 1 or greater, however many displayed records are read', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb,
        fc.oneof(
          fc.constantFrom(1, 2, 99, 100, MAX_COUNT),
          fc.integer({ min: 1, max: MAX_COUNT }),
        ),
        async (records, unreadCount) => {
          try {
            const panel = await renderPanel(records, unreadCount);

            // 6.9: unread Notification_Records within the Squad_Scope that the
            // capped list does not display remain markable, so an all-read display
            // with a count of 1 or more must still offer the control.
            expect(panel.control()).toBeEnabled();

            await panel.activate();

            // 6.4: exactly one call per activation.
            expect(panel.markAllCallCount()).toBe(1);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('issues no call from an activation while it is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb.map((records) =>
          records.map((record) => ({ ...record, readState: 'read' as const })),
        ),
        async (records) => {
          try {
            const panel = await renderPanel(records, 0);

            expect(panel.control()).toBeDisabled();

            await panel.activate();

            // A disabled control is not a styled one: there is nothing to mark, so
            // no backend call goes out.
            expect(panel.markAllCallCount()).toBe(0);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
