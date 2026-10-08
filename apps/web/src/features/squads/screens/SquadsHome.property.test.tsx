/**
 * Property test for the Squads_Home's rendered Squad_Card set and order
 * (task 10.6).
 *
 * **Property 1: The Squad_Card set and order are determined solely by the parsed
 * collection.** *For any* parsed Squad_Summary collection, the Squads_Home
 * renders exactly one Squad_Card per element of that collection and no
 * Squad_Card carrying any other squad identity; the rendered order is ascending
 * by squad name under a case-insensitive comparison with ties broken by
 * ascending squad identity; and *for any* two permutations of the same
 * collection the rendered order is identical.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 1.2 — exactly one card per parsed summary, and none for any other value | {@link expectOneCardPerSummary} |
 * | 1.3 — name ascending case-insensitively, ties by identity ascending | {@link expectCardsAreOrdered} |
 * | 20.6 — the order is determined solely by its input, unchanged by a permutation | the permutation property below |
 *
 * ### The collection is parsed, not hand-built
 *
 * The property quantifies over a *parsed* collection, so every case here starts
 * as a generated `ListMySquads` wire body handed to `parseSquadSummaryList`, and
 * the screen renders whatever comes out. That keeps two things honest at once:
 * the `role` and `state` fields are exercised as codes, as `null`, and as
 * missing properties — the three forms the backend can send (Requirement 16.8) —
 * and the property cannot accidentally quantify over a summary shape the parser
 * would have rejected.
 *
 * Neither field takes part in the order, which is the point of generating them:
 * the rendered sequence must be a function of the names and the identities
 * alone.
 *
 * ### The ordering rule is restated here rather than imported
 *
 * {@link expectedIdentityOrder} spells the rule out — `localeCompare` with
 * `sensitivity: 'base'`, then the identity by code unit — instead of only
 * comparing against `orderSquadSummaries`. Asserting a screen against the very
 * function it renders through would pass for any rule that function happened to
 * implement, including a wrong one. The rendered sequence is therefore checked
 * against the independent restatement *and* against `orderSquadSummaries`, the
 * second being the claim that the screen holds no ordering of its own
 * (Requirement 1.4). A third assertion walks consecutive rendered pairs and
 * demands each is strictly ascending under the rule, which is what makes the
 * order *total* rather than merely sorted-looking.
 *
 * ### Why names collide on purpose
 *
 * The tie-break only exists because a case-insensitive name comparison is a
 * weaker relation than string equality: `alpha AFC`, `Alpha AFC`, and
 * `ALPHA AFC` all compare equal, and the squad identity then separates them. The
 * name generator therefore draws mostly from a small pool of case variants and
 * outright duplicates, so most runs carry several ties and the identity key is
 * genuinely exercised rather than reached once in a hundred runs.
 *
 * Deliberately **not** claimed here: what a card *says* (Property 2), what
 * activating one does (Property 3), and that both entry points survive every load
 * state (Property 4, in the sibling file).
 *
 * Feature: web-squads-screens, Property 1: The Squad_Card set and order are determined solely by the parsed collection
 * Validates: Requirements 1.2, 1.3, 20.6
 */
import { describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import { MemoryRouter } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import {
  SQUAD_CARD_ID_ATTRIBUTE,
  SQUAD_CARD_SELECTOR,
} from '../components/SquadCard';
import { SQUADS_EMPTY_STATE_SELECTOR } from '../components/SquadsEmptyState';
import {
  parseSquadSummaryList,
  type SquadSummary,
} from '../lib/parse/squadSummary';
import { orderSquadSummaries } from '../lib/squadOrder';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { SquadsHome } from './SquadsHome';

// --- Generators --------------------------------------------------------------

/**
 * How a wire body carries a membership enum: as its Wire_Enum_Name, as `null`, or
 * not at all. The names come from the Generated_Enum_Unions, so no numeric enum
 * literal appears here (Requirement 12.8).
 */
type EnumField<TName extends string> = TName | null | 'absent';

const roleFieldArb: fc.Arbitrary<EnumField<SquadRole>> = fc.constantFrom(
  'Owner',
  'Admin',
  'Member',
  null,
  'absent' as const,
);

const stateFieldArb: fc.Arbitrary<EnumField<MembershipState>> =
  fc.constantFrom('Active', 'Inactive', null, 'absent' as const);

/**
 * Squad names that collide under the ordering's case-insensitive comparison —
 * three castings of one name, a duplicated pair, and two more castings — so the
 * identity tie-break is exercised on most runs.
 */
const COLLIDING_NAMES: readonly string[] = [
  'alpha AFC',
  'Alpha AFC',
  'ALPHA AFC',
  'Brackens',
  'brackens',
  'Thursday Ballers',
  'zebra fc',
  'Zebra FC',
];

/**
 * A Squad_Name: mostly a colliding one, occasionally free text. Interior
 * whitespace is collapsed and the value trimmed so a name is comparable to the
 * text a card renders, and the empty result is discarded.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...COLLIDING_NAMES) },
  {
    weight: 1,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 16, unit: 'grapheme' })
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length > 0),
  },
);

/**
 * A well-formed squad identity, in either letter case. Both are generated
 * because the tie-break compares identities by code unit, where `A` sorts before
 * `a` — a comparison a case-folding tie-break would get wrong.
 */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/** One generated `ListMySquads` element, before it becomes a wire body. */
interface SummaryCase {
  readonly squadId: string;
  readonly name: string;
  readonly role: EnumField<SquadRole>;
  readonly state: EnumField<MembershipState>;
}

/**
 * A generated collection whose squad identities are **distinct**, which is what
 * the backend guarantees across a caller's squads and what makes the ordering a
 * total order rather than a partial one.
 */
function collectionArb(
  minLength: number,
  maxLength: number,
): fc.Arbitrary<readonly SummaryCase[]> {
  return fc
    .array(fc.record({ name: nameArb, role: roleFieldArb, state: stateFieldArb }), {
      minLength,
      maxLength,
    })
    .chain((bodies) =>
      fc
        .uniqueArray(identityArb, {
          minLength: bodies.length,
          maxLength: bodies.length,
        })
        .map((identities) =>
          bodies.map((body, index) => ({ ...body, squadId: identities[index] })),
        ),
    );
}

/** A permutation of a generated collection, of the same length. */
function permutationArb(
  cases: readonly SummaryCase[],
): fc.Arbitrary<readonly SummaryCase[]> {
  return fc.shuffledSubarray(cases as SummaryCase[], {
    minLength: cases.length,
    maxLength: cases.length,
  });
}

// --- From generated cases to a parsed collection -----------------------------

/** The wire body a generated case describes, with an absent field unwritten. */
function bodyOf(summaryCase: SummaryCase): Record<string, unknown> {
  const body: Record<string, unknown> = {
    squadId: summaryCase.squadId,
    name: summaryCase.name,
  };

  if (summaryCase.role !== 'absent') {
    body.role = summaryCase.role;
  }

  if (summaryCase.state !== 'absent') {
    body.state = summaryCase.state;
  }

  return body;
}

/**
 * The parsed collection the property quantifies over.
 *
 * Parsing is asserted rather than assumed, so a generator that wandered outside
 * the accepted wire shape reports itself instead of silently narrowing the
 * property to the empty listing.
 */
function parsedCollectionOf(
  cases: readonly SummaryCase[],
): readonly SquadSummary[] {
  const body = cases.map(bodyOf);
  const parsed = parseSquadSummaryList(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated body must parse, but it did not: ${JSON.stringify(body)} — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

// --- The ordering rule, restated ---------------------------------------------

/**
 * Requirement 1.3's rule, written out here rather than imported: ascending name
 * under a case-insensitive comparison, then ascending squad identity.
 *
 * @returns `-1`, `0`, or `1`; `0` only for two summaries of the same squad
 */
function compareByRule(left: SquadSummary, right: SquadSummary): -1 | 0 | 1 {
  const byName = left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base',
  });

  if (byName !== 0) {
    return byName < 0 ? -1 : 1;
  }

  if (left.squadId === right.squadId) {
    return 0;
  }

  return left.squadId < right.squadId ? -1 : 1;
}

/** The squad identities in the order Requirement 1.3 demands. */
function expectedIdentityOrder(
  summaries: readonly SquadSummary[],
): readonly string[] {
  return [...summaries].sort(compareByRule).map((summary) => summary.squadId);
}

// --- The seams ---------------------------------------------------------------

/** A method the Squads_Home has no business calling in this property. */
function unreached(method: string): () => never {
  return () => {
    throw new Error(`the ${method} call is not part of Property 1`);
  };
}

/**
 * A Squads_Api that answers `ListMySquads` with one accepted collection and
 * refuses every other call, so a submission or a squad read would fail the run
 * rather than pass unnoticed.
 */
function listingApi(summaries: readonly SquadSummary[]): SquadsApi {
  const listed: CallResult<readonly SquadSummary[]> = {
    kind: 'success',
    value: summaries,
  };

  return {
    listMySquads: () => Promise.resolve(listed),
    getSquad: unreached('GetSquad'),
    getDisplayRatingLeaderboard: unreached('GetSquadLeaderboard'),
    createSquad: unreached('CreateSquad'),
    redeemInvite: unreached('RedeemInvite'),
    previewInvite: unreached('PreviewInvite'),
    listInvites: unreached('ListInvites'),
    generateInvite: unreached('GenerateInvite'),
    revokeInvite: unreached('RevokeInvite'),
    createGuest: unreached('CreateGuest'),
    editGuest: unreached('EditGuest'),
    promoteToAdmin: unreached('PromoteToAdmin'),
    getFeatureFlags: unreached('GetFeatureFlags'),
    setFeatureFlag: unreached('SetFeatureFlag'),
  };
}

/**
 * A `SessionManager` reporting `authenticated`, which is the only Auth_State in
 * which the Squads_Home lists anything at all (Requirement 1.13). `AuthProvider`
 * reads `getState()` and `subscribe()`, and no case here moves the session, so
 * the remaining members are inert.
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

// --- Rendering ---------------------------------------------------------------

/** Let the listing call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Render the Squads_Home over an accepted collection and let it settle.
 *
 * The real `MemoryRouter` and `AuthProvider` are supplied because the screen
 * calls `useNavigate()` and `useAuth()`; nothing else is stubbed.
 */
async function renderListing(summaries: readonly SquadSummary[]): Promise<void> {
  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={listingApi(summaries)} />
      </MemoryRouter>
    </AuthProvider>,
  );

  await flush();
}

