/**
 * Property test for the unauthenticated boundary (task 14.2).
 *
 * **Property 2: The unauthenticated boundary leaks nothing and captures the path
 * reversibly.** *For any* requested shell path, while the auth state is
 * `unauthenticated` the guard renders no shell frame and no destination content at
 * any point, and navigates to the auth feature's log-in route replacing the
 * current history entry; and *for any* requested shell path of up to 2048
 * characters — including query string and fragment — decoding the single redirect
 * query parameter of that navigation target yields the requested path
 * character-for-character, while *for any* requested shell path longer than 2048
 * characters the navigation target carries no redirect parameter.
 *
 * Four acceptance criteria at once:
 *
 * | Criterion | What it asks | Where it is asserted |
 * | --- | --- | --- |
 * | 2.2 | neither the Shell_Frame nor the Destination_Content rendered at any point, and a navigation to the Log_In_Route | {@link expectNothingLeaked} |
 * | 2.5 | the whole requested path — query string and fragment included — carried as one parameter that decodes back character-for-character | {@link expectCapture} |
 * | 2.7 | above 2048 characters, no parameter at all | {@link expectCapture} |
 * | 2.8 | the requested shell path replaced in history, not pushed | {@link expectReplacedNotPushed} and the back-navigation property |
 *
 * ### The two halves of Property 2
 *
 * The reversibility of the *construction* is already pinned over generated log-in
 * routes and parameter names in `lib/redirectCapture.property.test.ts`, which is
 * the pure half. This file is the **rendering** half: the same claims measured
 * through a mounted `RouteGuard`, a real client-side router, and a real
 * `AuthProvider`, so the requested path arrives the way the browser delivers it —
 * split into `pathname`, `search`, and `hash` by the router and reassembled by the
 * guard — rather than being handed to a function as one tidy string. A guard that
 * dropped the fragment, or reassembled the parts in the wrong order, would satisfy
 * the pure half and fail here.
 *
 * ### What is generated
 *
 * Requested shell paths, widely:
 *
 * - with and without a query string, and with and without a fragment, including
 *   the degenerate bare `?` and `#`;
 * - reserved characters (`&`, `=`, `+`, `;`, `:`, `@`, `,`, `$`, `!`, `'`, `(`,
 *   `)`, `*`) — the ones that would be mistaken for structure of the
 *   Log_In_Route's *own* query string if the guard failed to encode them;
 * - characters that must be percent-encoded (space, `"`, `<`, `>`, `[`, `]`, `{`,
 *   `}`, `|`, `\`, `^`, `` ` ``), and text that *already looks* percent-encoded
 *   (`%20`, `%2F`), which must survive as literal text rather than being decoded
 *   once too often;
 * - unicode, from the Latin-1 supplement through CJK and RTL scripts to astral
 *   emoji, a ZWJ sequence, and a zero-width space;
 * - lengths straddling the cap: 2040 through 2060 and well beyond, **including
 *   exactly 2048 and exactly 2049**, since that single character is the whole
 *   difference between Requirement 2.5 and Requirement 2.7.
 *
 * Unpaired surrogates are deliberately *excluded*: `encodeURIComponent` rejects
 * them, so `loginRedirectTarget` drops the capture rather than throwing. That
 * totality is a pure-half claim (covered there); it is not reachable through a
 * router, whose locations come from real addresses.
 *
 * ### Why the assertions cannot pass vacuously
 *
 * Two safeguards. First, every run asserts the router *reached* the Log_In_Route —
 * a location only the guard's `Navigate` can produce, so a generated path that
 * failed to match the guarded route would fail rather than quietly skip the
 * checks. Second, {@link harnessRendersGuardedContentWhenAuthenticated} proves the
 * same harness *does* render the guarded content and the stand-in frame when the
 * Auth_State is `authenticated`, so "nothing leaked" is a fact about the boundary
 * rather than about a harness that never mounted anything.
 *
 * The guarded subtree is a stand-in for the shell — a `<header>`, a `<nav>`, an
 * `h1`, and a displayed value — rather than the real {@link ShellFrame}: the claim
 * under test is that React is never asked to render the children at all, which the
 * render counter measures directly and which no amount of real frame markup would
 * measure better. The frame's own structure is Property 3's subject.
 *
 * Feature: app-shell, Property 2: The unauthenticated boundary leaks nothing and
 * captures the path reversibly
 * Validates: Requirements 2.2, 2.5, 2.7, 2.8
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';
import fc from 'fast-check';

import {
  AuthProvider,
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
  type AuthState,
  type SessionManager,
} from '../auth';
import { RouteGuard } from './RouteGuard';
import { MAX_CAPTURED_PATH_LENGTH } from './lib/redirectCapture';

// --- Sentinels ---------------------------------------------------------------

/** Heading text only ever rendered inside the guarded subtree. */
const GUARDED_HEADING = 'Squad settings';

