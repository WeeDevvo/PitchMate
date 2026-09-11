import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { validateHeadingOutline } from './headingOutline';
import type { HeadingOutlineValidation } from './headingOutline';

/**
 * Property tests for the pure heading-outline validator, beside the module they
 * cover as the design's Testing Strategy asks, and running well above the
 * 100-iteration floor (Requirements 20.1, 19.2).
 *
 * Property 44 is an *exactly* claim: the validator reports an outline as holding
 * for the well-formed sequences and as not holding for every other sequence,
 * the empty sequence included. An "exactly" claim needs both directions driven
 * densely, and a generator over arbitrary heading levels overwhelmingly produces
 * failures — so there are two families of generators here. One builds sequences
 * that are well-formed **by construction** (start at level one, then step down
 * into depth by at most one and never back to level one), so the accepting
 * direction is exercised on thousands of real outlines rather than on the handful
 * a uniform generator would stumble into. The other builds each named failure
 * deliberately: no level-one heading, two level-one headings, and a level skipped
 * at a known position.
 *
 * Four claims are made:
 *
 * - **The verdict matches the stated rule on every sequence.** Asserted against an
 *   independently written oracle, whole-result rather than boolean, so the *named
 *   reason* and the position it reports are part of the claim.
 * - **Every well-formed outline is accepted**, including the shapes the three
 *   screens actually render — `[1]` for the Invite_Landing_Route, `[1, 2, 2]` for
 *   the Squads_Home, and `[1, 2, 2, 2, 2, 3, 3, 3]` for the Squad_Screen's five
 *   sections with the Admin_Section's three regions beneath the last of them
 *   (Requirement 19.1).
 * - **Each failure is named, not merely reported.** A screen with two titles is
 *   reported as `multiple-level-one` rather than as whichever skip that
 *   duplication caused, and a skip names the index and the two levels involved.
 * - **The function is pure and total**: same sequence, same verdict; a frozen
 *   array is accepted; the supplied array is not written; and no numeric input
 *   raises.
 *
 * **The literal two-clause reading is asserted on purpose.** The module's header
 * documents that clause 2 constrains a heading against its *predecessor*, and the
 * first heading has none — so `[2, 1]` satisfies both clauses and is reported as
 * holding. That is stated below by name (see "the first heading has no
 * predecessor") so the reading is visible in the tests rather than an accident of
 * the implementation. It is consistent with Requirement 19.2, which defines the
 * function as "exactly one level-one heading and skips no level"; whether
 * Requirement 19.1's intent additionally wants a screen's *first* heading to be
 * its level-one title is a third rule neither this module nor this test claims.
 * Nothing is lost in practice: **Property 43** asserts the rendered heading
 * sequence of each screen at the rendering site, where the title genuinely is the
 * first heading.
 *
 * What is deliberately not claimed here: that any screen renders a particular
 * sequence (Property 43), and that heading levels stay within 1–6 — the sequence
 * comes from headings that already exist in a rendered document, so the
 * validator's subject is the relation between levels, not their vocabulary.
 */

/** The heading level that titles a screen. */
const TOP_HEADING_LEVEL = 1;

/** The largest step down into depth a well-formed outline may take. */
const MAX_LEVEL_STEP = 1;

/** The deepest level the generators build, matching HTML's `h6`. */
const MAX_HEADING_LEVEL = 6;

// --- the oracle --------------------------------------------------------------

/**
 * The rule of Requirement 19.2 written independently of the module: the level-one
 * headings are *filtered and counted* rather than accumulated in a loop, and the
 * skip is found by *subtracting* adjacent levels through `findIndex` rather than
 * by comparing against a raised predecessor. Same rule, a different route to it,
 * so an inverted comparison or an off-by-one in either pass would show up as a
 * disagreement rather than being restated identically on both sides.
 *
 * "Exceeds its predecessor by more than one" is read as a strict `> 1` difference
 * on both sides, which is what keeps the function total: a difference that is not
 * a number is not greater than one, so it contributes no skip.
 */
