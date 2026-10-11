// Feature: web-player-stats-screen, Property 18: The four conditions are mutually distinguishable
// Validates: Requirements 7.5, 7.6

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
import {
  RATING_ABSENT,
  RATING_NEVER_PLAYED,
  RATING_PROVISIONAL,
} from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { RatingCondition } from '../lib/ratingCondition';

/**
 * Property test for the rating panel's **distinguishability**, quantified over
 * generated conditions, generated display ratings, and generated player names
 * rather than over the four hand-written cases beside it in
 * `RatingPanel.test.tsx`.
 *
 * The claim (Requirements 7.5, 7.6): *for any two distinct Rating_Conditions,
 * their rendered text differs and their accessible names differ, each accessible
 * name states which condition holds, and each condition is conveyed by text plus
 * a non-colour cue in addition to any colour.*
 *
 * ## Why this is worth generating rather than enumerating
 *
 * There are twelve ordered pairs of the four conditions, which an example test
 * could list. What it could not list is the *parameter* the conditions carry: the
 * `established` arm renders a Display_Rating, and a number is exactly the kind of
 * value that can collide with words — a rating that happened to render as the
 * empty string, or a label that happened to carry the same digits, would make two
 * presentations identical for *some* ratings while the four hand-written cases
 * still passed. The player's name is generated for the same reason: it is
 * prepended to every accessible name, so a name could in principle be what makes
 * two names differ, which would leave the *condition* undistinguished. Holding
 * the name fixed across each pair removes that escape: anything that differs
 * below differs because the condition does.
 *
 * ## The three channels, asserted separately
 *
 * Requirement 7.6 asks that no two of the four presentations render identical
 * text. Requirement 16.6 asks that the condition be conveyed in addition to any
 * colour. So each pair is separated on **three independent channels** and the
 * assertions are made one at a time rather than as a single "they differ
 * somehow":
 *
 * | Channel | Read from | Why |
 * | --- | --- | --- |
 * | the visible words | {@link RATING_PANEL_TEXT_SELECTOR} | Requirement 7.6's "identical text" |
 * | the accessible name | the `aria-label` of the named composite | what a screen reader announces |
 * | the badge shape | {@link RATING_PANEL_BADGE_SELECTOR} | the non-colour cue (7.3, 16.6) |
 *
 * The cue is read as **markup** — the badge's own `data-` attribute and its shape
 * class — and never as a computed colour. That is not a convenience: the panel's
 * hues come from custom properties declared in `styles/playerStatsTokens.css`,
 * and jsdom resolves a `var()` reference to the empty string, so a colour
 * assertion here would be vacuous whatever the stylesheet said. Asserting the
 * shape is also the stronger claim: a reader in greyscale, in a forced-colours
 * mode, or with no colour perception at all is told the four apart by the words
 * and the shape, which is what "in addition to any colour" means.
 *
 * ## What "states which condition holds" is held to
 *
 * Difference alone is not enough — four distinct but meaningless names would
 * satisfy it. So each name is additionally required to carry **its own
 * condition's claim** and **none of the other conditions' claims**: the three
 * non-numeric conditions carry their fixed statement from `lib/messages.ts`
 * verbatim, and the `established` condition carries the rating's digits announced
 * as a rating rather than as a bare figure. The vocabulary block below asserts
 * that those three statements are pairwise distinct and that none is a substring
 * of another, so the containment test is a real discriminator rather than an
 * accident of wording.
 *
 * Generated names are constrained to carry no digit and to mention none of the
 * vocabulary, so every match found in an accessible name is attributable to the
 * condition and not to the subject.
 *
 * Deliberately **not** claimed here: that a provisional rating renders no number
 * (Property 17, `ratingPanel.provisional.property.test.tsx`), and that exactly
 * one condition is resolved in the first place (Property 15,
 * `lib/ratingCondition.property.test.ts`). Restating either would hide a
 * regression behind a duplicate.
 */

// --- the vocabulary this suite is written against -----------------------------

/** The four conditions, transcribed from Requirement 7.1 rather than read off the union. */
const CONDITION_KINDS = [
  'established',
  'provisional',
  'never-played',
  'absent',
] as const;

type ConditionKind = (typeof CONDITION_KINDS)[number];

/** Every ordered pair of two *distinct* conditions — the quantifier of the property. */
const DISTINCT_KIND_PAIRS: readonly (readonly [ConditionKind, ConditionKind])[] =
  CONDITION_KINDS.flatMap((first) =>
    CONDITION_KINDS.filter((second) => second !== first).map(
      (second) => [first, second] as const,
    ),
  );

