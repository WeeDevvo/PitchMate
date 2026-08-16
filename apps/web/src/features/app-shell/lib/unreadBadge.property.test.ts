import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  BADGE_MAX_EXACT_COUNT,
  BADGE_MIN_COUNT,
  BADGE_OVERFLOW_TEXT,
  NOTIFICATIONS_SUBJECT,
  notificationIndicatorLabel,
  unreadBadgeText,
} from './unreadBadge';

/**
 * Property tests for the App_Shell's single pure Unread_Badge formatter and
 * Notification_Indicator namer, placed beside the module they cover as
 * Requirement 14.2 asks, and run well above the 100-iteration floor.
 *
 * These carry **Property 15: Badge text and indicator name report the same
 * count**:
 *
 *  - *the three badge bands* — `null` at 0, the decimal representation from 1 to
 *    99 inclusive, `99+` at 100 and above (Requirements 4.2, 4.3, 4.4, 14.8);
 *  - *agreement* — the accessible name reports the very count the badge shows,
 *    so the two can never drift (Requirement 4.5);
 *  - *the name's subject* — every name opens by naming notifications, so the
 *    count is perceivable without the badge's visual position
 *    (Requirement 4.5);
 *  - *squad coverage* — an active Squad_Scope is conveyed in the name and only in
 *    the name, leaving the badge text untouched (Requirement 7.6);
 *  - *totality* — every numeric input, the ones a well-formed count response can
 *    never carry included, yields one badge outcome and one non-empty name and
 *    raises nothing.
 *
 * The expected mapping is re-derived here from the acceptance criteria rather
 * than lifted from the module's branch structure, so a change of implementation
 * cannot silently drag the expectation along with it. The band constants are read
 * from the module so a test can never disagree with it about *where* a boundary
 * sits — their literal values are asserted once, separately, so a wrong constant
 * is still caught.
 *
 * Wording is asserted by what a requirement actually demands — a term naming
 * notifications, the same count, a statement that nothing is unread, an
 * indication of single-squad coverage — rather than by whole fixed sentences,
 * which no acceptance criterion fixes.
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.5, 7.6, 14.8
 */

/** The largest count an accepted unread-count response can carry (`int32` max). */
const MAX_COUNT = 2_147_483_647;

/**
 * An independent reading of Requirements 4.2, 4.3, and 4.4 for the counts those
 * criteria speak about: whole numbers of 0 or above.
 */
function expectedBadge(count: number): string | null {
  if (count < BADGE_MIN_COUNT) {
    return null;
  }

  if (count > BADGE_MAX_EXACT_COUNT) {
    return BADGE_OVERFLOW_TEXT;
  }

  return count.toString(10);
}

/** Counts of 0 — including `-0`, which is the same quantity of unread records. */
const zeroArb: fc.Arbitrary<number> = fc.constantFrom(0, -0);

/** The exact band, 1 to 99 inclusive, with its edges generated outright. */
const exactBandArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.integer({ min: BADGE_MIN_COUNT, max: BADGE_MAX_EXACT_COUNT }),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      BADGE_MIN_COUNT,
      2,
      9,
      10,
      42,
      BADGE_MAX_EXACT_COUNT - 1,
      BADGE_MAX_EXACT_COUNT,
    ),
  },
);

/** The overflow band, 100 up to the largest count a response can carry. */
const overflowBandArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.integer({ min: BADGE_MAX_EXACT_COUNT + 1, max: MAX_COUNT }),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      BADGE_MAX_EXACT_COUNT + 1,
      101,
      199,
      1000,
      99_999,
      MAX_COUNT - 1,
      MAX_COUNT,
    ),
  },
);

/**
 * The whole production domain: an integer from 0 to 2,147,483,647, which is what
 * an accepted unread-count response yields.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: zeroArb },
  { weight: 4, arbitrary: exactBandArb },
  { weight: 4, arbitrary: overflowBandArb },
);

/**
 * Numbers no accepted unread-count response can carry: non-finite values,
 * negatives, and fractions. They exist here to show the functions stay total and
 * never render `NaN`, `-1`, or `5.5` on a badge.
 */
const offDomainNumberArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      -99,
      -MAX_COUNT,
      0.5,
      0.999_999,
      1.5,
      99.5,
      99.999_999,
      100.5,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
    ),
  },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer({ min: -MAX_COUNT, max: -1 }) },
);