/** A value the guarded content displays, which must never reach the DOM. */
const GUARDED_VALUE = 'Rating 1284';

/** Text only ever rendered by the Log_In_Route stand-in. */
const LOG_IN_HEADING = 'Log in';

/** Text only ever rendered by the public landing stand-in. */
const LANDING_TEXT = 'PitchMate landing';

// --- Generated requested shell paths ----------------------------------------

/** Characters needing no escaping at all. */
const UNRESERVED_UNITS: readonly string[] = ['a', 'Z', '9', '-', '_', '~', '.'];

/**
 * Reserved characters. Each of these inside the requested path could be read as
 * structure of the Log_In_Route's own query string if it survived unescaped, so
 * they are generated deliberately rather than left to chance.
 */
const RESERVED_UNITS: readonly string[] = [
  '&',
  '=',
  '+',
  ',',
  ';',
  ':',
  '@',
  '$',
  '!',
  "'",
  '(',
  ')',
  '*',
];

/**
 * Characters that must be percent-encoded to travel in a query value, plus text
 * that already looks percent-encoded — `%20` must come back as the three
 * characters `%`, `2`, `0`, not as a space.
 */
const ESCAPABLE_UNITS: readonly string[] = [
  ' ',
  '"',
  '<',
  '>',
  '[',
  ']',
  '{',
  '}',
  '|',
  '\\',
  '^',
  '`',
  '%20',
  '%2F',
];

/**
 * Unicode: Latin-1 supplement, CJK, Japanese, Hebrew, Arabic, an astral emoji, a
 * ZWJ sequence, and a zero-width space. All well-formed, so `encodeURIComponent`
 * accepts every one and the round trip is expected to hold.
 */
const UNICODE_UNITS: readonly string[] = [
  'é',
  'ß',
  'ü',
  'ñ',
  '中',
  'は',
  'א',
  'د',
  '🎉',
  '🏳️‍🌈',
  '\u200b',
];

const ALL_UNITS: readonly string[] = [
  ...UNRESERVED_UNITS,
  ...RESERVED_UNITS,
  ...ESCAPABLE_UNITS,
  ...UNICODE_UNITS,
];

/** A short run of generated characters, never empty. */
const textArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALL_UNITS), { minLength: 1, maxLength: 6 })
  .map((units) => units.join(''));

/** A query string, including none at all and the degenerate bare `?`. */
const queryArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('?') },
  {
    weight: 3,
    arbitrary: fc
      .tuple(textArb, textArb)
      .map(([name, value]) => `?${name}=${value}`),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(textArb, textArb)
      .map(([first, second]) => `?tab=${first}&sort=${second}`),
  },
);

/** A fragment, including none at all and the degenerate bare `#`. */
const fragmentArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('#') },
  { weight: 3, arbitrary: textArb.map((text) => `#${text}`) },
  // A fragment carrying its own `?` and `=`: the guard must keep it in the one
  // captured value rather than letting it split the Log_In_Route's query string.
  { weight: 2, arbitrary: textArb.map((text) => `#a=b?${text}`) },
);

