/**
 * Property test for the Invite_Landing_Route's Invite_Secret round trip and for
 * the incomplete-link surface (task 14.3).
 *
 * **Property 9: The Invite_Landing_Route path round-trips the Invite_Secret.**
 * *For any* non-empty Invite_Secret of up to 512 characters, including reserved
 * and non-ASCII characters, extracting the Invite_Secret from the
 * Invite_Landing_Route path built from that secret yields that secret
 * character-for-character; and *for any* path whose `code` segment is absent,
 * empty, empty after trimming, or not decodable, the extraction yields a named
 * extraction failure, no `PreviewInvite` call and no `RedeemInvite` call are
 * issued, and the rendered surface states that the invite link is incomplete and
 * presents a control to the Squads_Home.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 5.11, 20.8 — the pure extraction recovers every built secret exactly | {@link describe} "the pure round trip" |
 * | 11.8 — the built address *resolves to* the Invite_Landing_Route | {@link expectResolvedToTheInviteRoute} |
 * | 5.11 — the secret reaches `RedeemInvite` character-for-character | {@link expectRedeemCarriesTheSecret} |
 * | 5.11, 20.8 — the requested path survives the Redirect_Capture round trip | {@link expectHandoverCarriesTheRequestedPath} |
 * | 5.9 — a named extraction failure for each broken shape | {@link expectNamedExtractionFailure} |
 * | 5.9 — neither call is issued | {@link expectNeitherCallWasIssued} |
 * | 5.9 — the incomplete-link message, and nothing else of the five surfaces | {@link expectIncompleteLinkSurface} |
 * | 5.9 — a control that *navigates* to the Squads_Home | {@link expectHomeControlNavigates} |
 *
 * ### Why the round trip is asserted through a rendered route, not only a function
 *
 * `lib/inviteSecret.ts` and `lib/routePaths.ts` are pure and could be paired by a
 * two-line property — and the first `describe` below does exactly that, because
 * Requirement 20.8 asks for the extraction to be covered by a round-trip property
 * in its own right. But the claim the product depends on is larger than the pair:
 * the path has to be *routable*. Requirement 11.8 asks that opening the address
 * built from a returned Invite_Link resolves to the Invite_Landing_Route for that
 * invite, and a secret carrying `/`, `?`, `#`, or `%` is exactly what could make a
 * path resolve somewhere else, resolve to a second segment, or arrive at the
 * screen already mangled.
 *
 * So the rendered halves drive a real `MemoryRouter` whose route table registers
 * the real `INVITE_LANDING_ROUTE` pattern, entered at the real
 * `inviteLandingPath(secret)`, and read the secret back from the place it actually
 * has to arrive: the `RedeemInvite` request body. A wildcard route registers the
 * same screen for every other path, so a path that fails to match the pattern
 * still renders and is caught by {@link expectResolvedToTheInviteRoute} naming the
 * mismatch, rather than by an empty document.
 *
 * ### The two ways a complete link is observed
 *
 * The Auth_State decides which call is owed, so both are exercised:
 *
 * - **`authenticated`** — one `RedeemInvite`, whose body carries the secret. The
 *   fake leaves that call pending, so the screen stays on the busy surface and
 *   the property reads the issued body without a navigation intervening.
 * - **`unauthenticated`** — one `PreviewInvite` and the handover surface, whose
 *   two controls carry the *requested path* as the Redirect_Capture value. That
 *   value is read back with the Auth_Feature's own `redirectCandidateFromSearch`
 *   and the secret is recovered from it, which is the round trip a person actually
 *   takes: land, sign up, come back, redeem.
 *
 * A query string is generated onto the entry in both cases and a fragment too:
 * `inviteLandingPath` percent-encodes `?` and `#`, so neither introducer can ever
 * be part of a secret and cutting at the first of them cannot shorten one
 * (Requirement 20.8). The fragment is expected *not* to travel in the redirect
 * value, because a fragment is never sent anywhere.
 *
 * ### The broken shapes, and how the generator is kept honest
 *
 * All three named failures are generated — `absent`, `empty`, `undecodable` —
 * across the shapes Requirement 5.9 enumerates: no `/join/` marker at all, the
 * marker with nothing after it, an empty segment before a second one, a segment
 * that is whitespace or `%20`, and segments carrying malformed percent-escapes.
 * Each case carries the reason it claims to produce and
 * {@link expectNamedExtractionFailure} checks the real extraction against it, so a
 * generator that drifted into producing a *valid* secret fails loudly instead of
 * quietly weakening the property.
 *
 * ### Two documented exclusions
 *
 * 1. **Edge whitespace is outside the character-for-character claim.** The
 *    extraction trims after decoding, so a secret intending to carry leading or
 *    trailing whitespace comes back trimmed; `lib/inviteSecret.ts` documents this
 *    and the backend's tokens carry none.
 * 2. **A secret of `.` or `..` is excluded from the *rendered* halves only.**
 *    Neither character is percent-encoded, so such a path is a dot segment that
 *    URL and history normalisation may rewrite before the screen ever sees it.
 *    The pure round trip below keeps both shapes, so the extraction is still held
 *    to them; what is not claimed is that a browser would route them.
 *
 * Deliberately **not** claimed here: the once-per-path redemption discipline
 * (Property 11, `state/useInviteRedemption.property.test.tsx`), the unusable and
 * failure surfaces, and the wording of any message — the copy is read from
 * `lib/messages.ts` rather than restated.
 *
 * Feature: web-squads-screens, Property 9: The Invite_Landing_Route path round-trips the Invite_Secret
 * Validates: Requirements 5.9, 5.11, 11.8, 20.8
 */
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import {
  AuthProvider,
  redirectCandidateFromSearch,
  type AuthState,
  type SessionManager,
} from '../../auth';
import type {
  CallResult,
  RedeemInviteRequest,
  SquadsApi,
} from '../api/squadsApi';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import {
  extractInviteSecretFromPath,
  type InviteSecretFailureReason,
} from '../lib/inviteSecret';
import {
  INVITE_LANDING_HEADING,
  INVITE_LINK_INCOMPLETE,
  INVITE_SIGN_IN_REQUIRED_INSTRUCTION,
  INVITE_UNUSABLE,
  SQUADS_HOME_CONTROL_LABEL,
} from '../lib/messages';
import type { InvitePreview } from '../lib/parse/invitePreview';
import { INVITE_LANDING_ROUTE, inviteLandingPath } from '../lib/routePaths';
import {
  INVITE_HANDOVER_SELECTOR,
  INVITE_LANDING_SELECTOR,
  InviteLandingScreen,
} from './InviteLandingScreen';