/** Any number at all — the totality generator. */
const anyNumberArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: countArb },
  { weight: 2, arbitrary: offDomainNumberArb },
);

/** Whether a name conveys that the count covers one squad (Requirement 7.6). */
function conveysSquadCoverage(label: string): boolean {
  return label.toLowerCase().includes('squad');
}

describe('Property 15: badge text and indicator name report the same count', () => {
  it('formats the badge as the three bands the acceptance criteria state', () => {
    fc.assert(
      fc.property(countArb, (count) => {
        expect(unreadBadgeText(count)).toBe(expectedBadge(count));
      }),
      { numRuns: 1000 },
    );
  });

  it('renders no badge at a count of 0', () => {
    fc.assert(
      fc.property(zeroArb, (count) => {
        // 4.4: one representation of *no badge*, so a component never has to read
        // an empty string as an absence.
        expect(unreadBadgeText(count)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('shows the decimal representation from 1 to 99 inclusive', () => {
    fc.assert(
      fc.property(exactBandArb, (count) => {
        const badge = unreadBadgeText(count);

        // 4.2: a count of 1 renders as `1`, not `01` and not `1 unread`.
        expect(badge).toBe(count.toString(10));
        expect(badge).toMatch(/^[1-9][0-9]?$/);
        expect(Number(badge)).toBe(count);
      }),
      { numRuns: 500 },
    );
  });

  it('shows the fixed overflow text at 100 and above', () => {
    fc.assert(
      fc.property(overflowBandArb, (count) => {
        // 4.3: one small stable shape however large the count grows.
        expect(unreadBadgeText(count)).toBe(BADGE_OVERFLOW_TEXT);
      }),
      { numRuns: 500 },
    );
  });

  it('names notifications as the subject of every accessible name', () => {
    fc.assert(
      fc.property(anyNumberArb, fc.boolean(), (count, scoped) => {
        const label = notificationIndicatorLabel(count, scoped);

        // 4.5: the control announces what it is before it announces how many.
        expect(label).toContain(NOTIFICATIONS_SUBJECT);
        expect(label.startsWith(NOTIFICATIONS_SUBJECT)).toBe(true);
        expect(label.trim().length).toBeGreaterThan(
          NOTIFICATIONS_SUBJECT.length,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('reports in the name the same count the badge shows', () => {
    fc.assert(
      fc.property(countArb, fc.boolean(), (count, scoped) => {
        const badge = unreadBadgeText(count);
        const label = notificationIndicatorLabel(count, scoped);

        if (badge === null) {
          // 4.5: a count of 0 is stated, not omitted — a quiet inbox has to be
          // distinguishable from an unreported one, so the name says nothing is
          // unread and carries no number to be misread as a count.
          expect(label.toLowerCase()).toContain('no unread');
          expect(label).not.toMatch(/[0-9]/);
        } else {
          // 4.5: the badge's own text appears in the name, which is what makes
          // the two agree rather than merely coincide.
          expect(label).toContain(badge);
          expect(label.toLowerCase()).toContain('unread');
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('reports a count of 100 or above as the overflow text, never as a raw number', () => {
    fc.assert(
      fc.property(overflowBandArb, fc.boolean(), (count, scoped) => {
        const label = notificationIndicatorLabel(count, scoped);

        expect(label).toContain(BADGE_OVERFLOW_TEXT);
        // The exact count is deliberately not disclosed: 4.5 asks for `99+`, so
        // `2147483647 unread` would be a disagreement with the badge.
        expect(label).not.toContain(count.toString(10));
      }),
      { numRuns: 500 },
    );
  });

  it('conveys single-squad coverage in the name exactly while a squad scope is active', () => {
    fc.assert(
      fc.property(anyNumberArb, (count) => {
        const accountWide = notificationIndicatorLabel(count, false);
        const squadScoped = notificationIndicatorLabel(count, true);

        // 7.6: the badge is a number in a corner with no room to say which squad
        // the number belongs to, so the name carries it — and only when scoped.
        expect(conveysSquadCoverage(squadScoped)).toBe(true);
        expect(conveysSquadCoverage(accountWide)).toBe(false);
        expect(squadScoped).not.toBe(accountWide);
        // The count report itself is unchanged by the scope: the coverage phrase
        // is added to the same name, not a different reading of the count.
        expect(squadScoped.startsWith(accountWide)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('leaves the badge text untouched by the squad scope', () => {
    fc.assert(
      fc.property(countArb, (count) => {
        // 7.6 changes the name, never the badge — the badge derives from the
        // scoped count and knows nothing else about the scope.
        const badge = unreadBadgeText(count);

        expect(unreadBadgeText(count)).toBe(badge);
        expect(notificationIndicatorLabel(count, true)).toContain(
          badge ?? NOTIFICATIONS_SUBJECT,
        );
        expect(notificationIndicatorLabel(count, false)).toContain(
          badge ?? NOTIFICATIONS_SUBJECT,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('yields one badge outcome and one non-empty name for any number, and raises nothing', () => {
    fc.assert(
      fc.property(anyNumberArb, fc.boolean(), (count, scoped) => {
        expect(() => unreadBadgeText(count)).not.toThrow();
        expect(() => notificationIndicatorLabel(count, scoped)).not.toThrow();

        const badge = unreadBadgeText(count);

        // Exactly one of the three stated outcomes, whatever arrived: no badge
        // ever reads `-1`, `5.5`, or `NaN`.
        expect(
          badge === null ||
            badge === BADGE_OVERFLOW_TEXT ||
            /^[1-9][0-9]?$/.test(badge),
        ).toBe(true);

        const label = notificationIndicatorLabel(count, scoped);

        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toContain('NaN');
        expect(label).not.toContain('undefined');
        expect(label).not.toContain('-');
      }),
      { numRuns: 1000 },
    );
  });

  it('reads an off-domain number as the nearest sensible band', () => {
    fc.assert(
      fc.property(offDomainNumberArb, (count) => {
        const badge = unreadBadgeText(count);

        if (!Number.isFinite(count) || count < BADGE_MIN_COUNT) {
          // A non-finite value and anything below one whole unread record are no
          // count at all, so no badge — `NaN` in particular must not fall
          // through to the overflow band.
          expect(badge).toBeNull();
        } else {
          // A fraction reports the whole records it has passed: `5.5` is five.
          expect(badge).toBe(expectedBadge(Math.trunc(count)));
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic: the same count and scope always give the same badge and name', () => {
    fc.assert(
      fc.property(anyNumberArb, fc.boolean(), (count, scoped) => {
        expect(unreadBadgeText(count)).toBe(unreadBadgeText(count));
        expect(notificationIndicatorLabel(count, scoped)).toBe(
          notificationIndicatorLabel(count, scoped),
        );
      }),
      { numRuns: 500 },
    );
  });

  it('holds the stated bands and boundary counts: 0, 1, 99, 100, and 2,147,483,647', () => {
    // The constants are the contract, so they are asserted literally here — the
    // generated properties read them from the module and so could not catch a
    // wrong constant on their own.
    expect(BADGE_MIN_COUNT).toBe(1);
    expect(BADGE_MAX_EXACT_COUNT).toBe(99);
    expect(BADGE_OVERFLOW_TEXT).toBe('99+');
    expect(NOTIFICATIONS_SUBJECT).toBe('Notifications');

    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(1)).toBe('1');
    expect(unreadBadgeText(99)).toBe('99');
    expect(unreadBadgeText(100)).toBe('99+');
    expect(unreadBadgeText(MAX_COUNT)).toBe('99+');

    expect(notificationIndicatorLabel(0, false)).toBe(
      'Notifications, no unread notifications',
    );
    expect(notificationIndicatorLabel(1, false)).toBe('Notifications, 1 unread');
    expect(notificationIndicatorLabel(99, false)).toBe(
      'Notifications, 99 unread',
    );
    expect(notificationIndicatorLabel(100, false)).toBe(
      'Notifications, 99+ unread',
    );
    expect(notificationIndicatorLabel(MAX_COUNT, false)).toBe(
      'Notifications, 99+ unread',
    );

    // The same five counts while a Squad_Scope is active (Requirement 7.6).
    expect(notificationIndicatorLabel(0, true)).toBe(
      'Notifications, no unread notifications in this squad',
    );
    expect(notificationIndicatorLabel(1, true)).toBe(
      'Notifications, 1 unread in this squad',
    );
    expect(notificationIndicatorLabel(99, true)).toBe(
      'Notifications, 99 unread in this squad',
    );
    expect(notificationIndicatorLabel(100, true)).toBe(
      'Notifications, 99+ unread in this squad',
    );
    expect(notificationIndicatorLabel(MAX_COUNT, true)).toBe(
      'Notifications, 99+ unread in this squad',
    );
  });
});
