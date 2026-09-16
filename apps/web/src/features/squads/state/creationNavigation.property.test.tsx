/**
 * Property test for where a successful creation or redemption lands (task 7.6).
 *
 * **Property 7: A successful creation or redemption reaches the squad without
 * re-entry.** *For any* successful `CreateSquad` or `RedeemInvite` response, the
 * feature navigates to the Squad_Route for the returned squad identity when the
 * parser obtains one, and otherwise navigates to the Squads_Home and issues
 * exactly one further `ListMySquads` call; in neither case does it perform a
 * full-document reload, and in neither case does it leave the submitted form as
 * the rendered surface.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 3.6, 4.6 — an obtained identity navigates to that Squad_Route | {@link expectPropertySeven}, against the matched route's own `squadId` parameter |
 * | 3.7, 4.7 — otherwise the Squads_Home, plus **exactly one** further `ListMySquads` | {@link expectPropertySeven}, counted, and re-counted after a further flush |
 * | 3.6, 3.7, 4.6, 4.7 — no full-document reload | the document element and the out-of-screen Location probe node survive the navigation |
 * | 3.7, 4.7 — no re-entry: the submitted form is not the rendered surface | the form's panel element and its fields are gone, and the relisted squad is rendered as a card |
 *
 * ### The outcome is a parsed wire body, not a hand-built value
 *
 * The property is stated over a *response*, so every case here starts as a
 * generated `CreateSquad` or `RedeemInvite` wire body run through the feature's
 * real Response_Parser, and the fake Squads_Api reports exactly what the
 * transport seam would report for that body on a `2xx`: a success carrying the
 * parsed value, or `parse-failure` where the parser obtained nothing
 * (`api/squadsApi.ts`, and Requirement 16.4's all-or-nothing rule).
 *
 * That is what makes the two branches honest rather than assumed:
 *
 * - **`CreateSquad`** — `parseCreatedSquad` *requires* a well-formed `squadId`,
 *   so "a successful response the parser can obtain no squad identity from" is
 *   necessarily a `parse-failure` on a `2xx`, which is precisely the case
 *   Requirement 3.7 describes. The generator therefore covers a body with both
 *   identities, a body with no `squadId`, a `null` one, a malformed one, one
 *   missing the owner membership, and an **empty body** — the seam passes an
 *   empty body to the parser as an absence.
 * - **`RedeemInvite`** — `parseRedemption` accepts three shapes, all successes:
 *   the identity-bearing `{ membershipId, outcome, squadId }`, the
 *   `{ membershipId, outcome }` form the backend actually sends today, and the
 *   **empty body** of the already-a-member no-op. Only the first yields a squad
 *   identity, so the Squads_Home fallback of Requirement 4.7 is the *normal*
 *   path for a redemption rather than an edge case (design.md → contract
 *   realities). A malformed redemption body is deliberately **not** generated
 *   here: a body that was malformed is a failure the screen reports as an
 *   outcome message, not a successful response, and belongs to Property 40.
 *
 * ### How "no full-document reload" is observed
 *
 * The screen runs inside a real `MemoryRouter`, so a navigation is observed as a
 * Location change rather than as a spy call — and two nodes are captured before
 * the submission and compared after it: `document.documentElement`, which no
 * reload could preserve, and the Location probe's own element, which lives
 * *outside* the screen's route element and so survives a route change but not a
 * rebuilt document. Nothing here stubs `window.location`.
 *
 * ### Exactly one further list call, not at least one
 *
 * The fallback's list count is asserted, then a further microtask flush is run
 * and the count asserted again, so a screen that re-listed twice — once from the
 * fallback and once from something that re-issues itself — fails rather than
 * passes on the first reading (Requirement 17.4).
 *
 * Feature: web-squads-screens, Property 7: A successful creation or redemption reaches the squad without re-entry
 * Validates: Requirements 3.6, 3.7, 4.6, 4.7
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import fc from 'fast-check';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type SessionManager } from '../../auth';
import type {
  CallResult,
  CreateSquadRequest,
  RedeemInviteRequest,
  SquadsApi,
} from '../api/squadsApi';
import { CREATE_SQUAD_FORM_ID } from '../components/CreateSquadForm';
import { JOIN_SQUAD_FORM_ID } from '../components/JoinSquadForm';
import {
  SQUAD_CARD_ID_ATTRIBUTE,
  SQUAD_CARD_SELECTOR,
} from '../components/SquadCard';
import { codeFromRedeemOutcome } from '../lib/enumCodes';
import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  GENERIC_SQUADS_FAILURE,
  INVITE_SECRET_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
  SQUAD_NAME_LABEL,
} from '../lib/messages';
import {
  parseCreatedSquad,
  type CreatedSquad,
} from '../lib/parse/createdSquad';
import { parseRedemption, type Redemption } from '../lib/parse/redemption';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { SQUAD_ROUTE, squadPath } from '../lib/routePaths';
import { SquadsHome } from '../screens/SquadsHome';

// --- The recording Squads_Api fake ------------------------------------------

/** What the three calls this screen may issue were asked, and how often. */
interface ApiCallLog {
  /** How many `ListMySquads` calls were issued (Requirements 3.7, 4.7). */
  listCalls: number;
  /** Every `CreateSquad` body issued, in order (Requirement 3.5). */
  readonly createCommands: CreateSquadRequest[];
  /** Every `RedeemInvite` body issued, in order (Requirement 4.5). */
  readonly redeemCommands: RedeemInviteRequest[];
}

