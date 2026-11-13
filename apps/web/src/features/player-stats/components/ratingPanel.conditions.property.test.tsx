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
  RATING_PANEL_SETTLING_SELECTOR,
  RATING_PANEL_TEXT_SELECTOR,
  RatingPanel,
  ratingPanelAccessibleName,
} from './RatingPanel';
import {
  RATING_ABSENT,
  RATING_NEVER_PLAYED,
  RATING_SETTLING_NOTE,
} from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { RatingCondition } from '../lib/ratingCondition';

/**
 * Property test for the rating panel's **distinguishability**, quantified over
 * generated conditions, generated display ratings, and generated player names
 * rather than over the four hand-written cases beside it in
 * `RatingPanel.test.tsx`.
 *
 * The claim: *any two distinct Rating_Conditions read differently as a panel,
 * and each is conveyed in words plus a non-colour cue.* How two conditions
 * differ depends on which two they are:
 *
 * - **A rating, never played, and not recorded** are three different
 *   presentations: different visible words, different accessible names, and
 *   different badge shapes.
 * - **An established rating and a settling one are the same presentation of the
 *   number** — same words, same name, same badge, same classes — because a
 *   settling rating looks like every other rating (brand.md). They are told
 *   apart by the plain sentence under a settling figure, and by nothing on the
 *   figure itself.
 *
 * The player's name is held fixed across each pair, so anything that differs
 * differs because the condition does. Generated names carry no digit and none of
 * the vocabulary, so every match found is attributable to the condition.
 *
 * The cue is read as **markup** — the badge's own `data-` attribute and its
 * shape class — and never as a computed colour: jsdom resolves a `var()`
 * reference to the empty string, so a colour assertion would be vacuous.
 */

// --- the vocabulary this suite is written against -----------------------------

/** The four conditions, transcribed rather than read off the union. */
const CONDITION_KINDS = [
  'established',
  'settling',
  'never-played',
  'absent',
] as const;

type ConditionKind = (typeof CONDITION_KINDS)[number];

/** The look each condition is drawn in: both numeric conditions are a rating. */
const LOOK_OF: Readonly<Record<ConditionKind, string>> = {
  established: 'rating',
  settling: 'rating',
  'never-played': 'never-played',
  absent: 'absent',
};

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
  settling: null,
  'never-played': RATING_NEVER_PLAYED,
  absent: RATING_ABSENT,
};

/** The three fixed statements the rating section can show. */
const EVERY_STATEMENT: readonly string[] = [
  RATING_SETTLING_NOTE,
  RATING_NEVER_PLAYED,
  RATING_ABSENT,
];

const RATING_NOUN = /rating/iu;

// --- generators ---------------------------------------------------------------

/** The characters a generated player name is built from: no digit, no vocabulary. */
const NAME_CHARACTERS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ' ',
  '-',
  "'",
] as const;

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

/** Build the union member for a kind, so a generated kind becomes a condition. */
function conditionOf(kind: ConditionKind, displayRating: number): RatingCondition {
  return kind === 'established' || kind === 'settling'
    ? { kind, displayRating }
    : { kind };
}

/** One ordered pair of distinct conditions, sharing one generated rating. */
const distinctPairArb: fc.Arbitrary<readonly [RatingCondition, RatingCondition]> =
  fc
    .tuple(fc.constantFrom(...DISTINCT_KIND_PAIRS), displayRatingArb)
    .map(
      ([[firstKind, secondKind], displayRating]) =>
        [
          conditionOf(firstKind, displayRating),
          conditionOf(secondKind, displayRating),
        ] as const,
    );

/** Any one of the four conditions. */
const conditionArb: fc.Arbitrary<RatingCondition> = fc
  .tuple(fc.constantFrom(...CONDITION_KINDS), displayRatingArb)
  .map(([kind, displayRating]) => conditionOf(kind, displayRating));

// --- reading a render ---------------------------------------------------------

/** What one render says about its condition. */
interface RenderedCondition {
  /** The words (or digits) of the presentation. */
  readonly visibleText: string;

  /** Everything the panel renders, the sentences beneath the figure included. */
  readonly panelText: string;

  /** The accessible name of the badge-and-text composite. */
  readonly accessibleName: string;

  /** The look the badge names — the non-colour cue, read as markup. */
  readonly badgeCue: string;

  /** The badge's shape class, which is what makes the cue visible. */
  readonly badgeClass: string;

  /** How many badges rendered; exactly one is the cue, none is no cue. */
  readonly badgeCount: number;

  /** Whether the badge is hidden from assistive technology, as the design has it. */
  readonly badgeHidden: boolean;

  /** How many named composites rendered. */
  readonly presentationCount: number;

  /** The markup of the named composite: the badge, the figure and their classes. */
  readonly presentationMarkup: string;

  /** How many settling sentences rendered. */
  readonly settlingSentenceCount: number;