// --- The recording Squads_Api fake --------------------------------------------

/** What the two calls this route may issue were asked, and how often. */
interface ApiCallLog {
  /** How many `PreviewInvite` calls were issued (Requirement 5.9). */
  previewCalls: number;
  /** Every `RedeemInvite` body issued, in order (Requirements 5.9, 5.11). */
  readonly redeemCommands: RedeemInviteRequest[];
}

/**
 * A Squads_Api method the Invite_Landing_Route must never call.
 *
 * Throwing rather than answering is what makes "no call was issued" total: the
 * property does not merely count the two endpoints this route owns, it fails
 * outright if the screen reaches for any other operation.
 */
function unavailable(method: string): () => never {
  return () => {
    throw new Error(`the Invite_Landing_Route must not call ${method}`);
  };
}

/** The preview the fake answers with — generic wording, naming no squad. */
const PREVIEW_RESULT: CallResult<InvitePreview> = {
  kind: 'success',
  value: {
    requiresAuthentication: true,
    message: 'Sign in or create an account to join this squad.',
  },
};

/**
 * A Squads_Api that records the two calls this route may issue and refuses the
 * rest.
 *
 * `redeemInvite` returns a promise that never settles on purpose. This property
 * is about the *body* the call carries, and a settled success would navigate away
 * from the screen (Requirement 5.8) while a settled failure would swap the
 * surface — either would replace what is being observed with something else. A
 * pending call leaves the screen on its busy surface with the issued body
 * recorded, which is precisely the observation wanted.
 */
