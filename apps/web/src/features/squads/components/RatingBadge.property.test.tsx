/**
 * Property test for the two non-rating Rating_Presentations (task 11.2).
 *
 * **Property 21: The band and unavailable presentations are constant,
 * non-numeric, and non-colour-dependent.** *For any* Player_Row presenting a
 * Provisional_Band, the rendered band content is identical irrespective of that
 * member's membership state, guest flag, and role and irrespective of how many
 * entries the leaderboard carries, comprises a badge together with a text label
 * containing no digit character, no approximation or range indicator, no count of
 * matches played, and no statement of a reason; *for any* Player_Row presenting
 * Rating_Unavailable the label text is identical across rows, states that ratings
 * are unavailable, and contains no digit character; and both are conveyed by text
 * and shape in addition to any colour difference.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 8.4 — a badge together with a label asserting nothing but the absence | {@link expectBadgeAndTextLabel}, {@link expectLabelAssertsOnlyAbsence} |
 * | 8.7 — text and shape, not colour alone | {@link expectBadgeAndTextLabel}, {@link expectNotColourDependent} |
 * | 8.12 — identical band content whatever the member and the leaderboard size | the identity comparison against {@link baselineMarkupFor} |
 * | 8.13 — one identical unavailable label, digit-free, about no individual | the same comparison, {@link expectLabelAssertsOnlyAbsence} |
 * | 19.3 — the state survives with every hue discarded | {@link expectNotColourDependent} |
 *
 * ### The presentation is selected, not asserted into place
 *
 * Every rendering here is driven by `selectRatingPresentation` over a **parsed**
 * Squad_Member and a **parsed** leaderboard, so the case reaching the component is
 * the one a real screen would reach. That matters for Requirement 8.12: the claim
 * is about a band rendered for a member with a state, a guest flag, and a role, and
 * a hand-built `{ kind: 'provisional' }` would quietly assume the very thing the
 * property is testing — that none of those fields can reach the badge. Generating
 * the member and letting the selection function choose keeps that a result rather
 * than a premise. The expected kind is derived independently (a leaderboard was
 * obtained or it was not) and asserted, so a selection that started answering
 * differently fails here rather than silently narrowing the property.
 *
 * ### Identity is compared against a baseline, not spot-checked
 *
 * "Identical content" is asserted as `outerHTML` equality against a baseline
 * rendering of the same kind — a fixed member (active, non-guest, owner) with the
 * same player name — so *any* difference fails: a class that varied with the
 * membership state, an extra chip for a guest, a title attribute naming a role, a
 * count of leaderboard entries. Comparing markup rather than text is deliberate:
 * Requirement 8.12 says the *content* is identical, and a tell hidden in an
 * attribute is still a tell.
 *
 * ### Why the leaderboard size is generated, including 200
 *
 * A Provisional_Band arises when the leaderboard carries no entry for that
 * membership — which happens whether the leaderboard is empty or carries every
 * other player in the squad. A band that quietly said "unranked of 200" would be a
 * statement of a reason, so sizes 0, 1, 2, and 200 are generated and all of them
 * are compared to the same baseline. {@link describe}'s third property goes
 * further: the entries carry generated values, and none of those values' digits
 * may appear anywhere in the rendered band.
 *
 * Feature: web-squads-screens, Property 21: The band and unavailable presentations are constant, non-numeric, and non-colour-dependent
 * Validates: Requirements 8.4, 8.7, 8.12, 8.13, 19.3
 */
import { describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import fc from 'fast-check';

import {
  RATING_BADGE_KIND_ATTRIBUTE,
  RATING_BADGE_SELECTOR,
  RATING_BADGE_SHAPE_SELECTOR,
  RatingBadge,
} from './RatingBadge';
import {
  codeFromMemberRole,
  codeFromMembershipState,
  type MemberRole,
  type MembershipStateValue,
} from '../lib/enumCodes';
import {
  parseDisplayRatingLeaderboard,
  type DisplayRatingLeaderboard,
} from '../lib/parse/leaderboard';
import { parseSquadMember, type SquadMember } from '../lib/parse/squadDetail';
import { PROVISIONAL_BAND_LABEL, RATING_UNAVAILABLE_LABEL } from '../lib/messages';
import {
  selectRatingPresentation,
  type RatingPresentation,
} from '../lib/ratingPresentation';

// --- What the two non-rating presentations may say ---------------------------

/** The label each non-rating presentation must render (Requirements 8.4, 8.13). */
const LABEL_OF_KIND: Readonly<Record<'provisional' | 'unavailable', string>> = {
  provisional: PROVISIONAL_BAND_LABEL,
  unavailable: RATING_UNAVAILABLE_LABEL,
};

/**
 * Any decimal digit in any script, so a label carrying an Eastern Arabic numeral
 * fails the same way one carrying `7` does (Requirements 8.4, 8.13).
 */
const DIGIT_PATTERN = /\p{Nd}/u;

/**
 * An approximation or range indicator (Requirement 8.4). A band says the rating is
 * not settled; it may not hint at where an unsettled rating might land, whether by
 * a tilde, a plus-or-minus, a dash between two ends, an ellipsis, or a word like
 * "about" or "between".
 */
const RANGE_INDICATOR_PATTERN =
  /[~≈±<>≤≥+\u2013\u2014\u2026]|\.\.\.|\b(?:to|between|around|about|approx\w*|roughly|near|circa|est\w*)\b/iu;

/**
 * A count of matches played (Requirement 8.4). Digits are already forbidden, so
 * this catches the wording that would carry a count — "no matches yet", "needs
 * more games" — even spelled out in words.
 */
const MATCH_COUNT_PATTERN =
  /\b(?:match\w*|game\w*|played|play|appearance\w*|cap|caps|fixture\w*|result\w*|one|two|three|four|five|six|seven|eight|nine|ten|few|several|more|enough)\b/iu;

/**
 * A statement of why no settled rating exists (Requirements 8.4, 8.13). The band
 * distinguishes no cause, so it may name neither the member's standing in the
 * squad, nor the leaderboard's fate, nor a reason of any kind.
 */
const REASON_PATTERN =
  /\b(?:because|since|due|guest|owner|admin|member\w*|inactive|active|new|newcomer|unranked|unrated|provisional|insufficient|missing|absent|failed|failure|error|unknown|why|reason|left|removed|anonymised|anonymized|former|offline|timed|timeout)\b/iu;

// --- Generators --------------------------------------------------------------

/** Every Member_Role a Squad_Member can carry, and the guest's absence of one. */
const ROLE_FORMS: readonly (MemberRole | null)[] = [
  'owner',
  'admin',
  'member',
  null,
];

/** Both Membership_States (Requirement 8.12). */
const STATE_FORMS: readonly MembershipStateValue[] = ['active', 'inactive'];

/**
 * How many entries the leaderboard carries, or `null` for a leaderboard that was
 * never obtained — the Rating_Unavailable case. `200` is included because a band
 * beside a fully-populated leaderboard must say exactly what one beside an empty
 * leaderboard says (Requirement 8.12).
 */
const LEADERBOARD_SIZES: readonly (number | null)[] = [null, 0, 1, 2, 200];

/**
 * A player name. Restricted to letters, punctuation, and single interior spaces so
 * the rendered text can be compared verbatim, and free of digits so a digit found
 * in the badge can only have come from the label itself.
 */
const playerNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('Dave', 'BigDave', "Síobhán O'Neill") },
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

interface BandCase {
  readonly membershipId: string;
  readonly playerName: string;
  readonly role: MemberRole | null;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
  /** Entry count, or `null` for no leaderboard at all. */
  readonly leaderboardSize: number | null;
}

const bandCaseArb: fc.Arbitrary<BandCase> = fc.record({
  membershipId: fc.uuid(),
  playerName: playerNameArb,
  role: fc.constantFrom(...ROLE_FORMS),
  state: fc.constantFrom(...STATE_FORMS),
  isGuest: fc.boolean(),
  leaderboardSize: fc.constantFrom(...LEADERBOARD_SIZES),
});

// --- From a generated case to parsed values ----------------------------------

/**
 * The parsed Squad_Member a case describes. Parsing is asserted rather than
 * assumed, so a generator that wandered outside the accepted wire shape reports
 * itself instead of narrowing the property.
 */
