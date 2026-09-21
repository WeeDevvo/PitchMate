/**
 * Property test for the signed-out invite surface's non-disclosure and handover
 * (task 14.2).
 *
 * **Property 10: The signed-out invite surface discloses nothing and hands over
 * reversibly.** *For any* `PreviewInvite` response body, including one carrying
 * squad-shaped properties the feature does not recognise, the
 * Invite_Landing_Route renders exactly one level-one heading, no squad name, no
 * squad identity, no membership count, and no player display name; and it renders
 * exactly one control navigating to the Auth_Feature's sign-up route and exactly
 * one navigating to its log-in route, each carrying the requested
 * Invite_Landing_Route path as the value of the Auth_Feature's redirect query
 * parameter such that decoding that value yields the requested path
 * character-for-character.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 5.3 — exactly one level-one heading | {@link expectExactlyOneLevelOneHeading} |
 * | 5.3 — no Squad_Name, no squad identity, no membership count, no Player_Display_Name | {@link expectNothingOfTheSquadIsDisclosed} |
 * | 5.4 — exactly one sign-up control and exactly one log-in control | {@link readHandoverControls} |
 * | 5.4 — decoding the redirect value yields the requested path character-for-character | {@link expectCarriesRequestedPathBack} |
 * | 5.4 — the handover is reversible: activation navigates, and the back control returns to the invite path | the second property below |
 *
 * ### The unrecognised properties have to travel over the wire to prove anything
 *
 * The interesting half of this property is what happens to a `PreviewInvite` body
 * that carries a squad name, a squad identity, a membership count, and player
 * display names the feature never asked for. A fake `SquadsApi` handing the screen
 * an already-parsed `InvitePreview` would have discarded those properties before
 * the screen ever saw them, so the property would be quantifying over inputs that
 * cannot fail. Each run therefore drives the **real** `createSquadsApi` over the
 * **real** generated `@pitchmate/api-client` with an injected `fetch`, and the
 * generated body is the actual JSON text the anonymous preview answers with. The
 * claim then covers the whole path — client, facade, parser, machine, screen —
 * rather than the last step of it.
 *
 * Every generated squad-shaped value carries a per-run nonce, so
 * {@link expectNothingOfTheSquadIsDisclosed} can look for it in the rendered text
 * *and* in the rendered markup and know that a hit is a disclosure rather than a
 * coincidence with the fixed copy or with the invite path.
 *
 * ### Two kinds of body, because both are "any response body"
 *
 * - An **accepted** body carries `requiresAuthentication` and `message` beside the
 *   squad-shaped extras, so the parser succeeds and the preview's own generic
 *   instruction is what a visitor reads (Requirement 5.2).
 * - A **rejected** body carries the squad-shaped extras and *neither* recognised
 *   property, so the parser refuses it and the screen falls back to its own fixed
 *   instruction (Requirement 5.6).
 *
 * The four disclosure clauses and both handover clauses are claimed over both, so
 * a body the feature could not read is held to the same non-disclosure standard as
 * one it could.
 *
 * The generated `message` is deliberately drawn from generic wordings that name no
 * squad and count no members. Requirement 5.2 *requires* that string to be
 * rendered, so a generator that put a squad name inside it would be asking the
 * screen to satisfy two requirements that contradict each other rather than
 * testing this one. The backend's own preview is generic by contract — that it
 * stays that way is the backend's property, not this screen's.
 *
 * ### The path is generated too, and that is what makes the round trip a claim
 *
 * The requested Invite_Landing_Route path is built by the feature's own
 * `inviteLandingPath` from secrets carrying the reserved characters
 * `/ ? # & = % +` and non-ASCII characters, and it is generated *with a query
 * string* — including one that already carries a `redirect` parameter of its own,
 * which is the case a naive string concatenation gets wrong. The value is then
 * read back through the Auth_Feature's own `redirectCandidateFromSearch`, the
 * exact reader the other side of the handover uses, and compared with `toBe` —
 * character-for-character, not "contains".
 *
 * A fragment is not generated: the router reports a fragment separately from the
 * path, it is never sent to the backend, and the screen deliberately builds its
 * targets from the pathname and search alone.
 *
 * Deliberately **not** claimed here: the Invite_Secret path round trip and the
 * incomplete-link surface (Property 9, a sibling file), the unusable-invite
 * message (Property 12, a sibling file), and the at-most-once redemption
 * (Property 11, under `state/`).
 *
 * Feature: web-squads-screens, Property 10: The signed-out invite surface discloses nothing and hands over reversibly
 * Validates: Requirements 5.3, 5.4
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { createApiClient } from '@pitchmate/api-client';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  AuthProvider,
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
  SIGN_UP_ROUTE,
  redirectCandidateFromSearch,
  type SessionManager,
} from '../../auth';
import { createSquadsApi, type SquadsApi } from '../api/squadsApi';
import {
  INVITE_LANDING_HEADING,
  INVITE_LOG_IN_LABEL,
  INVITE_SIGN_IN_REQUIRED_INSTRUCTION,
  INVITE_SIGN_UP_LABEL,
} from '../lib/messages';
import { INVITE_LANDING_ROUTE, inviteLandingPath } from '../lib/routePaths';
import {
  INVITE_HANDOVER_SELECTOR,
  INVITE_LANDING_SELECTOR,
  InviteLandingScreen,
} from './InviteLandingScreen';

// --- The wire -----------------------------------------------------------------

/** The base URL of the injected client — never rendered, never asserted on. */
const BASE_URL = 'https://api.test';

