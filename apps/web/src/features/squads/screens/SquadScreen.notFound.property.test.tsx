/**
 * Property test for the Not_Found_Treatment's identity across every cause
 * (task 13.2).
 *
 * **Property 13: The Not_Found_Treatment is identical for every cause and asserts
 * nothing.** *For any* cause of a not-found result on the Squad_Route — a squad
 * that does not exist, a squad the caller cannot access, a membership that is not
 * active, and a `squadId` path segment that is not a syntactically valid
 * identifier — the rendered content is identical, contains no squad name, no
 * player list, and no admin section, contains no statement that the squad exists,
 * does not exist, or is inaccessible for a particular reason, and for the invalid
 * identifier no `GetSquad` call is issued.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 6.5 — one treatment whose content is *identical* whatever the cause | {@link expectIdenticalAcrossCauses} |
 * | 6.4 — no Squad_Name, no Player_List, no Admin_Section | {@link expectNothingOfTheSquadIsRendered} |
 * | 6.4, 17.7 — no statement that the squad exists, does not exist, or is inaccessible for a reason | {@link expectNoCauseIsStated} |
 * | 6.6 — no `GetSquad` call for an identifier that is not syntactically valid | {@link expectNoSquadScopedRequest} |
 *
 * ### The causes are distinguished at the wire, not at the seam
 *
 * The three server-side causes all reach `CallResult` as the same `not-found`
 * value, so a property driven through a fake Squads_Api would be quantifying over
 * one input wearing three labels and would prove nothing about disclosure. Each
 * run therefore drives the **real** `createSquadsApi` over the **real** generated
 * `@pitchmate/api-client` with an injected `fetch`, and each cause answers
 * `GetSquad` with its own ProblemDetails body — its own status, its own `code`,
 * its own `title`, and a `detail` sentence that *names the squad and states the
 * cause outright*, in the shape `SquadErrorResults` builds. What the property then
 * claims is the interesting thing: none of that reaches the screen, and the four
 * causes are indistinguishable from one another on it.
 *
 * `403` is generated alongside `404` even though `GetSquad` conceals existence and
 * answers only `404` today. Both fold into the one non-disclosing branch
 * (`classifyOutcome`), so generating both means a backend that later stopped
 * concealing would still be covered by this property rather than by a new one.
 *
 * ### What else is generated, and why
 *
 * The incidentals around the failing call are generated per cause and *not* held
 * equal across them: the caller's `ListMySquads` standing (owner, admin, member,
 * a summary for another squad, and a failed listing), the leaderboard's outcome,
 * the squad's name, the letter case of the requested identity. Holding them equal
 * would leave the identity claim satisfiable by a screen that varies its content
 * with any of them — and the `owner` standing is the sharpest of the five, because
 * an Admin_Section is exactly what a screen that leaked the caller's authority
 * past the not-found branch would render.
 *
 * ### Identity is asserted on the markup, not on the words
 *
 * {@link expectIdenticalAcrossCauses} compares the Squad_Screen subtree's
 * `outerHTML`, so a difference in an attribute, an element, an order, or a class —
 * not only in visible text — fails the property. That is the strongest reading of
 * "identical", and it is available here because the treatment takes no props and
 * so has nothing to vary with (see `components/NotFoundTreatment.tsx`).
 *
 * Deliberately **not** claimed here: that a *failed* `GetSquad` renders the
 * `FailureNotice` rather than this treatment (a worked example beside this file),
 * and what the treatment's copy says (the copy lives in `lib/messages.ts` and is
 * read from there rather than restated).
 *
 * Feature: web-squads-screens, Property 13: The Not_Found_Treatment is identical for every cause and asserts nothing
 * Validates: Requirements 6.4, 6.5, 6.6, 17.7
 */
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import { createApiClient } from '@pitchmate/api-client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type SessionManager } from '../../auth';
import { createSquadsApi, type SquadsApi } from '../api/squadsApi';
import { ADMIN_SECTION_SELECTOR } from '../components/AdminSection';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import { NOT_FOUND_TREATMENT_SELECTOR } from '../components/NotFoundTreatment';
import { PLAYER_LIST_SELECTOR } from '../components/PlayerList';
import { PLAYER_ROW_SELECTOR } from '../components/PlayerRow';
import {
  codeFromMemberRole,
  codeFromMembershipState,
  type MemberRole,
  type MembershipStateValue,
} from '../lib/enumCodes';
import { isSquadIdentifier } from '../lib/identifiers';
import {
  NOT_FOUND_TREATMENT_BODY,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_HOME_LABEL,
} from '../lib/messages';
import { SQUAD_ROUTE, squadPath } from '../lib/routePaths';
import { SQUAD_SCREEN_SELECTOR, SquadScreen } from './SquadScreen';

