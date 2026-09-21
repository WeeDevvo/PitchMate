/**
 * Property test for the Player_Stats_Route seam as a Player_Row presents it
 * (task 11.4).
 *
 * **Property 24: The Player_Stats_Route seam is constructed once and
 * recoverable.** *For any* squad identity and membership identity, the path built
 * by the exported construction function matches the exported route pattern, both
 * identities are recoverable from it by that pattern, and each Player_Row renders
 * exactly one keyboard-operable control whose target is the path built from that
 * row's identities and whose accessible name names the player whose stats it opens.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 9.2 — one construction, and the path it builds matches the exported pattern | {@link expectPathMatchesPattern}, {@link expectSeamIsBuiltOnce} |
 * | 9.2 — both identities recoverable through that pattern | {@link expectPathMatchesPattern} |
 * | 9.1 — exactly one control per row, reachable and operable by keyboard | {@link expectExactlyOneSeamControl}, the activation property |
 * | 9.5 — that control's accessible name names the player | {@link expectExactlyOneSeamControl} |
 *
 * ### What this file adds over `lib/routePaths.property.test.ts`
 *
 * The pure half of Property 24 — a built path matches the pattern and round-trips
 * its segments — is already held beside the module that owns it. What that property
 * cannot say is whether the *row* uses it. So this file is about the join: the
 * control the row renders carries exactly the string `playerStatsPath` returns for
 * that row's own identities, the pattern recovers those same two identities from it,
 * and no second element in the row carries a path of its own. A row that assembled
 * the path with a template literal would satisfy the pure property (which never
 * sees the row) and fail here on the first identity needing an escape.
 *
 * A local pattern matcher is the oracle, written from the route pattern's shape
 * rather than from the construction, for the same reason it is there: comparing two
 * strings built the same way proves nothing, whereas matching back against the
 * pattern catches a dropped segment, a run-together pair, and an unencoded
 * separator.
 *
 * ### Two rows, so "that row's identities" is a real claim
 *
 * Every case renders **two** rows with distinct memberships and asserts each
 * control targets its own path and carries neither the other row's path nor the
 * other player's name. A single-row test would pass just as happily for a row that
 * targeted the first membership of the list.
 *
 * ### The admin controls are generated on purpose
 *
 * "Exactly one control targeting the seam" has to hold on a row that renders three
 * buttons, not just on a bare one. So the viewer holds Admin_Authority on most runs
 * and the generated rows include the promotable and guest-editable shapes: the
 * count under test is the number of controls carrying the stats path, not the number
 * of buttons.
 *
 * ### "Operable by keyboard" is exercised, not inferred from the tag name
 *
 * Requirement 9.1 asks for reachable *and* operable, so the activation property
 * drives pointer, Enter, and Space through `user-event` and asserts each opens that
 * row's own membership exactly once. The native `<button>` gives Enter and Space for
 * free today, which is precisely the claim worth pinning: a later change to a
 * clickable `div` would keep the pointer case passing and break both keys.
 *
 * Feature: web-squads-screens, Property 24: The Player_Stats_Route seam is constructed once and recoverable
 * Validates: Requirements 9.1, 9.2, 9.5
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

import {
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_OPEN_SELECTOR,
  PLAYER_ROW_SELECTOR,
  PLAYER_ROW_STATS_PATH_ATTRIBUTE,
  PlayerRow,
  type ViewerContext,
} from './PlayerRow';
import {
  codeFromMemberRole,
  codeFromMembershipState,
  type MemberRole,
  type MembershipStateValue,
} from '../lib/enumCodes';
import { parseSquadDetail } from '../lib/parse/squadDetail';
import { composePlayerList, type PlayerListRow } from '../lib/playerList';
import { PLAYER_STATS_ROUTE, playerStatsPath } from '../lib/routePaths';

const VIEWER_MEMBERSHIP_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// --- The oracle: recovering a path's identities through the pattern ------------

/**
 * Matches a path against the Player_Stats_Route pattern, recovering each dynamic
 * segment's decoded value.
 *
 * Written from the pattern's own shape — `/` separators, `:name` for a dynamic
 * segment, everything else literal — and strict in the two ways a router is: the
 * segment counts must agree, and a dynamic segment must carry a non-empty value.
 * An undecodable segment is a non-match rather than a throw, so the oracle is total.
 *
 * @returns the decoded dynamic segments by name, or `null` when the path does not
 *   match the pattern
 */