function parsedMemberOf(testCase: {
  readonly membershipId: string;
  readonly playerName: string;
  readonly role: MemberRole | null;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
}): SquadMember {
  const body = {
    membershipId: testCase.membershipId,
    displayName: testCase.playerName,
    role: testCase.role === null ? null : codeFromMemberRole(testCase.role),
    state: codeFromMembershipState(testCase.state),
    isGuest: testCase.isGuest,
  };
  const parsed = parseSquadMember(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated member must parse, but it did not: ${JSON.stringify(body)} — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

/**
 * A leaderboard identity that is well formed and **cannot** collide with a
 * generated `fc.uuid()`: its version nibble is `0`, and `fc.uuid()` only produces
 * versions 1 to 5. So no entry ever matches the member under test, and the
 * presentation stays provisional by construction rather than by probability.
 */
function otherIdentity(index: number): string {
  return `ffffffff-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

/**
 * The parsed leaderboard a case describes, or `null` for the Rating_Unavailable
 * case. Entries carry values, none of which belongs to the member under test.
 */
function parsedLeaderboardOf(
  size: number | null,
  valueAt: (index: number) => number = (index) => index + 1,
): DisplayRatingLeaderboard | null {
  if (size === null) {
    return null;
  }

  const body = {
    entries: Array.from({ length: size }, (_unused, index) => ({
      membershipId: otherIdentity(index),
      displayName: `Other ${otherIdentity(index)}`,
      value: valueAt(index),
    })),
  };
  const parsed = parseDisplayRatingLeaderboard(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated leaderboard of ${String(size)} entries must parse, but it did not — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

// --- Rendering ---------------------------------------------------------------

/** The single Rating_Presentation element of a rendering. */
function badgeOf(container: HTMLElement): HTMLElement {
  const badges = container.querySelectorAll<HTMLElement>(RATING_BADGE_SELECTOR);

  expect(badges).toHaveLength(1);

  return badges[0];
}

/** The badge's markup, rendered and then torn down. */
function markupOf(playerName: string, presentation: RatingPresentation): string {
  const { container } = render(
    <RatingBadge playerName={playerName} presentation={presentation} />,
  );

  try {
    return badgeOf(container).outerHTML;
  } finally {
    cleanup();
  }
}

/**
 * The markup a presentation of this kind must produce for this player: a fixed
 * active, non-guest owner, with a leaderboard of one entry for the provisional case
 * and none at all for the unavailable case (Requirements 8.12, 8.13).
 */
function baselineMarkupFor(
  kind: 'provisional' | 'unavailable',
  playerName: string,
): string {
  const member = parsedMemberOf({
    membershipId: '00000000-0000-4000-8000-000000000001',
    playerName,
    role: 'owner',
    state: 'active',
    isGuest: false,
  });
  const leaderboard = parsedLeaderboardOf(kind === 'provisional' ? 1 : null);
  const presentation = selectRatingPresentation(member, leaderboard);

  expect(presentation.kind).toBe(kind);

  return markupOf(playerName, presentation);
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirements 8.4, 8.7: the presentation is a badge shape **together with** a text
 * label — the shape alone would say nothing to a reader, and the label alone would
 * leave the row distinguishable only by its colour.
 */
function expectBadgeAndTextLabel(badge: HTMLElement, label: string): void {
  const shapes = badge.querySelectorAll<HTMLElement>(RATING_BADGE_SHAPE_SELECTOR);

  // Exactly one shape: a badge, not a row of them.
  expect(shapes).toHaveLength(1);
  // The shape carries no words of its own, so the label below is the statement.
  expect(shapes[0].textContent).toBe('');

  const stated = within(badge).getAllByText(label);

  expect(stated).toHaveLength(1);
  expect(stated[0].textContent).toBe(label);
  // The words are available to assistive technology as well as to the eye.
  expect(stated[0].closest('[aria-hidden="true"]')).toBeNull();
  // Nothing else is said: the whole badge is the label.
  expect(badge.textContent).toBe(label);
}

/**
 * Requirements 8.4, 8.13: the label states the absence and nothing else — no digit,
 * no approximation or range, no count of matches, and no cause.
 */
function expectLabelAssertsOnlyAbsence(badge: HTMLElement): void {
  const text = badge.textContent ?? '';

  expect(text.trim()).not.toBe('');
  expect(text).not.toMatch(DIGIT_PATTERN);
  expect(text).not.toMatch(RANGE_INDICATOR_PATTERN);
  expect(text).not.toMatch(MATCH_COUNT_PATTERN);
  expect(text).not.toMatch(REASON_PATTERN);
}

/**
 * Requirements 8.7, 19.3: the presentation survives every hue being discarded. The
 * shape and the words are in the markup, no element carries an inline colour, and
 * the kind is exposed as an attribute rather than only as a computed style — so a
 * reader who perceives no colour difference still reads the state.
 */
function expectNotColourDependent(badge: HTMLElement, kind: string): void {
  expect(badge.getAttribute(RATING_BADGE_KIND_ATTRIBUTE)).toBe(kind);

  for (const element of [badge, ...badge.querySelectorAll<HTMLElement>('*')]) {
    // No inline colour anywhere: every value comes from the token table, so
    // discarding the stylesheet removes emphasis and leaves the statement.
    expect(element.hasAttribute('style')).toBe(false);
    expect(element.hasAttribute('color')).toBe(false);
  }
}

// --- The property ------------------------------------------------------------

describe('Property 21 — the band and unavailable presentations are constant, non-numeric, and non-colour-dependent', () => {
  // Feature: web-squads-screens, Property 21: The band and unavailable presentations are constant, non-numeric, and non-colour-dependent
  // Validates: Requirements 8.12, 8.13
  it('renders identical content for every membership state, guest flag, role, and leaderboard size', () => {
    fc.assert(
      fc.property(bandCaseArb, (testCase) => {
        const member = parsedMemberOf(testCase);
        const leaderboard = parsedLeaderboardOf(testCase.leaderboardSize);
        const presentation = selectRatingPresentation(member, leaderboard);

        // No entry can match, so the leaderboard's presence alone decides which of
        // the two non-rating presentations this row gets.
        const expectedKind =
          testCase.leaderboardSize === null ? 'unavailable' : 'provisional';

        expect(presentation.kind).toBe(expectedKind);
        expect(markupOf(testCase.playerName, presentation)).toBe(
          baselineMarkupFor(expectedKind, testCase.playerName),
        );
      }),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 21: The band and unavailable presentations are constant, non-numeric, and non-colour-dependent
  // Validates: Requirements 8.4, 8.7, 8.13, 19.3
  it('states the absence as a badge plus a text label carrying no digit, range, count, or reason', () => {
    fc.assert(
      fc.property(bandCaseArb, (testCase) => {
        const member = parsedMemberOf(testCase);
        const leaderboard = parsedLeaderboardOf(testCase.leaderboardSize);
        const presentation = selectRatingPresentation(member, leaderboard);

        if (presentation.kind === 'rating') {
          throw new Error('the generated case must present no Display_Rating');
        }

        const { container } = render(
          <RatingBadge
            playerName={testCase.playerName}
            presentation={presentation}
          />,
        );

        try {
          const badge = badgeOf(container);

          expectBadgeAndTextLabel(badge, LABEL_OF_KIND[presentation.kind]);
          expectLabelAssertsOnlyAbsence(badge);
          expectNotColourDependent(badge, presentation.kind);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 21: The band and unavailable presentations are constant, non-numeric, and non-colour-dependent
  // Validates: Requirements 8.4, 8.13
  it('renders no value the leaderboard carried for anybody else', () => {
    fc.assert(
      fc.property(
        playerNameArb,
        fc.uuid(),
        fc.array(
          fc.integer({ min: -100_000, max: 100_000 }).filter((value) => value !== 0),
          { minLength: 1, maxLength: 20 },
        ),
        (playerName, membershipId, values) => {
          const member = parsedMemberOf({
            membershipId,
            playerName,
            role: 'member',
            state: 'active',
            isGuest: false,
          });
          const leaderboard = parsedLeaderboardOf(
            values.length,
            (index) => values[index],
          );
          const presentation = selectRatingPresentation(member, leaderboard);

          // Nobody else's rating is this row's rating (Requirement 8.3).
          expect(presentation.kind).toBe('provisional');

          const markup = markupOf(playerName, presentation);

          // Not the values, and not the count of them either (Requirement 8.4).
          for (const value of values) {
            expect(markup).not.toContain(String(value));
            expect(markup).not.toContain(String(Math.abs(value)));
          }

          expect(markup).not.toContain(String(values.length));
          expect(markup).not.toMatch(DIGIT_PATTERN);
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);
});