function createRecordingSquadsApi(): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const log: ApiCallLog = { previewCalls: 0, redeemCommands: [] };

  const api: SquadsApi = {
    previewInvite: () => {
      log.previewCalls += 1;
      return Promise.resolve(PREVIEW_RESULT);
    },
    redeemInvite: (command) => {
      log.redeemCommands.push(command);
      return new Promise(() => {
        // Deliberately never settles; see the note above.
      });
    },
    listMySquads: unavailable('listMySquads'),
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    createSquad: unavailable('createSquad'),
    listInvites: unavailable('listInvites'),
    generateInvite: unavailable('generateInvite'),
    revokeInvite: unavailable('revokeInvite'),
    createGuest: unavailable('createGuest'),
    editGuest: unavailable('editGuest'),
    promoteToAdmin: unavailable('promoteToAdmin'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    setFeatureFlag: unavailable('setFeatureFlag'),
  };

  return { api, log };
}

/** A `SessionManager` reporting one fixed Auth_State, and nothing else. */
function sessionManager(authState: AuthState): SessionManager {
  return {
    bootstrap: () => authState,
    establish: () => undefined,
    getState: () => authState,
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

// --- The harness --------------------------------------------------------------

/** Which route of the harness's table the requested path resolved to. */
type RouteMatch = 'invite-landing-pattern' | 'wildcard';

/** The attribute {@link expectResolvedToTheInviteRoute} reads. */
const ROUTE_MATCH_ATTRIBUTE = 'data-invite-route-match';

/** The marker rendered where a click on the Squads_Home control lands. */
const HOME_MARKER_TEST_ID = 'squads-home-destination';

/**
 * Records which route matched, around the screen it wraps.
 *
 * A wrapper rather than a prop on the screen: the screen must be the application's
 * own, unmodified, so the only thing the harness may add is around it.
 */
function MatchedRoute({
  at,
  children,
}: {
  readonly at: RouteMatch;
  readonly children: ReactNode;
}): ReactElement {
  return <div {...{ [ROUTE_MATCH_ATTRIBUTE]: at }}>{children}</div>;
}

/** What one rendered path produced. */
interface Rendered {
  readonly log: ApiCallLog;
  /** The Invite_Landing_Route subtree's text. */
  readonly text: string;
  /** Which harness route the requested path resolved to. */
  readonly match: RouteMatch | null;
}

/** One macrotask, with every resulting React update applied. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Render the Invite_Landing_Route for one requested path and let its calls issue.
 *
 * The real `INVITE_LANDING_ROUTE` pattern is registered, so a path that resolves
 * here resolved the way the application's own route table would resolve it
 * (Requirement 11.8). The wildcard registers the same screen for every other
 * path, which is what lets the broken shapes — `/join`, `/join/`, `/join//x`, a
 * path belonging to no route at all — be rendered and asserted on rather than
 * silently dropped by the router.
 *
 * `HOME_ROUTE` is registered with a marker so activating the Squads_Home control
 * is observable as a *navigation* rather than only as an `href`.
 */
async function renderPath(
  requestedEntry: string,
  authState: AuthState,
): Promise<Rendered> {
  const { api, log } = createRecordingSquadsApi();

  render(
    <AuthProvider manager={sessionManager(authState)}>
      <MemoryRouter initialEntries={[requestedEntry]}>
        <Routes>
          <Route
            path={INVITE_LANDING_ROUTE}
            element={
              <MatchedRoute at="invite-landing-pattern">
                <InviteLandingScreen api={api} />
              </MatchedRoute>
            }
          />
          <Route
            path={HOME_ROUTE}
            element={<div data-testid={HOME_MARKER_TEST_ID}>Your squads</div>}
          />
          <Route
            path="*"
            element={
              <MatchedRoute at="wildcard">
                <InviteLandingScreen api={api} />
              </MatchedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  // Two flushes: the first runs the mount effect that issues a call, the second
  // applies the update its resolved outcome dispatches.
  await tick();
  await tick();

  const root = document.querySelector(INVITE_LANDING_SELECTOR);

  if (root === null) {
    throw new Error(
      `the Invite_Landing_Route did not render for ${requestedEntry}`,
    );
  }

  const wrapper = root.closest(`[${ROUTE_MATCH_ATTRIBUTE}]`);

  return {
    log,
    text: root.textContent ?? '',
    match: (wrapper?.getAttribute(ROUTE_MATCH_ATTRIBUTE) ?? null) as
      | RouteMatch
      | null,
  };
}

// --- Generators ---------------------------------------------------------------

/** The characters reserved in a URL, each of which the path must encode away. */
const RESERVED_CHARACTERS = ['/', '?', '#', '&', '=', '%', '+'] as const;

/** The exact secret lengths this property's Testing Strategy names. */
const SECRET_LENGTHS = [1, 8, 12, 512] as const;

/** Characters a backend token plausibly uses. */
const tokenCharacterArb = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split(
    '',
  ),
);

/** Every reserved character, so a secret carrying one is generated often. */
const reservedCharacterArb = fc.constantFrom(...RESERVED_CHARACTERS);

/**
 * Non-ASCII characters of a single UTF-16 code unit, across several scripts.
 *
 * Single-code-unit on purpose: they are the units of the fixed-length family, so a
 * request for a 512-character secret yields a string of exactly 512 characters.
 * None is whitespace, so a generated secret is trim-stable by construction.
 */
const nonAsciiCharacterArb = fc.constantFrom(
  'ü',
  'é',
  'ñ',
  'ß',
  'Ω',
  '√',
  '≈',
  'ç',
  '日',
  '語',
  'Ж',
  'ﬀ',
  '—',
  '·',
  '¿',
);

/** Any single-code-unit secret character: token, reserved, or non-ASCII. */
const secretCharacterArb = fc.oneof(
  { weight: 4, arbitrary: tokenCharacterArb },
  { weight: 3, arbitrary: reservedCharacterArb },
  { weight: 3, arbitrary: nonAsciiCharacterArb },
);

/**
 * A secret of exactly 1, 8, 12, or 512 characters — the lengths named for this
 * property, with 8 and 12 the bounds of the short Invite_Code and 512 the upper
 * bound Requirement 5.11 states.
 */
const fixedLengthSecretArb: fc.Arbitrary<string> = fc
  .constantFrom(...SECRET_LENGTHS)
  .chain((length) =>
    fc.string({
      unit: secretCharacterArb,
      minLength: length,
      maxLength: length,
    }),
  );

/** Curated secrets a reader can recognise, including the awkward shapes. */
const curatedSecretArb: fc.Arbitrary<string> = fc.constantFrom(
  'a',
  '/',
  '?',
  '#',
  '&',
  '=',
  '%',
  '+',
  '%2F',
  '%zz',
  '%%%',
  'a/b',
  'a?b=c',
  'a#b',
  'a&b=c+d',
  '.',
  '..',
  '../../etc/passwd',
  'join',
  'ABCD1234',
  'ABCD1234EFGH',
  'ünïcödé',
  '日本語',
  'Ω≈ç√',
  '🙈🙉🙊',
  'a'.repeat(512),
  '%'.repeat(512),
  '/'.repeat(512),
  '日'.repeat(512),
);

/** Any Invite_Secret shape: fixed-length, curated, free text, or graphemes. */
const anySecretArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fixedLengthSecretArb },
  { weight: 4, arbitrary: curatedSecretArb },
  { weight: 2, arbitrary: fc.string({ minLength: 1, maxLength: 64 }) },
  {
    weight: 2,
    arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 64 }),
  },
);