function oracleValidation(levels: readonly number[]): HeadingOutlineValidation {
  const levelOneCount = levels.filter((level) => level === TOP_HEADING_LEVEL).length;

  if (levelOneCount !== 1) {
    return {
      ok: false,
      reason: levelOneCount === 0 ? 'no-level-one' : 'multiple-level-one',
      levelOneCount,
    };
  }

  const skipIndex = levels.findIndex(
    (level, index) => index > 0 && level - levels[index - 1] > MAX_LEVEL_STEP,
  );

  if (skipIndex !== -1) {
    return {
      ok: false,
      reason: 'skipped-level',
      index: skipIndex,
      previousLevel: levels[skipIndex - 1],
      level: levels[skipIndex],
    };
  }

  return { ok: true };
}

// --- generators --------------------------------------------------------------

/**
 * A single heading level, weighted towards the levels a screen renders but
 * including the values a level is not supposed to be — zero, seven, a negative, a
 * fraction — because the validator compares levels and never interprets them.
 */
const levelArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 1, max: MAX_HEADING_LEVEL }) },
  { weight: 3, arbitrary: fc.constantFrom(1, 2, 3) },
  { weight: 1, arbitrary: fc.constantFrom(0, 7, -1, 1.5, 2.5) },
);

/**
 * An arbitrary sequence of heading levels, the empty sequence included. Most are
 * malformed, which is exactly what the rejecting half of Property 44 needs.
 */
const arbitraryOutlineArb: fc.Arbitrary<number[]> = fc.array(levelArb, {
  minLength: 0,
  maxLength: 24,
});

/**
 * A sequence that is **well-formed by construction**: it opens with the single
 * level-one heading, and every later heading is at least level two (so level one
 * is never repeated) and at most one deeper than the heading before it (so no
 * level is skipped). Descending is unconstrained — a level-two section following a
 * level-four subsection closes two levels at once, which is ordinary — so the
 * steps are drawn from `-3..1`.
 */
const wellFormedOutlineArb: fc.Arbitrary<number[]> = fc
  .array(fc.integer({ min: -3, max: MAX_LEVEL_STEP }), { minLength: 0, maxLength: 24 })
  .map((steps) => {
    const levels = [TOP_HEADING_LEVEL];
    let previousLevel = TOP_HEADING_LEVEL;

    for (const step of steps) {
      // Clamped below at two and above at six: clamping up can only reach level
      // two, which never exceeds any predecessor by more than one.
      const level = Math.min(MAX_HEADING_LEVEL, Math.max(2, previousLevel + step));

      levels.push(level);
      previousLevel = level;
    }

    return levels;
  });

/**
 * A sequence carrying **no** level-one heading, the empty sequence included: every
 * heading is level two or deeper, which is the shape a screen takes when its title
 * is rendered as a level-two heading or removed altogether.
 */
const noLevelOneOutlineArb: fc.Arbitrary<number[]> = fc.array(
  fc.integer({ min: 2, max: MAX_HEADING_LEVEL }),
  { minLength: 0, maxLength: 16 },
);

/**
 * A well-formed outline with an extra level-one heading spliced in — two titles on
 * one screen, the shape a section introduced with its own `h1` produces.
 */
const multipleLevelOneOutlineArb: fc.Arbitrary<{
  levels: number[];
  levelOneCount: number;
}> = wellFormedOutlineArb.chain((wellFormed) =>
  fc
    .tuple(
      fc.integer({ min: 0, max: wellFormed.length }),
      fc.integer({ min: 1, max: 3 }),
    )
    .map(([index, extra]) => {
      const levels = wellFormed.slice();

      levels.splice(index, 0, ...new Array<number>(extra).fill(TOP_HEADING_LEVEL));

      return { levels, levelOneCount: 1 + extra };
    }),
);

/**
 * A well-formed outline with exactly one heading **raised** so that it exceeds its
 * predecessor by two or more: a section introduced with a level-three heading
 * directly under the level-one title, or a level-two heading removed from above
 * its level-three children.
 *
 * Because the outline was well-formed and the raised heading sits at an index of at
 * least one, the sequence still carries exactly one level-one heading (a raised
 * level is at least three) and the *first* skip is at the raised index — so the
 * index the validator reports is known, not merely non-negative.
 */
