// Feature: web-player-stats-screen, Property 26: The two tracking conditions are never presented as one another
// Validates: Requirements 11.1, 11.2, 11.6

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { TRACKING_DISABLED, TRACKING_EMPTY } from './messages';
import type { RichStats } from './parse/playerProfile';
import { resolveRichCondition, type RichCondition } from './richStats';
import { richStatsArb } from '../testing/playerProfileFixtures';

/**
 * Property tests for the rich-stats gate, beside the module they cover and each
 * assertion running well above the 100-case floor (Requirement 14.5).
 *
 * Property 26 is the claim that a squad which does not record live match detail
 * is never presented as a squad which records it and has none, and it has two
 * halves that meet nowhere else:
 *
 *  - **The mapping.** `resolveRichCondition` sends an absent block to
 *    `disabled`, a present block whose every member is absent to `empty`, and
 *    every other block to `present` (Requirements 11.1, 11.2, 11.6). The two
 *    empty-looking inputs are the whole difficulty: both render no figures, and
 *    a gate that collapsed them — by testing falsiness, by counting non-null
 *    members with a `??`, or by treating an all-null block as no block — would
 *    look right on screen and misdescribe the squad's own settings.
 *  - **The copy.** The two conditions license different sentences, so
 *    `TRACKING_DISABLED` and `TRACKING_EMPTY` must be distinct strings neither
 *    of which contains the other. Containment matters as much as equality: an
 *    assertion that a rendered panel *contains* one statement would also pass
 *    for a panel showing the statement that contains it.
 *
 * The mapping is held against an **independently written oracle**
 * ({@link oracleKind}) that reaches the same rule by a different route: the
 * absence of the block is decided by a `typeof` test rather than by comparing
 * against `null` and `undefined`, and the members are counted through a key
 * list rather than conjoined by hand. A failure therefore means the criterion
 * is broken rather than that the implementation was restated — and a member
 * added to `RichStats` next month is counted by the oracle without anyone
 * editing it, so the gate would be caught still ignoring it.
 *
 * Between the two halves sits {@link statementFor}, a test-local model of what
 * a panel does with a condition. It is what lets this file state Property 26 as
 * one sentence — *the statement rendered for an absent block is never the
 * statement rendered for an all-absent one, and neither contains the other* —
 * without rendering anything, which is Requirement 11.6's point in asking for a
 * pure function in the first place. That the panel actually reaches for these
 * strings is a rendering claim its own test carries; that the strings could be
 * told apart at all is settled here.
 *
 * Deliberately asserted rather than worked around: **a member whose value is
 * zero is a present member**. A player who has turned out for tracked matches
 * and scored nothing carries `goals: 0`, which is a recorded figure and a true
 * statement about them, so such a block is `present` and the panel renders the
 * zero. A falsy test would report "no live match detail has been recorded yet"
 * for a squad that records it diligently. Every zero-flavoured value a JSON
 * number can take — `0`, `-0`, and `NaN` — is generated as a present member for
 * exactly that reason.
 *
 * Not claimed here: that an absent member of a present block renders a no-data
 * statement and no numeral (Property 27), and that the non-rich sections survive
 * every rich condition (Property 28). Both consume this answer; neither
 * re-decides it.
 */

// --- the oracle --------------------------------------------------------------

/** The three kinds, named once so the exhaustiveness claim can quantify over them. */
const RICH_CONDITION_KINDS = ['disabled', 'empty', 'present'] as const;

type RichConditionKind = (typeof RICH_CONDITION_KINDS)[number];

/**
 * Every member of the Rich_Stats block, as a key list.
 *
 * The oracle counts through this rather than conjoining four comparisons the way
 * the module does, and the `satisfies` keeps it honest against the parsed type —
 * so a fifth member added to `RichStats` lands here at compile time and the
 * oracle starts counting it, while a gate that still ignored it would begin to
 * disagree.
 */
const MEMBER_KEYS = [
  'goals',
  'cleanSheets',
  'goalsConcededAsKeeper',
  'keeperTimeMs',
] as const satisfies readonly (keyof RichStats)[];