/**
 * A Squads_Api method the Squads_Home has no business calling.
 *
 * Throwing rather than answering is what makes the counting claims total: a run
 * fails outright if the screen reaches for an operation this property does not
 * expect, instead of that call passing unnoticed.
 */
function unavailable(method: string): () => never {
  return () => {
    throw new Error(`the Squads_Home must not call ${method}`);
  };
}

interface FakeApiOptions {
  /** One outcome per `ListMySquads`; the last is reused once exhausted. */
  readonly listOutcomes: readonly CallResult<readonly SquadSummary[]>[];
  readonly createOutcome?: CallResult<CreatedSquad>;
  readonly redeemOutcome?: CallResult<Redemption>;
}

/**
 * A Squads_Api answering the listing and one submission with settled
 * {@link CallResult} values and refusing everything else.
 *
 * Every answer resolves immediately: this property is about *where* a settled
 * success lands and *how many* further calls it causes, not about the
 * Squad_Call_Timeout, so the transport is reduced to a resolved value. The real
 * transport, the generated client, and `fetch` are all untouched.
 */
function createRecordingSquadsApi(options: FakeApiOptions): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const { listOutcomes, createOutcome, redeemOutcome } = options;
  const log: ApiCallLog = {
    listCalls: 0,
    createCommands: [],
    redeemCommands: [],
  };

  const api: SquadsApi = {
    listMySquads: () => {
      const index = Math.min(log.listCalls, listOutcomes.length - 1);
      log.listCalls += 1;
      return Promise.resolve(listOutcomes[index]);
    },
    createSquad: (command) => {
      log.createCommands.push(command);
      if (createOutcome === undefined) {
        throw new Error('createSquad is not part of this case');
      }
      return Promise.resolve(createOutcome);
    },
    redeemInvite: (command) => {
      log.redeemCommands.push(command);
      if (redeemOutcome === undefined) {
        throw new Error('redeemInvite is not part of this case');
      }
      return Promise.resolve(redeemOutcome);
    },
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    previewInvite: unavailable('previewInvite'),
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

/**
 * A `SessionManager` reporting `authenticated`, the only Auth_State in which the
 * Squads_Home lists or submits anything (Requirement 1.13). `AuthProvider` reads
 * `getState()` and `subscribe()`, and no case here moves the session, so the
 * remaining members are inert.
 */
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

// --- The rendered route table -----------------------------------------------

/** The rendered path, so a navigation is observable as a change. */
function LocationProbe(): ReactElement {
  const location = useLocation();

  return <output data-testid="location">{location.pathname}</output>;
}

/**
 * What the Squad_Route renders here: its own `squadId` parameter.
 *
 * Asserting against the *matched parameter* rather than only against the
 * pathname is what makes the destination claim a route claim — a path that
 * merely looked right but matched no route would render nothing at all.
 */
function SquadRouteProbe(): ReactElement {
  const { squadId } = useParams();

  return <output data-testid="squad-route-id">{squadId ?? ''}</output>;
}

/**
 * Render the Squads_Home at the Squads_Home route, with the Squad_Route
 * registered beside it.
 *
 * The probe sits *outside* the `Routes`, so its DOM node survives a route change
 * — which is what lets a surviving node stand for "no full-document reload".
 */
function renderHome(api: SquadsApi): void {
  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <Routes>
          <Route path={HOME_ROUTE} element={<SquadsHome api={api} />} />
          <Route path={SQUAD_ROUTE} element={<SquadRouteProbe />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** Let every settled call and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

function renderedPath(): string {
  return screen.getByTestId('location').textContent ?? '';
}

/** The squad identity of every rendered Squad_Card, in rendered order. */
function renderedCardIdentities(): readonly (string | null)[] {
  return Array.from(document.querySelectorAll(SQUAD_CARD_SELECTOR)).map((card) =>
    card.getAttribute(SQUAD_CARD_ID_ATTRIBUTE),
  );
}

// --- Generators -------------------------------------------------------------

/**
 * The characters a typed name is generated from: letters, digits, and a space.
 *
 * Restricted on purpose — `{` and `[` are keyboard directives to
 * `userEvent.type`, so generating them would exercise the test library rather
 * than the screen. What matters to this property is that *a* valid name was
 * entered, not which one.
 */
const NAME_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '.split('');

/**
 * A name the feature's name validation accepts: non-empty after trimming, well
 * within the 100-character bound, and sometimes padded with whitespace so the
 * trimming of Requirement 3.2 is exercised alongside.
 */
const typedNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.constantFrom(...NAME_CHARACTERS), {
      minLength: 1,
      maxLength: 8,
    }),
    fc.constantFrom('', ' ', '  '),
    fc.constantFrom('', ' '),
  )
  .map(([characters, before, after]) => `${before}${characters.join('')}${after}`)
  .filter((value) => value.trim().length > 0);

/** The characters an Invite_Secret is generated from: URL-safe and typeable. */
const SECRET_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('');

const inviteSecretArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SECRET_CHARACTERS), { minLength: 6, maxLength: 16 })
  .map((characters) => characters.join(''));