const skippedLevelOutlineArb: fc.Arbitrary<{
  levels: number[];
  index: number;
  previousLevel: number;
  level: number;
}> = wellFormedOutlineArb
  .filter((wellFormed) => wellFormed.length >= 2)
  .chain((wellFormed) =>
    fc
      .tuple(
        fc.integer({ min: 1, max: wellFormed.length - 1 }),
        fc.integer({ min: 2, max: 4 }),
      )
      .map(([index, jump]) => {
        const levels = wellFormed.slice();
        const previousLevel = levels[index - 1];
        const level = previousLevel + jump;

        levels[index] = level;

        return { levels, index, previousLevel, level };
      }),
  );

/** Numeric values a heading level is never meant to be, for the totality claim. */
const oddNumberArb: fc.Arbitrary<number> = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  -0,
  0.5,
);

// Feature: web-squads-screens, Property 44: The heading-outline validator accepts
// exactly the well-formed outlines
// Validates: Requirements 19.2
describe('validateHeadingOutline — the verdict is exactly the stated rule', () => {
  it('agrees with an independent reading of the rule on any sequence of levels', () => {
    fc.assert(
      fc.property(arbitraryOutlineArb, (levels) => {
        // Whole-result rather than boolean: the named reason and the reported
        // position are part of the claim, not decoration on it.
        expect(validateHeadingOutline(levels)).toEqual(oracleValidation(levels));
      }),
      { numRuns: 600 },
    );
  });

  it('agrees with the oracle on well-formed outlines and on each named failure shape', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          wellFormedOutlineArb,
          noLevelOneOutlineArb,
          multipleLevelOneOutlineArb.map(({ levels }) => levels),
          skippedLevelOutlineArb.map(({ levels }) => levels),
        ),
        (levels) => {
          // The same agreement driven through the deliberate generators, so each
          // branch of the rule is reached densely rather than by chance.
          expect(validateHeadingOutline(levels)).toEqual(oracleValidation(levels));
        },
      ),
      { numRuns: 600 },
    );
  });

  it('holds for every outline that is well-formed by construction', () => {
    fc.assert(
      fc.property(wellFormedOutlineArb, (levels) => {
        expect(validateHeadingOutline(levels)).toEqual({ ok: true });
      }),
      { numRuns: 500 },
    );
  });

  it('rejects every sequence that breaks either clause', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          noLevelOneOutlineArb,
          multipleLevelOneOutlineArb.map(({ levels }) => levels),
          skippedLevelOutlineArb.map(({ levels }) => levels),
        ),
        (levels) => {
          expect(validateHeadingOutline(levels).ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('holds for the outlines the three screens render', () => {
    // Worked examples a reader can check by eye, taken from Requirement 19.1:
    // the Invite_Landing_Route's title alone, the Squads_Home's title over two
    // sections, a section with a subsection followed by a sibling section, and the
    // Squad_Screen — five level-two sections with the Admin_Section's invite,
    // guest, and feature regions beneath the last of them.
    for (const levels of [
      [1],
      [1, 2],
      [1, 2, 2],
      [1, 2, 3, 2, 3],
      [1, 2, 2, 2, 2, 3, 3, 3],
      [1, 2, 3, 4, 5, 6],
    ]) {
      expect(validateHeadingOutline(levels)).toEqual({ ok: true });
    }
  });

  it('holds when an outline closes several levels at once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: MAX_HEADING_LEVEL }),
        (depth) => {
          // Descending is unrestricted: a level-two section following a deep
          // subsection is how that subsection ends, not a skip.
          const descend: number[] = [];

          for (let level = TOP_HEADING_LEVEL; level <= depth; level += 1) {
            descend.push(level);
          }

          expect(validateHeadingOutline([...descend, 2])).toEqual({ ok: true });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects the empty sequence, since a screen with no headings has no outline', () => {
    expect(validateHeadingOutline([])).toEqual({
      ok: false,
      reason: 'no-level-one',
      levelOneCount: 0,
    });
  });
});