/** Any requested shell path, under `/app`, in the shapes a browser delivers. */
const shellPathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(textArb, { maxLength: 3 }),
    fc.boolean(),
    queryArb,
    fragmentArb,
  )
  .map(([segments, trailingSlash, query, fragment]) => {
    const base = segments.length === 0 ? '/app' : `/app/${segments.join('/')}`;
    return `${base}${trailingSlash ? '/' : ''}${query}${fragment}`;
  });

/**
 * A requested shell path of exactly `length` characters (UTF-16 code units, which
 * is what `String.length` — and therefore the cap — counts), ending in `tail` so
 * the boundary is exercised with and without a query string and fragment.
 *
 * Generated units are never split: a unit that would overshoot is replaced by
 * ASCII padding, so a surrogate pair can never be halved into the unpaired
 * surrogate that `encodeURIComponent` rejects.
 */
function shellPathOfLength(
  length: number,
  units: readonly string[],
  tail: string,
): string {
  const prefix = '/app/';
  const budget = length - prefix.length - tail.length;

  let body = '';
  let index = 0;
  while (body.length < budget) {
    const unit = units[index % units.length];
    index += 1;
    body +=
      body.length + unit.length <= budget
        ? unit
        : 'a'.repeat(budget - body.length);
  }

  return `${prefix}${body}${tail}`;
}

/** Tails that place the length boundary in the path, the query, or the fragment. */
const TAILS: readonly string[] = ['', '?tab=stats', '#top', '?tab=stats#top'];

/**
 * Lengths straddling the cap. 2048 and 2049 are the two that matter — the last
 * captured path and the first dropped one — and are pinned by name below as well
 * as generated here.
 */
const STRADDLING_LENGTHS: readonly number[] = [
  2040, 2044, 2046, 2047, 2048, 2049, 2050, 2052, 2060, 2500,
];

/** A requested shell path whose length sits near or beyond the cap. */
const straddlingPathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...STRADDLING_LENGTHS),
    fc.shuffledSubarray(ALL_UNITS, { minLength: 1, maxLength: 8 }),
    fc.constantFrom(...TAILS),
  )
  .map(([length, units, tail]) => shellPathOfLength(length, units, tail));

// --- The harness -------------------------------------------------------------

/**
 * A {@link SessionManager} reporting one fixed Auth_State.
 *
 * The `AuthProvider` reads only `getState()` and `subscribe()`; the rest is inert
 * because Property 2 never moves the session — it asks what happens *while* the
 * state is `unauthenticated`.
 */
function fixedManager(state: AuthState): SessionManager {
  return {
    bootstrap: (): AuthState => state,
    establish: vi.fn(),
    getState: (): AuthState => state,
    getAccessTokenForRequest: vi.fn(async () => ({
      error: 'unauthenticated' as const,
    })),
    signOut: vi.fn(async () => {}),
    subscribe: () => () => {},
  };
}

/**
 * A stand-in for the shell: the two landmarks the Shell_Frame owns, a heading, and
 * a displayed value. `onRender` fires during the render pass, so it counts the
 * times React was asked to render the guarded subtree at all — which is what
 * "renders neither the Shell_Frame nor the Destination_Content at any point"
 * means (Requirement 2.2).
 */
function GuardedShell({
  onRender,
}: {
  readonly onRender: () => void;
}): ReactElement {
  onRender();

  return (
    <div>
      <header>
        <nav aria-label="Primary">
          <a href="/app">Home</a>
        </nav>
      </header>
      <main>
        <h1>{GUARDED_HEADING}</h1>
        <p data-testid="guarded-value">{GUARDED_VALUE}</p>
      </main>
    </div>
  );
}

interface Harness {
  readonly router: ReturnType<typeof createMemoryRouter>;
  /** How many times React rendered the guarded subtree. Must stay 0. */
  readonly guardedRenders: () => number;
}

/**
 * Mount the guard at `requestedPath` behind a real router and a real
 * `AuthProvider`.
 *
 * The guard sits on a `*` route so *every* generated path reaches it — a narrower
 * pattern could silently fail to match an awkward path and take the property's
 * assertions with it. `/` is seeded ahead of the requested path in the history so
 * a back navigation has somewhere to land, which is what Requirement 2.8 needs.
 */
