/**
 * Property test for the application-level not-found screen (task 15.3).
 *
 * Requirement 15.9 is about the address nobody registered: a stale bookmark, a
 * mistyped path, a link from an old email. It must land on a plain not-found
 * surface — **not** on the authenticated frame, and **not** on an Auth_Feature
 * screen with a redirect stashed for after sign-in. A wrong address is not an
 * authentication outcome, and telling someone to log in for a page that does not
 * exist sends them round a loop they cannot leave.
 *
 * ### What is generated
 *
 * One axis: the requested path. Drawn from two sources and then **filtered** by
 * {@link matchesNoRegisteredRoute} so the generator can only ever yield the paths
 * the requirement is about — a path matching no registered route and not
 * beginning with the Home_Destination route path `/app`:
 *
 * - freely generated paths of one to four segments, and
 * - a table of deliberate near misses ({@link NEAR_MISS_PATHS}) — a sibling under
 *   a registered nested path, a path one segment deeper than a registered auth
 *   path, a mixed-case near miss, a file-looking address, and a very long path.
 *   Random segments almost never land next to a registered path, so the near
 *   misses are what exercise the boundary the router's route ranking decides.
 *
 * Each is then given an optional trailing `/` and an optional query string or
 * fragment, because a stale link carries those and they must change nothing. No
 * generated query carries the redirect parameter, so an assertion that the
 * parameter is absent afterwards is meaningful.
 *
 * The filter is checked in both directions by a guard test before the property:
 * every registered path — including `/app` under any casing or trailing slash — is
 * rejected by the predicate, and every near miss is admitted by it. Without that
 * guard a predicate that had drifted could quietly shrink the generator to
 * something vacuous.
 *
 * ### What is asserted, for each generated path
 *
 * | Requirement 15.9 clause | Assertion |
 * | --- | --- |
 * | exactly one level-one heading | one `h1`, carrying `APP_NOT_FOUND_HEADING` |
 * | a control that navigates to the marketing landing route | the one link on the surface, `href="/"` |
 * | renders neither the Shell_Frame … | no `.shell-frame`, no banner, no navigation landmark |
 * | … nor an Auth_Feature screen | no `.auth-layout` (every auth screen renders through it), none of the auth fallback's text, no form field |
 * | no navigation to the Log_In_Route | the Location still holds the requested path |
 * | no Redirect_Capture | the Location's query carries no redirect parameter and is exactly the requested query |
 * | no full-document reload | activating the control moves the Location to `/` and renders the landing page with the same document element |
 *
 * ### Why the heading text alone cannot decide this
 *
 * The Auth_Feature's own fallback screen heads itself `'Page not found'` too — the
 * same words as `APP_NOT_FOUND_HEADING`. That collision is the reason this
 * property does not lean on heading text to tell the two apart: it checks the
 * *structure* (`.auth-layout`), the body text, and the control's destination
 * (the landing route, never the Log_In_Route). The auth table's fallback registers
 * the bare path `*` — the application catch-all's own path — and `appRouter` drops
 * it as it registers the auth subtree; if that ever regressed, the auth fallback
 * would win the tie by registration order and these assertions would fail.
 *
 * ### The injected seams
 *
 * The router is the production one, assembled through `appRouterTestHarness`
 * with only the outside world replaced. The Session_Manager it is given reports
 * `authenticated` — deliberately the *harder* case for this property, since a
 * signed-in visitor is exactly who could plausibly be sent into the shell or
 * bounced through the Route_Guard by a stray match.
 *
 * Feature: app-shell, Property 38: An unmatched path outside `/app` reaches the application not-found screen
 * Validates: Requirements 15.9
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import fc from 'fast-check';
import type { RouteObject } from 'react-router-dom';

import {
  AUTH_ROUTE_PATHS,
  AUTH_NOT_FOUND_BACK_TO_LOG_IN_LABEL,
  AUTH_NOT_FOUND_MESSAGE,
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
} from '../features/auth';
import { HOME_ROUTE, SHELL_DESTINATIONS } from '../features/app-shell';
import { landingContent } from '../features/landing/content/landingContent';
import {
  APP_NOT_FOUND_BODY,
  APP_NOT_FOUND_CONTROL_LABEL,
  APP_NOT_FOUND_HEADING,
} from './AppNotFound';
import { LANDING_ROUTE } from './appRoutePaths';
import {
  assembleRoutes,
  flush,
  renderAt,
  resetThemeAttribute,
} from './appRouterTestHarness';

// --- What "registered" means -------------------------------------------------

/**
 * Every concrete path the three contributing tables register.
 *
 * Read from the tables rather than restated, so a table gaining a path narrows
 * this property's generator with it instead of leaving a newly registered path
 * generated as if it were unmatched. The two catch-alls (`/app/*` and `*`) are
 * absent on purpose: they are the routes under test, not paths to avoid.
 */