// --- The App_Shell seam -------------------------------------------------------

/**
 * `usePublishSquadScopeFromRoute` reads the App_Shell's publish context and
 * throws where none is above it, which is correct for the application — the
 * Squad_Route is a child of the shell's `/app` layout route — and unusable for a
 * screen rendered on its own. Only that one export is replaced; every other
 * app-shell export the subtree reads stays the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return { ...actual, usePublishSquadScopeFromRoute: () => null };
});

// --- The four causes ----------------------------------------------------------

/**
 * A cause of a not-found result on the Squad_Route, as Requirements 6.5 and 6.6
 * enumerate them.
 *
 * The first three are answers to a `GetSquad` call; the fourth is the absence of
 * one.
 */
type Cause =
  | 'absent-squad'
  | 'inaccessible-squad'
  | 'inactive-membership'
  | 'malformed-identifier';

/** All four, so a run covers every cause rather than a sampled subset. */
const CAUSES: readonly Cause[] = [
  'absent-squad',
  'inaccessible-squad',
  'inactive-membership',
  'malformed-identifier',
];

// --- Generators ---------------------------------------------------------------

/** The base URL of the injected client — never rendered, never asserted on. */
const BASE_URL = 'https://api.test';

/**
 * A squad name carrying a generated nonce, so {@link expectNoCauseIsStated} can
 * look for the name in the rendered text and know that a hit is a leak rather
 * than a coincidence with the fixed copy.
 */
const squadNameArb: fc.Arbitrary<string> = fc
  .uuid()
  .map((nonce) => `Thursday Ballers pmn-${nonce}`);

/**
 * A well-formed squad identity in either letter case — the identity check accepts
 * both, and a screen that upper-cased or lower-cased what it renders would show
 * up in the identity comparison.
 */
const squadIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.uuid().map((identity) => identity.toUpperCase()),
);

/**
 * A `squadId` path segment that is **not** a syntactically valid identifier —
 * the near-misses a person actually produces, plus free text, plus a
 * well-formed identity spoiled in one of the ways `isSquadIdentifier` documents.
 *
 * Empty and whitespace-collapsed values are excluded because a path with an empty
 * segment matches no dynamic-segment route at all: the screen would not render,
 * so there would be nothing to make a claim about. Everything generated is
 * filtered through the real predicate, so a generator that wandered into the
 * accepted form cannot silently weaken the property.
 */
const malformedSquadIdArb: fc.Arbitrary<string> = fc
  .oneof(
    // Free text, including values carrying path and query separators — which
    // `squadPath` percent-encodes, so the route still resolves to one segment.
    fc.string({ minLength: 1, maxLength: 40, unit: 'grapheme' }),
    // The near-misses: the unhyphenated form, the braced form, the `urn:uuid:`
    // form, a well-formed identity inside whitespace, and one with a truncated
    // final group.
    fc.uuid().map((identity) => identity.replace(/-/gu, '')),
    fc.uuid().map((identity) => `{${identity}}`),
    fc.uuid().map((identity) => `urn:uuid:${identity}`),
    fc.uuid().map((identity) => ` ${identity}`),
    fc.uuid().map((identity) => identity.slice(0, -1)),
    fc.uuid().map((identity) => `${identity}x`),
    fc.constantFrom('not-an-identifier', '0', 'null', 'undefined', '%20'),
  )
  .filter((candidate) => candidate.trim().length > 0)
  .filter((candidate) => !isSquadIdentifier(candidate));