function renderGuardAt(requestedPath: string, state: AuthState): Harness {
  let renders = 0;

  const routes: RouteObject[] = [
    { path: '/', element: <p>{LANDING_TEXT}</p> },
    { path: LOG_IN_ROUTE, element: <h1>{LOG_IN_HEADING}</h1> },
    {
      path: '*',
      element: (
        <RouteGuard>
          <GuardedShell
            onRender={() => {
              renders += 1;
            }}
          />
        </RouteGuard>
      ),
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: ['/', requestedPath],
    initialIndex: 1,
  });

  render(
    <AuthProvider manager={fixedManager(state)}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );

  return { router, guardedRenders: () => renders };
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 2.2: nothing of the shell rendered at any point, and the person is
 * on the Log_In_Route.
 */
function expectNothingLeaked(harness: Harness): void {
  // Never asked to render — so no frame, no content, and no value inside either
  // could have reached the DOM even transiently.
  expect(harness.guardedRenders()).toBe(0);

  // And nothing of it is in the document, checked from the markup rather than
  // from the accessibility tree, so an `aria-hidden` or attribute-borne leak
  // would still be caught.
  const markup = document.documentElement.innerHTML;
  expect(markup).not.toContain(GUARDED_HEADING);
  expect(markup).not.toContain(GUARDED_VALUE);
  expect(screen.queryByTestId('guarded-value')).toBeNull();
  expect(screen.queryAllByRole('banner')).toHaveLength(0);
  expect(screen.queryAllByRole('navigation')).toHaveLength(0);
  expect(screen.queryAllByRole('main')).toHaveLength(0);

  // The Log_In_Route is reached, and reached by the guard: no other route in the
  // table navigates anywhere. This is also what keeps every assertion above
  // non-vacuous for an awkward generated path.
  expect(harness.router.state.location.pathname).toBe(LOG_IN_ROUTE);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    LOG_IN_HEADING,
  );
}

/**
 * Requirements 2.5 and 2.7: at or below the cap the single Redirect_Capture
 * parameter decodes back to the requested path character-for-character; above it
 * there is no parameter at all.
 *
 * The value is read through `URLSearchParams`, the way the Auth_Feature reads it
 * (`redirectCandidateFromSearch`), which percent-decodes and also treats `+` as a
 * space — so an exact round trip requires the guard to have escaped `+` too.
 */
function expectCapture(harness: Harness, requestedPath: string): void {
  const { search } = harness.router.state.location;
  const captured = new URLSearchParams(search).getAll(REDIRECT_PARAM_NAME);

  if (requestedPath.length <= MAX_CAPTURED_PATH_LENGTH) {
    // Exactly one parameter, carrying the whole path — its query string and
    // fragment included — decodable back to the original (Requirement 2.5).
    expect(captured).toEqual([requestedPath]);
  } else {
    // Dropped entirely rather than truncated, so the Auth_Feature falls back to
    // the Default_Authenticated_Route (Requirement 2.7).
    expect(captured).toEqual([]);
    expect(search).toBe('');
  }
}

/**
 * Requirement 2.8: the navigation replaced the current history entry.
 *
 * `historyAction` is the router's own record of how it got here, so this is the
 * criterion stated directly. The back-navigation property below corroborates it
 * from the outside.
 */
function expectReplacedNotPushed(harness: Harness): void {
  expect(harness.router.state.historyAction).toBe('REPLACE');
}

// --- The property ------------------------------------------------------------

