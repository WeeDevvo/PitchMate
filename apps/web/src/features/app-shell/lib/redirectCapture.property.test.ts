import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_CAPTURED_PATH_LENGTH,
  loginRedirectTarget,
} from './redirectCapture';

/**
 * Property tests for the Redirect_Capture construction (Requirements 2.5, 2.6,
 * 2.7), placed beside the module they cover as Requirement 14.2 asks, at well
 * over the 100-iteration floor.
 *
 * These carry the pure half of **Property 2: The unauthenticated boundary leaks
 * nothing and captures the path reversibly** — the reversibility and the
 * 2048/2049-character boundary. The rendering half (that neither the Shell_Frame
 * nor any Destination_Content is painted for a visitor) belongs to the
 * Route_Guard's own test, which mounts a component.
 *
 * The Log_In_Route path and the parameter name are *generated*, never assumed:
 * the module must hold no copy of either (Requirement 2.6), so a test that only
 * ever passed `/login` and `redirect` could not tell a parameterised
 * implementation from a hard-coded one.
 */

/** Log_In_Route paths a caller could hand in, including awkward ones. */
const loginRouteArb: fc.Arbitrary<string> = fc.constantFrom(
  '/login',
  '/sign-in',
  '/auth/log-in',
  '/login?locale=en-GB',
  '/login#top',
  '/login?locale=en-GB#top',
);

/** Redirect_Capture parameter names a caller could hand in. */
const paramNameArb: fc.Arbitrary<string> = fc.constantFrom(
  'redirect',
  'returnTo',
  'next',
  'return url',
);

/**
 * Requested shell paths: plain paths, paths carrying a query string and a
 * fragment, and arbitrary well-formed text. The interesting inputs are the ones
 * whose own `?`, `#`, `&`, `=`, and `+` could be mistaken for structure of the
 * Log_In_Route's query string, so they are generated deliberately rather than
 * left to chance.
 */
const requestedPathArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('/app', '/app/notifications', '/app/settings') },
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom('/app', '/app/squads/7f3a', '/app/profile'),
        fc.constantFrom('', '?tab=stats', '?tab=stats&sort=name', '?q=a+b&r=%20'),
        fc.constantFrom('', '#top', '#a=b?c'),
      )
      .map(([path, query, fragment]) => `${path}${query}${fragment}`),
  },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 200 }) },
  {
    weight: 2,
    // Well-formed unicode (no unpaired surrogates), so the round trip is
    // expected to hold for these too.
    arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 200 }),
  },
);

/**
 * Read one parameter back out of a target the way a consumer does — through
 * `URLSearchParams`, which percent-decodes and also treats `+` as a space. An
 * exact round trip therefore requires the encoder to have escaped `+` too.
 */
function capturedValue(target: string, paramName: string): string | null {
  const fragmentAt = target.indexOf('#');
  const base = fragmentAt === -1 ? target : target.slice(0, fragmentAt);
  const queryAt = base.indexOf('?');

  if (queryAt === -1) {
    return null;
  }

  const value = new URLSearchParams(base.slice(queryAt + 1)).get(paramName);

  return value;
}

/** A requested path of exactly `length` characters, shaped like a shell path. */
function pathOfLength(length: number): string {
  return `/app/${'a'.repeat(length - 5)}`;
}

