/**
 * Automated accessibility audits for every surface the App_Shell renders
 * (task 14.6).
 *
 * Requirement 13.10 asks for zero automated accessibility violations under
 * `jest-axe`, over the **WCAG 2.1 Level A and Level AA rule set**, for the
 * Shell_Frame and for each Destination the shell supplies content for, in **both**
 * the dark Theme and the light Theme — with no rule disabled, no violation marked
 * as an accepted exception, and no violation suppressed.
 *
 * The six surfaces the task names, each audited in both Themes:
 *
 * | Surface | Reached by | Requirement |
 * | --- | --- | --- |
 * | The Shell_Frame | `/app` with Destination_Content supplied, in the Wide_Layout and the Compact_Layout, with each header disclosure closed and open | 1.1–1.5, 13.10 |
 * | The Notifications_Destination | `/app/notifications`, with records returned | 3.9, 5.4 |
 * | The Settings_Destination | `/app/settings`, with an injected section | 3.1, 12.4 |
 * | The Unavailable_State | `/app` with no Destination_Content supplied | 3.7, 3.8 |
 * | The `/app` not-found indication | `/app/nowhere` | 3.10 |
 * | The session-ended notice | a notification call answering `401`, which begins the handover | 9.7 |
 *
 * ### Mounted through the real route table
 *
 * Every audit goes through `createShellRoutes`, so each surface is assessed in
 * the composition it actually ships in: the Route_Guard, the Theme_Provider, the
 * Squad_Scope, the notification state machine, and the Shell_Frame with its real
 * header, real Primary_Navigation, real Notification_Panel, and real
 * Account_Menu. An audit of a component rendered in isolation would miss exactly
 * the faults that matter here — a duplicated landmark, a second level-one
 * heading, an `aria-controls` with no target, a nested interactive control — since
 * all of those arise from composition rather than from any one component.
 *
 * Two seams are stubbed, both outside the shell: the Authenticated_Api_Client, so
 * no network is touched and the Notification_List is deterministic, and
 * `matchMedia`, because jsdom evaluates no media query and the frame's layout
 * depends on one (`state/viewportLayoutTestHarness.ts`).
 *
 * ### How both Themes are forced
 *
 * The route table's `ShellThemeProvider` reads the Appearance_Preference from the
 * ambient storage under the one namespaced key, so each audit writes `dark` or
 * `light` there before mounting and then waits for `data-theme` on the document
 * element to confirm the resolved Theme was applied. That drives the Theme from
 * the *stored preference* rather than from a stubbed browser preference, which
 * keeps the audit independent of what `matchMedia` reports for
 * `prefers-color-scheme` — the viewport harness answers width queries only.
 *
 * ### The rule set, and the one thing jsdom cannot judge
 *
 * `runOnly` names the four tags that make up WCAG 2.1 Level A and Level AA
 * (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`). Nothing here disables a rule,
 * marks a violation as expected, or filters the reported violations by impact —
 * {@link expectNoWcagViolations} asserts the whole `violations` array is empty.
 *
 * One environmental limitation is worth stating plainly rather than leaving to be
 * discovered: `jest-axe` itself disables axe's colour-category rules on import,
 * because jsdom computes no colour and resolves no `var(--token)`, so a contrast
 * ratio cannot be measured in this environment at all. That is the same division
 * the design records — the contrast floors for both Themes are asserted from the
 * declared token tables by Property 34
 * (`components/ShellThemeProvider`'s token contrast test), and full accessibility
 * validation still requires manual testing with assistive technologies and expert
 * review. This suite establishes the automated floor.
 *
 * The audit also asserts the run was **not vacuous**: a run that evaluated no
 * rule at all would report zero violations while proving nothing, so each audit
 * requires at least one evaluated rule outcome.
 *
 * Focus order, focus escapability, live-region announcements, and the heading
 * outline are not re-asserted here — Properties 3, 35, and 36 own those.
 *
 * Feature: app-shell
 * Validates: Requirements 13.10
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { axe } from 'jest-axe';
import type { PitchMateApiClient } from '@pitchmate/api-client';

import { AuthProvider, type AuthState, type SessionManager } from '../auth';
import { createShellRoutes, type ShellDestinationContent } from './shellRoutes';
import {
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  SETTINGS_ROUTE,
  destinationLabel,
} from './lib/destinations';
import {
  ACCOUNT_MENU_LABEL,
  PRIMARY_NAVIGATION_TOGGLE,
  SESSION_ENDED_HEADING,
  SHELL_NOT_FOUND_HEADING,
  UNAVAILABLE_BODY,
} from './lib/messages';
import { NOTIFICATIONS_SUBJECT } from './lib/unreadBadge';
import {
  printNotificationRecord,
  type NotificationRecord,
} from './lib/notificationParsing';
import {
  installViewport,
  restoreViewport,
} from './state/viewportLayoutTestHarness';
import { APPEARANCE_STORAGE_KEY, type Theme } from '../../theme';

// --- The rule set (Requirement 13.10) ---------------------------------------

/**
 * The axe tags that together make up the WCAG 2.1 Level A and Level AA rule set:
 * the WCAG 2.0 A and AA rules, plus the rules 2.1 added at each level.
 *
 * Passed as `runOnly`, which *scopes* the run to this rule set. It disables
 * nothing within it — an axe rule outside WCAG 2.1 A/AA (a best-practice rule
 * such as `region` or `page-has-heading-one`) is simply not part of what
 * Requirement 13.10 asks about.
 */