const REGISTERED_PATHS: readonly string[] = [
  LANDING_ROUTE,
  ...AUTH_ROUTE_PATHS,
  ...SHELL_DESTINATIONS.map((destination) => destination.path),
];

/**
 * Normalise a path the way `react-router` matches one: matching is
 * case-insensitive by default and a single trailing separator is not significant,
 * so `/Login/` and `/login` are the same registered route.
 */
function normalisePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 ? lower.replace(/\/+$/, '') : lower;
}

/** The path portion of a requested address, without its query or fragment. */
function pathnameOf(requested: string): string {
  return requested.split('#')[0].split('?')[0];
}

/**
 * Is this requested address the subject of Requirement 15.9 — matching no
 * registered route, and not beginning with the Home_Destination route path?
 *
 * The `/app` exclusion is a plain string-prefix test rather than a segment test,
 * which is the conservative reading: it rules out `/app`, everything the shell's
 * own `/app/*` not-found owns (Requirement 3.10), and also near neighbours like
 * `/apple`, which the requirement's wording leaves outside this property.
 */
function matchesNoRegisteredRoute(requested: string): boolean {
  const normalised = normalisePath(pathnameOf(requested));

  return (
    normalised.startsWith('/') &&
    normalised.length > 1 &&
    !normalised.startsWith(HOME_ROUTE) &&
    !REGISTERED_PATHS.some((path) => normalisePath(path) === normalised)
  );
}

// --- The generated requested paths -------------------------------------------

/** Characters a plausible path segment is built from. */
const SEGMENT_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('');

const segmentArb = fc.string({
  unit: fc.constantFrom(...SEGMENT_CHARACTERS),
  minLength: 1,
  maxLength: 12,
});

