/**
 * Unit tests for the Notification_Indicator.
 *
 * These cover what this component itself decides:
 *
 *   - the Unread_Badge at every band boundary — 0, 1, 99, 100, and the largest
 *     count the parser accepts, 2,147,483,647 (Requirements 4.2, 4.3, 4.4),
 *   - the accessible name reporting that same count in each band, so the count is
 *     never carried by the badge alone (Requirement 4.5),
 *   - the control being available for activation before any Unread_Count has been
 *     accepted (Requirement 4.12),
 *   - the three trigger props from `Disclosure` reaching the `<button>`, so the
 *     indicator works as the Notification_Panel's trigger, and
 *   - the name stating that the count covers one squad while a Squad_Scope is
 *     active, and not stating it otherwise (Requirement 7.6).
 *
 * The count reaches the component through the *real* notification state machine
 * over a stub Notifications_Api, rather than being poked into the component as a
 * prop: the frame runs one machine and the indicator reads it, so wiring the two
 * together is part of what these tests are for. The stub answers immediately —
 * these tests are about what is rendered for a count, not about when calls are
 * issued, which `state/useNotificationCentre.*` already covers.
 *
 * The badge and name *formatting* is exhaustively covered by Property 15 over
 * `lib/unreadBadge.ts`; the expected strings here are written out in full so this
 * suite pins the wiring against stated text rather than against the same
 * functions the component calls.
 *
 * Feature: app-shell
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.12, 7.6
 */
import { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from '../api/notificationsApi';
import { NotificationCentreProvider } from '../state/NotificationCentreContext';
import { SquadScopeProvider } from '../state/SquadScopeContext';
import { useDisclosureGroup } from '../state/useDisclosureGroup';
import { Disclosure } from './Disclosure';
import { NotificationIndicator } from './NotificationIndicator';

/** The surface id the Shell_Header supplies for the notification disclosure. */
const SURFACE_ID = 'shell-notification-panel';

/** A well-formed squad identity, so the Squad_Scope normaliser admits it. */
const SQUAD_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** The largest Unread_Count an accepted unread-count response can carry. */
const MAX_COUNT = 2_147_483_647;

/** Stands in for the Notification_Panel, which lands in task 11.3. */
const PANEL_TEXT = 'Panel contents';

/**
 * A minimal authenticated {@link SessionManager}.
 *
 * `AuthProvider` reads only `getState()` and `subscribe()`, and nothing under
 * test performs a session transition, so the remaining members are inert. It
 * reports `authenticated`, which is the only state in which the notification
 * centre runs at all.
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
 * A Notifications_Api that answers the unread-count call with `count`, or never
 * answers it at all when `count` is `'pending'` — which is the state Requirement
 * 4.12 is about: the frame is rendered and no count has been accepted yet.
 */
function stubNotificationsApi(count: number | 'pending'): NotificationsApi {
  const answerCount = (): Promise<CountCallOutcome> =>
    count === 'pending'
      ? new Promise<CountCallOutcome>(() => {})
      : Promise.resolve<CountCallOutcome>({ kind: 'success', value: count });

  return {
    list: () =>
      Promise.resolve<NotificationCallOutcome>({ kind: 'success', value: [] }),
    unreadCount: answerCount,
    markRead: () =>
      Promise.resolve<AcknowledgementOutcome>({
        kind: 'success',
        value: undefined,
      }),
    markAllRead: answerCount,
  };
}

/**
 * Wires the indicator the way the Shell_Header's notification slot does: the open
 * state lives in the frame's disclosure group, and the indicator is the trigger
 * of the surface holding the Notification_Panel.
 */
function Harness(): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <Disclosure
      id={SURFACE_ID}
      open={open === 'notifications'}
      onRequestOpen={() => toggle('notifications')}
      onRequestClose={() => close('notifications')}
      trigger={(triggerProps) => <NotificationIndicator {...triggerProps} />}
    >
      <p>{PANEL_TEXT}</p>
    </Disclosure>
  );
}

interface RenderOptions {
  /** The Unread_Count the stub transport reports, or `'pending'` for none yet. */
  readonly count?: number | 'pending';
  /** A `squadId` route parameter, making that squad the active Squad_Scope. */
  readonly squadId?: string;
}