// Feature: web-squads-screens, Property 44: The heading-outline validator accepts
// exactly the well-formed outlines
// Validates: Requirements 19.2
describe('validateHeadingOutline — each failure is named and located', () => {
  it('reports no-level-one for a sequence whose headings all start at level two or deeper', () => {
    fc.assert(
      fc.property(noLevelOneOutlineArb, (levels) => {
        // Includes the empty sequence, which this generator produces.
        expect(validateHeadingOutline(levels)).toEqual({
          ok: false,
          reason: 'no-level-one',
          levelOneCount: 0,
        });
      }),
      { numRuns: 400 },
    );
  });

  it('reports multiple-level-one, and how many titles, for a sequence with two or more', () => {
    fc.assert(
      fc.property(multipleLevelOneOutlineArb, ({ levels, levelOneCount }) => {
        // Not "at least one": two titles leave a screen as unnavigable as none,
        // and the count is reported so the failure names the scale of it.
        expect(validateHeadingOutline(levels)).toEqual({
          ok: false,
          reason: 'multiple-level-one',
          levelOneCount,
        });
        expect(levelOneCount).toBeGreaterThan(1);
      }),
      { numRuns: 400 },
    );
  });

  it('reports skipped-level with the position and both levels involved', () => {
    fc.assert(
      fc.property(skippedLevelOutlineArb, ({ levels, index, previousLevel, level }) => {
        // "A level was skipped somewhere on this screen" is not actionable; "the
        // heading at index 3 jumps from 1 to 3" is.
        expect(validateHeadingOutline(levels)).toEqual({
          ok: false,
          reason: 'skipped-level',
          index,
          previousLevel,
          level,
        });
      }),
      { numRuns: 400 },
    );
  });

  it('reports the level-one count before any skip it also carries', () => {
    fc.assert(
      fc.property(arbitraryOutlineArb, (levels) => {
        const validation = validateHeadingOutline(levels);
        const levelOneCount = levels.filter(
          (level) => level === TOP_HEADING_LEVEL,
        ).length;

        // Precedence is part of the contract: a screen with two titles is reported
        // as such rather than as whichever skip that duplication happened to
        // cause, so a failing test names the cause and not a symptom.
        if (levelOneCount !== 1) {
          expect(validation).toEqual({
            ok: false,
            reason: levelOneCount === 0 ? 'no-level-one' : 'multiple-level-one',
            levelOneCount,
          });
        }
      }),
      { numRuns: 500 },
    );
  });

  it('names the first skip when a sequence carries several', () => {
    // Two skips, at index 1 and index 3; the earlier one is reported.
    expect(validateHeadingOutline([1, 3, 2, 5])).toEqual({
      ok: false,
      reason: 'skipped-level',
      index: 1,
      previousLevel: 1,
      level: 3,
    });
  });

  it('reports each named failure on a hand-checked sequence', () => {
    expect(validateHeadingOutline([2, 3])).toEqual({
      ok: false,
      reason: 'no-level-one',
      levelOneCount: 0,
    });

    expect(validateHeadingOutline([1, 2, 1])).toEqual({
      ok: false,
      reason: 'multiple-level-one',
      levelOneCount: 2,
    });

    expect(validateHeadingOutline([1, 3])).toEqual({
      ok: false,
      reason: 'skipped-level',
      index: 1,
      previousLevel: 1,
      level: 3,
    });

    expect(validateHeadingOutline([1, 2, 4])).toEqual({
      ok: false,
      reason: 'skipped-level',
      index: 2,
      previousLevel: 2,
      level: 4,
    });
  });
});