/** The squad identity of every rendered Squad_Card, in rendered order. */
function renderedIdentities(): readonly string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(SQUAD_CARD_SELECTOR),
  ).map((card) => card.getAttribute(SQUAD_CARD_ID_ATTRIBUTE) ?? '');
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 1.2: one Squad_Card per parsed Squad_Summary, and no Squad_Card
 * carrying any other squad identity.
 *
 * Stated as a multiset comparison rather than only as a count, so a rendering
 * that dropped one squad and duplicated another cannot satisfy it.
 */
function expectOneCardPerSummary(summaries: readonly SquadSummary[]): void {
  const rendered = renderedIdentities();

  expect(rendered).toHaveLength(summaries.length);
  expect([...rendered].sort()).toEqual(
    summaries.map((summary) => summary.squadId).sort(),
  );

  // Spelled out as the fact it protects: every rendered identity came from the
  // parsed collection, so no card was invented from anything else.
  const parsedIdentities = new Set(summaries.map((summary) => summary.squadId));
  for (const identity of rendered) {
    expect(parsedIdentities.has(identity)).toBe(true);
  }
}

/**
 * Requirement 1.3: the rendered sequence is the ordering rule's sequence, it is
 * the one the single pure function yields, and consecutive cards are strictly
 * ascending under the rule.
 */