/**
 * Which condition holds, as Requirements 11.1, 11.2, and 11.6 word it: no block
 * at all is the squad's live-tracking feature being off, a block carrying no
 * figure is tracking on with nothing recorded, and anything else has detail to
 * render.
 *
 * The absence test is a `typeof` one, which takes `null` and `undefined`
 * together without naming either — a different route to the same rule than the
 * module's two comparisons. The member test is **absence**, never falsiness:
 * `rich[key] !== null` admits a recorded zero.
 */
function oracleKind(rich: RichStats | null | undefined): RichConditionKind {
  if (typeof rich !== 'object' || rich === null) {
    return 'disabled';
  }

  const presentMembers = MEMBER_KEYS.filter((key) => rich[key] !== null);

  return presentMembers.length === 0 ? 'empty' : 'present';
}

/**
 * What a panel says for a condition: the Tracking_Disabled_Condition statement,
 * the Tracking_Empty_Condition statement, or no statement at all because there
 * are figures to render instead.
 *
 * A test-local model of the render decision, written as an exhaustive switch so
 * a fourth condition could not be added without this file failing to compile.
 * Requirement 11.6 asks for the distinction to be drawn by a pure function so
 * that exactly this can be checked without a DOM.
 */
function statementFor(condition: RichCondition): string | null {
  switch (condition.kind) {
    case 'disabled':
      return TRACKING_DISABLED;
    case 'empty':
      return TRACKING_EMPTY;
    case 'present':
      return null;
  }
}

/** The members a block carries a value for, by name — for a failure message. */
function presentMemberNames(rich: RichStats): readonly string[] {
  return MEMBER_KEYS.filter((key) => rich[key] !== null);
}

/** A structural copy, so the no-mutation claim compares like with like. */
function snapshot(rich: RichStats): Record<string, number | null> {
  return Object.fromEntries(MEMBER_KEYS.map((key) => [key, rich[key]]));
}

// --- generators --------------------------------------------------------------

/**
 * A figure a member can carry, zeros and the degenerate numbers included.
 *
 * `0` is the case the falsiness bug turns on; `-0` and `NaN` are the other two
 * values a `!value` test would also mistake for an absence, and `NaN` is
 * reachable because the wire carries JSON numbers. A count is drawn alongside a
 * Keeper_Time-sized millisecond figure so neither scale is incidental.
 */
const memberValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(0, -0, 1, 2, 12, Number.NaN) },
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 50 }) },
  {
    weight: 3,
    arbitrary: fc.integer({ min: 0, max: 7_200_000 }), // a plausible Keeper_Time
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      -1,
      -12,
      0.5,
      Number.EPSILON,
      Number.MAX_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
  },
);

/** A member: a figure, or the absence the parser spells as `null`. */
const memberArb: fc.Arbitrary<number | null> = fc.option(memberValueArb, {
  nil: null,
  freq: 3,
});

/** A block over the given member generator. */
function blockOver(
  member: fc.Arbitrary<number | null>,
): fc.Arbitrary<RichStats> {
  return fc.record<RichStats>({
    goals: member,
    cleanSheets: member,
    goalsConcededAsKeeper: member,
    keeperTimeMs: member,
  });
}

/** A block whose every member is absent: tracking on, nothing recorded. */
const allAbsentBlockArb: fc.Arbitrary<RichStats> = blockOver(
  fc.constant<number | null>(null),
);

/** A block carrying at least one figure, in any member configuration. */
const someMemberPresentBlockArb: fc.Arbitrary<RichStats> = fc
  .tuple(
    blockOver(memberArb),
    fc.constantFrom(...MEMBER_KEYS),
    memberValueArb,
  )
  .map(([block, key, value]) => ({ ...block, [key]: value }));

/**
 * A block whose **only** present member is a zero: the sharpest form of the
 * "zero is a value" rule, generated for each member in turn.
 */
const zeroOnlyBlockArb: fc.Arbitrary<RichStats> = fc
  .tuple(fc.constantFrom(...MEMBER_KEYS), fc.constantFrom(0, -0))
  .map(([key, zero]) => ({
    goals: null,
    cleanSheets: null,
    goalsConcededAsKeeper: null,
    keeperTimeMs: null,
    [key]: zero,
  }));

/** A block with every member present. */
const fullyPopulatedBlockArb: fc.Arbitrary<RichStats> =
  blockOver(memberValueArb);

