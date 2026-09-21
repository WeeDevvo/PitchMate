/**
 * The heading-outline validator: the pure half of Requirement 19.1.
 *
 * Requirement 19.1 asks that each of the three screens render exactly one
 * level-one heading and skip no heading level within that screen. Requirement 19.2
 * asks that the check be a **pure function over an ordered sequence of heading
 * levels** rather than a hand-written assertion repeated per screen — so each
 * screen's accessibility test reads the rendered heading levels in document order,
 * hands the sequence here, and asserts one thing.
 *
 * That split is what makes the rule checkable rather than merely stated. A skipped
 * level is invisible to a sighted reader and obvious to someone navigating by
 * heading, so it is exactly the sort of regression that survives review: a section
 * introduced with a level-three heading under a level-one, a level-two heading
 * removed from the Admin_Section while its level-three children stay. Both fail
 * here.
 *
 * **The rule, precisely.** An outline holds when both hold:
 *
 * 1. **Exactly one level-one heading.** Not "at least one": two level-one headings
 *    give a screen two titles and no structure, which is as unnavigable as none.
 *    The empty sequence therefore fails too — a screen with no headings has no
 *    outline to navigate.
 * 2. **No level exceeds its predecessor by more than one.** Descending is
 *    unrestricted: a level-two section following a level-four subsection closes two
 *    levels at once, which is ordinary and correct. Only *descent into* depth is
 *    constrained, because that is what skipping a level means.
 *
 * The first heading in the sequence has no predecessor, so clause 2 says nothing
 * about it. That is the literal rule Requirement 19.2 states, and it is kept
 * literal on purpose: a sequence like `[2, 1]` — a level-two heading before the
 * screen's only level-one — satisfies both clauses and is reported as holding.
 * No screen produces that shape, because a screen's title is its first heading;
 * treating the start of the sequence as though it had an implicit level-zero
 * predecessor would reject it, but that is a *third* rule and this module
 * implements the two it was given.
 *
 * **Levels are compared, never interpreted.** Nothing here knows that HTML stops
 * at `h6`, and nothing here rejects a level outside 1–6, because the sequence comes
 * from headings that already exist in a rendered document — the validator's job is
 * the relation between them. The function stays total over any numbers all the
 * same: `NaN` is not equal to one and no comparison against it is true, so a
 * sequence carrying one simply contributes no level-one heading and no skip, and
 * nothing raises.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all (Requirement 18.2) — the *reading* of heading levels out
 * of a rendered document belongs to the test that renders it, which is precisely
 * why the rule can live here.
 *
 * Requirements: 19.1, 19.2
 */

/** The heading level that titles a screen, of which there must be exactly one. */
const TOP_HEADING_LEVEL = 1;

/** The largest step down into depth an outline may take between two headings. */
const MAX_LEVEL_STEP = 1;

/**
 * Why a heading outline does not hold.
 *
 * Named rather than worded: these are identifiers a failing test reports, not copy
 * shown to anyone. `skipped-level` carries the position and the two levels
 * involved, because "a level was skipped somewhere on this screen" is not
 * actionable and "the third heading jumps from 1 to 3" is.
 *
 * | Reason              | The sequence                                   |
 * | ------------------- | ---------------------------------------------- |
 * | `no-level-one`      | carries no level-one heading, the empty sequence included |
 * | `multiple-level-one`| carries more than one level-one heading         |
 * | `skipped-level`     | steps down more than one level between two adjacent headings |
 */
export type HeadingOutlineFailureReason =
  | 'no-level-one'
  | 'multiple-level-one'
  | 'skipped-level';

/**
 * The result of validating a heading outline: it holds, or it fails for one named
 * reason (Requirement 19.2).
 *
 * A discriminated union rather than a bare boolean, so a failing assertion names
 * what is wrong with the screen instead of only that something is.
 */
export type HeadingOutlineValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'no-level-one' | 'multiple-level-one';
      /** How many level-one headings the sequence carried: `0`, or 2 or more. */
      readonly levelOneCount: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'skipped-level';
      /** The index of the heading that stepped down too far. */
      readonly index: number;
      /** The level of the heading before it. */
      readonly previousLevel: number;
      /** The level it stepped to. */
      readonly level: number;
    };

/**
 * Whether an ordered sequence of heading levels is a well-formed outline
 * (Requirement 19.2).
 *
 * Holds exactly when the sequence carries exactly one level-one heading and no
 * level exceeds its predecessor by more than one. The level-one count is checked
 * first, so a screen with two titles is reported as such rather than as whichever
 * skip that duplication happened to cause.
 *
 * Pure and total: one pass to count, one pass to compare, no clock, no DOM, no
 * exception, and the same answer for the same sequence. The sequence is read and
 * never written, so a frozen array is accepted.
 *
 * @param levels the heading levels of one screen, in document order — `[1, 2, 2,
 *   3]` for a screen whose title is followed by two sections, the second of which
 *   has a subsection
 * @returns that the outline holds, or the named reason it does not
 *
 * Requirements: 19.1, 19.2
 */
export function validateHeadingOutline(
  levels: readonly number[],
): HeadingOutlineValidation {
  // 19.1: exactly one level-one heading. Counted rather than searched, because
  // "none" and "two" are different failures and a search reports neither.
  let levelOneCount = 0;

  for (const level of levels) {
    if (level === TOP_HEADING_LEVEL) {
      levelOneCount += 1;
    }
  }

  if (levelOneCount === 0) {
    // Includes the empty sequence: a screen with no headings has no outline.
    return { ok: false, reason: 'no-level-one', levelOneCount };
  }

  if (levelOneCount > 1) {
    return { ok: false, reason: 'multiple-level-one', levelOneCount };
  }

  // 19.1: no skipped level. Only the step *down into* depth is constrained —
  // closing several levels at once is how a nested section ends.
  for (let index = 1; index < levels.length; index += 1) {
    const previousLevel = levels[index - 1];
    const level = levels[index];

    if (level > previousLevel + MAX_LEVEL_STEP) {
      return { ok: false, reason: 'skipped-level', index, previousLevel, level };
    }
  }

  return { ok: true };
}
