/**
 * Property test for the four player-list rating conditions (task 12.4).
 *
 * **Property 39: The four player-list bands are mutually distinguishable.**
 * *For any* two distinct player-list rating presentations, the rendered text
 * differs and the accessible name differs, and each conveys its condition by text
 * and by a non-colour cue in addition to any colour.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 17.3 — the never-played text differs from the provisional text, and both from the unavailable text | the second property, {@link expectNeitherContainsTheOther} |
 * | 17.4 — each condition is conveyed by text **and** by a non-colour cue, in addition to any colour | {@link expectTextAndNonColourCue}, and the shape comparison in the first property |
 * | 17.5 — the accessible name states the resolved condition, so the four are distinguishable to assistive technology | {@link renderingOf}, and the name comparisons in the first and second properties |
 *
 * ### Distinguishable means pairwise, so the pair is what is generated
 *
 * A claim about four conditions is easy to assert weakly — check that each one
 * renders *something*, and never notice that two of them render the same thing.
 * So the first property generates a **pair of distinct conditions**, renders both
 * for the same player with the same leaderboard value, and compares the two
 * renderings: the words, the computed accessible name, the badge silhouette, and
 * the kind attribute must all differ. Holding the player and the value fixed is
 * what makes the difference attributable to the condition rather than to the row.
 *
 * ### The non-colour cue is read as a shape attribute, not as a resolved style
 *
 * jsdom computes no layout and applies no stylesheet cascade, so asking it for a
 * `border-radius` would prove nothing about what a reader sees. The cue is
 * therefore asserted where it is actually decided: `data-rating-shape`, which
 * `RatingBadge.css` turns into a disc, a ring, a square, or a bar from
 * `currentColor`. Four distinct values of that attribute are what a greyscale
 * rendering has left to go on, and they are asserted to be distinct for every
 * pair. The attribute is only a proxy for the silhouette — the stylesheet's own
 * four rules are reviewed in `RatingBadge.css`, and the contrast of the cue
 * against its surface is measured beside the token table.
 *
 * That `never-played` and `unavailable` **share** `--muted-text` is the reason
 * this matters more than it looks: those two conditions have no hue between them,
 * so if the shape or the words collapsed, nothing would tell them apart. The pair
 * is generated like any other, so that case is exercised rather than argued.
 *
 * ### The presentation is selected, not asserted into place
 *
 * Every rendering is driven by `selectRatingPresentation` over a **parsed**
 * Squad_Member and a **parsed** leaderboard, so the value reaching the component
 * is the one a real Player_Row would reach, and the never-played case carries a
 * leaderboard entry **for its own membership** — a value the row declines to show.
 * A hand-built `{ kind: 'never-played' }` would skip past the precedence that
 * makes the condition reachable at all. The expected kind is asserted after
 * selection, so a selection function that started answering differently fails
 * here rather than quietly narrowing the property.
 *
 * Feature: web-player-stats-screen, Property 39: The four player-list bands are mutually distinguishable
 * Validates: Requirements 17.3, 17.4, 17.5
 */
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import fc from 'fast-check';

import {
  RATING_BADGE_KIND_ATTRIBUTE,
  RATING_BADGE_SELECTOR,
  RATING_BADGE_SHAPE_ATTRIBUTE,
  RATING_BADGE_SHAPE_SELECTOR,
  RatingBadge,
  ratingBadgeAccessibleName,
  type RatingBadgeShape,
} from './RatingBadge';
import {
  parseDisplayRatingLeaderboard,
  type DisplayRatingLeaderboard,
} from '../lib/parse/leaderboard';
import { parseSquadMember, type SquadMember } from '../lib/parse/squadDetail';
import {
  NEVER_PLAYED_BAND_LABEL,
  PROVISIONAL_BAND_LABEL,
  RATING_UNAVAILABLE_LABEL,
} from '../lib/messages';
import {
  formatDisplayRating,
  selectRatingPresentation,
  type RatingPresentation,
} from '../lib/ratingPresentation';
import type { RatingState } from '../lib/wireEnums';

// --- What the four conditions are --------------------------------------------

/** One of the four conditions a Player_Row may be in (Requirement 17.1). */
type ConditionKind = RatingPresentation['kind'];

/** All four, so "pairwise" covers every pairing rather than a chosen few. */
const CONDITION_KINDS: readonly ConditionKind[] = [
  'rating',
  'provisional',
  'never-played',
  'unavailable',
];

/** The three conditions that render a fixed statement instead of a value. */
const NON_RATING_KINDS: readonly Exclude<ConditionKind, 'rating'>[] = [
  'provisional',
  'never-played',
  'unavailable',
];