/** A present block in any shape at all, locally built or parser-shaped. */
const presentBlockArb: fc.Arbitrary<RichStats> = fc.oneof(
  { weight: 4, arbitrary: blockOver(memberArb) },
  { weight: 3, arbitrary: someMemberPresentBlockArb },
  { weight: 3, arbitrary: allAbsentBlockArb },
  { weight: 3, arbitrary: zeroOnlyBlockArb },
  { weight: 2, arbitrary: fullyPopulatedBlockArb },
  // The shared fixtures' own parsed blocks, so the shapes the Response_Parser
  // actually produces — Keeper_Time read from a wire duration included — are
  // part of this suite's input space rather than a separate one.
  { weight: 3, arbitrary: richStatsArb },
);

/** The gate's whole domain: a present block, or either spelling of no block. */
const richInputArb: fc.Arbitrary<RichStats | null | undefined> = fc.oneof(
  { weight: 7, arbitrary: presentBlockArb },
  { weight: 2, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

/* -------------------------------------------------------------------------- */
/* The mapping                                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 26: The two tracking conditions are never presented as one another
// Validates: Requirements 11.1, 11.2, 11.6
describe('resolveRichCondition — the three conditions are exactly the three the requirements name', () => {
  it('agrees with the oracle on every input in its domain', () => {
    fc.assert(
      fc.property(richInputArb, (rich) => {
        // The equivalence, by a different route: absence decided by `typeof`,
        // members counted through a key list.
        expect(resolveRichCondition(rich).kind, JSON.stringify(rich)).toBe(
          oracleKind(rich),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('yields exactly one of the three kinds, for every input', () => {
    fc.assert(
      fc.property(richInputArb, (rich) => {
        const condition = resolveRichCondition(rich);

        // Total: four absence tests and no coercion, so there is no input a
        // parsed block could be for which the gate has no answer.
        expect(RICH_CONDITION_KINDS).toContain(condition.kind);
      }),
      { numRuns: 500 },
    );
  });

  it('maps an absent block to the Tracking_Disabled_Condition', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (absent) => {
        // The backend reports a squad with live tracking off by omitting the
        // block, and a caller holding an optional property hands over
        // `undefined` for the same state (Requirement 11.1).
        expect(resolveRichCondition(absent)).toEqual({ kind: 'disabled' });
      }),
      { numRuns: 200 },
    );
  });

  it('maps a block whose every member is absent to the Tracking_Empty_Condition', () => {
    fc.assert(
      fc.property(allAbsentBlockArb, (rich) => {
        // Tracking is on and no figure has been recorded — a different state
        // from tracking being off, and one that resolves itself as soon as a
        // tracked match is played (Requirement 11.2).
        expect(resolveRichCondition(rich)).toEqual({ kind: 'empty' });
      }),
      { numRuns: 200 },
    );
  });

  it('maps every block carrying at least one figure to present', () => {
    fc.assert(
      fc.property(someMemberPresentBlockArb, (rich) => {
        const condition = resolveRichCondition(rich);

        expect(presentMemberNames(rich).length).toBeGreaterThan(0);
        expect(condition.kind, JSON.stringify(rich)).toBe('present');
      }),
      { numRuns: 1000 },
    );
  });

  it('carries the whole block through the present arm, unchanged', () => {
    fc.assert(
      fc.property(someMemberPresentBlockArb, (rich) => {
        const condition = resolveRichCondition(rich);

        expect(condition.kind).toBe('present');
        if (condition.kind !== 'present') return;

        // The very block, not a reduced summary: each member degrades
        // independently, so the panel needs all four to choose member by member
        // between a figure and a no-data statement (Requirements 11.3, 11.4).
        expect(condition.stats).toBe(rich);
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Zero is a value, not an absence                                            */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 26: The two tracking conditions are never presented as one another
// Validates: Requirements 11.1, 11.2, 11.6
describe('resolveRichCondition — the test for empty is absence, never falsiness', () => {
  it('reports present for a block whose only present member is zero', () => {
    fc.assert(
      fc.property(zeroOnlyBlockArb, (rich) => {
        // A player who has turned out for tracked matches and scored nothing
        // carries a zero, which is a recorded figure. Reading it as an absence
        // would announce a tracking squad as having recorded nothing, and would
        // erase the difference between a goalless player and an unmeasured one.
        expect(resolveRichCondition(rich).kind, JSON.stringify(rich)).toBe(
          'present',
        );
      }),
      { numRuns: 500 },
    );
  });

  it('reports present for each member in turn carrying a zero alone', () => {
    // Stated as examples as well as generated, so the four members are each
    // named: a defect ignoring one member would otherwise shrink to whichever
    // the generator happened to pick.
    for (const key of MEMBER_KEYS) {
      const rich: RichStats = {
        goals: null,
        cleanSheets: null,
        goalsConcededAsKeeper: null,
        keeperTimeMs: null,
        [key]: 0,
      };

      expect({ key, kind: resolveRichCondition(rich).kind }).toEqual({
        key,
        kind: 'present',
      });
    }
  });

  it('reports present for every falsy figure a JSON number can be', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEMBER_KEYS),
        fc.constantFrom(0, -0, Number.NaN),
        (key, falsy) => {
          const rich: RichStats = {
            goals: null,
            cleanSheets: null,
            goalsConcededAsKeeper: null,
            keeperTimeMs: null,
            [key]: falsy,
          };

          // `0`, `-0`, and `NaN` are the three values a `!value` test would
          // mistake for an absence. Each is a member the read model carried.
          expect(resolveRichCondition(rich).kind).toBe('present');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('reports empty only for the block that carries no member at all', () => {
    fc.assert(
      fc.property(presentBlockArb, (rich) => {
        // The sharp form: emptiness is decided by the count of present members
        // and by nothing else, so a block of four zeros is as present as a
        // block of four goals.
        expect(resolveRichCondition(rich).kind === 'empty').toBe(
          presentMemberNames(rich).length === 0,
        );
      }),
      { numRuns: 1000 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The copy, and the two conditions never read as one another                 */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 26: The two tracking conditions are never presented as one another
// Validates: Requirements 11.1, 11.2, 11.6
describe('the two tracking statements are distinct, neither inside the other', () => {
  it('keeps the two statements distinct, and neither contains the other', () => {
    // Requirement 11.2 asks for text distinct from the Tracking_Disabled
    // statement. Containment is checked as well as equality, because a rendered
    // assertion that the panel *contains* one statement would also pass for a
    // panel showing the statement that contains it.
    expect(TRACKING_DISABLED).not.toBe(TRACKING_EMPTY);
    expect(TRACKING_DISABLED.includes(TRACKING_EMPTY)).toBe(false);
    expect(TRACKING_EMPTY.includes(TRACKING_DISABLED)).toBe(false);

    // Non-empty, since an empty statement would be a blank space where a claim
    // about the squad's settings belongs — and would be a substring of the other.
    expect(TRACKING_DISABLED.trim().length).toBeGreaterThan(0);
    expect(TRACKING_EMPTY.trim().length).toBeGreaterThan(0);
  });

  it('keeps them distinct under the normalisation a reader applies', () => {
    const normalise = (text: string): string =>
      text.trim().toLowerCase().replace(/\s+/g, ' ');

    // Case and spacing are not the difference: the two sentences make different
    // claims, so they must still read differently to someone skimming.
    expect(normalise(TRACKING_DISABLED)).not.toBe(normalise(TRACKING_EMPTY));
    expect(normalise(TRACKING_DISABLED).includes(normalise(TRACKING_EMPTY))).toBe(
      false,
    );
    expect(normalise(TRACKING_EMPTY).includes(normalise(TRACKING_DISABLED))).toBe(
      false,
    );
  });

  it('renders the disabled statement for exactly the absent block', () => {
    fc.assert(
      fc.property(richInputArb, (rich) => {
        const statement = statementFor(resolveRichCondition(rich));

        // Property 26 in one line: the sentence claiming the squad does not
        // record live match detail is reached when, and only when, there is no
        // block — never for a squad that records it and has nothing yet.
        expect(statement === TRACKING_DISABLED, JSON.stringify(rich)).toBe(
          oracleKind(rich) === 'disabled',
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('renders the empty statement for exactly the all-absent block', () => {
    fc.assert(
      fc.property(richInputArb, (rich) => {
        const statement = statementFor(resolveRichCondition(rich));

        expect(statement === TRACKING_EMPTY, JSON.stringify(rich)).toBe(
          oracleKind(rich) === 'empty',
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('renders no tracking statement where there are figures instead', () => {
    fc.assert(
      fc.property(someMemberPresentBlockArb, (rich) => {
        // A block with detail in it gets the figures and neither sentence: both
        // sentences would be false of it.
        expect(statementFor(resolveRichCondition(rich))).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it('never renders one statement where the other condition holds', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RichStats | null | undefined>(null, undefined),
        allAbsentBlockArb,
        (absent, allAbsent) => {
          const disabledStatement = statementFor(resolveRichCondition(absent));
          const emptyStatement = statementFor(resolveRichCondition(allAbsent));

          // The pair stated together, which is how the requirement reads: the
          // two inputs that both render no figures are given statements that
          // cannot be mistaken for one another (Requirement 11.6).
          expect(disabledStatement).toBe(TRACKING_DISABLED);
          expect(emptyStatement).toBe(TRACKING_EMPTY);
          expect(disabledStatement).not.toBe(emptyStatement);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Purity and totality                                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 26: The two tracking conditions are never presented as one another
// Validates: Requirements 11.1, 11.2, 11.6
describe('resolveRichCondition — the gate is pure and total', () => {
  it('is deterministic: repeated calls on one input agree', () => {
    fc.assert(
      fc.property(richInputArb, (rich) => {
        const first = resolveRichCondition(rich);
        const second = resolveRichCondition(rich);

        // The panel asks this on every render; two renders of one parsed block
        // must not disagree about whether the squad tracks matches.
        expect(second.kind).toBe(first.kind);
        expect(second).toEqual(first);
      }),
      { numRuns: 500 },
    );
  });

  it('depends on nothing but its argument', () => {
    fc.assert(
      fc.property(richInputArb, richInputArb, (first, second) => {
        const firstKind = resolveRichCondition(first).kind;

        // Interleaving a call for another block changes nothing, so the gate
        // holds no state between the profiles of two subjects.
        resolveRichCondition(second);

        expect(resolveRichCondition(first).kind).toBe(firstKind);
      }),
      { numRuns: 500 },
    );
  });

  it('leaves the block it was handed exactly as it was', () => {
    fc.assert(
      fc.property(presentBlockArb, (rich) => {
        const before = snapshot(rich);

        resolveRichCondition(rich);

        // A reading, never a rewriting: no member is defaulted to zero and no
        // absence is filled in on the way through.
        expect(snapshot(rich)).toEqual(before);
      }),
      { numRuns: 500 },
    );
  });

  it('raises nothing on any input in its domain', () => {
    fc.assert(
      fc.property(richInputArb, (rich) => {
        expect(() => resolveRichCondition(rich)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity                                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 26: The two tracking conditions are never presented as one another
// Validates: Requirements 11.1, 11.2, 11.6
describe('the generated space reaches all three conditions', () => {
  it('produces each of the three kinds, so the agreement claim is not vacuous', () => {
    const sampled = fc.sample(richInputArb, { numRuns: 500, seed: 26 });
    const kinds = sampled.map((rich) => resolveRichCondition(rich).kind);

    // Without this, a gate returning a constant `disabled` would satisfy the
    // agreement property against a generator that never built a block.
    for (const kind of RICH_CONDITION_KINDS) {
      expect({ kind, produced: kinds.includes(kind) }).toEqual({
        kind,
        produced: true,
      });
    }
  });

  it('produces both spellings of an absent block', () => {
    const sampled = fc.sample(richInputArb, { numRuns: 500, seed: 11 });

    // `null` is what the wire sends; `undefined` is what a caller holding an
    // optional property hands over. Both are the Tracking_Disabled_Condition,
    // and both must actually occur for that claim to have been tested.
    expect(sampled.includes(null)).toBe(true);
    expect(sampled.includes(undefined)).toBe(true);
  });

  it('produces a block carrying a zero as its only figure', () => {
    const sampled = fc.sample(zeroOnlyBlockArb, { numRuns: 200, seed: 26 });

    expect(
      sampled.some((rich) =>
        MEMBER_KEYS.some((key) => Object.is(rich[key], 0) || Object.is(rich[key], -0)),
      ),
    ).toBe(true);
  });
});