function expectCardsAreOrdered(summaries: readonly SquadSummary[]): void {
  const rendered = renderedIdentities();

  // The rule as restated in this file, independently of the implementation.
  expect(rendered).toEqual(expectedIdentityOrder(summaries));

  // 1.4: and the screen sorts nothing of its own — the sequence is exactly what
  // the one pure ordering function yields.
  expect(rendered).toEqual(
    orderSquadSummaries(summaries).map((summary) => summary.squadId),
  );

  // Strictly ascending pair by pair, which is what makes the order total: no two
  // rendered neighbours may compare equal, and none may compare descending.
  const byIdentity = new Map(
    summaries.map((summary) => [summary.squadId, summary] as const),
  );
  for (let index = 1; index < rendered.length; index += 1) {
    const previous = byIdentity.get(rendered[index - 1]);
    const current = byIdentity.get(rendered[index]);

    expect(previous).toBeDefined();
    expect(current).toBeDefined();
    expect(compareByRule(previous as SquadSummary, current as SquadSummary)).toBe(-1);
  }
}

/**
 * Requirement 2.1: an accepted empty collection is the Squads_Empty_State, and a
 * non-empty one is not — and neither is an error indication. Asserted alongside
 * the card set so "no card" cannot be satisfied by the failure surface.
 */
function expectSurfaceMatchesCollection(summaries: readonly SquadSummary[]): void {
  const emptyState = document.querySelector(SQUADS_EMPTY_STATE_SELECTOR);

  if (summaries.length === 0) {
    expect(emptyState).not.toBeNull();
  } else {
    expect(emptyState).toBeNull();
  }

  expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
}

// --- The property ------------------------------------------------------------

describe('Property 1 — the Squad_Card set and order are determined solely by the parsed collection', () => {
  // Feature: web-squads-screens, Property 1: The Squad_Card set and order are determined solely by the parsed collection
  // Validates: Requirements 1.2, 1.3
  it('renders one card per parsed summary, no other identity, and the ordering rule’s sequence', async () => {
    await fc.assert(
      fc.asyncProperty(collectionArb(0, 8), async (cases) => {
        const summaries = parsedCollectionOf(cases);

        try {
          await renderListing(summaries);

          expectOneCardPerSummary(summaries);
          expectCardsAreOrdered(summaries);
          expectSurfaceMatchesCollection(summaries);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 120 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 1: The Squad_Card set and order are determined solely by the parsed collection
  // Validates: Requirements 1.3, 20.6
  it('renders the identical card sequence for any two permutations of the same collection', async () => {
    await fc.assert(
      fc.asyncProperty(
        collectionArb(2, 8).chain((cases) =>
          fc.record({
            first: permutationArb(cases),
            second: permutationArb(cases),
          }),
        ),
        async ({ first, second }) => {
          const renderOrder = async (
            cases: readonly SummaryCase[],
          ): Promise<readonly string[]> => {
            try {
              await renderListing(parsedCollectionOf(cases));
              return renderedIdentities();
            } finally {
              cleanup();
            }
          };

          const firstOrder = await renderOrder(first);
          const secondOrder = await renderOrder(second);

          // 20.6: the rendered order is a function of the collection alone, so a
          // response that arrived shuffled cannot rearrange a person's cards.
          expect(firstOrder).toEqual(secondOrder);
          // And that shared order is the rule's own, not merely a stable one.
          expect(firstOrder).toEqual(
            expectedIdentityOrder(parsedCollectionOf(first)),
          );
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});