/**
 * A secret within the character-for-character claim: non-empty and free of edge
 * whitespace, which the extraction trims (see the module docblock).
 */
const secretArb: fc.Arbitrary<string> = anySecretArb.filter(
  (secret) => secret.length > 0 && secret === secret.trim(),
);

/** Whether the encoded segment for a secret is a dot segment. */
function isDotSegment(secret: string): boolean {
  return /^\.{1,2}$/u.test(encodeURIComponent(secret));
}

/**
 * A secret whose path is safe to *route*: everything {@link secretArb} yields,
 * less `.` and `..`, whose paths are dot segments a history or URL normalisation
 * may rewrite before the screen sees them. The pure round trip keeps both.
 */
const routableSecretArb: fc.Arbitrary<string> = secretArb.filter(
  (secret) => !isDotSegment(secret),
);

/** A query string a forwarded invite link arrives with, or none. */
const queryArb = fc.constantFrom(
  '',
  '?utm_source=whatsapp',
  '?a=1&b=2%20c',
  '?redirect=%2Felsewhere',
);

/** A fragment, which is never sent anywhere, or none. */
const fragmentArb = fc.constantFrom('', '#', '#top', '#a?b');

/** One broken `code` segment shape, with the failure it claims to produce. */
interface IncompleteCase {
  /** The requested path, before a query or fragment is appended. */
  readonly path: string;
  /** The named failure the extraction must yield (Requirement 5.9). */
  readonly reason: InviteSecretFailureReason;
}