/** `GET /squads/invites/preview` — the one anonymous squads call. */
const PREVIEW_INVITE_PATH = '/squads/invites/preview';

// --- Generators ---------------------------------------------------------------

/**
 * An Invite_Secret to place in the route's `code` segment.
 *
 * The lengths and the reserved and non-ASCII characters are here for the redirect
 * round trip rather than for the extraction: a secret carrying `?`, `#`, or `&`
 * is exactly what a handover target built by concatenation would cut short.
 */
const secretArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 32, unit: 'grapheme' }),
  fc.uuid(),
  fc.constantFrom(
    'a',
    'abcd1234',
    'a/b?c#d&e=f%g+h',
    '%2Fnot-decoded',
    'ünïcødé-⚽-secret',
    '  padded  ',
  ),
  // A 512-character secret, the upper bound the feature's extraction is specified
  // over, so the target carries a long value rather than only short ones.
  fc.constant('s'.repeat(512)),
);

/**
 * A query string the invite link can arrive with.
 *
 * The `redirect=` entry is the sharp one: the requested path then *contains* the
 * name of the parameter it is about to be carried in, so a target built by string
 * concatenation would produce two `redirect` values and the reader on the other
 * side would recover the wrong one.
 */
const searchArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '?ref=whatsapp',
  '?ref=whatsapp&sent=2',
  `?${REDIRECT_PARAM_NAME}=%2Felsewhere`,
  '?note=a%20b%26c',
  '?note=%E2%9A%BD',
);

/**
 * A generic preview instruction — wording that names no squad and counts no
 * members, which is what the anonymous endpoint answers by contract and what
 * Requirement 5.2 has the screen render.
 */
const previewMessageArb: fc.Arbitrary<string> = fc.constantFrom(
  'Log in or create an account to redeem this invite.',
  'Sign in to continue.',
  'You need an account before an invite can be used.',
);

/**
 * The squad-shaped properties a `PreviewInvite` body might carry and the feature
 * does not recognise — one nonce per value, so a leak is identifiable.
 *
 * `memberCount` is a numeric nonce wide enough that finding it in the rendered
 * output is evidence rather than arithmetic coincidence.
 */
interface SquadShapedExtras {
  readonly squadName: string;
  readonly squadId: string;
  readonly ownerDisplayName: string;
  readonly memberDisplayName: string;
  readonly memberCount: number;
}