/** The statement each non-numeric condition's accessible name must carry. */
const CONDITION_STATEMENT: Readonly<Record<ConditionKind, string | null>> = {
  established: null,
  provisional: RATING_PROVISIONAL,
  'never-played': RATING_NEVER_PLAYED,
  absent: RATING_ABSENT,
};

/** The three fixed statements, as the discriminators the containment test uses. */
const EVERY_STATEMENT: readonly string[] = [
  RATING_PROVISIONAL,
  RATING_NEVER_PLAYED,
  RATING_ABSENT,
];

/**
 * The noun that makes a Display_Rating an announced *rating* rather than a bare
 * digit sequence, matched case-insensitively so the panel is free to word it
 * either way.
 */
const RATING_NOUN = /rating/iu;

// --- generators ---------------------------------------------------------------

/** The characters a generated player name is built from: no digit, no vocabulary. */
const NAME_CHARACTERS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ' ',
  '-',
  "'",
] as const;

/**
 * A Player_Display_Name: the shapes a squad really produces, arbitrary
 * digit-free strings, and the blank name the panel answers with the statement
 * alone.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      'Dave',
      'BigDave',
      "O'Neill",
      'Former player',
      'Síofra',
      'a',
    ),
  },
  {
    weight: 3,
    arbitrary: fc
      .array(fc.constantFrom(...NAME_CHARACTERS), { maxLength: 24 })
      .map((characters) => characters.join('')),
  },
  { weight: 1, arbitrary: fc.constantFrom('', '   ') },
);

/**
 * A Display_Rating for the `established` arm: ordinary values, the named edge
 * magnitudes, and `-0`, which renders as `'0'` and so is the one value that
 * could collide with another rating's text.
 */
const displayRatingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: -2000, max: 5000 }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      1000,
      1240,
      -15,
      1234567,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
  },
);

/** One ordered pair of distinct conditions, each with its own generated rating. */
const distinctPairArb: fc.Arbitrary<readonly [RatingCondition, RatingCondition]> =
  fc
    .tuple(
      fc.constantFrom(...DISTINCT_KIND_PAIRS),
      displayRatingArb,
      displayRatingArb,
    )
    .map(
      ([[firstKind, secondKind], firstRating, secondRating]) =>
        [
          conditionOf(firstKind, firstRating),
          conditionOf(secondKind, secondRating),
        ] as const,
    );

/** Any one of the four conditions. */
const conditionArb: fc.Arbitrary<RatingCondition> = fc
  .tuple(fc.constantFrom(...CONDITION_KINDS), displayRatingArb)
  .map(([kind, displayRating]) => conditionOf(kind, displayRating));

/** Build the union member for a kind, so a generated kind becomes a condition. */
function conditionOf(kind: ConditionKind, displayRating: number): RatingCondition {
  return kind === 'established' ? { kind, displayRating } : { kind };
}

// --- rendering ----------------------------------------------------------------

/** What one render says about its condition, read across the three channels. */
interface RenderedCondition {
  /** The words (or digits) of the presentation. */
  readonly visibleText: string;

  /** Everything the panel renders, the squad-scope statement included. */
  readonly panelText: string;

  /** The accessible name of the badge-and-text composite. */
  readonly accessibleName: string;

  /** The condition the badge names — the non-colour cue, read as markup. */
  readonly badgeCue: string;

  /** The badge's shape class, which is what makes the cue visible. */
  readonly badgeClass: string;

  /** How many badges rendered; exactly one is the cue, none is no cue. */
  readonly badgeCount: number;

  /** Whether the badge is hidden from assistive technology, as the design has it. */
  readonly badgeHidden: boolean;

  /** How many named composites rendered. */
  readonly presentationCount: number;

  /** The condition the panel records having rendered. */
  readonly conditionAttribute: string;
}

/**
 * Render one condition and read the three channels off it.
 *
 * Unmounted before returning, because a property runs hundreds of times within
 * one test and Testing Library's automatic cleanup only fires between tests —
 * so without this, the second render of a pair would be read out of a document
 * still holding the first.
 */