// Feature: app-shell, Property 2 (pure half): the captured path is reversible
// Validates: Requirements 2.5, 2.6, 2.7
describe('loginRedirectTarget — the captured path is reversible', () => {
  it('captures the whole requested path, query and fragment included, as one decodable parameter value', () => {
    fc.assert(
      fc.property(
        requestedPathArb,
        loginRouteArb,
        paramNameArb,
        (requestedPath, loginRoute, paramName) => {
          const target = loginRedirectTarget(requestedPath, loginRoute, paramName);

          // Requirement 2.5: decoding the parameter yields the requested path
          // character-for-character.
          expect(capturedValue(target, paramName)).toBe(requestedPath);

          // Requirement 2.6: the route and the parameter name are the supplied
          // ones — the target starts from the given route and names the given
          // parameter, with no shell-local substitute for either.
          expect(target.startsWith(loginRoute.split('#')[0])).toBe(true);
          expect(target).toContain(`${encodeURIComponent(paramName)}=`);

          // Exactly one parameter is added: the requested path is a single
          // value, never split across several.
          const fragmentAt = target.indexOf('#');
          const base = fragmentAt === -1 ? target : target.slice(0, fragmentAt);
          const added = new URLSearchParams(base.slice(base.indexOf('?') + 1));
          expect(added.getAll(paramName)).toHaveLength(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds for a requested path of exactly the maximum length and drops one character longer', () => {
    fc.assert(
      fc.property(loginRouteArb, paramNameArb, (loginRoute, paramName) => {
        const atLimit = pathOfLength(MAX_CAPTURED_PATH_LENGTH);
        const overLimit = pathOfLength(MAX_CAPTURED_PATH_LENGTH + 1);

        expect(atLimit).toHaveLength(2048);
        expect(overLimit).toHaveLength(2049);

        // 2048 characters: captured and reversible (Requirement 2.5).
        expect(
          capturedValue(loginRedirectTarget(atLimit, loginRoute, paramName), paramName),
        ).toBe(atLimit);

        // 2049 characters: no parameter at all, so the Auth_Feature falls back
        // to the Default_Authenticated_Route (Requirement 2.7). Nothing of the
        // requested path survives — not even a prefix.
        const overTarget = loginRedirectTarget(overLimit, loginRoute, paramName);
        expect(overTarget).toBe(loginRoute);
        expect(capturedValue(overTarget, paramName)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('omits the parameter for every requested path longer than the maximum, never truncating', () => {
    const overLimitArb = fc
      .integer({ min: MAX_CAPTURED_PATH_LENGTH + 1, max: MAX_CAPTURED_PATH_LENGTH + 500 })
      .map(pathOfLength);

    fc.assert(
      fc.property(
        overLimitArb,
        loginRouteArb,
        paramNameArb,
        (requestedPath, loginRoute, paramName) => {
          const target = loginRedirectTarget(requestedPath, loginRoute, paramName);

          expect(target).toBe(loginRoute);
          expect(capturedValue(target, paramName)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: app-shell, Property 2 (pure half): the construction is total
// Validates: Requirements 2.5, 2.7, 14.12
describe('loginRedirectTarget — the construction is total', () => {
  it('yields a string and raises no exception for any input of any type', () => {
    // The declared signature is three strings; the guard must still survive the
    // values a boundary can actually be handed at run time — absent, null, a
    // value of another type, and a string carrying an unpaired surrogate that
    // `encodeURIComponent` rejects.
    const anyArb = fc.oneof(
      { weight: 3, arbitrary: requestedPathArb },
      { weight: 1, arbitrary: fc.constantFrom('', '\uD800', 'a\uDFFF', '\uDC00\uD800') },
      { weight: 2, arbitrary: fc.anything() },
    ) as fc.Arbitrary<string>;

    fc.assert(
      fc.property(anyArb, anyArb, anyArb, (requestedPath, loginRoute, paramName) => {
        const target = loginRedirectTarget(requestedPath, loginRoute, paramName);

        expect(typeof target).toBe('string');
      }),
      { numRuns: 500 },
    );
  });

  it('falls back to the log-in route alone when there is nothing capturable', () => {
    fc.assert(
      fc.property(loginRouteArb, paramNameArb, (loginRoute, paramName) => {
        // No requested path, and no parameter name to carry it under: the target
        // is the route on its own, which is always somewhere valid to send a
        // visitor.
        expect(loginRedirectTarget('', loginRoute, paramName)).toBe(loginRoute);
        expect(loginRedirectTarget('/app', loginRoute, '')).toBe(loginRoute);
        expect(
          loginRedirectTarget('/app\uD800', loginRoute, paramName),
        ).toBe(loginRoute);
      }),
      { numRuns: 100 },
    );
  });
});