/**
 * A generated `CreateSquad` wire body: one shape the parser accepts, and five it
 * cannot obtain a squad identity from.
 *
 * `undefined` is the empty-body case — the transport seam hands an empty `2xx`
 * body to the parser as an absence. The missing-owner case is included because
 * Requirement 3.7 turns on what the *parser obtained*, and an all-or-nothing
 * parser obtains nothing from a body whose second identity is missing, even
 * though a `squadId` was written on the wire (Requirement 16.4).
 */
const createdSquadBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  // Accepted: both identities, well formed.
  fc.record({ squadId: fc.uuid(), ownerMembershipId: fc.uuid() }),
  // No squad identity obtainable, six ways.
  fc.record({ ownerMembershipId: fc.uuid() }),
  fc.record({ squadId: fc.constant(null), ownerMembershipId: fc.uuid() }),
  fc.record({
    squadId: fc.constantFrom('', 'not-a-guid', '1234'),
    ownerMembershipId: fc.uuid(),
  }),
  fc.record({ squadId: fc.uuid() }),
  fc.constant({}),
  fc.constant(undefined),
);

/**
 * A generated `RedeemInvite` wire body: the three successful shapes, one of
 * which carries a squad identity.
 *
 * The Redeem_Outcome codes are written through the Enum_Code_Map, which is the
 * only module in the feature — tests included — allowed to hold a numeric enum
 * literal (Requirement 16.7).
 */
const redemptionBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  // The identity-bearing form the parser already accepts, which the backend may
  // send later (Requirement 4.6).
  fc.record({
    membershipId: fc.uuid(),
    outcome: fc.constantFrom(
      codeFromRedeemOutcome('joined'),
      codeFromRedeemOutcome('reactivated'),
    ),
    squadId: fc.uuid(),
  }),
  // The form the backend sends today: a membership and an outcome, no squad
  // identity (Requirement 4.7).
  fc.record({
    membershipId: fc.uuid(),
    outcome: fc.constantFrom(
      codeFromRedeemOutcome('joined'),
      codeFromRedeemOutcome('reactivated'),
      codeFromRedeemOutcome('already-member'),
    ),
  }),
  // The already-a-member no-op: `200` with an empty body, and an empty object,
  // both of which parse to a Redemption carrying three absences.
  fc.constant({}),
  fc.constant(undefined),
);

