// Feature: web-player-stats-screen, Property 17: A provisional rating never renders as a number
// Validates: Requirements 7.3

import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  RATING_PANEL_BADGE_SELECTOR,
  RATING_PANEL_CONDITION_ATTRIBUTE,
  RATING_PANEL_PRESENTATION_SELECTOR,
  RATING_PANEL_SELECTOR,
  RATING_PANEL_TEXT_SELECTOR,
  RatingPanel,
  ratingPanelAccessibleName,
} from './RatingPanel';
import { RATING_PROVISIONAL } from '../lib/messages';
import { resolveRatingCondition } from '../lib/ratingCondition';
import type { RatingSummary } from '../lib/parse/playerProfile';

/**
 * Property test for the one claim Requirement 7.3 makes about a rating that has
 * not settled: **it never reaches a person as a figure**.
 *
 * Product steering is explicit that a provisional player shows a badge or a band
 * rather than a hard number (product.md → "Rating display"), and the backend
 * sends `displayRating` *alongside* `Provisional` — so the number is present in
 * the data on exactly the path where it must not be presented. That is why this
 * is a property rather than an example: the defect it guards against is not "the
 * provisional label is wrong", it is "some magnitude of `displayRating` found a
 * way onto the screen", and the only honest statement of that is a universal one
 * over every magnitude.
 *
 * ## The claim, stated precisely
 *
 * For any `RatingSummary` whose state is provisional and any **positive**
 * Appearance_Count — the Display_Rating present or absent, of any magnitude, and
 * for any Player_Display_Name:
 *
 * | Surface | Claim |
 * | --- | --- |
 * | the resolved condition | tagged `provisional`, carrying **no field** a number could ride in on |
 * | the rendered section's text | **no digit at all** — the name is not rendered here, so there is none to allow |
 * | every attribute in the section's subtree | no digit, once the player's own name is taken out of it |
 * | the accessible name | exactly the player's name, a colon, and the fixed label — asserting no numeric rating |
 *
 * The appearance count is kept positive deliberately. Zero appearances resolve
 * to `never-played` ahead of every rating-block rule (Property 16), which would
 * make this property pass for a reason that has nothing to do with provisional
 * ratings — the panel would simply be rendering a different condition. A
 * positive count is what forces the provisional arm to be the one under test.
 *
 * ## Why the condition is resolved rather than constructed
 *
 * The condition handed to the panel comes from `resolveRatingCondition` applied
 * to a generated `RatingSummary` and a generated count, not from a hand-written
 * `{ kind: 'provisional' }`. Constructing the tag directly would test the panel
 * against an input the feature cannot produce and would leave the interesting
 * half unexercised: that the resolver *drops* a present Display_Rating on this
 * path. Resolving it covers the real route from profile data to rendering, so a
 * regression in either module fails here.
 *
 * ## Non-vacuity
 *
 * Two ways this could pass while proving nothing, both closed below: the
 * generator might never produce a present Display_Rating (so there would be no
 * number to leak), and the panel might be incapable of rendering digits at all
 * (so "no digit" would be a fact about the component rather than about this
 * condition). The final section asserts that present ratings of every named
 * magnitude *are* generated, and that the very same summary read as
 * `Established` renders its digits — the panel can print a number; it declines
 * to while the rating is settling.
 *
 * Requirements: 7.3, 14.5
 */

// --- the input space ----------------------------------------------------------

/**
 * Present Display_Ratings across the magnitudes the property names: zero, both
 * signs, one digit through seven, the safe-integer bounds, and fractional values.
 *
 * `-0` sits beside `0` because they are distinct values, and the fractional and
 * out-of-contract values are here because the claim is universal: the
 * Response_Parser's `readCount` and `readNumber` keep most of them off this path,
 * and a presentation that leaked one only for an input "that cannot happen"
 * would still be a presentation that leaked one.
 */
const PRESENT_DISPLAY_RATINGS: readonly number[] = [
  0,
  -0,
  1,
  -1,
  9,
  42,
  -99,
  999,
  1000,
  1240,
  12_345,
  1_000_000,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  0.5,
  -0.5,
  1500.75,
];