/**
 * The caller's own standing as `ListMySquads` reports it.
 *
 * `owner` and `admin` are the sharp cases: they are the standings that would
 * produce an Admin_Section on a screen that let the caller's authority past the
 * not-found branch. `other-squad` and `unavailable` are the other end — a caller
 * the feature cannot identify at all.
 */
type ListingCase =
  | { readonly kind: 'summary'; readonly role: MemberRole; readonly state: MembershipStateValue }
  | { readonly kind: 'other-squad' }
  | { readonly kind: 'unavailable' };

const listingArb: fc.Arbitrary<ListingCase> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('summary' as const),
      role: fc.constantFrom<MemberRole>('owner', 'admin', 'member'),
      state: fc.constantFrom<MembershipStateValue>('active', 'inactive'),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'other-squad' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'unavailable' as const }) },
);

/**
 * The Display_Rating_Leaderboard's outcome. A successful one carries an entry for
 * a generated player, which is a second name the screen must not render — the
 * leaderboard names people, and Requirement 7.11 already says a leaderboard
 * without a Squad_Detail contributes nothing.
 */
type LeaderboardCase =
  | { readonly kind: 'entries'; readonly playerName: string; readonly value: number }
  | { readonly kind: 'unavailable' };

const leaderboardArb: fc.Arbitrary<LeaderboardCase> = fc.oneof(
  fc.record({
    kind: fc.constant('entries' as const),
    playerName: fc.uuid().map((nonce) => `Ada pmp-${nonce}`),
    value: fc.integer({ min: 800, max: 2000 }),
  }),
  fc.constant({ kind: 'unavailable' as const }),
);

/** The rejecting status a not-found cause is answered with. See the module note. */
const notFoundStatusArb: fc.Arbitrary<number> = fc.constantFrom(404, 403);

/**
 * The problem `code` extension a cause can carry, drawn from the backend's own
 * `SquadErrorCode` members that map to a concealing status.
 */
const problemCodeArb: fc.Arbitrary<string> = fc.constantFrom(
  'Unauthorized',
  'NotAMember',
);

/**
 * The `detail` sentence the backend would write for a cause — deliberately the
 * most disclosing wording each cause could carry, naming the squad and stating
 * the cause outright, so {@link expectNoCauseIsStated} has something real to
 * exclude.
 */
function detailArb(cause: Cause, squadName: string): fc.Arbitrary<string> {
  switch (cause) {
    case 'absent-squad':
      return fc.constantFrom(
        `The squad ${squadName} does not exist.`,
        `No squad named ${squadName} exists.`,
      );
    case 'inaccessible-squad':
      return fc.constantFrom(
        `You are not a member of ${squadName}.`,
        `Access to ${squadName} is forbidden.`,
      );
    case 'inactive-membership':
      return fc.constantFrom(
        `Your membership of ${squadName} is inactive.`,
        `You were removed from ${squadName}.`,
      );
    // The fourth cause issues no call, so no backend wording exists for it.
    case 'malformed-identifier':
      return fc.constant('');
  }
}

/** Everything one cause's scenario needs, once generated. */
interface Scenario {
  readonly cause: Cause;
  /** The value placed in the route's `squadId` segment. */
  readonly requestedSquadId: string;
  readonly squadName: string;
  readonly listing: ListingCase;
  readonly leaderboard: LeaderboardCase;
  /** The `GetSquad` rejection, or `null` for the cause that issues no call. */
  readonly rejection: WireRejection | null;
}

