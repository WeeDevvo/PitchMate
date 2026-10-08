/**
 * Property test for the ambiguous Display_Rating_Leaderboard (task 13.3).
 *
 * **Property 23: An ambiguous leaderboard yields no rating for anybody.** *For
 * any* leaderboard body carrying two or more entries with the same membership
 * identity, the parser yields a parse failure, and every Player_Row of the
 * resulting screen renders the Rating_Unavailable presentation and no numeric
 * rating value.
 *
 * Requirement 8.11 is a claim about a whole screen rather than about a parser, so
 * it is asserted over a whole screen: a generated `GetSquadLeaderboard` **wire
 * body** goes into a real transport, through the real `createSquadsApi`, through
 * `useSquadScreen`, and out as rendered rows. Nothing between the body and the DOM
 * is stubbed, which is what makes the claim "no player gets a rating derived from
 * an ambiguous body" rather than "the parser rejects duplicates" — the latter is
 * `lib/parse/leaderboard.property.test.ts`'s subject and is not repeated here.
 *
 * ### Only the duplication may fail the body
 *
 * Every generated entry is otherwise impeccable: a well-formed identity, a
 * non-empty name, and a **finite** value. So the parse failure the property
 * asserts can only be the repeated membership identity, and the Rating_Unavailable
 * rows can only be that failure's consequence — not a malformed value, and not the
 * Provisional_Band that an unmatched entry would produce (Requirements 8.3, 8.10).
 * The duplicated identity is drawn from the squad's own memberships *and* from an
 * identity no membership carries, because an ambiguity about somebody who is not
 * in this squad must silence the whole column just the same.
 *
 * ### The leaderboard settles before the first row exists
 *
 * Rating_Unavailable is *also* what a row shows while the leaderboard call is
 * still in flight (Requirement 7.13), so a naive assertion would pass on a screen
 * that had simply not heard back yet. The transport therefore holds the `GetSquad`
 * response until the leaderboard response has been served and its settlement
 * dispatched: by the time a Player_Row exists at all, the leaderboard slot has
 * already reached `unavailable`. The assertion is then repeated after further
 * flushes, so a late-arriving rating could not slip in behind it either.
 *
 * ### The second property is the discriminating half
 *
 * A test that only ever asserts an absence proves little about the harness. The
 * second property below de-duplicates the *same* generated body — keeping the
 * first entry per identity and dropping the repeats — and asserts the screen then
 * renders that member's Display_Rating as a number. Same generators, same
 * transport, same screen: the only difference is the duplication, so the first
 * property's silence is attributable to it.
 *
 * ### Two seams
 *
 * The App_Shell's `usePublishSquadScopeFromRoute` throws outside the shell's own
 * provider, so that single barrel export is replaced by a no-op stand-in exactly
 * as `SquadScreen.test.tsx` does. Everything else is real: a `MemoryRouter` at the
 * real `SQUAD_ROUTE`, a real `AuthProvider`, the real `createApiClient` over a fake
 * `fetch`, and the real `createSquadsApi`.
 *
 * Deliberately **not** claimed here: the Provisional_Band's content (Property 21),
 * the accessible name's composition (Property 22), the Player_Order (Property 15),
 * or which surface a *detail* failure renders (Property 13).
 *
 * Feature: web-squads-screens, Property 23: An ambiguous leaderboard yields no rating for anybody
 * Validates: Requirements 8.11
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fc from 'fast-check';

import { createApiClient } from '@pitchmate/api-client';

import { AuthProvider, type SessionManager } from '../../auth';
import { createSquadsApi, type SquadsApi } from '../api/squadsApi';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { NOT_FOUND_TREATMENT_SELECTOR } from '../components/NotFoundTreatment';
import { PLAYER_LIST_SELECTOR } from '../components/PlayerList';
import {
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_SELECTOR,
} from '../components/PlayerRow';
import {
  RATING_BADGE_KIND_ATTRIBUTE,
  RATING_BADGE_SELECTOR,
} from '../components/RatingBadge';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { RATING_UNAVAILABLE_LABEL } from '../lib/messages';
import { parseDisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import { SQUAD_ROUTE, squadPath } from '../lib/routePaths';
import { PLAYERS_SECTION_SELECTOR, SquadScreen } from './SquadScreen';

// --- The one replaced seam ---------------------------------------------------

/**
 * `usePublishSquadScopeFromRoute` reads the App_Shell's publish context and throws
 * where none is above it — correct for the application, unusable for a screen
 * rendered on its own. Only that export is replaced; the route parameter name and
 * everything else stay the shell's own. The real publication is exercised where
 * the real router is assembled.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return { ...actual, usePublishSquadScopeFromRoute: () => null };
});

// --- Fixtures ---------------------------------------------------------------

const BASE_URL = 'https://squads.property.test';
const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const SQUAD_NAME = 'Thursday Ballers';

/** The path segment the leaderboard call appends, so the fake can route on it. */
const LEADERBOARD_SEGMENT = '/leaderboard';