/** A Squad_Summary for the collection a re-listing answers with. */
function summaryOf(squadId: string, name: string): SquadSummary {
  return { squadId, name, role: 'owner', state: 'active' };
}

// --- What the property expects of a run -------------------------------------

/** Where a settled submission should land, and what it should cost. */
interface Expectation {
  /** The rendered path afterwards. */
  readonly path: string;
  /** The parsed squad identity, or `null` where the parser obtained none. */
  readonly squadId: string | null;
  /** How many `ListMySquads` calls the whole run should have issued. */
  readonly listCalls: number;
}

/**
 * The expectation a parsed squad identity implies.
 *
 * One place, so the creation and the redemption properties are held to exactly
 * the same standard: an obtained identity means the Squad_Route and **no**
 * further listing, and no identity means the Squads_Home and exactly one.
 */
function expectationFor(squadId: string | null): Expectation {
  return squadId === null
    ? { path: HOME_ROUTE, squadId: null, listCalls: 2 }
    : { path: squadPath(squadId), squadId, listCalls: 1 };
}

/**
 * The claims of Property 7, over one completed run.
 *
 * @param formId the submitted form's panel id, which must no longer be rendered
 * @param fieldLabel a field of that form, likewise
 * @param relistedSquadId the squad the second listing answers with, rendered as
 *   a card where the fallback path was taken — the "reachable without re-entry"
 *   half of Requirements 3.7 and 4.7
 */
async function expectPropertySeven(observation: {
  readonly log: ApiCallLog;
  readonly expected: Expectation;
  readonly formId: string;
  readonly fieldLabel: string;
  readonly relistedSquadId: string;
  readonly documentElementBefore: HTMLElement;
  readonly locationProbeBefore: HTMLElement;
}): Promise<void> {
  const {
    log,
    expected,
    formId,
    fieldLabel,
    relistedSquadId,
    documentElementBefore,
    locationProbeBefore,
  } = observation;

  // 3.6, 3.7, 4.6, 4.7: the destination, and the cost of reaching it.
  await waitFor(() => {
    expect(renderedPath()).toBe(expected.path);
    expect(log.listCalls).toBe(expected.listCalls);
  });

  // ...and *exactly* that many: nothing re-issues itself once the fallback's one
  // further call has settled (Requirement 17.4).
  await flush();
  expect(log.listCalls).toBe(expected.listCalls);
  expect(renderedPath()).toBe(expected.path);

  if (expected.squadId === null) {
    // 3.7, 4.7: the Squads_Home, re-listed, with the squad now reachable as a
    // card — no form, and nothing to re-enter.
    expect(renderedCardIdentities()).toEqual([relistedSquadId]);
    expect(screen.queryByTestId('squad-route-id')).toBeNull();
    // The fallback is not a failure: a `2xx` the parser got no identity from
    // still created or joined the squad, so no failure is reported.
    expect(screen.queryByText(GENERIC_SQUADS_FAILURE)).toBeNull();
  } else {
    // 3.6, 4.6: the Squad_Route matched, and its parameter is the parsed
    // identity — a pathname that matched no route would render no probe.
    expect(screen.getByTestId('squad-route-id')).toHaveTextContent(
      expected.squadId,
    );
  }

  // 3.6, 3.7, 4.6, 4.7: the submitted form is not the rendered surface — neither
  // its panel nor its fields are anywhere in the document.
  expect(document.getElementById(formId)).toBeNull();
  expect(screen.queryByLabelText(fieldLabel)).toBeNull();

  // ...and no full-document reload: a reload could preserve neither the document
  // element nor the probe node that lives outside the route element.
  expect(document.documentElement).toBe(documentElementBefore);
  expect(screen.getByTestId('location')).toBe(locationProbeBefore);
}

// --- The properties ---------------------------------------------------------