describe('RouteGuard — Property 2 (the unauthenticated boundary leaks nothing and captures the path reversibly)', () => {
  // Feature: app-shell, Property 2: The unauthenticated boundary leaks nothing and captures the path reversibly
  // Validates: Requirements 2.2, 2.5, 2.7, 2.8
  it('leaks nothing, replaces the history entry, and captures the path reversibly for any requested shell path', () => {
    fc.assert(
      fc.property(shellPathArb, (requestedPath) => {
        const harness = renderGuardAt(requestedPath, 'unauthenticated');
        try {
          expectNothingLeaked(harness);
          expectReplacedNotPushed(harness);
          expectCapture(harness, requestedPath);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  }, 120_000);

  // Feature: app-shell, Property 2: The unauthenticated boundary leaks nothing and captures the path reversibly
  // Validates: Requirements 2.5, 2.7
  it('captures at or below 2048 characters and omits above it, for paths straddling the cap', () => {
    fc.assert(
      fc.property(straddlingPathArb, (requestedPath) => {
        const harness = renderGuardAt(requestedPath, 'unauthenticated');
        try {
          expectNothingLeaked(harness);
          expectReplacedNotPushed(harness);
          expectCapture(harness, requestedPath);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 120_000);

  // Feature: app-shell, Property 2: The unauthenticated boundary leaks nothing and captures the path reversibly
  // Validates: Requirements 2.5, 2.7
  it('captures a requested path of exactly 2048 characters and drops one of exactly 2049', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(ALL_UNITS, { minLength: 1, maxLength: 8 }),
        fc.constantFrom(...TAILS),
        (units, tail) => {
          const atCap = shellPathOfLength(MAX_CAPTURED_PATH_LENGTH, units, tail);
          const overCap = shellPathOfLength(
            MAX_CAPTURED_PATH_LENGTH + 1,
            units,
            tail,
          );

          // The generator's own claim, checked before the guard's: these are the
          // two lengths the criteria turn on.
          expect(atCap).toHaveLength(2048);
          expect(overCap).toHaveLength(2049);

          const captured = renderGuardAt(atCap, 'unauthenticated');
          try {
            expectNothingLeaked(captured);
            expectCapture(captured, atCap);
          } finally {
            cleanup();
          }

          const dropped = renderGuardAt(overCap, 'unauthenticated');
          try {
            expectNothingLeaked(dropped);
            // Nothing of the requested path survives — not even a prefix.
            expect(dropped.router.state.location.search).toBe('');
            expectCapture(dropped, overCap);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);

  // Feature: app-shell, Property 2: The unauthenticated boundary leaks nothing and captures the path reversibly
  // Validates: Requirements 2.2, 2.8
  it('leaves the browser back control on what preceded the requested shell path', async () => {
    await fc.assert(
      fc.asyncProperty(shellPathArb, async (requestedPath) => {
        const harness = renderGuardAt(requestedPath, 'unauthenticated');
        try {
          expectNothingLeaked(harness);

          await act(async () => {
            await harness.router.navigate(-1);
          });

          // The requested shell path was replaced, so back reaches what preceded
          // it. Had the guard pushed, back would land on the shell path and
          // redirect straight to the Log_In_Route again (Requirement 2.8).
          expect(harness.router.state.location.pathname).toBe('/');
          expect(screen.getByText(LANDING_TEXT)).toBeInTheDocument();
          // And still nothing of the shell was ever rendered (Requirement 2.2).
          expect(harness.guardedRenders()).toBe(0);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});

/**
 * Harness control, not a property: the same mounting that measures "nothing
 * leaked" must be capable of leaking something, or the property above would hold
 * for a harness that never rendered the guard at all.
 */
describe('RouteGuard property harness', () => {
  it.each([
    '/app',
    '/app/settings?tab=appearance#top',
    '/app/squads/7f3a/players',
  ])(
    'harnessRendersGuardedContentWhenAuthenticated: %s',
    (requestedPath: string) => {
      const harness = renderGuardAt(requestedPath, 'authenticated');

      expect(harness.guardedRenders()).toBeGreaterThan(0);
      expect(screen.getByTestId('guarded-value')).toHaveTextContent(
        GUARDED_VALUE,
      );
      expect(screen.getAllByRole('banner')).toHaveLength(1);
      expect(screen.getAllByRole('navigation')).toHaveLength(1);
      expect(screen.getAllByRole('main')).toHaveLength(1);
      // Still on the requested path: no navigation was issued (Requirement 2.1).
      expect(harness.router.state.location.pathname).toBe(
        requestedPath.split(/[?#]/)[0],
      );
    },
  );
});