/** Any digit at all — the assertion that no numeric rating reached a row. */
const DIGIT_PATTERN = /\d/u;

// --- Generators -------------------------------------------------------------

/**
 * Player_Display_Names carrying **no digit**, so "no numeric rating value is
 * rendered" can be asserted as "no digit appears anywhere in the players section"
 * — a far stronger statement than checking the badge text alone, and one a stray
 * rating rendered in any other position would fail.
 *
 * `Former player` is in the pool because an anonymised membership is an ordinary
 * row here: it still gets a rating column, so it still has to be silent.
 */
const NAME_POOL: readonly string[] = [
  'Ada',
  'Grace',
  'Dave',
  'BigDave',
  'Sam',
  'Zoe',
  'Élan',
  'Former player',
  'Ash',
];

const nameArb: fc.Arbitrary<string> = fc.constantFrom(...NAME_POOL);

/**
 * How a `members` element carries its Member_Role: as a Wire_Enum_Name, as `null`,
 * or not at all — the three shapes the backend sends (Requirement 16.8). The names
 * come from the Generated_Enum_Union, so no numeric enum literal appears here.
 */
type RoleField = SquadRole | null | 'absent';

const roleFieldArb: fc.Arbitrary<RoleField> = fc.constantFrom(
  'Owner',
  'Admin',
  'Member',
  null,
  'absent' as const,
);

const stateArb: fc.Arbitrary<MembershipState> = fc.constantFrom(
  'Active' as const,
  'Inactive' as const,
);

/**
 * A **finite** leaderboard value, integral or fractional, positive or negative.
 *
 * Finiteness is the point: a `NaN` or infinite value would produce the
 * Provisional_Band by a different rule (Requirement 8.10), which would make a
 * silent row ambiguous evidence. Keeping every value finite leaves the repeated
 * identity as the only thing that can fail the body.
 */
const valueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1000, max: 9999 }) },
  {
    weight: 1,
    arbitrary: fc
      .double({ min: 1000, max: 9999, noNaN: true, noDefaultInfinity: true })
      .map((value) => Number(value.toFixed(3))),
  },
  { weight: 1, arbitrary: fc.integer({ min: -9999, max: -1000 }) },
);

/** One generated membership, before its identity is assigned. */
interface MemberCase {
  readonly displayName: string;
  readonly role: RoleField;
  readonly state: MembershipState;
  readonly isGuest: boolean;
  /** Whether the leaderboard carries an entry of its own for this membership. */
  readonly hasEntry: boolean;
}

const memberCaseArb: fc.Arbitrary<MemberCase> = fc.record({
  displayName: nameArb,
  role: roleFieldArb,
  state: stateArb,
  isGuest: fc.boolean(),
  hasEntry: fc.boolean(),
});

/** Everything one run needs, generated flatly so no case is assembled twice. */
interface LeaderboardCase {
  readonly members: readonly MemberCase[];
  /**
   * Six distinct identities: up to five for the memberships, and the last for an
   * identity **no membership carries**, so the duplication can be about somebody
   * outside the squad as well as inside it.
   */
  readonly identities: readonly string[];
  /** Which identity repeats: a membership's, or the foreign one. */
  readonly duplicateTarget: number;
  /** How many further copies of it the body carries — always at least one. */
  readonly duplicateCopies: number;
  /** Whether the copies sit together or are separated by other entries. */
  readonly duplicatesAdjacent: boolean;
  /** Values for the entries, drawn independently of one another. */
  readonly values: readonly number[];
}