/** A ProblemDetails answer, as `SquadErrorResults` builds one. */
interface WireRejection {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
}

/** One cause's scenario, with its own incidentals. */
function scenarioArb(cause: Cause): fc.Arbitrary<Scenario> {
  return squadNameArb.chain((squadName) =>
    fc.record({
      cause: fc.constant(cause),
      requestedSquadId:
        cause === 'malformed-identifier' ? malformedSquadIdArb : squadIdArb,
      squadName: fc.constant(squadName),
      listing: listingArb,
      leaderboard: leaderboardArb,
      rejection:
        cause === 'malformed-identifier'
          ? fc.constant(null)
          : fc.record({
              status: notFoundStatusArb,
              code: problemCodeArb,
              title: problemCodeArb,
              detail: detailArb(cause, squadName),
            }),
    }),
  );
}

/** One scenario per cause, each independently generated. */
const allCausesArb: fc.Arbitrary<readonly Scenario[]> = fc.tuple(
  ...CAUSES.map(scenarioArb),
);

// --- The transport ------------------------------------------------------------

/** What one request carried, reduced to what this property reads. */
interface RecordedRequest {
  readonly path: string;
  readonly method: string;
}

interface Harness {
  readonly api: SquadsApi;
  readonly requests: readonly RecordedRequest[];
  /** Requests to a path no screen in this property has any business issuing. */
  readonly unexpected: readonly RecordedRequest[];
}

/** `GET /squads` — the listing, which is not a squad-scoped read. */
const LIST_MY_SQUADS_PATH = '/squads';

/** A `200 OK` carrying `body` as JSON text. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The ProblemDetails answer a cause is expressed as. */
function problemResponse(rejection: WireRejection): Response {
  return new Response(
    JSON.stringify({
      type: 'https://tools.ietf.org/html/rfc9110',
      title: rejection.title,
      status: rejection.status,
      detail: rejection.detail,
      code: rejection.code,
    }),
    {
      status: rejection.status,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  );
}

/** The `ListMySquads` body a generated standing describes. */
function listingBody(scenario: Scenario): unknown {
  const { listing } = scenario;

  if (listing.kind === 'summary') {
    return [
      {
        squadId: scenario.requestedSquadId,
        name: scenario.squadName,
        role: codeFromMemberRole(listing.role),
        state: codeFromMembershipState(listing.state),
      },
    ];
  }

  if (listing.kind === 'other-squad') {
    return [
      {
        // A different squad entirely, so no summary identifies the caller here.
        squadId: '00000000-0000-4000-8000-000000000000',
        name: 'Another squad',
        role: codeFromMemberRole('owner'),
        state: codeFromMembershipState('active'),
      },
    ];
  }

  // A body the Response_Parser rejects, so the listing is simply unavailable.
  return { squads: 'not a list' };
}

/**
 * The real Squads_Api over the real generated client, with a `fetch` that answers
 * from the scenario and records what it was asked for.
 *
 * Nothing about the client, the facade, or the parsers is stubbed, so every
 * assertion below is made against what the screen does with an actual wire
 * answer.
 */
function createHarness(scenario: Scenario): Harness {
  const requests: RecordedRequest[] = [];
  const unexpected: RecordedRequest[] = [];

  const fetchImpl = (async (input: Request): Promise<Response> => {
    const path = new URL(input.url).pathname;
    const recorded: RecordedRequest = { path, method: input.method };
    requests.push(recorded);

    if (path === LIST_MY_SQUADS_PATH) {
      return jsonResponse(listingBody(scenario));
    }

    if (path.endsWith('/leaderboard')) {
      if (scenario.leaderboard.kind === 'entries') {
        return jsonResponse({
          entries: [
            {
              membershipId: '11111111-2222-4333-8444-555555555555',
              displayName: scenario.leaderboard.playerName,
              value: scenario.leaderboard.value,
            },
          ],
        });
      }

      return new Response(null, { status: 503 });
    }

    if (path.startsWith(`${LIST_MY_SQUADS_PATH}/`)) {
      // The squad-scoped read: the cause itself. A cause that issues no call
      // never reaches here, which is what {@link expectNoSquadScopedRequest}
      // checks independently.
      if (scenario.rejection !== null) {
        return problemResponse(scenario.rejection);
      }
    }

    unexpected.push(recorded);
    return new Response(null, { status: 500 });
  }) as unknown as typeof fetch;

  const apiClient = createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });

  return { api: createSquadsApi({ apiClient }), requests, unexpected };
}