const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Audit one rendering and require zero violations.
 *
 * No rule is disabled, no violation is filtered by impact, and no reported
 * violation is treated as expected: the assertion is over the entire
 * `violations` array. The second assertion guards against a *vacuous* pass — a
 * misconfigured tag list would evaluate no rule and report no violation, which
 * would look identical to a clean audit.
 */
async function expectNoWcagViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, {
    runOnly: { type: 'tag', values: [...WCAG_A_AND_AA_TAGS] },
  });

  const evaluated =
    results.passes.length + results.incomplete.length + results.violations.length;
  expect(evaluated).toBeGreaterThan(0);

  expect(results).toHaveNoViolations();
}

// --- The two Themes ---------------------------------------------------------

/** Both Themes, so every surface is audited twice (Requirement 13.10). */
const THEMES: readonly Theme[] = ['dark', 'light'];

// --- Viewport widths --------------------------------------------------------

/** A Wide_Layout width: every Primary_Navigation control is rendered directly. */
const WIDE_WIDTH = 1024;

/** A Compact_Layout width: the navigation sits behind its disclosure control. */
const COMPACT_WIDTH = 390;

// --- The Notification_List the audits render --------------------------------

/** A fixed clock, so every relative time label is deterministic (Req 5.5, 5.11). */
const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

/** The Squad_Scope the generated records belong to. */
const SQUAD_ID = 'b1d0f4a2-7c3e-4f51-9a6b-8e2d5c7f0a13';

/**
 * Three records covering the display cases a row can be in: unread, read, and an
 * unrecognised type marker with an empty body — so the audit sees the unread cue,
 * the neutral type label, and an omitted body rather than only the happy shape.
 */
const RECORDS: readonly NotificationRecord[] = [
  {
    notificationId: '11111111-1111-4111-8111-111111111111',
    type: { kind: 'catalogued', value: 'match-confirmed' },
    squadId: SQUAD_ID,
    title: 'Thursday is confirmed',
    body: 'Kick-off at 7pm, Pitch 3.',
    createdAtMs: FIXED_NOW - 90_000,
    readState: 'unread',
  },
  {
    notificationId: '22222222-2222-4222-8222-222222222222',
    type: { kind: 'catalogued', value: 'teams-rolled' },
    squadId: SQUAD_ID,
    title: 'Teams are up',
    body: 'You are in bibs. Again.',
    createdAtMs: FIXED_NOW - 3 * 60 * 60 * 1000,
    readState: 'read',
  },
  {
    notificationId: '33333333-3333-4333-8333-333333333333',
    type: { kind: 'unrecognised', code: 99 },
    squadId: SQUAD_ID,
    title: 'Something new happened',
    body: '',
    createdAtMs: FIXED_NOW - 5 * 24 * 60 * 60 * 1000,
    readState: 'unread',
  },
];

/** The Unread_Count the stub reports, matching the records it returns. */
const UNREAD_COUNT = RECORDS.filter(
  (record) => record.readState === 'unread',
).length;

// --- The stubbed seams ------------------------------------------------------

/**
 * A minimal authenticated {@link SessionManager}.
 *
 * `AuthProvider` reads only `getState()` and `subscribe()`, and nothing in an
 * audit performs a session transition, so the remaining members are inert. It
 * reports `authenticated`, which is the state the Route_Guard admits.
 */
function authenticatedSessionManager(): SessionManager {
  const state: AuthState = 'authenticated';
  return {
    bootstrap: (): AuthState => state,
    establish: vi.fn(),
    getState: (): AuthState => state,
    getAccessTokenForRequest: vi.fn(async () => ({ token: 'access-token' })),
    signOut: vi.fn(async () => {}),
    subscribe: () => () => {},
  } as unknown as SessionManager;
}