function renderCondition(
  playerName: string,
  condition: RatingCondition,
): RenderedCondition {
  try {
    const { container } = render(
      <RatingPanel playerName={playerName} condition={condition} />,
    );

    const panel = container.querySelector<HTMLElement>(RATING_PANEL_SELECTOR);

    if (panel === null) {
      throw new Error('the rating panel did not render');
    }

    const presentations = panel.querySelectorAll(
      RATING_PANEL_PRESENTATION_SELECTOR,
    );
    const badges = panel.querySelectorAll(RATING_PANEL_BADGE_SELECTOR);
    const badge = badges[0] ?? null;

    return {
      visibleText:
        panel.querySelector(RATING_PANEL_TEXT_SELECTOR)?.textContent ?? '',
      panelText: panel.textContent ?? '',
      accessibleName: presentations[0]?.getAttribute('aria-label') ?? '',
      badgeCue: badge?.getAttribute('data-player-stats-rating-badge') ?? '',
      badgeClass: badge?.getAttribute('class') ?? '',
      badgeCount: badges.length,
      badgeHidden: badge?.getAttribute('aria-hidden') === 'true',
      presentationCount: presentations.length,
      conditionAttribute: panel.getAttribute(RATING_PANEL_CONDITION_ATTRIBUTE) ?? '',
    };
  } finally {
    cleanup();
  }
}

/** A generated name that mentions the vocabulary would make a match unattributable. */
function namesNothingItShouldNot(playerName: string): boolean {
  return (
    !RATING_NOUN.test(playerName) &&
    !/\d/u.test(playerName) &&
    EVERY_STATEMENT.every((statement) => !playerName.includes(statement))
  );
}

/** The statements that belong to conditions other than this one. */
function foreignStatements(kind: ConditionKind): readonly string[] {
  return EVERY_STATEMENT.filter(
    (statement) => statement !== CONDITION_STATEMENT[kind],
  );
}

// --- the vocabulary is a real discriminator -----------------------------------

// Feature: web-player-stats-screen, Property 18: The four conditions are mutually distinguishable
// Validates: Requirements 7.5, 7.6
describe('the four conditions this suite holds the panel to', () => {
  it('names four conditions and all twelve ordered pairs of distinct ones', () => {
    expect(new Set(CONDITION_KINDS).size).toBe(4);
    expect([...CONDITION_KINDS].sort()).toEqual([
      'absent',
      'established',
      'never-played',
      'provisional',
    ]);
    expect(DISTINCT_KIND_PAIRS).toHaveLength(12);
    expect(
      DISTINCT_KIND_PAIRS.every(([first, second]) => first !== second),
    ).toBe(true);
  });

  it('carries three statements that are pairwise distinct and none a substring of another', () => {
    // The containment test below is only a discriminator if this holds: a
    // statement contained in another would make one condition's name "state"
    // two conditions at once.
    expect(new Set(EVERY_STATEMENT).size).toBe(EVERY_STATEMENT.length);

    for (const statement of EVERY_STATEMENT) {
      for (const other of EVERY_STATEMENT) {
        expect(statement === other || !other.includes(statement)).toBe(true);
      }
    }
  });

  it('generates all four conditions, so the property is not satisfied vacuously', () => {
    const kinds = fc
      .sample(conditionArb, { numRuns: 400, seed: 18 })
      .map(({ kind }) => kind);

    expect(new Set(kinds)).toEqual(new Set(CONDITION_KINDS));
  });
});

// --- the property proper ------------------------------------------------------

// Feature: web-player-stats-screen, Property 18: The four conditions are mutually distinguishable
// Validates: Requirements 7.5, 7.6
describe('any two distinct rating conditions present differently (Req 7.6)', () => {
  it('renders different text and announces a different name for every distinct pair', () => {
    fc.assert(
      fc.property(nameArb, distinctPairArb, (playerName, [first, second]) => {
        fc.pre(namesNothingItShouldNot(playerName));

        // The same subject on both sides, so nothing below can differ because
        // the player did.
        const left = renderCondition(playerName, first);
        const right = renderCondition(playerName, second);

        // 7.6: no two of the four render identical text — asserted on the
        // presentation's own words and on the whole panel, since the
        // squad-scope statement is identical in all four conditions and so
        // cannot be what separates them.
        expect(left.visibleText).not.toBe(right.visibleText);
        expect(left.panelText).not.toBe(right.panelText);

        // What a screen reader hears differs too, and not only what a sighted
        // reader sees.
        expect(left.accessibleName).not.toBe(right.accessibleName);
      }),
      { numRuns: 300 },
    );
  });

  it('gives every distinct pair two different non-colour cues (Req 16.6)', () => {
    fc.assert(
      fc.property(nameArb, distinctPairArb, (playerName, [first, second]) => {
        const left = renderCondition(playerName, first);
        const right = renderCondition(playerName, second);

        // The shape channel separates the pair on its own, so the two are told
        // apart with no colour perceived at all. Read as markup rather than as
        // a computed hue: the panel's colours come from custom properties, and
        // jsdom resolves a `var()` reference to nothing.
        expect(left.badgeCue).not.toBe(right.badgeCue);
        expect(left.badgeClass).not.toBe(right.badgeClass);

        // And the panel records which condition it rendered, so the markup
        // agrees with the words.
        expect(left.conditionAttribute).not.toBe(right.conditionAttribute);
      }),
      { numRuns: 300 },
    );
  });

  it('separates all four at once, for any one subject', () => {
    fc.assert(
      fc.property(nameArb, displayRatingArb, (playerName, displayRating) => {
        fc.pre(namesNothingItShouldNot(playerName));

        const rendered = CONDITION_KINDS.map((kind) =>
          renderCondition(playerName, conditionOf(kind, displayRating)),
        );

        // Pairwise difference does not by itself give four distinct
        // presentations unless it holds simultaneously, which is what
        // Requirement 7.6's "four mutually distinguishable presentations"
        // asks for. Four sets of four.
        expect(new Set(rendered.map(({ visibleText }) => visibleText)).size).toBe(4);
        expect(new Set(rendered.map(({ accessibleName }) => accessibleName)).size).toBe(4);
        expect(new Set(rendered.map(({ badgeCue }) => badgeCue)).size).toBe(4);
        expect(new Set(rendered.map(({ badgeClass }) => badgeClass)).size).toBe(4);
      }),
      { numRuns: 200 },
    );
  });
});