/**
 * Appearance_Counts that are positive, so the Never_Played rule cannot pre-empt
 * the provisional one. The fractional and non-finite counts cannot arrive
 * through `readCount`; they are included because a count is read from a response
 * body and the claim must hold however one arrives.
 */
const POSITIVE_APPEARANCE_COUNTS: readonly number[] = [
  1,
  2,
  3,
  7,
  38,
  500,
  10_000,
  1_000_000,
  Number.MAX_SAFE_INTEGER,
  0.5,
  7.5,
  Number.POSITIVE_INFINITY,
];

/**
 * Player_Display_Names worth naming rather than only sampling: names with no
 * digit, names whose digits are their own, a name that is nothing but digits,
 * and the blank forms the accessible name has a branch for.
 *
 * The digit-bearing names are the reason this property is phrased as "no digit
 * sequence **other than those of the player's own display name**" — "Dave2" is a
 * legitimate name in a squad where names are unique, and its `2` must not be
 * mistaken for a leaked rating, nor a leaked rating excused as part of a name.
 */
const PLAYER_NAMES: readonly string[] = [
  'Dave',
  'BigDave',
  'Dave 2',
  'Dave2',
  '7Up',
  '1240',
  'O’Neill-Smith',
  'Ωmega',
  '',
  '   ',
];

/** A Display_Rating: the named magnitudes, arbitrary numbers, and the absence. */
const displayRatingArb: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...PRESENT_DISPLAY_RATINGS) },
  { weight: 3, arbitrary: fc.integer({ min: -5000, max: 5000 }) },
  { weight: 2, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
  { weight: 2, arbitrary: fc.constant(null) },
);

/** A positive Appearance_Count: the named counts plus arbitrary whole numbers. */
const appearanceCountArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...POSITIVE_APPEARANCE_COUNTS) },
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 10_000 }) },
);

/** A Player_Display_Name: the named names plus arbitrary text. */
const playerNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...PLAYER_NAMES) },
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
);

/**
 * A Rating_Summary whose state is provisional. The state is **fixed** and the
 * Display_Rating generated: this property is about one state, and a generated
 * state would spend most of its runs rendering a different condition.
 */
const provisionalSummaryArb: fc.Arbitrary<RatingSummary> = fc.record({
  state: fc.constant('Provisional' as const),
  displayRating: displayRatingArb,
});

/** One rendering of the panel: the profile data, the count, and whose rating it is. */
interface PanelInput {
  readonly rating: RatingSummary;
  readonly appearances: number;
  readonly playerName: string;
}

const panelInputArb: fc.Arbitrary<PanelInput> = fc.record({
  rating: provisionalSummaryArb,
  appearances: appearanceCountArb,
  playerName: playerNameArb,
});

// --- reading what was rendered ------------------------------------------------

/** Any decimal digit, anywhere. */
const ANY_DIGIT = /\d/u;

/** A numeric rating asserted after the noun — the form the settled arm uses. */
const NUMERIC_RATING_CLAIM = /rating\s*[-+]?\d/iu;

/** The input named in an assertion message, so a failure identifies itself. */
function describeInput({ rating, appearances, playerName }: PanelInput): string {
  return `displayRating ${String(rating.displayRating)}, appearances ${String(
    appearances,
  )}, name ${JSON.stringify(playerName)}`;
}

/** The panel element, which every assertion is scoped to. */
function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>(RATING_PANEL_SELECTOR);

  if (panel === null) {
    throw new Error('the rating panel did not render');
  }

  return panel;
}

/** Every attribute value in the panel's subtree, the panel's own included. */
function attributeValuesOf(panel: HTMLElement): readonly string[] {
  return [panel, ...panel.querySelectorAll<HTMLElement>('*')].flatMap((element) =>
    element
      .getAttributeNames()
      .map((name) => element.getAttribute(name) ?? ''),
  );
}

/**
 * `value` with every occurrence of the player's own name removed, so what is
 * left is the part of the rendering the panel itself is responsible for.
 *
 * Removal rather than a prefix test, because a name may appear in an attribute
 * at any position, and string splitting rather than a pattern, because a
 * generated name is not a safe regular expression.
 */
function withoutPlayerName(value: string, playerName: string): string {
  return playerName === '' ? value : value.split(playerName).join('');
}