/**
 * Paths carrying no `/join/` marker at all, so there is no `code` segment to
 * read: a link truncated before the slash, a path belonging to another route, and
 * near-misses of the marker itself.
 *
 * `HOME_ROUTE` is deliberately not among them — it is registered in the harness's
 * route table, so a path equal to it would render the marker rather than the
 * screen.
 */
const absentCaseArb: fc.Arbitrary<IncompleteCase> = fc
  .constantFrom(
    '/join',
    '/joining/abc',
    '/join-us/abc',
    '/JOIN/abc',
    '/',
    '/app/squads/abc',
  )
  .map((path) => ({ path, reason: 'absent' as const }));

/**
 * Paths whose segment is empty, or empty once decoded and trimmed: the marker
 * with nothing after it, an empty first segment, literal whitespace, and the
 * percent-encoded whitespace a wrapped email produces.
 */
const emptyCaseArb: fc.Arbitrary<IncompleteCase> = fc
  .constantFrom(
    '/join/',
    '/join//abc',
    '/join/%20',
    '/join/%20%20%20',
    '/join/%09%0A',
    '/join/%C2%A0',
    '/join/%E3%80%80',
    '/join/ ',
  )
  .map((path) => ({ path, reason: 'empty' as const }));

/** Paths whose segment carries a malformed percent-escape — a hand-edited link. */
const undecodableCaseArb: fc.Arbitrary<IncompleteCase> = fc
  .constantFrom(
    '/join/%',
    '/join/%zz',
    '/join/%2',
    '/join/abc%',
    '/join/%%%',
    '/join/%E0%A4%A',
    '/join/%FF',
  )
  .map((path) => ({ path, reason: 'undecodable' as const }));

/** All three named failures, each generated across its own shapes. */
const incompleteCaseArb: fc.Arbitrary<IncompleteCase> = fc.oneof(
  absentCaseArb,
  emptyCaseArb,
  undecodableCaseArb,
);

const authStateArb = fc.constantFrom<AuthState>(
  'authenticated',
  'unauthenticated',
);

// --- Assertions ---------------------------------------------------------------

/**
 * Requirement 11.8: the address built for a secret resolves to the
 * Invite_Landing_Route rather than to some other route or to none.
 */
function expectResolvedToTheInviteRoute(rendered: Rendered): void {
  expect(
    rendered.match,
    'the built invite address must resolve to the Invite_Landing_Route pattern',
  ).toBe('invite-landing-pattern');
}

/**
 * Requirement 5.11: exactly one `RedeemInvite` was issued and its body carries the
 * secret character-for-character — no re-encoding, no truncation at a reserved
 * character, no case folding.
 */
function expectRedeemCarriesTheSecret(
  rendered: Rendered,
  secret: string,
): void {
  expect(
    rendered.log.redeemCommands.map((command) => command.presentedSecret),
  ).toEqual([secret]);
  expect(rendered.log.previewCalls).toBe(0);
}

/**
 * Requirements 5.11 and 20.8: both handover controls carry the requested
 * Invite_Landing_Route path as the Redirect_Capture value, and the secret is
 * recoverable from that value character-for-character.
 *
 * The value is read back with the Auth_Feature's own `redirectCandidateFromSearch`
 * — the exact counterpart of the `URLSearchParams` encoding the screen performs —
 * so what is asserted is the round trip a person takes through sign-up, not a
 * re-implementation of the encoding.
 */
