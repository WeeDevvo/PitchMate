/**
 * Property test for the accessible name of a Rating_Presentation (task 11.2).
 *
 * **Property 22: A row's rating is perceivable from its accessible name alone.**
 * *For any* Player_Row, the Rating_Presentation's accessible name names that player
 * and states either the Display_Rating value, or that no settled rating exists yet,
 * or that ratings are unavailable, and carries no numeric rating value whenever the
 * presentation is not a Display_Rating.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | names that player | {@link expectNamesThePlayer} |
 * | states the Display_Rating value | {@link expectStatesTheRating} |
 * | states that no settled rating exists yet, or that ratings are unavailable | {@link expectStatesTheAbsence} |
 * | carries no numeric rating value where the presentation is not a Display_Rating | {@link expectStatesTheAbsence}, the third property |
 *
 * ### "Perceivable from the name alone" is asserted as a lookup, not a read
 *
 * Every property here finds the badge with `getByRole('img', { name })` — a query
 * that computes the accessible name the way a browser does, through
 * `dom-accessibility-api`, rather than reading the `aria-label` attribute back. A
 * `role="img"` collapses its subtree for name computation, so an implementation
 * that dropped the label and relied on its child text would fail the lookup even
 * though the words were visibly on screen. That is exactly the failure Requirement
 * 8.8 is about: the rating must not be something a reader has to infer from which
 * badge sits beside which row.
 *
 * The rendered name is separately asserted equal to what the exported pure function
 * returns, so the function a Player_Row test can call without a DOM is the same
 * statement a screen reader announces — one name, not two that can drift.
 *
 * ### Position independence is measured with several rows at once
 *
 * The last property renders a whole list of badges and asserts each is still
 * findable by its own accessible name, and that two players with the *same*
 * presentation still get distinguishable names. A badge whose name stated only the
 * rating — "1240" — would pass every single-row assertion and fail this one, which
 * is the case Requirement 8.8 actually guards against.
 *
 * ### Why the non-rating names are checked for digits with digit-free player names
 *
 * The name is composed of the player's name and a fixed statement, so a digit in a
 * band's name can only have come from the player's own name — "Player 7" is a
 * legitimate name and must survive verbatim. The digit assertion is therefore made
 * over digit-free names, where any digit found is necessarily a rating value that
 * leaked; a separate property generates names *containing* digits and asserts they
 * are preserved rather than stripped, so the two claims do not collapse into one
 * that forbids digits outright.
 *
 * Feature: web-squads-screens, Property 22: A row's rating is perceivable from its accessible name alone
 * Validates: Requirements 8.8
 */
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import fc from 'fast-check';

import {
  RATING_BADGE_SELECTOR,
  RatingBadge,
  ratingBadgeAccessibleName,
} from './RatingBadge';
import {
  parseDisplayRatingLeaderboard,
  type DisplayRatingLeaderboard,
} from '../lib/parse/leaderboard';
import { parseSquadMember, type SquadMember } from '../lib/parse/squadDetail';
import { PROVISIONAL_BAND_LABEL, RATING_UNAVAILABLE_LABEL } from '../lib/messages';
import {
  formatDisplayRating,
  selectRatingPresentation,
  type RatingPresentation,
} from '../lib/ratingPresentation';

/** Any decimal digit in any script — a leaked rating value, wherever it came from. */
const DIGIT_PATTERN = /\p{Nd}/u;

// --- Generators --------------------------------------------------------------

/**
 * A player name free of digits, with single interior spaces so the accessible name
 * (which collapses whitespace) can be compared to it verbatim. Case variants are
 * weighted in because a name that was folded on its way into the announcement would
 * make two similarly-named squad members indistinguishable by ear.
 */
const digitFreeNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'Dave',
      'dave',
      'DAVE',
      'BigDave',
      "Síobhán O'Neill",
      'Former player',
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 30, unit: 'grapheme' })
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(
        (value) =>
          value.length > 0 &&
          /^[\p{L}\p{P} ]+$/u.test(value) &&
          !DIGIT_PATTERN.test(value),
      ),
  },
);

/** A player name that carries digits of its own — a legitimate squad display name. */
const digitBearingNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom('Player 7', 'Dave 2', '5-a-side Sam') },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        fc.constantFrom('Dave', 'Sam', 'Ash'),
        fc.integer({ min: 0, max: 9999 }),
      )
      .map(([stem, number]) => `${stem} ${String(number)}`),
  },
);