const squadShapedExtrasArb: fc.Arbitrary<SquadShapedExtras> = fc.record({
  squadName: fc.uuid().map((nonce) => `Thursday Ballers pmn-${nonce}`),
  squadId: fc.uuid().map((nonce) => `pmi-${nonce}`),
  ownerDisplayName: fc.uuid().map((nonce) => `Ada pmo-${nonce}`),
  memberDisplayName: fc.uuid().map((nonce) => `Grace pmd-${nonce}`),
  memberCount: fc.integer({ min: 1_000_000, max: 9_999_999 }),
});

/**
 * The wire body the preview is answered with, built from the extras.
 *
 * The extras appear at the top level, nested inside a `squad` object, and inside a
 * `members` array, so "unrecognised properties are disregarded" is claimed at more
 * than one depth.
 *
 * @param extras the squad-shaped values, each carrying its nonce
 * @param recognised the two properties the Response_Parser reads, or `null` for a
 *   body it must reject
 */
function previewBody(
  extras: SquadShapedExtras,
  recognised: { readonly requiresAuthentication: boolean; readonly message: string } | null,
): unknown {
  return {
    ...(recognised === null ? {} : recognised),
    squadId: extras.squadId,
    squadName: extras.squadName,
    name: extras.squadName,
    memberCount: extras.memberCount,
    membershipCount: extras.memberCount,
    squad: {
      id: extras.squadId,
      name: extras.squadName,
      memberCount: extras.memberCount,
      owner: { displayName: extras.ownerDisplayName },
    },
    members: [
      { membershipId: extras.squadId, displayName: extras.memberDisplayName },
      { membershipId: extras.squadId, displayName: extras.ownerDisplayName },
    ],
  };
}

/** Everything one run needs, once generated. */
interface Scenario {
  /** The Invite_Landing_Route path the visitor requested, query string and all. */
  readonly requestedPath: string;
  readonly extras: SquadShapedExtras;
  /**
   * The instruction the accepted body carries, or `null` where the body omits both
   * recognised properties and the Response_Parser therefore rejects it.
   */
  readonly previewMessage: string | null;
  readonly requiresAuthentication: boolean;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  requestedPath: fc
    .tuple(secretArb, searchArb)
    .map(([secret, search]) => `${inviteLandingPath(secret)}${search}`),
  extras: squadShapedExtrasArb,
  previewMessage: fc.option(previewMessageArb, { nil: null }),
  requiresAuthentication: fc.boolean(),
});

/** The body for a scenario, as JSON-able wire content. */
function bodyFor(scenario: Scenario): unknown {
  return previewBody(
    scenario.extras,
    scenario.previewMessage === null
      ? null
      : {
          requiresAuthentication: scenario.requiresAuthentication,
          message: scenario.previewMessage,
        },
  );
}

/**
 * The nonce-bearing values that must not appear anywhere in the rendered output,
 * paired with what each one would be a disclosure of.
 */
function disclosures(
  extras: SquadShapedExtras,
): readonly { readonly what: string; readonly value: string }[] {
  return [
    { what: 'a Squad_Name', value: extras.squadName },
    { what: 'a squad identity', value: extras.squadId },
    { what: 'a membership count', value: String(extras.memberCount) },
    { what: "an owner's Player_Display_Name", value: extras.ownerDisplayName },
    { what: "a member's Player_Display_Name", value: extras.memberDisplayName },
  ];
}

// --- The transport ------------------------------------------------------------

interface Harness {
  readonly api: SquadsApi;
  /** The paths the injected `fetch` was asked for, in order. */
  readonly requests: readonly string[];
}

/**
 * The real Squads_Api over the real generated client, with a `fetch` that answers
 * the anonymous preview from the scenario's body and records every path it is
 * asked for.
 *
 * Nothing is stubbed between the generated JSON and the screen. A request for any
 * other path is recorded and answered `500`, so a call this surface has no
 * business issuing — a `RedeemInvite` while there is no session, above all —
 * shows up in {@link expectOnlyTheAnonymousPreviewWasIssued}.
 */