function expectHandoverCarriesTheRequestedPath(
  secret: string,
  expectedRequestedPath: string,
): void {
  const handover = document.querySelector(INVITE_HANDOVER_SELECTOR);
  expect(handover).not.toBeNull();

  const controls = Array.from(handover?.querySelectorAll('a') ?? []);
  expect(controls).toHaveLength(2);

  for (const control of controls) {
    const href = control.getAttribute('href') ?? '';
    const target = new URL(href, 'https://web.test');
    const captured = redirectCandidateFromSearch(target.search);

    // The requested path, character-for-character: the path the screen was
    // mounted on, query string included, fragment excluded.
    expect(captured).toBe(expectedRequestedPath);

    // And the secret is still recoverable from it, which is the whole point of
    // carrying the path rather than the secret.
    expect(
      captured === null
        ? { ok: false }
        : extractInviteSecretFromPath(captured),
    ).toEqual({ ok: true, secret });
  }
}

/**
 * Requirement 5.9: the extraction yields the *named* failure this case claims.
 *
 * Asserted rather than filtered, so a generated shape that turned out to carry a
 * readable secret fails loudly instead of quietly narrowing the property.
 */
function expectNamedExtractionFailure(
  requestedPath: string,
  reason: InviteSecretFailureReason,
): void {
  expect(extractInviteSecretFromPath(requestedPath)).toEqual({
    ok: false,
    reason,
  });
}

/** Requirement 5.9: neither call was issued for an unreadable path. */
function expectNeitherCallWasIssued(rendered: Rendered): void {
  expect(rendered.log.previewCalls).toBe(0);
  expect(rendered.log.redeemCommands).toEqual([]);
}

/**
 * Requirement 5.9: the incomplete-link message is rendered, and none of the other
 * four surfaces is.
 *
 * The negative half matters as much as the positive one: "states that the link is
 * incomplete" must not be satisfiable by a screen that also offers the handover,
 * claims to be joining, or shows an outcome about an invite that was never
 * presented.
 */
function expectIncompleteLinkSurface(rendered: Rendered): void {
  expect(rendered.text).toContain(INVITE_LINK_INCOMPLETE);

  expect(document.querySelector(INVITE_HANDOVER_SELECTOR)).toBeNull();
  expect(document.querySelector(LOADING_INDICATION_SELECTOR)).toBeNull();
  expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  expect(rendered.text).not.toContain(INVITE_UNUSABLE);
  expect(rendered.text).not.toContain(INVITE_SIGN_IN_REQUIRED_INSTRUCTION);

  // 5.2, 19.1: the route's own single level-one heading is still what introduces
  // the surface — the incomplete link replaces the body, not the screen.
  expect(
    Array.from(document.querySelectorAll('h1')).map(
      (heading) => heading.textContent,
    ),
  ).toEqual([INVITE_LANDING_HEADING]);
}

/**
 * Requirement 5.9: the surface presents a control that *navigates* to the
 * Squads_Home.
 *
 * Activated with `user-event` and checked by arriving at the destination
 * registered at `HOME_ROUTE`, so the claim is about navigation rather than about
 * an `href` that happens to read correctly.
 */
async function expectHomeControlNavigates(): Promise<void> {
  const control = screen.getByRole('link', { name: SQUADS_HOME_CONTROL_LABEL });
  expect(control.getAttribute('href')).toBe(HOME_ROUTE);

  await userEvent.click(control);

  expect(screen.getByTestId(HOME_MARKER_TEST_ID)).toBeTruthy();
  expect(document.querySelector(INVITE_LANDING_SELECTOR)).toBeNull();
}

// --- The pure round trip ------------------------------------------------------