/**
 * A leaderboard value. The exact halves and the signed zero are included because
 * they are where the rounding in `formatDisplayRating` earns its keep, and the
 * bounded double keeps every rendering a plain decimal integer rather than an
 * exponent form.
 */
const ratingValueArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      0,
      -0,
      0.5,
      -0.5,
      1.5,
      -2.5,
      1240,
      -1240,
      Number.MAX_SAFE_INTEGER,
    ),
  },
  {
    weight: 3,
    arbitrary: fc.double({
      min: -1_000_000,
      max: 1_000_000,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  },
);

/** Which of the three presentations a generated row gets. */
type PresentationKind = 'rating' | 'provisional' | 'unavailable';

// --- From a generated case to a presentation ---------------------------------

/** A parsed Squad_Member with the given identity and name. */
function parsedMemberOf(membershipId: string, displayName: string): SquadMember {
  const body = {
    membershipId,
    displayName,
    role: null,
    state: 'Active',
    isGuest: false,
    appearances: 12,
    ratingState: 'Established',
  };
  const parsed = parseSquadMember(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated member must parse, but it did not: ${JSON.stringify(body)} — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

/** A leaderboard identity that no `fc.uuid()` can produce: its version nibble is 0. */
function otherIdentity(index: number): string {
  return `ffffffff-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

/** The parsed leaderboard from a list of entry values keyed by identity. */
function parsedLeaderboardOf(
  entries: readonly { readonly membershipId: string; readonly value: number }[],
): DisplayRatingLeaderboard {
  const body = {
    entries: entries.map((entry) => ({
      membershipId: entry.membershipId,
      displayName: 'a name the Player_List never reads',
      value: entry.value,
    })),
  };
  const parsed = parseDisplayRatingLeaderboard(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated leaderboard must parse, but it did not — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

/**
 * The presentation a row of the given kind gets, chosen by the production selection
 * function over parsed values rather than hand-built, so the name under test is the
 * name a real Player_Row would carry.
 */
function presentationFor(
  kind: PresentationKind,
  membershipId: string,
  displayName: string,
  value: number,
): RatingPresentation {
  const member = parsedMemberOf(membershipId, displayName);
  const leaderboard =
    kind === 'unavailable'
      ? null
      : parsedLeaderboardOf(
          kind === 'rating'
            ? [{ membershipId, value }]
            : [{ membershipId: otherIdentity(0), value }],
        );
  const presentation = selectRatingPresentation(member, leaderboard);

  expect(presentation.kind).toBe(kind);

  return presentation;
}

// --- The assertions ----------------------------------------------------------

/** The single Rating_Presentation element of a rendering. */
function badgeOf(container: HTMLElement): HTMLElement {
  const badges = container.querySelectorAll<HTMLElement>(RATING_BADGE_SELECTOR);

  expect(badges).toHaveLength(1);

  return badges[0];
}

/**
 * Requirement 8.8: the name is announced as one unit, is the name the exported pure
 * function builds, and names the player verbatim — so a reader hearing it knows
 * whose rating it is without looking at where the badge sits.
 */
function expectNamesThePlayer(
  badge: HTMLElement,
  playerName: string,
  presentation: RatingPresentation,
): string {
  const expected = ratingBadgeAccessibleName(playerName, presentation);

  // The computed name, not the attribute: a label that assistive technology would
  // not use fails here even when the words are in the markup.
  expect(badge).toHaveAccessibleName(expected);
  expect(screen.getByRole('img', { name: expected })).toBe(badge);
  expect(expected).toContain(playerName);

  return expected;
}

/** The Display_Rating case: the name states the row's own value (Requirement 8.8). */
function expectStatesTheRating(accessibleName: string, value: number): void {
  const rendered = String(formatDisplayRating(value));

  expect(accessibleName).toContain(rendered);
  // Announced as a rating rather than as a bare number.
  expect(accessibleName.toLowerCase()).toContain('rating');
}

/**
 * The two non-rating cases: the name states the absence in the same words the row
 * shows, and carries no numeric rating value at all (Requirement 8.8).
 */
function expectStatesTheAbsence(
  accessibleName: string,
  kind: 'provisional' | 'unavailable',
): void {
  const expectedStatement =
    kind === 'provisional' ? PROVISIONAL_BAND_LABEL : RATING_UNAVAILABLE_LABEL;
  const otherStatement =
    kind === 'provisional' ? RATING_UNAVAILABLE_LABEL : PROVISIONAL_BAND_LABEL;

  expect(accessibleName).toContain(expectedStatement);
  expect(accessibleName).not.toContain(otherStatement);
  // The player name is digit-free in this property, so any digit is a leak.
  expect(accessibleName).not.toMatch(DIGIT_PATTERN);
}

// --- The property ------------------------------------------------------------

describe("Property 22 — a row's rating is perceivable from its accessible name alone", () => {
  // Feature: web-squads-screens, Property 22: A row's rating is perceivable from its accessible name alone
  // Validates: Requirements 8.8
  it('names the player and states the value, the band, or the unavailable label', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PresentationKind>('rating', 'provisional', 'unavailable'),
        digitFreeNameArb,
        fc.uuid(),
        ratingValueArb,
        (kind, playerName, membershipId, value) => {
          const presentation = presentationFor(
            kind,
            membershipId,
            playerName,
            value,
          );
          const { container } = render(
            <RatingBadge playerName={playerName} presentation={presentation} />,
          );

          try {
            const accessibleName = expectNamesThePlayer(
              badgeOf(container),
              playerName,
              presentation,
            );

            if (kind === 'rating') {
              expectStatesTheRating(accessibleName, value);
            } else {
              expectStatesTheAbsence(accessibleName, kind);
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 300 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 22: A row's rating is perceivable from its accessible name alone
  // Validates: Requirements 8.8
  it("keeps the digits of a player's own name while adding none of its own", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Exclude<PresentationKind, 'rating'>>(
          'provisional',
          'unavailable',
        ),
        digitBearingNameArb,
        fc.uuid(),
        ratingValueArb,
        (kind, playerName, membershipId, value) => {
          const presentation = presentationFor(
            kind,
            membershipId,
            playerName,
            value,
          );
          const { container } = render(
            <RatingBadge playerName={playerName} presentation={presentation} />,
          );

          try {
            const accessibleName = expectNamesThePlayer(
              badgeOf(container),
              playerName,
              presentation,
            );

            // The name is preserved, and the only digits in the announcement are
            // the ones the name itself carried — nothing derived from a rating.
            const digitsOfName = (playerName.match(/\p{Nd}/gu) ?? []).join('');
            const digitsOfAnnouncement = (
              accessibleName.match(/\p{Nd}/gu) ?? []
            ).join('');

            expect(digitsOfAnnouncement).toBe(digitsOfName);
            expect(accessibleName).toContain(
              kind === 'provisional'
                ? PROVISIONAL_BAND_LABEL
                : RATING_UNAVAILABLE_LABEL,
            );
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 22: A row's rating is perceivable from its accessible name alone
  // Validates: Requirements 8.8
  it('names each row independently of where its badge sits', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            membershipId: fc.uuid(),
            playerName: digitFreeNameArb,
            kind: fc.constantFrom<PresentationKind>(
              'rating',
              'provisional',
              'unavailable',
            ),
            value: ratingValueArb,
          }),
          {
            minLength: 2,
            maxLength: 6,
            selector: (row) => row.playerName,
          },
        ),
        (rows) => {
          const presentations = rows.map((row) =>
            presentationFor(row.kind, row.membershipId, row.playerName, row.value),
          );
          const { container } = render(
            <ul>
              {rows.map((row, index) => (
                <li key={row.membershipId}>
                  <RatingBadge
                    playerName={row.playerName}
                    presentation={presentations[index]}
                  />
                </li>
              ))}
            </ul>,
          );

          try {
            const names = rows.map((row, index) => {
              const expected = ratingBadgeAccessibleName(
                row.playerName,
                presentations[index],
              );
              const badge = within(container).getByRole('img', {
                name: expected,
              });

              // Each badge is the one inside its own row, so the name belongs to
              // the player it sits beside rather than to a neighbour.
              expect(badge.closest('li')?.textContent).toBe(badge.textContent);
              expect(expected).toContain(row.playerName);

              return expected;
            });

            // Distinct players yield distinct announcements, even where two rows
            // present the very same rating (Requirement 8.8).
            expect(new Set(names).size).toBe(names.length);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);
});