// --- each name says which condition holds -------------------------------------

// Feature: web-player-stats-screen, Property 18: The four conditions are mutually distinguishable
// Validates: Requirements 7.5, 7.6
describe('each accessible name states which condition holds (Req 7.5)', () => {
  it('carries its own condition’s claim and none of the others’', () => {
    fc.assert(
      fc.property(nameArb, conditionArb, (playerName, condition) => {
        fc.pre(namesNothingItShouldNot(playerName));

        const { accessibleName } = renderCondition(playerName, condition);
        const statement = CONDITION_STATEMENT[condition.kind];

        if (statement === null) {
          // 7.2: the one condition whose claim is a figure. The digits are
          // announced as a *rating*, so the number is not heard as a bare
          // value — and the name is more than the digits alone.
          expect(accessibleName).toContain(formatCount(condition.displayRating));
          expect(accessibleName).toMatch(RATING_NOUN);
          expect(accessibleName).not.toBe(formatCount(condition.displayRating));
        } else {
          // 7.3, 7.4, 7.5: the fixed statement, verbatim.
          expect(accessibleName).toContain(statement);
        }

        // Whatever it says, it says one thing: no other condition's statement
        // appears, so a name cannot be read as two conditions at once.
        for (const foreign of foreignStatements(condition.kind)) {
          expect(accessibleName).not.toContain(foreign);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('names the subject whose rating it is, and the pure name matches the rendered one', () => {
    fc.assert(
      fc.property(nameArb, conditionArb, (playerName, condition) => {
        const { accessibleName } = renderCondition(playerName, condition);

        // The announced name is exactly what the exported pure function builds,
        // so the claim can be reasoned about without a DOM — and the two cannot
        // drift apart.
        expect(accessibleName).toBe(
          ratingPanelAccessibleName(playerName, condition),
        );

        if (playerName.trim() !== '') {
          expect(accessibleName).toContain(playerName);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// --- every condition has both channels ----------------------------------------

// Feature: web-player-stats-screen, Property 18: The four conditions are mutually distinguishable
// Validates: Requirements 7.5, 7.6
describe('every condition is conveyed by text plus a non-colour cue (Req 16.6)', () => {
  it('renders words and exactly one shape for every condition', () => {
    fc.assert(
      fc.property(nameArb, conditionArb, (playerName, condition) => {
        const rendered = renderCondition(playerName, condition);

        // Channel one: words. Never blank, so no condition is a shape alone.
        expect(rendered.visibleText).not.toBe('');

        // Channel two: one shape, naming the condition it stands for, and
        // carrying the condition in its class so the shape really is its own.
        expect(rendered.badgeCount).toBe(1);
        expect(rendered.badgeCue).toBe(condition.kind);
        expect(rendered.badgeClass).toContain(condition.kind);

        // The shape is decorative to a screen reader because the composite's
        // name already states the condition — two channels for sight, one
        // complete statement for hearing.
        expect(rendered.badgeHidden).toBe(true);
        expect(rendered.presentationCount).toBe(1);
        expect(rendered.conditionAttribute).toBe(condition.kind);
      }),
      { numRuns: 300 },
    );
  });
});