/** A `SessionManager` reporting `authenticated` — the only state the screen reads in. */
function sessionManager(): SessionManager {
  return {
    bootstrap: () => 'authenticated',
    establish: () => undefined,
    getState: () => 'authenticated',
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

// --- Rendering ----------------------------------------------------------------

/** One macrotask, with every resulting React update applied. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * The rendered outcome of one scenario: the Squad_Screen subtree's markup, its
 * text, and what the transport was asked for.
 */
interface Rendered {
  readonly html: string;
  readonly text: string;
  readonly requests: readonly RecordedRequest[];
  readonly unexpected: readonly RecordedRequest[];
}

/**
 * Render the Squad_Screen for one scenario and let both squad reads and the
 * listing settle.
 *
 * The screen runs at the real `SQUAD_ROUTE` inside a real `MemoryRouter` and a
 * real `AuthProvider`, so the `squadId` arrives exactly as the router delivers it.
 * Settling waits for the treatment to appear and then keeps flushing, so a late
 * leaderboard or listing response has applied before the markup is captured.
 */
async function renderScenario(scenario: Scenario): Promise<Rendered> {
  const harness = createHarness(scenario);

  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[squadPath(scenario.requestedSquadId)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadScreen api={harness.api} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  const treatment = (): Element | null =>
    document.querySelector(NOT_FOUND_TREATMENT_SELECTOR);

  for (let round = 0; round < 40 && treatment() === null; round += 1) {
    await tick();
  }

  // Whether or not the treatment arrived, keep flushing: the assertions want the
  // settled screen, and a scenario that never reached the treatment must fail on
  // the treatment assertion rather than on a timeout.
  for (let round = 0; round < 4; round += 1) {
    await tick();
  }

  const root = document.querySelector(SQUAD_SCREEN_SELECTOR);

  if (root === null) {
    throw new Error('the Squad_Screen did not render at all');
  }

  return {
    html: root.outerHTML,
    text: root.textContent ?? '',
    requests: harness.requests,
    unexpected: harness.unexpected,
  };
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 6.4: the treatment is what is rendered, and the surfaces that
 * would say something about the squad are not.
 *
 * The busy indication and the `FailureNotice` are checked too: "no player list"
 * must not be satisfiable by a screen that is still loading or that rendered the
 * generic failure instead, since neither of those is the Not_Found_Treatment.
 */
function expectNothingOfTheSquadIsRendered(rendered: Rendered): void {
  expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).not.toBeNull();

  expect(document.querySelector(PLAYER_LIST_SELECTOR)).toBeNull();
  expect(document.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(0);
  expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
  expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  expect(document.querySelector(LOADING_INDICATION_SELECTOR)).toBeNull();

  // 6.4, 19.1: one level-one heading, carrying no squad name, and no section
  // headings — the treatment is the whole screen.
  const levelOne = Array.from(document.querySelectorAll('h1'));
  expect(levelOne.map((heading) => heading.textContent)).toEqual([
    NOT_FOUND_TREATMENT_HEADING,
  ]);
  expect(document.querySelectorAll('h2')).toHaveLength(0);

  // The treatment's own three pieces are present, so "identical" below is
  // identity of the intended surface rather than of an empty one.
  expect(rendered.text).toContain(NOT_FOUND_TREATMENT_BODY);
  expect(rendered.text).toContain(NOT_FOUND_TREATMENT_HOME_LABEL);
}

/**
 * The words a treatment would use to state a cause. None of them appears in
 * `lib/messages.ts`'s copy, which states only that the squad was not found *or*
 * is not available — one sentence covering both possibilities and choosing
 * neither.
 *
 * A fixed list can only ever guard the copy; the quantified half of the claim is
 * the generated material {@link expectNoCauseIsStated} also excludes.
 */
/**
 * The shortest requested identity worth checking for in the rendered text.
 *
 * A malformed `squadId` segment may be one character long, and a one-character
 * "leak" is a coincidence with the fixed copy rather than a disclosure. Twenty
 * characters is comfortably longer than any word of the treatment's copy, so a hit
 * at or above it is a genuine leak.
 */
const IDENTITY_DISCLOSURE_MIN_LENGTH = 20;

const CAUSE_STATING_FRAGMENTS: readonly string[] = [
  'does not exist',
  "doesn't exist",
  'no longer exists',
  'exists',
  'no such squad',
  'not a member',
  'membership',
  'inactive',
  'forbidden',
  'permission',
  'denied',
  'unauthorised',
  'unauthorized',
  'removed',
  'deleted',
  'invalid',
  'malformed',
  'identifier',
  '403',
  '404',
];

/**
 * Requirements 6.4 and 17.7: the rendered content states no cause, and carries
 * nothing of the backend's answer or of the squad.
 *
 * Two halves. The generated half is the quantified one — the squad name, the
 * problem's `detail`, `title`, `code`, and status, the requested identity, and any
 * player name the leaderboard carried are each absent from the rendered text, over
 * every generated case. The fixed half guards the copy against acquiring a cause
 * statement of its own.
 */
function expectNoCauseIsStated(scenario: Scenario, rendered: Rendered): void {
  const text = rendered.text.toLowerCase();

  // 6.4: no Squad_Name.
  expect(text).not.toContain(scenario.squadName.toLowerCase());

  // 6.4: not even the requested identity, which is the one value a person could
  // use to tell one answer from another.
  //
  // Checked only for a value long enough to be evidence: a malformed segment may
  // be a single character, and "the copy does not contain the letter `a`" is a
  // claim about English rather than about disclosure.
  if (scenario.requestedSquadId.length >= IDENTITY_DISCLOSURE_MIN_LENGTH) {
    expect(text).not.toContain(scenario.requestedSquadId.toLowerCase());
  }

  // 17.2, 17.7: nothing of the backend's answer.
  if (scenario.rejection !== null) {
    const { rejection } = scenario;
    expect(text).not.toContain(rejection.detail.toLowerCase());
    expect(text).not.toContain(rejection.title.toLowerCase());
    expect(text).not.toContain(rejection.code.toLowerCase());
    expect(text).not.toContain(String(rejection.status));
  }

  // 7.11: and no name the leaderboard carried, since no Squad_Detail confirmed it.
  if (scenario.leaderboard.kind === 'entries') {
    expect(text).not.toContain(scenario.leaderboard.playerName.toLowerCase());
  }

  for (const fragment of CAUSE_STATING_FRAGMENTS) {
    expect(text).not.toContain(fragment);
  }
}

/**
 * Requirement 6.6: an identifier that is not syntactically valid issues no
 * squad-scoped call at all — neither `GetSquad` nor the leaderboard read that
 * accompanies it.
 *
 * The `ListMySquads` listing is not squad-scoped and is deliberately not
 * excluded: it names no squad in its request and is how the caller's own standing
 * is resolved on every mount of this screen.
 */
function expectNoSquadScopedRequest(rendered: Rendered): void {
  const squadScoped = rendered.requests.filter((request) =>
    request.path.startsWith(`${LIST_MY_SQUADS_PATH}/`),
  );

  expect(squadScoped).toEqual([]);
}

/**
 * The counterpart of {@link expectNoSquadScopedRequest}, and the reason this
 * property is not vacuous: a cause expressed as a wire answer was *actually
 * delivered* — exactly one `GetSquad` request left the client and was answered by
 * that cause's ProblemDetails body.
 *
 * Without it a scenario that never issued the call, or that fell through to the
 * transport's unexpected-path answer, could satisfy every other assertion by
 * accident.
 */
function expectCauseWasDelivered(rendered: Rendered): void {
  const getSquadRequests = rendered.requests.filter(
    (request) =>
      request.path.startsWith(`${LIST_MY_SQUADS_PATH}/`) &&
      !request.path.endsWith('/leaderboard'),
  );

  expect(getSquadRequests).toHaveLength(1);
}

/**
 * Requirement 6.5: one treatment whose rendered content is identical whatever the
 * cause.
 *
 * Compared as markup rather than as text, so an attribute, an element, or an
 * ordering that varied with the cause fails the property.
 */
function expectIdenticalAcrossCauses(
  renderings: readonly { readonly cause: Cause; readonly html: string }[],
): void {
  const [first, ...rest] = renderings;

  for (const other of rest) {
    // Named in the message so a failure says *which* cause diverged.
    expect(
      { cause: other.cause, html: other.html },
      `the ${other.cause} rendering must match the ${first.cause} rendering`,
    ).toEqual({ cause: other.cause, html: first.html });
  }
}

// --- The property -------------------------------------------------------------

describe('Property 13 — the Not_Found_Treatment is identical for every cause and asserts nothing', () => {
  // Feature: web-squads-screens, Property 13: The Not_Found_Treatment is identical for every cause and asserts nothing
  // Validates: Requirements 6.4, 6.5, 6.6, 17.7
  it('renders identical content for every cause, stating none of them', async () => {
    await fc.assert(
      fc.asyncProperty(allCausesArb, async (scenarios) => {
        const renderings: { cause: Cause; html: string }[] = [];

        for (const scenario of scenarios) {
          try {
            const rendered = await renderScenario(scenario);

            expectNothingOfTheSquadIsRendered(rendered);
            expectNoCauseIsStated(scenario, rendered);
            expect(rendered.unexpected).toEqual([]);

            // 6.6: the fourth cause is the one that must not reach the backend;
            // the other three must, or the run proved nothing about them.
            if (scenario.cause === 'malformed-identifier') {
              expectNoSquadScopedRequest(rendered);
            } else {
              expectCauseWasDelivered(rendered);
            }

            renderings.push({ cause: scenario.cause, html: rendered.html });
          } finally {
            cleanup();
          }
        }

        expectIdenticalAcrossCauses(renderings);
      }),
      { numRuns: 100 },
    );
  }, 600_000);

  // Feature: web-squads-screens, Property 13: The Not_Found_Treatment is identical for every cause and asserts nothing
  // Validates: Requirements 6.6
  it('issues no squad-scoped call for any identifier that is not syntactically valid', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestedSquadId: malformedSquadIdArb,
          squadName: squadNameArb,
          listing: listingArb,
          leaderboard: leaderboardArb,
        }),
        async (generated) => {
          const scenario: Scenario = {
            ...generated,
            cause: 'malformed-identifier',
            rejection: null,
          };

          try {
            const rendered = await renderScenario(scenario);

            // 6.6: no `GetSquad`, and no leaderboard call either — the identity
            // both would have carried was never worth a request.
            expectNoSquadScopedRequest(rendered);
            expect(rendered.unexpected).toEqual([]);

            // And the same treatment an inaccessible squad renders.
            expectNothingOfTheSquadIsRendered(rendered);
            expectNoCauseIsStated(scenario, rendered);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 300_000);
});