const caseArb: fc.Arbitrary<LeaderboardCase> = fc.record({
  members: fc.array(memberCaseArb, { minLength: 1, maxLength: 5 }),
  identities: fc.uniqueArray(fc.uuid(), { minLength: 6, maxLength: 6 }),
  duplicateTarget: fc.nat({ max: 5 }),
  duplicateCopies: fc.integer({ min: 1, max: 3 }),
  duplicatesAdjacent: fc.boolean(),
  values: fc.array(valueArb, { minLength: 12, maxLength: 12 }),
});

// --- From a generated case to wire bodies ------------------------------------

/** A membership with the identity it was given. */
interface IdentifiedMember extends MemberCase {
  readonly membershipId: string;
}

/** One `entries` element, exactly as the wire carries it. */
interface EntryBody {
  readonly membershipId: string;
  readonly displayName: string;
  readonly value: number;
}

/** The bodies one run drives the screen with, and what they should produce. */
interface PreparedCase {
  readonly members: readonly IdentifiedMember[];
  /** The `GetSquad` body — impeccable, so the screen always reaches its rows. */
  readonly detailBody: unknown;
  /** The ambiguous `GetSquadLeaderboard` body. */
  readonly ambiguousBody: unknown;
  /** The same body with the repeats dropped, keeping the first per identity. */
  readonly deduplicatedBody: unknown;
  /** The membership the de-duplicated body carries a usable entry for. */
  readonly ratedMembershipId: string;
  /** The integer that membership's Display_Rating must read as. */
  readonly ratedInteger: number;
}

/** The `members` element a case describes, with an absent role left unwritten. */
function memberBodyOf(member: IdentifiedMember): Record<string, unknown> {
  const body: Record<string, unknown> = {
    membershipId: member.membershipId,
    displayName: member.displayName,
    state: member.state,
    isGuest: member.isGuest,
    appearances: 12,
    ratingState: 'Established',
  };

  if (member.role !== 'absent') {
    body.role = member.role;
  }

  return body;
}

/**
 * Requirement 8.2's rounding, restated: to the nearest integer, an exact half away
 * from zero. Written out here rather than imported, so the expected number owes
 * nothing to the implementation that produced the rendered one.
 */
function expectedInteger(value: number): number {
  const magnitude = Math.round(Math.abs(value));

  return magnitude === 0 ? 0 : value < 0 ? -magnitude : magnitude;
}

/** The first entry per membership identity, in first-seen order. */
function deduplicate(entries: readonly EntryBody[]): readonly EntryBody[] {
  const seen = new Set<string>();

  return entries.filter((entry) => {
    if (seen.has(entry.membershipId)) {
      return false;
    }

    seen.add(entry.membershipId);
    return true;
  });
}

/**
 * Turn a generated case into the two wire bodies.
 *
 * The first membership always carries an entry of its own, which is what gives the
 * discriminating property a row whose rating must appear once the repeats are
 * dropped. Everything about the duplication — whose identity repeats, how often,
 * and whether the copies are adjacent — comes from the generator.
 */
function prepare(generated: LeaderboardCase): PreparedCase {
  const members: readonly IdentifiedMember[] = generated.members.map(
    (member, index) => ({
      ...member,
      membershipId: generated.identities[index],
      // The first membership is always on the leaderboard; the rest are as drawn.
      hasEntry: index === 0 ? true : member.hasEntry,
    }),
  );

  const ownEntries: readonly EntryBody[] = members
    .filter((member) => member.hasEntry)
    .map((member, index) => ({
      membershipId: member.membershipId,
      displayName: member.displayName,
      value: generated.values[index],
    }));

  // The repeated identity: one of the memberships, or the identity no membership
  // carries — an ambiguity about somebody outside the squad silences the column
  // just as one about a member does.
  const targetIndex = generated.duplicateTarget % (members.length + 1);
  const target =
    targetIndex < members.length
      ? {
          membershipId: members[targetIndex].membershipId,
          displayName: members[targetIndex].displayName,
        }
      : { membershipId: generated.identities[5], displayName: 'Nia' };

  // One copy beyond whatever the target already has, so the body always carries
  // two or more entries for one identity.
  const copies: readonly EntryBody[] = Array.from(
    { length: generated.duplicateCopies + 1 },
    (_unused, index) => ({
      membershipId: target.membershipId,
      displayName: target.displayName,
      value: generated.values[6 + index],
    }),
  );

  const entries: readonly EntryBody[] = generated.duplicatesAdjacent
    ? [...ownEntries, ...copies]
    : [copies[0], ...ownEntries, ...copies.slice(1)];

  const deduplicated = deduplicate(entries);
  const ratedEntry = deduplicated.find(
    (entry) => entry.membershipId === members[0].membershipId,
  );

  if (ratedEntry === undefined) {
    throw new Error('the first membership must carry a leaderboard entry');
  }

  return {
    members,
    detailBody: {
      squadId: SQUAD_ID,
      name: SQUAD_NAME,
      members: members.map(memberBodyOf),
      features: [],
    },
    ambiguousBody: { entries },
    deduplicatedBody: { entries: deduplicated },
    ratedMembershipId: members[0].membershipId,
    ratedInteger: expectedInteger(ratedEntry.value),
  };
}