/** The statement each non-rating condition renders (Requirement 17.3). */
const STATEMENT_OF_KIND: Readonly<
  Record<Exclude<ConditionKind, 'rating'>, string>
> = {
  provisional: PROVISIONAL_BAND_LABEL,
  'never-played': NEVER_PLAYED_BAND_LABEL,
  unavailable: RATING_UNAVAILABLE_LABEL,
};

/**
 * The silhouettes a badge may take. The property does not pin which condition
 * gets which — only that the four are distinct and that every rendered cue is one
 * of these, so re-drawing a shape stays a stylesheet decision while losing one
 * stays a failure (Requirement 17.4).
 */
const SHAPE_NAMES: readonly RatingBadgeShape[] = ['disc', 'ring', 'square', 'bar'];

/** Any decimal digit in any script — a rating value, wherever it came from. */
const DIGIT_PATTERN = /\p{Nd}/u;

// --- Generators --------------------------------------------------------------

/**
 * A player name free of digits and containing none of the three fixed statements.
 *
 * Digit-free because the badge's own text must stay digit-free on the three
 * non-rating conditions, and statement-free because the accessible name is the
 * player's name followed by a statement — a player literally called "Ratings
 * unavailable" would make a non-containment assertion about the *name* say
 * something about the player rather than about the condition. Neither restriction
 * weakens the property: the digits of a player's own name are preserved verbatim,
 * which `RatingBadge.accessibleName.property.test.tsx` holds separately.
 */
const playerNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'Dave',
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
          !DIGIT_PATTERN.test(value) &&
          !Object.values(STATEMENT_OF_KIND).some((statement) =>
            value.includes(statement),
          ),
      ),
  },
);

/**
 * A leaderboard value, kept integral so the rendered Display_Rating is exactly
 * the value and a text comparison needs no rounding of its own. The halves and
 * the signed zero are `lib/displayRatingFormat.property.test.ts`'s business.
 */
const ratingValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(0, 1, -1, 1240, Number.MAX_SAFE_INTEGER) },
  { weight: 3, arbitrary: fc.integer({ min: -1_000_000, max: 1_000_000 }) },
);

/** Two different conditions, in the order they were drawn. */
const distinctKindPairArb: fc.Arbitrary<readonly [ConditionKind, ConditionKind]> =
  fc
    .tuple(fc.constantFrom(...CONDITION_KINDS), fc.constantFrom(...CONDITION_KINDS))
    .filter(([first, second]) => first !== second);

/** Two different non-rating conditions — the pairing Requirement 17.3 is about. */
const distinctNonRatingPairArb: fc.Arbitrary<
  readonly [Exclude<ConditionKind, 'rating'>, Exclude<ConditionKind, 'rating'>]
> = fc
  .tuple(fc.constantFrom(...NON_RATING_KINDS), fc.constantFrom(...NON_RATING_KINDS))
  .filter(([first, second]) => first !== second);

// --- From a generated case to a selected presentation ------------------------

/**
 * The parsed Squad_Member a case describes. Parsing is asserted rather than
 * assumed, so a generator that wandered outside the accepted wire shape reports
 * itself instead of narrowing the property.
 */