function matchRoutePattern(
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | null {
  const patternSegments = pattern.split('/');
  const pathSegments = path.split('/');

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const parameters: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathSegments[index];

    if (!expected.startsWith(':')) {
      if (actual !== expected) {
        return null;
      }
      continue;
    }

    if (actual.length === 0) {
      return null;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(actual);
    } catch {
      return null;
    }

    parameters[expected.slice(1)] = decoded;
  }

  return parameters;
}

// --- Generators ---------------------------------------------------------------

/** A well-formed membership identity, in either letter case. */
const membershipIdArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((value) => value.toUpperCase()) },
);

/**
 * A squad identity as the row receives it: the well-formed form the Squad_Route
 * carries, plus values whose characters would change a path's *shape* if the
 * construction ever stopped encoding them. The row treats the value as opaque, so
 * nothing here is out of its domain.
 */
const squadIdArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: membershipIdArb },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'a/b',
      '../../etc/passwd',
      'a?b=c',
      'a#b',
      '%2F',
      '%',
      'squad with spaces',
      'ünïcödé',
      '日本語',
      '🙈',
      'e'.repeat(200),
    ),
  },
);

/** A player name, free of exotic whitespace so its accessible name is comparable. */
const playerNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'Dave',
      'BigDave',
      "Síobhán O'Neill",
      'Former player',
      'Ali',
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 30, unit: 'grapheme' })
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length > 0 && /^[\p{L}\p{N}\p{P} ]+$/u.test(value)),
  },
);

/** One generated membership: enough to reach the promotable and guest shapes. */
interface MemberCase {
  readonly membershipId: string;
  readonly displayName: string;
  readonly role: MemberRole | null;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
}

const memberCaseArb: fc.Arbitrary<MemberCase> = fc
  .record({
    membershipId: membershipIdArb,
    displayName: playerNameArb,
    role: fc.constantFrom<MemberRole | null>('owner', 'admin', 'member', null),
    state: fc.constantFrom<MembershipStateValue>('active', 'inactive'),
    isGuest: fc.boolean(),
  })
  // A guest carries no role on the wire, which is the shape the parser accepts as
  // the guest's absence (Requirement 16.8).
  .map((member) => (member.isGuest ? { ...member, role: null } : member));

interface SeamCase {
  readonly squadId: string;
  readonly members: readonly [MemberCase, MemberCase];
  readonly viewerIsAdmin: boolean;
}