describe('Property 9 — the pure round trip through the Invite_Landing_Route path', () => {
  // Feature: web-squads-screens, Property 9: The Invite_Landing_Route path round-trips the Invite_Secret
  // Validates: Requirements 5.11, 20.8
  it('recovers every built secret character-for-character, reserved and non-ASCII alike', () => {
    fc.assert(
      fc.property(secretArb, queryArb, (secret, query) => {
        // 5.11: the pair `inviteLandingPath` / `extractInviteSecretFromPath` is a
        // round trip for every non-empty secret up to 512 characters. Pinned here
        // rather than only through a rendered screen, because the requirement
        // asks for a *pure* function and 20.8 asks for a round-trip property over
        // it.
        expect(
          extractInviteSecretFromPath(`${inviteLandingPath(secret)}${query}`),
        ).toEqual({ ok: true, secret });
      }),
      { numRuns: 500 },
    );
  });

  // Feature: web-squads-screens, Property 9: The Invite_Landing_Route path round-trips the Invite_Secret
  // Validates: Requirements 5.9, 5.11
  it('yields the named failure, and never a secret, for every broken code segment', () => {
    fc.assert(
      fc.property(
        incompleteCaseArb,
        queryArb,
        fragmentArb,
        ({ path, reason }, query, fragment) => {
          // 5.9: a query string and a fragment cannot repair a broken segment, and
          // cannot break a readable one either — both are cut before the segment
          // is read (20.8).
          expectNamedExtractionFailure(`${path}${query}${fragment}`, reason);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// --- The rendered round trip --------------------------------------------------

describe('Property 9 — the rendered Invite_Landing_Route round-trips the Invite_Secret', () => {
  // Feature: web-squads-screens, Property 9: The Invite_Landing_Route path round-trips the Invite_Secret
  // Validates: Requirements 5.11, 11.8, 20.8
  it('resolves the built address and carries the secret into the RedeemInvite body', async () => {
    await fc.assert(
      fc.asyncProperty(
        routableSecretArb,
        queryArb,
        fragmentArb,
        async (secret, query, fragment) => {
          const path = inviteLandingPath(secret);

          try {
            const rendered = await renderPath(
              `${path}${query}${fragment}`,
              'authenticated',
            );

            // 11.8: the address built from the secret reached this route.
            expectResolvedToTheInviteRoute(rendered);

            // 5.11, 20.8: and the secret arrived intact, through a path carrying
            // its reserved and non-ASCII characters percent-encoded, past a query
            // string and a fragment that could have eaten part of it.
            expectRedeemCarriesTheSecret(rendered, secret);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 600_000);

  // Feature: web-squads-screens, Property 9: The Invite_Landing_Route path round-trips the Invite_Secret
  // Validates: Requirements 5.11, 11.8, 20.8
  it('carries the requested path through the handover controls, secret recoverable', async () => {
    await fc.assert(
      fc.asyncProperty(
        routableSecretArb,
        queryArb,
        fragmentArb,
        async (secret, query, fragment) => {
          const path = inviteLandingPath(secret);

          try {
            const rendered = await renderPath(
              `${path}${query}${fragment}`,
              'unauthenticated',
            );

            expectResolvedToTheInviteRoute(rendered);

            // Non-vacuity: a complete link *does* reach the backend, so the
            // incomplete-link property below is claiming something.
            expect(rendered.log.previewCalls).toBe(1);
            expect(rendered.log.redeemCommands).toEqual([]);

            // 5.11, 20.8: the fragment is excluded because a fragment is never
            // sent anywhere; the query string is part of the requested path and
            // travels with it.
            expectHandoverCarriesTheRequestedPath(secret, `${path}${query}`);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 600_000);
});

// --- The incomplete link -----------------------------------------------------

describe('Property 9 — an incomplete Invite_Landing_Route path issues nothing', () => {
  // Feature: web-squads-screens, Property 9: The Invite_Landing_Route path round-trips the Invite_Secret
  // Validates: Requirements 5.9, 5.11, 20.8
  it('issues neither call and states that the link is incomplete, in either Auth_State', async () => {
    await fc.assert(
      fc.asyncProperty(
        incompleteCaseArb,
        queryArb,
        fragmentArb,
        authStateArb,
        async ({ path, reason }, query, fragment, authState) => {
          const requestedPath = `${path}${query}`;

          try {
            const rendered = await renderPath(
              `${requestedPath}${fragment}`,
              authState,
            );

            // 5.9: the extraction failed by name — and it is the failure this
            // generated shape claims to produce.
            expectNamedExtractionFailure(requestedPath, reason);

            // 5.9: so no `PreviewInvite` and no `RedeemInvite` was issued —
            // whether or not there was a session to redeem with.
            expectNeitherCallWasIssued(rendered);

            // 5.9: one fixed message about the address, and none of the other
            // four surfaces.
            expectIncompleteLinkSurface(rendered);

            // 5.9: and the way onward.
            await expectHomeControlNavigates();
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 600_000);
});