/** Render the indicator beneath the real auth, scope, and notification providers. */
function renderIndicator({ count = 0, squadId }: RenderOptions = {}): void {
  const providers = (children: ReactNode): ReactElement => (
    <AuthProvider manager={authenticatedSessionManager()}>
      <SquadScopeProvider>
        <NotificationCentreProvider
          api={stubNotificationsApi(count)}
          signOut={vi.fn()}
        >
          {children}
        </NotificationCentreProvider>
      </SquadScopeProvider>
    </AuthProvider>
  );

  if (squadId === undefined) {
    render(<MemoryRouter>{providers(<Harness />)}</MemoryRouter>);
    return;
  }

  // 7.6: the Squad_Scope arrives from the route, never from a control the frame
  // renders, so it is supplied here exactly as a scoped shell route would.
  render(
    <MemoryRouter initialEntries={[`/app/squads/${squadId}`]}>
      <Routes>
        <Route path="/app/squads/:squadId" element={providers(<Harness />)} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The Unread_Badge element, or `null` where no badge is rendered. */
function badge(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-unread-badge]');
}

/** The indicator, found by the accessible name it is expected to carry. */
function indicator(name: string): Promise<HTMLElement> {
  return screen.findByRole('button', { name });
}

/** Each band boundary of Requirements 4.2, 4.3, 4.4, with the name for it (4.5). */
const BANDS = [
  { count: 0, badgeText: null, name: 'Notifications, no unread notifications' },
  { count: 1, badgeText: '1', name: 'Notifications, 1 unread' },
  { count: 99, badgeText: '99', name: 'Notifications, 99 unread' },
  { count: 100, badgeText: '99+', name: 'Notifications, 99+ unread' },
  { count: MAX_COUNT, badgeText: '99+', name: 'Notifications, 99+ unread' },
] as const;

describe('NotificationIndicator badge and accessible name', () => {
  // Requirements 4.2, 4.3, 4.4 — the badge at each band boundary, and no badge
  // element at all for a count of 0. Requirement 4.5 — the accessible name
  // reports the same count, so the badge is never its only carrier.
  for (const band of BANDS) {
    it(`reports an unread count of ${band.count} on the badge and in the name`, async () => {
      renderIndicator({ count: band.count });

      const control = await indicator(band.name);

      expect(control).toBeInTheDocument();
      if (band.badgeText === null) {
        expect(badge()).toBeNull();
      } else {
        expect(badge()).toHaveTextContent(band.badgeText);
        // The count is inside the control, not beside it.
        expect(control).toContainElement(badge());
      }
    });
  }

  // Requirement 4.5 — the badge does not also reach the accessible name, so a
  // count of 3 is announced once rather than as "3 unread, 3".
  it('does not announce the badge text a second time', async () => {
    renderIndicator({ count: 3 });

    const control = await indicator('Notifications, 3 unread');

    expect(badge()).toHaveAttribute('aria-hidden', 'true');
    // The visible word is the opening of the accessible name (WCAG 2.5.3).
    expect(control).toHaveTextContent('Notifications');
  });
});

describe('NotificationIndicator before the first accepted count', () => {
  // Requirement 4.12 — no count accepted yet: no badge, a name saying nothing is
  // unread, and a control that is available for activation.
  it('renders without a badge and available for activation', async () => {
    renderIndicator({ count: 'pending' });

    const control = await indicator('Notifications, no unread notifications');

    expect(control).toBeEnabled();
    expect(control).not.toHaveAttribute('aria-disabled');
    expect(badge()).toBeNull();
  });

  // Requirement 4.12 — the Notification_Panel is operable before the first
  // accepted Unread_Count value arrives.
  it('opens the notification panel while no count has been accepted', async () => {
    const user = userEvent.setup();
    renderIndicator({ count: 'pending' });

    const control = await indicator('Notifications, no unread notifications');
    await user.click(control);

    expect(control).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(PANEL_TEXT)).toBeInTheDocument();
  });
});

describe('NotificationIndicator as a disclosure trigger', () => {
  // The three props `Disclosure` supplies all reach the button, so the panel's
  // state is reported programmatically and the trigger names its surface.
  it('spreads the disclosure trigger props onto the button', async () => {
    renderIndicator({ count: 2 });

    const control = await indicator('Notifications, 2 unread');

    expect(control).toHaveAttribute('type', 'button');
    expect(control).toHaveAttribute('aria-expanded', 'false');
    expect(control).toHaveAttribute('aria-controls', SURFACE_ID);
  });

  // The supplied `onClick` is the toggle, so a second activation collapses the
  // surface rather than the indicator holding state of its own.
  it('toggles the surface through the supplied handler', async () => {
    const user = userEvent.setup();
    renderIndicator({ count: 2 });

    const control = await indicator('Notifications, 2 unread');

    await user.click(control);
    expect(control).toHaveAttribute('aria-expanded', 'true');

    await user.click(control);
    expect(control).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(PANEL_TEXT)).not.toBeInTheDocument();
  });
});

describe('NotificationIndicator squad-scoped naming', () => {
  // Requirement 7.6 — while a Squad_Scope is active the name conveys that the
  // count covers a single squad rather than every squad of the account.
  it('states that the count covers one squad while a scope is active', async () => {
    renderIndicator({ count: 4, squadId: SQUAD_IDENTITY });

    expect(
      await indicator('Notifications, 4 unread in this squad'),
    ).toBeInTheDocument();
    expect(badge()).toHaveTextContent('4');
  });

  // Requirement 7.6 — a scoped count of 0 still says which coverage it reports.
  it('states the coverage for a scoped count of zero', async () => {
    renderIndicator({ count: 0, squadId: SQUAD_IDENTITY });

    expect(
      await indicator('Notifications, no unread notifications in this squad'),
    ).toBeInTheDocument();
    expect(badge()).toBeNull();
  });

  // Requirement 7.6 — and says nothing about a squad when none is active, so the
  // account-wide count is not mislabelled.
  it('omits the squad coverage when no scope is active', async () => {
    renderIndicator({ count: 4 });

    expect(await indicator('Notifications, 4 unread')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /in this squad/ }),
    ).not.toBeInTheDocument();
  });
});