/** Freely generated paths of one to four segments. */
const generatedPathArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${segments.join('/')}`);

/**
 * Deliberate near misses of the registered paths, which random segments would
 * effectively never produce.
 *
 * Each sits one step from something registered: a sibling of a registered nested
 * path, a segment deeper than a registered auth path, a case variation, a
 * one-character difference, a file-looking address of the kind a crawler or an
 * old bookmark requests, and a very long path.
 */
const NEAR_MISS_PATHS: readonly string[] = [
  '/squads',
  '/squads/7f3a/matches',
  '/reset-password/other',
  '/login/extra',
  '/verify-email/some-token',
  '/LOGIN-X',
  '/signin',
  '/loginx',
  '/reset-password-confirm',
  '/favicon.ico',
  '/index.html',
  `/${'x'.repeat(300)}`,
];

/** A stale link's query or fragment. None carries the redirect parameter. */
const suffixArb = fc.constantFrom(
  '',
  '?from=email',
  '?a=1&b=2',
  '#top',
  '?q=x#frag',
);

/**
 * A requested address matching no registered route and not beginning with `/app`.
 *
 * The filter is what makes that true of every value, whatever the composition
 * above produced.
 */
const unmatchedPathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(
      { weight: 6, arbitrary: generatedPathArb },
      { weight: 4, arbitrary: fc.constantFrom(...NEAR_MISS_PATHS) },
    ),
    fc.constantFrom('', '/'),
    suffixArb,
  )
  .map(([path, trailingSlash, suffix]) => `${path}${trailingSlash}${suffix}`)
  .filter(matchesNoRegisteredRoute);

// --- Assertions --------------------------------------------------------------

/** The pathname, query, and fragment the requested address asked for. */
function requestedLocation(requested: string): {
  pathname: string;
  search: string;
  hash: string;
} {
  const url = new URL(requested, 'http://localhost');
  return { pathname: url.pathname, search: url.search, hash: url.hash };
}

/**
 * Assert every clause of Requirement 15.9 over the currently rendered surface and
 * the router's resulting Location.
 */
async function expectApplicationNotFound(
  router: Awaited<ReturnType<typeof renderAt>>,
  requested: string,
): Promise<void> {
  // 15.9: exactly one level-one heading, and it is this surface's own.
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(APP_NOT_FOUND_HEADING);
  expect(screen.getByText(APP_NOT_FOUND_BODY)).toBeInTheDocument();

  // 15.9: a control that navigates to the marketing landing route — and it is the
  // only control offering a route anywhere, so nothing here points at sign-in.
  const control = screen.getByRole('link', {
    name: APP_NOT_FOUND_CONTROL_LABEL,
  });
  expect(control).toHaveAttribute('href', LANDING_ROUTE);
  expect(screen.getAllByRole('link')).toHaveLength(1);

  // 15.9: not the Shell_Frame. The frame is a banner containing the one
  // navigation landmark, none of which a bare not-found surface renders.
  expect(document.querySelector('.shell-frame')).toBeNull();
  expect(screen.queryByRole('banner')).toBeNull();
  expect(screen.queryByRole('navigation')).toBeNull();

  // 15.9: not an Auth_Feature screen. Every auth screen — including the auth
  // feature's own fallback, which shares this heading's wording — renders through
  // `AuthLayout`, so its absence is the discriminator; the fallback's own text and
  // control, and any form field, are checked too.
  expect(document.querySelector('.auth-layout')).toBeNull();
  expect(screen.queryByText(AUTH_NOT_FOUND_MESSAGE)).toBeNull();
  expect(
    screen.queryByRole('link', { name: AUTH_NOT_FOUND_BACK_TO_LOG_IN_LABEL }),
  ).toBeNull();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);

  // 15.9: no navigation to the Log_In_Route — the Location is still the address
  // that was requested, untouched.
  const expected = requestedLocation(requested);
  expect(router.state.location.pathname).toBe(expected.pathname);
  expect(normalisePath(router.state.location.pathname)).not.toBe(LOG_IN_ROUTE);

  // 15.9: no Redirect_Capture — nothing appended a redirect parameter, and the
  // query is exactly the one requested.
  expect(
    new URLSearchParams(router.state.location.search).get(REDIRECT_PARAM_NAME),
  ).toBeNull();
  expect(router.state.location.search).toBe(expected.search);
  expect(router.state.location.hash).toBe(expected.hash);

  // 15.9: no full-document reload. Activating the control navigates within the
  // router — the Location becomes the landing route and the landing page renders
  // while the very same document element stays in place, which a reload could not
  // do.
  const documentElementBefore = document.documentElement;
  fireEvent.click(control);
  await flush();

  expect(router.state.location.pathname).toBe(LANDING_ROUTE);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    landingContent.hero.headline,
  );
  expect(document.documentElement).toBe(documentElementBefore);
}

afterEach(() => {
  // The auth table's and the shell's Theme_Providers apply the resolved Theme to
  // the document element, which outlives an unmount.
  resetThemeAttribute();
});

// --- The property ------------------------------------------------------------

describe('appRouter — Property 38 (unmatched path outside /app)', () => {
  it('admits only unmatched paths outside /app into the generator', () => {
    // Every registered path is excluded, under any casing and with or without a
    // trailing separator.
    for (const path of REGISTERED_PATHS) {
      expect(matchesNoRegisteredRoute(path)).toBe(false);
      expect(matchesNoRegisteredRoute(`${path}/`)).toBe(false);
      expect(matchesNoRegisteredRoute(path.toUpperCase())).toBe(false);
    }

    // As is everything the shell's own `/app/*` not-found owns (Requirement 3.10).
    expect(matchesNoRegisteredRoute(HOME_ROUTE)).toBe(false);
    expect(matchesNoRegisteredRoute('/App/Settings/')).toBe(false);
    expect(matchesNoRegisteredRoute('/app/nothing-here')).toBe(false);

    // And every near miss is admitted, so the boundary cases are actually run.
    for (const path of NEAR_MISS_PATHS) {
      expect(matchesNoRegisteredRoute(path)).toBe(true);
    }
  });

  // Feature: app-shell, Property 38: An unmatched path outside `/app` reaches the application not-found screen
  // Validates: Requirements 15.9
  it('reaches the application not-found screen and nothing else', async () => {
    const routes: RouteObject[] = assembleRoutes();

    await fc.assert(
      fc.asyncProperty(unmatchedPathArb, async (requested) => {
        try {
          const router = await renderAt(routes, requested);
          await expectApplicationNotFound(router, requested);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