  /** The condition the panel records having rendered. */
  readonly conditionAttribute: string;
}

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
      presentationMarkup: presentations[0]?.outerHTML ?? '',
      settlingSentenceCount: panel.querySelectorAll(RATING_PANEL_SETTLING_SELECTOR)
        .length,
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

/** Whether both conditions of a pair are a number. */
function bothNumeric(first: RatingCondition, second: RatingCondition): boolean {
  return LOOK_OF[first.kind] === 'rating' && LOOK_OF[second.kind] === 'rating';
}

describe('the four conditions this suite holds the panel to', () => {
  it('names four conditions and all twelve ordered pairs of distinct ones', () => {
    expect(new Set(CONDITION_KINDS).size).toBe(4);
    expect([...CONDITION_KINDS].sort()).toEqual([
      'absent',
      'established',
      'never-played',
      'settling',
    ]);
    expect(DISTINCT_KIND_PAIRS).toHaveLength(12);
    expect(
      DISTINCT_KIND_PAIRS.every(([first, second]) => first !== second),
    ).toBe(true);
  });

  it('carries three statements that are pairwise distinct and none a substring of another', () => {
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

describe('any two distinct rating conditions present differently (Req 7.6)', () => {
  it('reads differently as a panel, and records a different condition, for every distinct pair', () => {
    fc.assert(
      fc.property(nameArb, distinctPairArb, (playerName, [first, second]) => {
        fc.pre(namesNothingItShouldNot(playerName));

        const left = renderCondition(playerName, first);
        const right = renderCondition(playerName, second);

        expect(left.panelText).not.toBe(right.panelText);
        expect(left.conditionAttribute).not.toBe(right.conditionAttribute);
      }),
      { numRuns: 300 },
    );
  });

  it('separates a rating, never played and not recorded by words, name and shape', () => {
    fc.assert(
      fc.property(nameArb, distinctPairArb, (playerName, [first, second]) => {
        fc.pre(namesNothingItShouldNot(playerName));
        fc.pre(!bothNumeric(first, second));

        const left = renderCondition(playerName, first);
        const right = renderCondition(playerName, second);

        expect(left.visibleText).not.toBe(right.visibleText);
        expect(left.accessibleName).not.toBe(right.accessibleName);
        expect(left.badgeCue).not.toBe(right.badgeCue);
        expect(left.badgeClass).not.toBe(right.badgeClass);
      }),
      { numRuns: 300 },
    );
  });

  it('draws a settling rating exactly as an established one, and tells them apart in words beneath', () => {
    fc.assert(
      fc.property(nameArb, displayRatingArb, (playerName, displayRating) => {
        const established = renderCondition(playerName, {
          kind: 'established',
          displayRating,
        });
        const settling = renderCondition(playerName, {
          kind: 'settling',
          displayRating,
        });

        // Nothing on the figure differs: no colour, mark or label of its own.
        expect(settling.presentationMarkup).toBe(established.presentationMarkup);

        // The sentence is the difference, and it is words.
        expect(established.settlingSentenceCount).toBe(0);
        expect(settling.settlingSentenceCount).toBe(1);
        expect(settling.panelText).toContain(RATING_SETTLING_NOTE);
        expect(established.panelText).not.toContain(RATING_SETTLING_NOTE);
      }),
      { numRuns: 200 },
    );
  });
});

describe('each accessible name states which condition holds (Req 7.5)', () => {
  it('carries its own condition’s claim and none of the others’', () => {
    fc.assert(
      fc.property(nameArb, conditionArb, (playerName, condition) => {
        fc.pre(namesNothingItShouldNot(playerName));

        const { accessibleName } = renderCondition(playerName, condition);
        const statement = CONDITION_STATEMENT[condition.kind];

        if (condition.kind === 'established' || condition.kind === 'settling') {
          expect(accessibleName).toContain(formatCount(condition.displayRating));
          expect(accessibleName).toMatch(RATING_NOUN);
          expect(accessibleName).not.toBe(formatCount(condition.displayRating));
        } else {
          expect(accessibleName).toContain(statement);
        }

        for (const foreign of EVERY_STATEMENT.filter((other) => other !== statement)) {
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

describe('every condition is conveyed by text plus a non-colour cue (Req 16.6)', () => {
  it('renders words and exactly one shape for every condition', () => {
    fc.assert(
      fc.property(nameArb, conditionArb, (playerName, condition) => {
        const rendered = renderCondition(playerName, condition);

        expect(rendered.visibleText).not.toBe('');

        expect(rendered.badgeCount).toBe(1);
        expect(rendered.badgeCue).toBe(LOOK_OF[condition.kind]);
        expect(rendered.badgeClass).toContain(LOOK_OF[condition.kind]);

        expect(rendered.badgeHidden).toBe(true);
        expect(rendered.presentationCount).toBe(1);
        expect(rendered.conditionAttribute).toBe(condition.kind);
      }),
      { numRuns: 300 },
    );
  });
});