// --- The transport ----------------------------------------------------------

/** A `200 OK` carrying `body` as JSON text — what every read of this screen sees. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Yields to the macrotask queue, letting every pending settlement run. */
async function drainTasks(ticks = 4): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * The Squads_Api over a real Api_Client and a fake `fetch`, answering the three
 * reads this screen issues.
 *
 * **The `GetSquad` response is held back** until the leaderboard response has been
 * served *and* its settlement has had time to reach the machine. The two calls are
 * issued in the same tick, so this ordering makes "a Player_Row exists" imply "the
 * leaderboard slot has settled" — which is what stops the property from passing on
 * a screen that is merely still waiting (Requirement 7.13).
 *
 * The caller's `ListMySquads` summary names the `member` role, so no Admin_Section
 * is rendered and no admin read is issued from this subtree.
 */
function createApi(prepared: PreparedCase, leaderboardBody: unknown): SquadsApi {
  let announceLeaderboardServed: () => void = () => {};
  const leaderboardServed = new Promise<void>((resolve) => {
    announceLeaderboardServed = resolve;
  });

  const summariesBody = [
    {
      squadId: SQUAD_ID,
      name: SQUAD_NAME,
      role: 'Member',
      state: 'Active',
    },
  ];

  const fetchImpl = (async (input: Request): Promise<Response> => {
    const path = new URL(input.url).pathname;

    if (path.endsWith(LEADERBOARD_SEGMENT)) {
      announceLeaderboardServed();
      return jsonResponse(leaderboardBody);
    }

    if (path === '/squads') {
      return jsonResponse(summariesBody);
    }

    // The Squad_Detail, deliberately last: the leaderboard has been served and its
    // parse verdict has already reached the machine by the time this lands.
    await leaderboardServed;
    await drainTasks();

    return jsonResponse(prepared.detailBody);
  }) as unknown as typeof fetch;

  return createSquadsApi({
    apiClient: createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl }),
  });
}

/** A `SessionManager` reporting an authenticated session and nothing else. */
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