// Feature: web-squads-screens, Property 44: the two clauses are read literally —
// the first heading has no predecessor
// Validates: Requirements 19.2
describe('validateHeadingOutline — the first heading has no predecessor', () => {
  it('holds for a sequence opening deeper than the level-one heading that follows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: MAX_HEADING_LEVEL }), (openingLevel) => {
        // Stated so the reading is visible rather than accidental. Requirement
        // 19.2 gives two clauses — exactly one level-one heading, and no level
        // exceeding its *predecessor* by more than one — and the first heading has
        // no predecessor, so `[2, 1]` satisfies both and is reported as holding.
        // Treating the start of the sequence as having an implicit level-zero
        // predecessor would reject it, but that is a third rule this module was not
        // given. No screen produces the shape: a screen's title is its first
        // heading, which Property 43 asserts where the screens are rendered.
        expect(validateHeadingOutline([openingLevel, TOP_HEADING_LEVEL])).toEqual({
          ok: true,
        });
      }),
      { numRuns: 200 },
    );
  });

  it('constrains every later heading against the one before it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: MAX_HEADING_LEVEL }),
        fc.integer({ min: 2, max: 4 }),
        (openingLevel, jump) => {
          // The mirror of the case above: the exemption belongs to the first
          // position only, so the very same jump one heading later is a skip.
          expect(
            validateHeadingOutline([TOP_HEADING_LEVEL, openingLevel + jump]).ok,
          ).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('holds for a single heading of any level, having neither predecessor nor successor', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_HEADING_LEVEL }), (level) => {
        // Only the level-one clause can speak about a one-heading sequence, so
        // `[1]` holds and `[3]` fails for the count and not for a skip.
        expect(validateHeadingOutline([level])).toEqual(
          level === TOP_HEADING_LEVEL
            ? { ok: true }
            : { ok: false, reason: 'no-level-one', levelOneCount: 0 },
        );
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 44: the validator is a pure, total
// function of the sequence it is given
// Validates: Requirements 19.2, 20.1
describe('validateHeadingOutline — the validation is pure and total', () => {
  it('is deterministic: repeated calls on one sequence agree', () => {
    fc.assert(
      fc.property(arbitraryOutlineArb, (levels) => {
        // Each screen's accessibility test runs this per Theme and per state; two
        // runs over the same rendered outline must not disagree.
        expect(validateHeadingOutline(levels)).toEqual(validateHeadingOutline(levels));
      }),
      { numRuns: 400 },
    );
  });

  it('does not mutate the supplied sequence, and accepts a frozen one', () => {
    fc.assert(
      fc.property(arbitraryOutlineArb, (levels) => {
        const before = levels.slice();
        const frozen = Object.freeze(levels.slice());

        // The sequence is a reading of a rendered document; validating it must not
        // rewrite what was read, and a frozen reading must still be validatable.
        expect(validateHeadingOutline(frozen)).toEqual(oracleValidation(before));
        validateHeadingOutline(levels);
        expect(levels).toEqual(before);
      }),
      { numRuns: 400 },
    );
  });

  it('answers without raising for sequences carrying values a level never is', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(levelArb, oddNumberArb), { minLength: 0, maxLength: 16 }),
        (levels) => {
          // Total by construction rather than by guard: nothing equals `NaN` and no
          // comparison against it is true, so such a heading contributes neither a
          // level-one count nor a skip, and nothing here raises.
          expect(validateHeadingOutline(levels)).toEqual(oracleValidation(levels));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('depends on nothing but the sequence it is given', () => {
    fc.assert(
      fc.property(arbitraryOutlineArb, arbitraryOutlineArb, (first, second) => {
        const firstValidation = validateHeadingOutline(first);

        // Validating an unrelated screen's outline in between changes nothing, so
        // the function holds no state across calls.
        validateHeadingOutline(second);

        expect(validateHeadingOutline(first)).toEqual(firstValidation);
      }),
      { numRuns: 400 },
    );
  });

  it('holds for a 200-heading outline, larger than any screen renders', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -3, max: MAX_LEVEL_STEP }), {
          minLength: 199,
          maxLength: 199,
        }),
        (steps) => {
          const levels = [TOP_HEADING_LEVEL];
          let previousLevel = TOP_HEADING_LEVEL;

          for (const step of steps) {
            const level = Math.min(
              MAX_HEADING_LEVEL,
              Math.max(2, previousLevel + step),
            );

            levels.push(level);
            previousLevel = level;
          }

          expect(levels).toHaveLength(200);
          expect(validateHeadingOutline(levels)).toEqual({ ok: true });
        },
      ),
      { numRuns: 100 },
    );
  });
});