function createHarness(scenario: Scenario): Harness {
  const requests: string[] = [];

  const fetchImpl = (async (input: Request): Promise<Response> => {
    const path = new URL(input.url).pathname;
    requests.push(path);

    if (path === PREVIEW_INVITE_PATH) {
      return new Response(JSON.stringify(bodyFor(scenario)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(null, { status: 500 });
  }) as unknown as typeof fetch;

  const apiClient = createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });

  return { api: createSquadsApi({ apiClient }), requests };
}

/**
 * A `SessionManager` reporting `unauthenticated` — the only Auth_State
 * Requirements 5.3 and 5.4 make a claim about.
 */
function sessionManager(): SessionManager {
  return {
    bootstrap: () => 'unauthenticated',
    establish: () => undefined,
    getState: () => 'unauthenticated',
    getAccessTokenForRequest: () =>
      Promise.resolve({ error: 'unauthenticated' as const }),
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
 * A probe that outlives navigation: it reports the router's current path and
 * offers the equivalent of the browser back control, which is how the second
 * property checks that the handover is reversible.
 */
function LocationProbe(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <span data-testid="location">
        {`${location.pathname}${location.search}`}
      </span>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </div>
  );
}

/**
 * Render the Invite_Landing_Route for a scenario at the real
 * {@link INVITE_LANDING_ROUTE} inside a real `MemoryRouter` and a real
 * `AuthProvider`, so the `code` segment and the query string arrive exactly as the
 * router delivers them.
 *
 * The two Auth_Feature routes are registered with stubs: the screen's controls
 * target the Auth_Feature's own exported paths, and a route table that resolved
 * neither of them would make the activation half of this property untestable.
 */
function renderScenario(scenario: Scenario): Harness {
  const harness = createHarness(scenario);

  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[scenario.requestedPath]}>
        <LocationProbe />
        <Routes>
          <Route
            path={INVITE_LANDING_ROUTE}
            element={<InviteLandingScreen api={harness.api} />}
          />
          <Route path={SIGN_UP_ROUTE} element={<h1>sign up stub</h1>} />
          <Route path={LOG_IN_ROUTE} element={<h1>log in stub</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  return harness;
}

/**
 * Let the anonymous preview reach the transport and settle.
 *
 * The request is waited for rather than a fixed number of ticks being flushed, so
 * a run cannot pass by asserting against a surface the response never reached; the
 * trailing flushes then apply whatever the settled call dispatched.
 */
async function settle(harness: Harness): Promise<void> {
  for (let round = 0; round < 40 && harness.requests.length === 0; round += 1) {
    await tick();
  }

  for (let round = 0; round < 4; round += 1) {
    await tick();
  }
}

/** The Invite_Landing_Route subtree, which must be what rendered. */
function screenRoot(): Element {
  const root = document.querySelector(INVITE_LANDING_SELECTOR);

  if (root === null) {
    throw new Error('the Invite_Landing_Route did not render at all');
  }

  return root;
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 5.3 (with 19.1): exactly one level-one heading, and it is the
 * route's own fixed heading rather than anything derived from the response.
 */
function expectExactlyOneLevelOneHeading(): void {
  const headings = Array.from(document.querySelectorAll('h1'));

  expect(headings.map((heading) => heading.textContent)).toEqual([
    INVITE_LANDING_HEADING,
  ]);
}

/**
 * Requirement 5.3: no Squad_Name, no squad identity, no membership count, and no
 * Player_Display_Name reaches the surface.
 *
 * Checked against the rendered **markup** as well as the rendered text, so a value
 * that reached an attribute — a `title`, an `aria-label`, a `data-` property, a
 * link target — fails the property just as visible text would. Each searched value
 * carries a nonce that cannot occur in the fixed copy or in the generated invite
 * path, so a hit is a disclosure.
 */
function expectNothingOfTheSquadIsDisclosed(scenario: Scenario): void {
  const root = screenRoot();
  const text = (root.textContent ?? '').toLowerCase();
  const markup = root.outerHTML.toLowerCase();

  for (const disclosure of disclosures(scenario.extras)) {
    const needle = disclosure.value.toLowerCase();

    expect(text, `${disclosure.what} must not be rendered`).not.toContain(
      needle,
    );
    expect(
      markup,
      `${disclosure.what} must not reach the markup`,
    ).not.toContain(needle);
  }
}

/**
 * The counterpart of the disclosure assertion, and the reason this property is not
 * vacuous: the generated body was *actually delivered* and its recognised content
 * *did* reach the surface.
 *
 * An accepted body must have put its own instruction on the screen (Requirement
 * 5.2); a rejected one must have left the fixed instruction there (Requirement
 * 5.6). Without this, a screen that rendered nothing at all beneath its heading
 * would satisfy every other assertion.
 */
function expectTheBodyReachedTheSurface(scenario: Scenario): void {
  const text = screenRoot().textContent ?? '';

  expect(text).toContain(
    scenario.previewMessage ?? INVITE_SIGN_IN_REQUIRED_INSTRUCTION,
  );
}

/**
 * No call this surface has no business issuing was made: exactly one anonymous
 * `PreviewInvite`, and nothing else — in particular no `RedeemInvite`, which
 * belongs to the authenticated Auth_State.
 */
function expectOnlyTheAnonymousPreviewWasIssued(harness: Harness): void {
  expect(harness.requests).toEqual([PREVIEW_INVITE_PATH]);
}

/** One handover control, split into the parts this property reads. */
interface HandoverControl {
  readonly label: string;
  /** The target path, without its query string. */
  readonly path: string;
  /** The target's query string, including its leading `?`, or `''` for none. */
  readonly search: string;
  readonly element: HTMLAnchorElement;
}

/**
 * Requirement 5.4: read the handover surface's controls, asserting there is
 * **exactly one** navigating to the Auth_Feature's sign-up route and **exactly
 * one** navigating to its log-in route, and nothing else that navigates.
 *
 * The controls are scoped to the handover surface — the region Requirement 5.12
 * defines as the instruction plus these two controls — so the count is a claim
 * about that surface rather than about whatever else the screen may hold in
 * another state.
 */
function readHandoverControls(): {
  readonly signUp: HandoverControl;
  readonly logIn: HandoverControl;
} {
  const handover = screenRoot().querySelector(INVITE_HANDOVER_SELECTOR);

  expect(handover, 'the handover surface must be rendered').not.toBeNull();

  const controls = Array.from(
    (handover as Element).querySelectorAll('a'),
  ).map<HandoverControl>((element) => {
    const href = element.getAttribute('href') ?? '';
    const queryAt = href.indexOf('?');

    return {
      label: element.textContent ?? '',
      path: queryAt === -1 ? href : href.slice(0, queryAt),
      search: queryAt === -1 ? '' : href.slice(queryAt),
      element,
    };
  });

  const signUp = controls.filter((control) => control.path === SIGN_UP_ROUTE);
  const logIn = controls.filter((control) => control.path === LOG_IN_ROUTE);

  expect(
    signUp.map((control) => control.label),
    'exactly one control navigating to the sign-up route',
  ).toEqual([INVITE_SIGN_UP_LABEL]);
  expect(
    logIn.map((control) => control.label),
    'exactly one control navigating to the log-in route',
  ).toEqual([INVITE_LOG_IN_LABEL]);

  // Nothing else on the handover surface navigates anywhere, so "exactly one
  // each" is not satisfied alongside a third way off this screen.
  expect(controls.map((control) => control.path).sort()).toEqual(
    [SIGN_UP_ROUTE, LOG_IN_ROUTE].sort(),
  );

  return { signUp: signUp[0], logIn: logIn[0] };
}

/**
 * Requirement 5.4: the control carries the requested Invite_Landing_Route path as
 * the Redirect_Capture query value, and decoding that value yields the requested
 * path character-for-character.
 *
 * Read back through the Auth_Feature's own `redirectCandidateFromSearch` — the
 * exact reader the other side of the handover uses — and compared with `toBe`, so
 * a value cut short at a reserved character, double-encoded, or accompanied by a
 * second `redirect` entry fails rather than "contains" its way through.
 */
function expectCarriesRequestedPathBack(
  control: HandoverControl,
  requestedPath: string,
  what: string,
): void {
  expect(
    control.search,
    `the ${what} control must carry a ${REDIRECT_PARAM_NAME} value`,
  ).toContain(`${REDIRECT_PARAM_NAME}=`);

  expect(
    redirectCandidateFromSearch(control.search),
    `the ${what} control must carry the requested path back exactly`,
  ).toBe(requestedPath);
}

// --- The properties -----------------------------------------------------------

describe('Property 10 — the signed-out invite surface discloses nothing and hands over reversibly', () => {
  // Feature: web-squads-screens, Property 10: The signed-out invite surface discloses nothing and hands over reversibly
  // Validates: Requirements 5.3, 5.4
  it('renders one heading, discloses nothing of the squad, and carries the requested path back through both controls', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        try {
          const harness = renderScenario(scenario);
          await settle(harness);

          // 5.3: one heading, and nothing of the squad anywhere.
          expectExactlyOneLevelOneHeading();
          expectNothingOfTheSquadIsDisclosed(scenario);

          // The body did arrive and its readable half was rendered, so the
          // disclosure claim is about a populated surface.
          expectTheBodyReachedTheSurface(scenario);
          expectOnlyTheAnonymousPreviewWasIssued(harness);

          // 5.4: exactly one control to each Auth_Feature route, each carrying
          // the requested path back character-for-character.
          const controls = readHandoverControls();

          expectCarriesRequestedPathBack(
            controls.signUp,
            scenario.requestedPath,
            'sign-up',
          );
          expectCarriesRequestedPathBack(
            controls.logIn,
            scenario.requestedPath,
            'log-in',
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 600_000);

  // Feature: web-squads-screens, Property 10: The signed-out invite surface discloses nothing and hands over reversibly
  // Validates: Requirements 5.4
  it('navigates to each auth route on activation, carrying the path back, and returns to the invite on the back control', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const user = userEvent.setup();

        try {
          const harness = renderScenario(scenario);
          await settle(harness);

          const location = (): string =>
            document.querySelector('[data-testid="location"]')?.textContent ??
            '';
          const backControl = (): HTMLElement => {
            const control = Array.from(
              document.querySelectorAll('button'),
            ).find((candidate) => candidate.textContent === 'back');

            if (control === undefined) {
              throw new Error('the probe rendered no back control');
            }

            return control;
          };

          expect(location()).toBe(scenario.requestedPath);

          for (const target of [
            { route: SIGN_UP_ROUTE, what: 'sign-up' as const },
            { route: LOG_IN_ROUTE, what: 'log-in' as const },
          ]) {
            const controls = readHandoverControls();
            const control =
              target.what === 'sign-up' ? controls.signUp : controls.logIn;

            // 5.4: activating the control actually navigates to the
            // Auth_Feature's route, carrying the requested path as the
            // Redirect_Capture value.
            await user.click(control.element);
            await tick();

            const reached = location();
            const queryAt = reached.indexOf('?');

            expect(queryAt === -1 ? reached : reached.slice(0, queryAt)).toBe(
              target.route,
            );
            expect(
              redirectCandidateFromSearch(
                queryAt === -1 ? '' : reached.slice(queryAt),
              ),
              `the ${target.what} route must be reached carrying the requested path`,
            ).toBe(scenario.requestedPath);

            // Reversible: the handover added a history entry rather than
            // replacing one, so the back control returns to the invite path —
            // secret and all — and the invite surface renders again.
            await user.click(backControl());
            await tick();
            await settle(harness);

            expect(location()).toBe(scenario.requestedPath);
            expectExactlyOneLevelOneHeading();
            expectNothingOfTheSquadIsDisclosed(scenario);
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 900_000);
});