const seamCaseArb: fc.Arbitrary<SeamCase> = fc
  .record({
    squadId: squadIdArb,
    members: fc.uniqueArray(memberCaseArb, {
      minLength: 2,
      maxLength: 2,
      selector: (member) => member.membershipId.toLowerCase(),
    }),
    // Weighted towards Admin_Authority, so most runs render the extra buttons the
    // "exactly one control targeting the seam" count has to survive.
    viewerIsAdmin: fc.oneof(
      { weight: 4, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
  })
  .map(({ squadId, members, viewerIsAdmin }) => ({
    squadId,
    members: [members[0], members[1]] as const,
    viewerIsAdmin,
  }));

// --- From a generated case to composed rows -----------------------------------

/**
 * The two composed Player_List rows a case describes, parsed from a wire body so
 * every identity and name is one `GetSquad` could have produced.
 */
function composedRowsOf(testCase: SeamCase): readonly PlayerListRow[] {
  const body = {
    // The squad identity the *rows* are composed under is irrelevant to the
    // composition; the path is built from the `squadId` prop the screen passes.
    squadId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01',
    name: 'Thursday Ballers',
    members: testCase.members.map((member) => ({
      membershipId: member.membershipId,
      displayName: member.displayName,
      role: member.role === null ? null : codeFromMemberRole(member.role),
      state: codeFromMembershipState(member.state),
      isGuest: member.isGuest,
    })),
    features: [],
  };
  const detail = parseSquadDetail(body);

  if (!detail.ok) {
    throw new Error(
      `the generated detail must parse, but it did not: ${JSON.stringify(body)} — ${detail.reason}`,
    );
  }

  const rows = composePlayerList(detail.value, null);

  expect(rows).toHaveLength(2);

  return rows;
}

interface Rendered {
  readonly container: HTMLElement;
  readonly onOpenPlayer: ReturnType<typeof vi.fn>;
}

/** Render both rows of a case, as the Player_List will render them. */
function renderRows(
  testCase: SeamCase,
  rows: readonly PlayerListRow[],
): Rendered {
  const onOpenPlayer = vi.fn();
  const viewer: ViewerContext = {
    membershipId: VIEWER_MEMBERSHIP_ID,
    isAdmin: testCase.viewerIsAdmin,
  };
  const { container } = render(
    <div>
      {rows.map((row) => (
        <PlayerRow
          key={row.membershipId}
          squadId={testCase.squadId}
          row={row}
          viewer={viewer}
          onOpenPlayer={onOpenPlayer}
          onPromote={vi.fn()}
          onEditGuest={vi.fn()}
        />
      ))}
    </div>,
  );

  expect(container.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(rows.length);

  return { container, onOpenPlayer };
}

/** The rendered row of a membership, located by identity rather than by name. */
function rowFor(container: HTMLElement, membershipId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `${PLAYER_ROW_SELECTOR}[${PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE}="${membershipId}"]`,
  );

  expect(row, `no row rendered for ${membershipId}`).not.toBeNull();

  return row as HTMLElement;
}

/** Whitespace collapsed the way an accessible name computation collapses it. */
function normalised(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 9.2: the built path matches the exported pattern and both identities
 * come back out of it unchanged — the claim the later player-stats feature registers
 * against.
 */
function expectPathMatchesPattern(
  path: string,
  squadId: string,
  membershipId: string,
): void {
  expect(matchRoutePattern(PLAYER_STATS_ROUTE, path)).toEqual({
    squadId,
    membershipId,
  });
}

/**
 * Requirements 9.1, 9.5: the row renders exactly one control targeting the seam, it
 * is a native button that is reachable by keyboard, its target is the path built for
 * *this* row, and its accessible name is this player's name.
 */
function expectExactlyOneSeamControl(
  row: HTMLElement,
  squadId: string,
  member: MemberCase,
): void {
  const targeting = [
    ...row.querySelectorAll<HTMLElement>(`[${PLAYER_ROW_STATS_PATH_ATTRIBUTE}]`),
  ];

  // Exactly one, however many other buttons the row renders.
  expect(targeting).toHaveLength(1);

  const control = targeting[0];

  expect(control.matches(PLAYER_ROW_OPEN_SELECTOR)).toBe(true);
  expect(row.querySelectorAll(PLAYER_ROW_OPEN_SELECTOR)).toHaveLength(1);

  // Reachable and operable by keyboard: a native, enabled button in the tab order.
  expect(control.tagName).toBe('BUTTON');
  expect(control.getAttribute('type')).toBe('button');
  expect(control.hasAttribute('disabled')).toBe(false);
  expect(control.getAttribute('aria-disabled')).toBeNull();
  expect(control.tabIndex).toBeGreaterThanOrEqual(0);
  // 9.4: no link default anywhere in the row, so no full-document reload exists
  // to be prevented.
  expect(control.hasAttribute('href')).toBe(false);
  expect(row.querySelector('a')).toBeNull();

  const target = control.getAttribute(PLAYER_ROW_STATS_PATH_ATTRIBUTE) ?? '';

  expect(target).toBe(playerStatsPath(squadId, member.membershipId));
  expectPathMatchesPattern(target, squadId, member.membershipId);

  // 9.5: the control names the player whose stats it opens.
  expect(control).toHaveAccessibleName(normalised(member.displayName));
}

/**
 * Requirement 9.2: the path is constructed once. It appears in the rendered row
 * exactly once — no duplicate attribute, no hidden copy — and the row carries no
 * other row's path.
 */
function expectSeamIsBuiltOnce(
  row: HTMLElement,
  squadId: string,
  member: MemberCase,
  otherMember: MemberCase,
): void {
  const path = playerStatsPath(squadId, member.membershipId);
  const otherPath = playerStatsPath(squadId, otherMember.membershipId);
  const markup = row.outerHTML;

  // `encodeURIComponent` output is ASCII and free of `&`, `<`, and `>`, so the path
  // reaches the markup unescaped and counting occurrences is exact.
  expect(markup.split(path)).toHaveLength(2);
  expect(markup).not.toContain(otherPath);
}

// --- The property -------------------------------------------------------------

describe('Property 24 — the Player_Stats_Route seam is constructed once and recoverable', () => {
  // Feature: web-squads-screens, Property 24: The Player_Stats_Route seam is constructed once and recoverable
  // Validates: Requirements 9.1, 9.2, 9.5
  it('renders one control per row targeting playerStatsPath for that row, recoverable through PLAYER_STATS_ROUTE', () => {
    fc.assert(
      fc.property(seamCaseArb, (testCase) => {
        const rows = composedRowsOf(testCase);
        const rendered = renderRows(testCase, rows);

        try {
          testCase.members.forEach((member, index) => {
            const other = testCase.members[index === 0 ? 1 : 0];
            const row = rowFor(rendered.container, member.membershipId);

            expectExactlyOneSeamControl(row, testCase.squadId, member);
            expectSeamIsBuiltOnce(row, testCase.squadId, member, other);
          });
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 24: The Player_Stats_Route seam is constructed once and recoverable
  // Validates: Requirements 9.1
  it('opens that row’s own membership on pointer activation, Enter, and Space', async () => {
    await fc.assert(
      fc.asyncProperty(
        seamCaseArb,
        fc.nat(),
        fc.constantFrom<'pointer' | 'enter' | 'space'>('pointer', 'enter', 'space'),
        async (testCase, offset, activation) => {
          const member = testCase.members[offset % testCase.members.length];
          const rows = composedRowsOf(testCase);
          const rendered = renderRows(testCase, rows);
          const user = userEvent.setup();

          try {
            const control = rowFor(
              rendered.container,
              member.membershipId,
            ).querySelector<HTMLElement>(PLAYER_ROW_OPEN_SELECTOR);

            expect(control).not.toBeNull();

            if (activation === 'pointer') {
              await user.click(control as HTMLElement);
            } else {
              (control as HTMLElement).focus();
              expect(control).toHaveFocus();
              await user.keyboard(activation === 'enter' ? '{Enter}' : ' ');
            }

            // Exactly once, and for this row's membership — not the other row's.
            expect(rendered.onOpenPlayer).toHaveBeenCalledTimes(1);
            expect(rendered.onOpenPlayer).toHaveBeenCalledWith(member.membershipId);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 24: The Player_Stats_Route seam is constructed once and recoverable
  // Validates: Requirements 9.2
  it('keeps the two identities in their own segments, so no pair collapses into another path', () => {
    fc.assert(
      fc.property(squadIdArb, membershipIdArb, (squadId, membershipId) => {
        const path = playerStatsPath(squadId, membershipId);

        expectPathMatchesPattern(path, squadId, membershipId);

        // Swapping the identities yields a different path whenever they differ, so
        // the construction cannot have run them together.
        const swapped = playerStatsPath(membershipId, squadId);

        if (squadId === membershipId) {
          expect(swapped).toBe(path);
        } else {
          expect(swapped).not.toBe(path);
          expectPathMatchesPattern(swapped, membershipId, squadId);
        }
      }),
      { numRuns: 300 },
    );
  }, 120_000);
});