function parsedMemberOf(
  membershipId: string,
  displayName: string,
  appearances: number,
  ratingState: RatingState,
): SquadMember {
  const body = {
    membershipId,
    displayName,
    role: null,
    state: 'Active',
    isGuest: false,
    appearances,
    ratingState,
  };
  const parsed = parseSquadMember(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated member must parse, but it did not: ${JSON.stringify(body)} — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

/** The parsed leaderboard carrying one value for one membership. */
function parsedLeaderboardOf(
  membershipId: string,
  value: number,
): DisplayRatingLeaderboard {
  const body = {
    entries: [
      {
        membershipId,
        displayName: 'a name the Player_List never reads',
        value,
      },
    ],
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
 * The presentation a row in the given condition gets, chosen by the production
 * selection function over parsed values.
 *
 * Each condition is reached the way a squad reaches it, and two of them are
 * reached **against** a leaderboard that carries this row's own value:
 *
 *  - `rating` — played, settled, and an entry of its own.
 *  - `provisional` — played, still settling; the entry exists and is declined.
 *  - `never-played` — no completed match; the entry exists and is declined.
 *  - `unavailable` — played and settled, but no leaderboard was obtained.
 *
 * So the digit-free assertions below are about a row that *had* a number to leak.
 */
function presentationFor(
  kind: ConditionKind,
  membershipId: string,
  playerName: string,
  value: number,
): RatingPresentation {
  const member = parsedMemberOf(
    membershipId,
    playerName,
    kind === 'never-played' ? 0 : 12,
    kind === 'provisional' ? 'Provisional' : 'Established',
  );
  const leaderboard =
    kind === 'unavailable' ? null : parsedLeaderboardOf(membershipId, value);
  const presentation = selectRatingPresentation(member, leaderboard);

  expect(presentation.kind).toBe(kind);

  return presentation;
}

/** The text a condition must render: the value, or its one fixed statement. */
function expectedTextOf(kind: ConditionKind, value: number): string {
  return kind === 'rating'
    ? String(formatDisplayRating(value))
    : STATEMENT_OF_KIND[kind];
}

// --- Rendering ---------------------------------------------------------------

/** The single Rating_Presentation element of a rendering. */
function badgeOf(container: HTMLElement): HTMLElement {
  const badges = container.querySelectorAll<HTMLElement>(RATING_BADGE_SELECTOR);

  expect(badges).toHaveLength(1);

  return badges[0];
}

/** Render one badge, read it while it is mounted, and tear it down. */
function withBadge<T>(
  playerName: string,
  presentation: RatingPresentation,
  read: (badge: HTMLElement) => T,
): T {
  const { container } = render(
    <RatingBadge playerName={playerName} presentation={presentation} />,
  );

  try {
    return read(badgeOf(container));
  } finally {
    cleanup();
  }
}

/** What one condition renders, reduced to the three things that must differ. */
interface ConditionRendering {
  /** The kind attribute, so a pair can be compared without reading copy. */
  readonly kind: string | null;
  /** The words a reader sees (Requirement 17.3). */
  readonly text: string;
  /** The non-colour cue (Requirement 17.4). */
  readonly shape: string | null;
  /** The computed accessible name (Requirement 17.5). */
  readonly accessibleName: string;
}

/**
 * Render a condition and return its words, its cue, and its accessible name.
 *
 * The name is the **computed** one — looked up through `getByRole('img', …)`,
 * which resolves it the way a browser does rather than reading the `aria-label`
 * back — and it is asserted equal to what the exported pure function builds, so
 * the name a Player_Row test can obtain without a DOM is the one assistive
 * technology announces (Requirement 17.5).
 */
function renderingOf(
  playerName: string,
  presentation: RatingPresentation,
): ConditionRendering {
  return withBadge(playerName, presentation, (badge) => {
    const expectedName = ratingBadgeAccessibleName(playerName, presentation);

    expect(badge).toHaveAccessibleName(expectedName);
    expect(screen.getByRole('img', { name: expectedName })).toBe(badge);

    const shapes = badge.querySelectorAll<HTMLElement>(RATING_BADGE_SHAPE_SELECTOR);

    expect(shapes).toHaveLength(1);

    return {
      kind: badge.getAttribute(RATING_BADGE_KIND_ATTRIBUTE),
      text: badge.textContent ?? '',
      shape: shapes[0].getAttribute(RATING_BADGE_SHAPE_ATTRIBUTE),
      accessibleName: expectedName,
    };
  });
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 17.4: the condition is carried by **words** and by a **shape**, and
 * by neither a hue nor a position.
 *
 * The words are the whole of the badge's text, are exposed to assistive
 * technology rather than hidden, and are the one fixed statement or the one value
 * this condition renders. The shape is a single element carrying no words of its
 * own, named by one of the four silhouettes, and hidden from assistive technology
 * because the wrapper's accessible name already states what it signals. And
 * nothing anywhere carries an inline colour, so discarding every hue removes
 * emphasis and leaves both cues intact.
 */
function expectTextAndNonColourCue(
  badge: HTMLElement,
  kind: ConditionKind,
  expectedText: string,
): void {
  // The words, and only the words.
  expect(badge.textContent).toBe(expectedText);
  expect(expectedText.trim()).not.toBe('');

  const stated = within(badge).getAllByText(expectedText);

  expect(stated).toHaveLength(1);
  expect(stated[0].closest('[aria-hidden="true"]')).toBeNull();

  // The shape: one cue, wordless, named, and decorative.
  const shapes = badge.querySelectorAll<HTMLElement>(RATING_BADGE_SHAPE_SELECTOR);

  expect(shapes).toHaveLength(1);
  expect(shapes[0].textContent).toBe('');
  expect(shapes[0].getAttribute('aria-hidden')).toBe('true');
  expect(SHAPE_NAMES).toContain(shapes[0].getAttribute(RATING_BADGE_SHAPE_ATTRIBUTE));

  // The condition is in the markup, not only in a computed style.
  expect(badge.getAttribute(RATING_BADGE_KIND_ATTRIBUTE)).toBe(kind);

  for (const element of [badge, ...badge.querySelectorAll<HTMLElement>('*')]) {
    expect(element.hasAttribute('style')).toBe(false);
    expect(element.hasAttribute('color')).toBe(false);
  }
}

/**
 * Requirement 17.3: two statements read differently, and neither is a prefix,
 * suffix, or fragment of the other.
 *
 * Containment is checked as well as inequality because "No settled rating yet"
 * and "No settled rating yet, no matches" would differ while still telling a
 * reader who glanced at the first few words the same thing.
 */
function expectNeitherContainsTheOther(first: string, second: string): void {
  expect(first).not.toBe(second);
  expect(first).not.toContain(second);
  expect(second).not.toContain(first);
}

// --- The property ------------------------------------------------------------

describe('Property 39 — the four player-list bands are mutually distinguishable', () => {
  // Feature: web-player-stats-screen, Property 39: The four player-list bands are mutually distinguishable
  // Validates: Requirements 17.3, 17.4, 17.5
  it('renders different words, a different cue, and a different accessible name for each pair of distinct conditions', () => {
    fc.assert(
      fc.property(
        distinctKindPairArb,
        playerNameArb,
        fc.uuid(),
        ratingValueArb,
        ([firstKind, secondKind], playerName, membershipId, value) => {
          // One player, one membership, one leaderboard value: whatever differs
          // between the two renderings differs because the condition does.
          const first = renderingOf(
            playerName,
            presentationFor(firstKind, membershipId, playerName, value),
          );
          const second = renderingOf(
            playerName,
            presentationFor(secondKind, membershipId, playerName, value),
          );

          // 17.3: the words differ.
          expect(first.text).not.toBe(second.text);
          // 17.4: so does the non-colour cue — including for `never-played` and
          // `unavailable`, which share a colour and have nothing else.
          expect(first.shape).not.toBe(second.shape);
          expect(first.kind).not.toBe(second.kind);
          // 17.5: and the announcement, so the four are as distinguishable by ear
          // as by eye.
          expect(first.accessibleName).not.toBe(second.accessibleName);
        },
      ),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-player-stats-screen, Property 39: The four player-list bands are mutually distinguishable
  // Validates: Requirements 17.4, 17.5
  it('conveys every condition by text and by a non-colour cue, and states it in the accessible name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONDITION_KINDS),
        playerNameArb,
        fc.uuid(),
        ratingValueArb,
        (kind, playerName, membershipId, value) => {
          const presentation = presentationFor(
            kind,
            membershipId,
            playerName,
            value,
          );
          const expectedText = expectedTextOf(kind, value);

          withBadge(playerName, presentation, (badge) => {
            expectTextAndNonColourCue(badge, kind, expectedText);

            // 17.5: the announcement states the condition the row shows — the
            // same words for a band, and the value announced as a rating.
            const accessibleName = ratingBadgeAccessibleName(
              playerName,
              presentation,
            );

            expect(badge).toHaveAccessibleName(accessibleName);
            expect(accessibleName).toContain(expectedText);
            expect(accessibleName).toContain(playerName);

            if (kind === 'rating') {
              expect(accessibleName.toLowerCase()).toContain('rating');
            } else {
              // A band says nothing numeric, even though this row's own value was
              // sitting in the leaderboard the presentation was selected against.
              expect(expectedText).not.toMatch(DIGIT_PATTERN);
              expect(badge.textContent ?? '').not.toMatch(DIGIT_PATTERN);
            }
          });
        },
      ),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-player-stats-screen, Property 39: The four player-list bands are mutually distinguishable
  // Validates: Requirements 17.3, 17.5
  it('renders the never-played, provisional, and unavailable statements pairwise distinct, neither containing the other', () => {
    fc.assert(
      fc.property(
        distinctNonRatingPairArb,
        playerNameArb,
        fc.uuid(),
        ratingValueArb,
        ([firstKind, secondKind], playerName, membershipId, value) => {
          const first = renderingOf(
            playerName,
            presentationFor(firstKind, membershipId, playerName, value),
          );
          const second = renderingOf(
            playerName,
            presentationFor(secondKind, membershipId, playerName, value),
          );

          // 17.3: three statements, told apart by their words alone — the shapes
          // and the colours are set aside here.
          expectNeitherContainsTheOther(first.text, second.text);
          expect(first.text).toBe(STATEMENT_OF_KIND[firstKind]);
          expect(second.text).toBe(STATEMENT_OF_KIND[secondKind]);

          // 17.5: and the same of the announcements. The generated player name
          // carries none of the three statements, so a containment here could only
          // come from one statement being folded into another.
          expectNeitherContainsTheOther(
            first.accessibleName,
            second.accessibleName,
          );
          expect(first.accessibleName).toContain(STATEMENT_OF_KIND[firstKind]);
          expect(first.accessibleName).not.toContain(
            STATEMENT_OF_KIND[secondKind],
          );
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);
});