/** The accessible name of the badge-and-text composite, as rendered. */
function renderedAccessibleName(panel: HTMLElement): string {
  return (
    panel
      .querySelector(RATING_PANEL_PRESENTATION_SELECTOR)
      ?.getAttribute('aria-label') ?? ''
  );
}

// --- the property proper ------------------------------------------------------

// Feature: web-player-stats-screen, Property 17: A provisional rating never renders as a number
// Validates: Requirements 7.3
describe('a provisional rating never renders as a number', () => {
  it('resolves to a condition carrying no number, for any provisional summary and positive count', () => {
    fc.assert(
      fc.property(panelInputArb, (input) => {
        // The first half of 7.3, held at the resolver: a Display_Rating sent
        // beside a provisional state is dropped, so the panel is handed nothing
        // it could render as a settled figure.
        const condition = resolveRatingCondition(input.rating, input.appearances);

        expect(condition.kind, describeInput(input)).toBe('provisional');
        expect(Object.keys(condition), describeInput(input)).toEqual(['kind']);
      }),
      { numRuns: 500 },
    );
  });

  it('renders no digit in the rating section, whatever the display rating', () => {
    fc.assert(
      fc.property(panelInputArb, (input) => {
        try {
          const condition = resolveRatingCondition(
            input.rating,
            input.appearances,
          );
          const { container } = render(
            <RatingPanel playerName={input.playerName} condition={condition} />,
          );
          const panel = panelOf(container);

          // The player's name is not among the section's visible words — only
          // the label and the squad-scope statement are — so the visible text
          // owes no digit at all, and a leaked rating has nowhere to hide.
          expect(panel.textContent ?? '', describeInput(input)).not.toMatch(
            ANY_DIGIT,
          );
          expect(
            panel.querySelector(RATING_PANEL_TEXT_SELECTOR)?.textContent,
            describeInput(input),
          ).toBe(RATING_PROVISIONAL);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  });

  it('carries no digit in any attribute of the section but the player’s own name', () => {
    fc.assert(
      fc.property(panelInputArb, (input) => {
        try {
          const condition = resolveRatingCondition(
            input.rating,
            input.appearances,
          );
          const { container } = render(
            <RatingPanel playerName={input.playerName} condition={condition} />,
          );
          const panel = panelOf(container);

          // Text is not the only way a number reaches a person: an accessible
          // name, a title, or a data attribute would all be announced or
          // inspectable. So every attribute in the subtree is held to the same
          // claim, with the one sequence that is legitimately numeric — the
          // name the caller gave — taken out first.
          for (const value of attributeValuesOf(panel)) {
            expect(
              withoutPlayerName(value, input.playerName),
              `${describeInput(input)} — attribute ${JSON.stringify(value)}`,
            ).not.toMatch(ANY_DIGIT);
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  });

  it('announces the fixed label and asserts no numeric rating', () => {
    fc.assert(
      fc.property(panelInputArb, (input) => {
        // The accessible name is composed, not fixed, so it is the one string on
        // this path that could acquire a figure. Asserted as an equality rather
        // than a digit scan: the name is the player's own name verbatim, a
        // separator, and the label — and nothing else is appended, which is the
        // strongest available reading of "asserts no numeric rating".
        const condition = resolveRatingCondition(input.rating, input.appearances);
        const accessibleName = ratingPanelAccessibleName(
          input.playerName,
          condition,
        );
        const expected =
          input.playerName.trim() === ''
            ? RATING_PROVISIONAL
            : `${input.playerName}: ${RATING_PROVISIONAL}`;

        expect(accessibleName, describeInput(input)).toBe(expected);
        expect(
          withoutPlayerName(accessibleName, input.playerName),
          describeInput(input),
        ).not.toMatch(ANY_DIGIT);
        expect(accessibleName, describeInput(input)).not.toMatch(
          NUMERIC_RATING_CLAIM,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('announces exactly what it rendered, so the seen and heard forms cannot diverge', () => {
    fc.assert(
      fc.property(panelInputArb, (input) => {
        try {
          const condition = resolveRatingCondition(
            input.rating,
            input.appearances,
          );
          const { container } = render(
            <RatingPanel playerName={input.playerName} condition={condition} />,
          );
          const panel = panelOf(container);

          // A rendering that showed the label and announced a number would
          // satisfy a text-only property, so the rendered name is read from the
          // DOM and held to the pure function's output.
          expect(renderedAccessibleName(panel), describeInput(input)).toBe(
            ratingPanelAccessibleName(input.playerName, condition),
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  });

  it('conveys the condition by a badge and a label rather than by a figure', () => {
    fc.assert(
      fc.property(panelInputArb, (input) => {
        try {
          const condition = resolveRatingCondition(
            input.rating,
            input.appearances,
          );
          const { container } = render(
            <RatingPanel playerName={input.playerName} condition={condition} />,
          );
          const panel = panelOf(container);
          const badges = panel.querySelectorAll(RATING_PANEL_BADGE_SELECTOR);

          // 7.3 asks for a badge *and* a label. Without this, "renders no
          // digit" could be satisfied by a section that rendered nothing at
          // all — which would be a different defect, not a fix.
          expect(badges, describeInput(input)).toHaveLength(1);
          expect(
            badges[0]?.getAttribute('data-player-stats-rating-badge'),
            describeInput(input),
          ).toBe('provisional');
          expect(
            panel.getAttribute(RATING_PANEL_CONDITION_ATTRIBUTE),
            describeInput(input),
          ).toBe('provisional');
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  });
});

// --- non-vacuity --------------------------------------------------------------

// Feature: web-player-stats-screen, Property 17: A provisional rating never renders as a number
// Validates: Requirements 7.3
describe('the provisional property is not vacuous', () => {
  it('generates present display ratings of several magnitudes, so there is a number to leak', () => {
    const sampled = fc.sample(provisionalSummaryArb, 400);
    const present = sampled
      .map(({ displayRating }) => displayRating)
      .filter((value): value is number => typeof value === 'number');

    expect(present.length).toBeGreaterThan(0);
    // Several magnitudes, so the claim is not carried by single-digit values
    // alone — a four-figure rating is the ordinary case in a squad.
    expect(
      new Set(present.map((value) => String(Math.abs(value)).length)).size,
    ).toBeGreaterThan(1);
    expect(
      present.some((value) => Math.abs(value) >= 1000),
    ).toBe(true);
  });

  it('names every magnitude the property claims to cover', () => {
    // Asserted literally rather than left to the sampler: zero, both signs,
    // large, and fractional are the shapes the task calls out.
    expect(PRESENT_DISPLAY_RATINGS.some((value) => Object.is(value, 0))).toBe(true);
    expect(PRESENT_DISPLAY_RATINGS.some((value) => Object.is(value, -0))).toBe(true);
    expect(PRESENT_DISPLAY_RATINGS.some((value) => value > 0)).toBe(true);
    expect(PRESENT_DISPLAY_RATINGS.some((value) => value < 0)).toBe(true);
    expect(PRESENT_DISPLAY_RATINGS).toContain(Number.MAX_SAFE_INTEGER);
    expect(
      PRESENT_DISPLAY_RATINGS.some((value) => !Number.isInteger(value)),
    ).toBe(true);
    expect(POSITIVE_APPEARANCE_COUNTS.every((count) => count > 0)).toBe(true);
    expect(PLAYER_NAMES.some((name) => ANY_DIGIT.test(name))).toBe(true);
  });

  it('renders the digits of the very same rating once the state is established', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESENT_DISPLAY_RATINGS),
        fc.constantFrom(...POSITIVE_APPEARANCE_COUNTS),
        (displayRating, appearances) => {
          try {
            // The panel *can* print a number: read as `Established`, the same
            // summary and the same count render its digits. So "no digit while
            // provisional" is a fact about this condition, not about a component
            // that never shows figures.
            const condition = resolveRatingCondition(
              { state: 'Established', displayRating },
              appearances,
            );

            expect(condition.kind).toBe('established');

            const { container } = render(
              <RatingPanel playerName="Dave" condition={condition} />,
            );

            expect(
              panelOf(container).querySelector(RATING_PANEL_TEXT_SELECTOR)
                ?.textContent ?? '',
            ).toMatch(ANY_DIGIT);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