/**
 * An Authenticated_Api_Client stand-in answering every notification call.
 *
 * The facade reads the response text and decodes it itself (the contract declares
 * no content schema), so the count endpoint answers a number and the list
 * endpoint the printed wire form of {@link RECORDS} — printed through the
 * production printer, so the audit renders records the real parser accepted.
 *
 * `status` is the status every call returns: `200` for the ordinary audits, `401`
 * for the session-ended one, which is what begins the handover (Requirement 9.3).
 */
function stubApiClient(status = 200): PitchMateApiClient {
  const answer = (body: unknown) =>
    Promise.resolve({ data: JSON.stringify(body), response: { status } });

  return {
    GET: (path: string) =>
      answer(
        path.includes('unread-count')
          ? UNREAD_COUNT
          : RECORDS.map(printNotificationRecord),
      ),
    POST: () => Promise.resolve({ data: '', response: { status: 204 } }),
  } as unknown as PitchMateApiClient;
}

/** Destination_Content for the Destinations a later feature fills (Req 3.7). */
const HOME_HEADING = 'Your squads';
const PROFILE_HEADING = 'Your profile';
const INJECTED_SETTING_HEADING = 'Notification preferences';

function injectedContent(): ShellDestinationContent {
  return {
    home: (
      <div>
        <h1>{HOME_HEADING}</h1>
        <p>Nothing to organise yet.</p>
      </div>
    ),
    profile: <h1>{PROFILE_HEADING}</h1>,
    settings: (
      <section aria-labelledby="injected-settings-heading">
        <h2 id="injected-settings-heading">{INJECTED_SETTING_HEADING}</h2>
        <p>Email and in-app notifications are on.</p>
      </section>
    ),
  };
}

// --- Mounting ---------------------------------------------------------------

interface RenderOptions {
  /** The Theme to force through the stored Appearance_Preference. */
  readonly theme: Theme;
  /** The reported viewport width; defaults to the Wide_Layout. */
  readonly width?: number;
  /** Injected Destination bodies; omit to render the Unavailable_State. */
  readonly destinationContent?: ShellDestinationContent;
  /** The status every notification call returns; `401` begins the handover. */
  readonly status?: number;
}

/**
 * Mount the shell's route table at `path` with the Theme and width forced, and
 * wait for the resolved Theme to reach the document element.
 */
async function renderShellAt(
  path: string,
  { theme, width = WIDE_WIDTH, destinationContent, status }: RenderOptions,
): Promise<HTMLElement> {
  // The Theme comes from the stored preference, read at mount by the provider.
  localStorage.setItem(APPEARANCE_STORAGE_KEY, theme);
  // jsdom evaluates no media query, so the layout needs a reported width.
  installViewport(width);

  const routes = createShellRoutes({
    apiClient: stubApiClient(status),
    signOut: async () => {},
    destinationContent,
    now: () => FIXED_NOW,
  });

  const { container } = render(
    <AuthProvider manager={authenticatedSessionManager()}>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: [path] })}
      />
    </AuthProvider>,
  );

  await waitFor(() =>
    expect(document.documentElement.getAttribute('data-theme')).toBe(theme),
  );

  return container;
}

/** The Notification_Indicator, found by the subject its name always opens with. */
function notificationIndicator(): HTMLElement {
  return screen.getByRole('button', {
    name: new RegExp(`^${NOTIFICATIONS_SUBJECT},`),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  restoreViewport();
  localStorage.clear();
  // The applied Theme outlives an unmount, so it is cleared between audits.
  document.documentElement.removeAttribute('data-theme');
  vi.clearAllMocks();
});

// --- The audit itself -------------------------------------------------------

describe('the configured audit', () => {
  /**
   * The counterpart to every clean audit below: markup with two faults the WCAG
   * 2.1 A rule set names — an image with no text alternative (`image-alt`) and a
   * text input with no label (`label`) — must be *reported*. Without this, a
   * `runOnly` tag list that matched no rule would let every audit in this file
   * pass while proving nothing.
   */
  it('reports violations for markup that breaks WCAG 2.1 A rules', async () => {
    const { container } = render(
      <div>
        <img src="/badge.png" />
        <input type="text" />
      </div>,
    );

    const results = await axe(container, {
      runOnly: { type: 'tag', values: [...WCAG_A_AND_AA_TAGS] },
    });

    expect(results.violations.map((violation) => violation.id).sort()).toEqual([
      'image-alt',
      'label',
    ]);
  });
});

// --- The Shell_Frame --------------------------------------------------------

describe.each(THEMES)('the Shell_Frame in the %s theme', (theme) => {
  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations with every header surface closed', async () => {
    const container = await renderShellAt(HOME_ROUTE, {
      theme,
      destinationContent: injectedContent(),
    });

    await screen.findByRole('heading', { level: 1, name: HOME_HEADING });

    await expectNoWcagViolations(container);
  });

  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations with the Notification_Panel open', async () => {
    const user = userEvent.setup();
    const container = await renderShellAt(HOME_ROUTE, {
      theme,
      destinationContent: injectedContent(),
    });
    await screen.findByRole('heading', { level: 1, name: HOME_HEADING });

    await user.click(notificationIndicator());
    // The list call settles into rendered rows before the audit reads the DOM.
    await screen.findByText(RECORDS[0].title);

    await expectNoWcagViolations(container);
  });

  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations with the Account_Menu open', async () => {
    const user = userEvent.setup();
    const container = await renderShellAt(HOME_ROUTE, {
      theme,
      destinationContent: injectedContent(),
    });
    await screen.findByRole('heading', { level: 1, name: HOME_HEADING });

    await user.click(screen.getByRole('button', { name: ACCOUNT_MENU_LABEL }));
    await screen.findByRole('button', { name: new RegExp('sign out', 'i') });

    await expectNoWcagViolations(container);
  });

  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations in the Compact_Layout with the navigation expanded', async () => {
    const user = userEvent.setup();
    const container = await renderShellAt(HOME_ROUTE, {
      theme,
      width: COMPACT_WIDTH,
      destinationContent: injectedContent(),
    });
    await screen.findByRole('heading', { level: 1, name: HOME_HEADING });

    await user.click(
      screen.getByRole('button', { name: PRIMARY_NAVIGATION_TOGGLE }),
    );
    const navigation = screen.getByRole('navigation');
    await within(navigation).findByRole('link', {
      name: destinationLabel('settings'),
    });

    await expectNoWcagViolations(container);
  });
});