describe('Property 7 — a successful creation reaches the squad without re-entry', () => {
  // Feature: web-squads-screens, Property 7: A successful creation or redemption reaches the squad without re-entry
  // Validates: Requirements 3.6, 3.7
  it('navigates to the created squad, or to the Squads_Home with exactly one further listing', async () => {
    await fc.assert(
      fc.asyncProperty(
        createdSquadBodyArb,
        typedNameArb,
        typedNameArb,
        fc.uuid(),
        async (body, squadName, displayName, relistedSquadId) => {
          // Exactly what the transport seam reports for this body on a `2xx`:
          // the parsed value, or `parse-failure` where the parser obtained
          // nothing (api/squadsApi.ts, Requirement 16.4).
          const parsed = parseCreatedSquad(body);
          const createOutcome: CallResult<CreatedSquad> = parsed.ok
            ? { kind: 'success', value: parsed.value }
            : { kind: 'parse-failure' };
          const expected = expectationFor(parsed.ok ? parsed.value.squadId : null);

          const { api, log } = createRecordingSquadsApi({
            listOutcomes: [
              { kind: 'success', value: [] },
              {
                kind: 'success',
                value: [summaryOf(relistedSquadId, 'Created FC')],
              },
            ],
            createOutcome,
          });
          const user = userEvent.setup({ delay: null });

          try {
            renderHome(api);
            await flush();

            const documentElementBefore = document.documentElement;
            const locationProbeBefore = screen.getByTestId('location');

            await user.click(
              screen.getByRole('button', { name: CREATE_SQUAD_HEADING }),
            );
            await user.type(
              screen.getByLabelText(SQUAD_NAME_LABEL),
              squadName,
            );
            await user.type(
              screen.getByLabelText(CREATOR_DISPLAY_NAME_LABEL),
              displayName,
            );
            await user.click(
              screen.getByRole('button', { name: CREATE_SQUAD_SUBMIT_LABEL }),
            );

            // 3.5: one submission, carrying the trimmed values.
            expect(log.createCommands).toEqual([
              { name: squadName.trim(), displayName: displayName.trim() },
            ]);

            await expectPropertySeven({
              log,
              expected,
              formId: CREATE_SQUAD_FORM_ID,
              fieldLabel: SQUAD_NAME_LABEL,
              relistedSquadId,
              documentElementBefore,
              locationProbeBefore,
            });
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});

describe('Property 7 — a successful redemption reaches the squad without re-entry', () => {
  // Feature: web-squads-screens, Property 7: A successful creation or redemption reaches the squad without re-entry
  // Validates: Requirements 4.6, 4.7
  it('navigates to the redeemed squad, or to the Squads_Home with exactly one further listing', async () => {
    await fc.assert(
      fc.asyncProperty(
        redemptionBodyArb,
        inviteSecretArb,
        fc.uuid(),
        async (body, secret, relistedSquadId) => {
          // Every generated body is one the parser accepts, so every case here
          // is a *successful* redemption — which is what the property quantifies
          // over. A malformed body belongs to Property 40.
          const parsed = parseRedemption(body);
          if (!parsed.ok) {
            throw new Error(
              `a generated redemption body must parse: ${JSON.stringify(body)} — ${parsed.reason}`,
            );
          }

          const expected = expectationFor(parsed.value.squadId);
          const { api, log } = createRecordingSquadsApi({
            listOutcomes: [
              { kind: 'success', value: [] },
              {
                kind: 'success',
                value: [summaryOf(relistedSquadId, 'Joined FC')],
              },
            ],
            redeemOutcome: { kind: 'success', value: parsed.value },
          });
          const user = userEvent.setup({ delay: null });

          try {
            renderHome(api);
            await flush();

            const documentElementBefore = document.documentElement;
            const locationProbeBefore = screen.getByTestId('location');

            await user.click(
              screen.getByRole('button', { name: JOIN_SQUAD_HEADING }),
            );
            await user.type(screen.getByLabelText(INVITE_SECRET_LABEL), secret);
            await user.click(
              screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }),
            );

            // 4.5: one submission, carrying the presented secret and nothing
            // else — no display name was entered.
            expect(log.redeemCommands).toEqual([{ presentedSecret: secret }]);

            await expectPropertySeven({
              log,
              expected,
              formId: JOIN_SQUAD_FORM_ID,
              fieldLabel: INVITE_SECRET_LABEL,
              relistedSquadId,
              documentElementBefore,
              locationProbeBefore,
            });
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});