/** The screen at its real route, inside a real router and a real AuthProvider. */
function screenTree(api: SquadsApi): ReactElement {
  return (
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[squadPath(SQUAD_ID)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadScreen api={api} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

// --- Reading the rendered rows ----------------------------------------------

/** One rendered Player_Row's rating column. */
interface RenderedRating {
  readonly membershipId: string;
  /** Which of the three presentations the row rendered. */
  readonly kind: string;
  /** The words in the rating column. */
  readonly text: string;
  /** The rating column's accessible name. */
  readonly accessibleName: string;
}

/** The rating column of every rendered Player_Row, in document order. */
function renderedRatings(): readonly RenderedRating[] {
  return [...document.querySelectorAll<HTMLElement>(PLAYER_ROW_SELECTOR)].map(
    (row) => {
      const badge = row.querySelector<HTMLElement>(RATING_BADGE_SELECTOR);

      return {
        membershipId: row.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE) ?? '',
        kind: badge?.getAttribute(RATING_BADGE_KIND_ATTRIBUTE) ?? '',
        text: badge?.textContent ?? '',
        accessibleName: badge?.getAttribute('aria-label') ?? '',
      };
    },
  );
}

/** The text of the players section, where every rating on screen lives. */
function playersSectionText(): string {
  return document.querySelector(PLAYERS_SECTION_SELECTOR)?.textContent ?? '';
}

/**
 * Render the screen and wait until every Player_Row exists — which, given the held
 * back `GetSquad` response, is after the leaderboard has settled.
 */
async function renderUntilRowsExist(
  api: SquadsApi,
  expectedRows: number,
): Promise<void> {
  render(screenTree(api));

  await waitFor(() => {
    expect(document.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(
      expectedRows,
    );
  });
}

// --- The assertions ---------------------------------------------------------

/**
 * Requirement 8.11: every row, without exception, renders the Rating_Unavailable
 * presentation and no numeric rating value.
 *
 * The absence of a number is asserted three ways, because each catches a different
 * mistake: the presentation kind (a row that chose a Display_Rating or a
 * Provisional_Band), the rating column's own words and accessible name (a number
 * rendered beside the label, visibly or only to a screen reader), and the whole
 * players section carrying no digit at all (a rating rendered anywhere else on a
 * row). The names in play carry no digit, so the last is exact rather than
 * approximate.
 */
function expectEveryRowSilent(
  prepared: PreparedCase,
  ratings: readonly RenderedRating[],
): void {
  expect(ratings).toHaveLength(prepared.members.length);
  expect([...ratings.map((rating) => rating.membershipId)].sort()).toEqual(
    prepared.members.map((member) => member.membershipId).sort(),
  );

  for (const rating of ratings) {
    expect(rating.kind).toBe('unavailable');
    expect(rating.text).toBe(RATING_UNAVAILABLE_LABEL);
    expect(DIGIT_PATTERN.test(rating.text)).toBe(false);
    expect(DIGIT_PATTERN.test(rating.accessibleName)).toBe(false);
  }

  // No rating value reached the screen by any other route either.
  expect(DIGIT_PATTERN.test(playersSectionText())).toBe(false);
}

/**
 * The degraded rating column is not a failed screen: the Player_List renders, and
 * neither the Generic_Squads_Failure nor the Not_Found_Treatment appears
 * (Requirement 7.10). Asserted here because "every row is unavailable" would be
 * trivially satisfiable by a screen that rendered no rows.
 */
function expectScreenStillWhole(): void {
  expect(document.querySelector(PLAYER_LIST_SELECTOR)).not.toBeNull();
  expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).toBeNull();
}

// --- The property -----------------------------------------------------------

describe('Property 23 — an ambiguous leaderboard yields no rating for anybody', () => {
  // Feature: web-squads-screens, Property 23: An ambiguous leaderboard yields no rating for anybody
  // Validates: Requirements 8.11
  it('rejects a body with a repeated membership identity and leaves every Player_Row without a rating', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (generated) => {
        const prepared = prepare(generated);

        // The parser's half of the property, over the very body the screen is
        // about to be driven with.
        const parsed = parseDisplayRatingLeaderboard(prepared.ambiguousBody);

        expect(parsed.ok).toBe(false);

        try {
          await renderUntilRowsExist(
            createApi(prepared, prepared.ambiguousBody),
            prepared.members.length,
          );

          expectScreenStillWhole();
          expectEveryRowSilent(prepared, renderedRatings());

          // And nothing arrives late: a rating that settled after the rows
          // appeared would show up here.
          await act(async () => {
            await drainTasks();
          });

          expectScreenStillWhole();
          expectEveryRowSilent(prepared, renderedRatings());
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 23: An ambiguous leaderboard yields no rating for anybody
  // Validates: Requirements 8.11
  it('renders that same body’s rating once the repeated entries are dropped', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (generated) => {
        const prepared = prepare(generated);

        // Same entries, same order, repeats removed — so the only difference from
        // the property above is the duplication itself.
        const parsed = parseDisplayRatingLeaderboard(prepared.deduplicatedBody);

        expect(parsed.ok).toBe(true);

        try {
          await renderUntilRowsExist(
            createApi(prepared, prepared.deduplicatedBody),
            prepared.members.length,
          );

          expectScreenStillWhole();

          const rated = renderedRatings().find(
            (rating) => rating.membershipId === prepared.ratedMembershipId,
          );

          expect(rated).toBeDefined();
          // The rating the de-duplicated body carries, rendered as a plain
          // integer — which is exactly what the ambiguous body must never yield.
          expect(rated?.kind).toBe('rating');
          expect(rated?.text).toBe(String(prepared.ratedInteger));
          expect(DIGIT_PATTERN.test(playersSectionText())).toBe(true);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});