// --- The Notifications_Destination (Requirement 3.9) ------------------------

describe.each(THEMES)('the Notifications_Destination in the %s theme', (theme) => {
  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations with the whole Notification_List rendered', async () => {
    const container = await renderShellAt(NOTIFICATIONS_ROUTE, {
      theme,
      destinationContent: injectedContent(),
    });

    await screen.findByRole('heading', {
      level: 1,
      name: destinationLabel('notifications'),
    });
    // Every record, so the audit covers the unread cue and the neutral type label.
    for (const record of RECORDS) {
      await screen.findByText(record.title);
    }

    await expectNoWcagViolations(container);
  });
});

// --- The Settings_Destination (Requirements 3.1, 12.4) ----------------------

describe.each(THEMES)('the Settings_Destination in the %s theme', (theme) => {
  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations with the appearance group and an injected section', async () => {
    const container = await renderShellAt(SETTINGS_ROUTE, {
      theme,
      destinationContent: injectedContent(),
    });

    await screen.findByRole('heading', {
      level: 1,
      name: destinationLabel('settings'),
    });
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getByText(INJECTED_SETTING_HEADING)).toBeInTheDocument();

    await expectNoWcagViolations(container);
  });
});

// --- The Unavailable_State (Requirements 3.7, 3.8) --------------------------

describe.each(THEMES)('the Unavailable_State in the %s theme', (theme) => {
  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations for a Destination with no content supplied', async () => {
    const container = await renderShellAt(HOME_ROUTE, { theme });

    await screen.findByRole('heading', {
      level: 1,
      name: destinationLabel('home'),
    });
    expect(screen.getByText(UNAVAILABLE_BODY)).toBeInTheDocument();

    await expectNoWcagViolations(container);
  });
});

// --- The `/app` not-found indication (Requirement 3.10) --------------------

describe.each(THEMES)('the /app not-found indication in the %s theme', (theme) => {
  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations', async () => {
    const container = await renderShellAt(`${HOME_ROUTE}/nowhere`, {
      theme,
      destinationContent: injectedContent(),
    });

    await screen.findByRole('heading', {
      level: 1,
      name: SHELL_NOT_FOUND_HEADING,
    });

    await expectNoWcagViolations(container);
  });
});

// --- The session-ended notice (Requirement 9.7) ----------------------------

describe.each(THEMES)('the session-ended notice in the %s theme', (theme) => {
  // Validates: Requirements 13.10
  it('has no WCAG 2.1 A or AA violations after the handover replaces the Destination', async () => {
    // 9.3: the mount's unread-count call answers `401`, which begins the
    // session-expiry handover and swaps the Content_Region for the notice.
    const container = await renderShellAt(HOME_ROUTE, {
      theme,
      status: 401,
      destinationContent: injectedContent(),
    });

    await screen.findByRole('heading', {
      level: 1,
      name: SESSION_ENDED_HEADING,
    });
    // 9.7: nothing of the Destination_Content is left on screen.
    expect(screen.queryByText(HOME_HEADING)).toBeNull();

    await expectNoWcagViolations(container);
  });
});
