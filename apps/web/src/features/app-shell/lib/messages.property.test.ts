import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import * as messages from './messages';
import {
  APPEARANCE_GROUP_LABEL,
  APPEARANCE_OPTION_LABELS,
  GENERIC_NOTIFICATION_FAILURE,
  MARK_ALL_READ_IN_PROGRESS,
  MARK_ALL_READ_LABEL,
  SIGN_OUT_LABEL,
} from './messages';
import { APPEARANCE_PREFERENCES, type AppearancePreference } from './theme';

/**
 * Property tests for the App_Shell's fixed user-facing strings, placed beside
 * the module they cover as Requirement 14.2 asks and run above the
 * 100-iteration floor.
 *
 * `lib/messages.ts` is a table of constants, so its interesting rules are not
 * about a computation but about what the table may and may not contain — and
 * those rules are universals over generated data rather than examples:
 *
 *  - *the Generic_Notification_Failure message discloses nothing* — it is the
 *    same string for every failing notification call, so whatever the status,
 *    the squad identity, or the notification identity behind a failure, the
 *    message contains none of them. That is what makes a squad-scoped
 *    not-found indistinguishable from a transport failure, which is the whole
 *    point of Requirements 7.7 and 11.10;
 *  - *every appearance option is labelled* — the option group covers each of the
 *    three stored Appearance_Preference values with a distinct visible label of
 *    1 to 24 characters, so no stored value can reach the control without a
 *    label and no two options can read alike (Requirement 12.4);
 *  - *every message is presentable* — each exported string is non-empty and
 *    carries no leading or trailing whitespace, so nothing renders blank or with
 *    stray padding.
 *
 * The generators are what makes the first property meaningful: the disclosing
 * values are *generated* — statuses across the whole 100 to 599 range, squad and
 * notification identities in both letter cases, response-body-shaped fragments —
 * so a message that ever interpolated one of them would be caught rather than
 * relied upon to be spotted in review.
 *
 * Validates: Requirements 7.7, 11.10, 12.4, 14.2
 */

/** The exported strings, read from the module rather than restated. */
const EXPORTED_STRINGS: ReadonlyArray<readonly [string, string]> = Object.entries(
  messages,
).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

/** Every visible label the requirements bound to 1 to 24 characters. */
const BOUNDED_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['SIGN_OUT_LABEL', SIGN_OUT_LABEL],
  ['ACCOUNT_MENU_LABEL', messages.ACCOUNT_MENU_LABEL],
  ['MARK_ALL_READ_LABEL', MARK_ALL_READ_LABEL],
  ['APPEARANCE_GROUP_LABEL', APPEARANCE_GROUP_LABEL],
  ...APPEARANCE_PREFERENCES.map(
    (preference) =>
      [`APPEARANCE_OPTION_LABELS.${preference}`, APPEARANCE_OPTION_LABELS[preference]] as const,
  ),
];

/** A hyphenated 36-character identity, in either letter case. */
const identityArb: fc.Arbitrary<string> = fc
  .uuid()
  .chain((identity) =>
    fc.constantFrom(identity, identity.toUpperCase(), identity.toLowerCase()),
  );

/** Every response status the outcome mapping covers (Requirement 11.6). */
const statusArb: fc.Arbitrary<number> = fc.integer({ min: 100, max: 599 });

/** The exported strings as a generator, so the table's growth is covered too. */
const exportedStringArb: fc.Arbitrary<readonly [string, string]> = fc.constantFrom(
  ...EXPORTED_STRINGS,
);

/** The three stored Appearance_Preference values (Requirement 12.4). */
const preferenceArb: fc.Arbitrary<AppearancePreference> = fc.constantFrom(
  ...APPEARANCE_PREFERENCES,
);

describe('the Generic_Notification_Failure message discloses nothing about the failure', () => {
  it('contains no response status, for any status from 100 to 599', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        // 7.7, 11.10: every failing notification call is presented identically,
        // so the message can carry no status code — not even for the statuses
        // that would be harmless on their own.
        expect(GENERIC_NOTIFICATION_FAILURE).not.toContain(status.toString(10));
        // Nor a digit of any kind, so no count, no status, and no minute can have
        // been interpolated into it.
        expect(/\d/.test(GENERIC_NOTIFICATION_FAILURE)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('contains no squad identity and no notification identity, in either letter case', () => {
    fc.assert(
      fc.property(identityArb, identityArb, (squadIdentity, notificationIdentity) => {
        expect(GENERIC_NOTIFICATION_FAILURE).not.toContain(squadIdentity);
        expect(GENERIC_NOTIFICATION_FAILURE).not.toContain(notificationIdentity);
        // Nor any fragment long enough to identify one: a leaked prefix would
        // disclose as much as the whole identity (Requirement 7.7).
        expect(GENERIC_NOTIFICATION_FAILURE).not.toContain(squadIdentity.slice(0, 8));
      }),
      { numRuns: 300 },
    );
  });

  it('carries no digit and no wire property name at all', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'id',
          'squadId',
          'title',
          'body',
          'createdAt',
          'readState',
          'type',
          'status',
          'notFound',
          '404',
          '401',
          '500',
        ),
        (wireName) => {
          // The message names nothing the response carried, so a squad that
          // exists and one that does not read the same (Requirements 7.7, 11.10).
          expect(GENERIC_NOTIFICATION_FAILURE.toLowerCase()).not.toContain(
            wireName.toLowerCase(),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is one fixed non-empty sentence', () => {
    expect(GENERIC_NOTIFICATION_FAILURE.length).toBeGreaterThan(0);
    expect(GENERIC_NOTIFICATION_FAILURE.trim()).toBe(GENERIC_NOTIFICATION_FAILURE);
  });
});

describe('the Appearance_Preference option group labels every stored value', () => {
  it('labels each of the three stored values with 1 to 24 trimmed characters', () => {
    fc.assert(
      fc.property(preferenceArb, (preference) => {
        const label = APPEARANCE_OPTION_LABELS[preference];

        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThanOrEqual(1);
        expect(label.length).toBeLessThanOrEqual(24);
        expect(label.trim()).toBe(label);
      }),
      { numRuns: 200 },
    );
  });

  it('never labels two distinct stored values alike', () => {
    fc.assert(
      fc.property(preferenceArb, preferenceArb, (first, second) => {
        if (first === second) {
          expect(APPEARANCE_OPTION_LABELS[second]).toBe(APPEARANCE_OPTION_LABELS[first]);
          return;
        }

        // 12.4: the selected option must be understandable from its label, which
        // two options reading alike would prevent.
        expect(APPEARANCE_OPTION_LABELS[second]).not.toBe(
          APPEARANCE_OPTION_LABELS[first],
        );
      }),
      { numRuns: 300 },
    );
  });

  it('carries a label for every value in the appearance table and no other key', () => {
    fc.assert(
      fc.property(preferenceArb, (preference) => {
        expect(Object.keys(APPEARANCE_OPTION_LABELS).sort()).toEqual(
          [...APPEARANCE_PREFERENCES].sort(),
        );
        expect(APPEARANCE_OPTION_LABELS[preference]).not.toBe(APPEARANCE_GROUP_LABEL);
      }),
      { numRuns: 100 },
    );
  });
});

describe('every fixed message is presentable', () => {
  it('is non-empty and free of leading and trailing whitespace', () => {
    fc.assert(
      fc.property(exportedStringArb, ([name, value]) => {
        expect(value.length, `${name} is empty`).toBeGreaterThan(0);
        expect(value.trim(), `${name} carries stray whitespace`).toBe(value);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps every bounded visible label within 1 to 24 characters', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BOUNDED_LABELS), ([name, value]) => {
        expect(value.length, `${name} is empty`).toBeGreaterThanOrEqual(1);
        expect(value.length, `${name} exceeds 24 characters`).toBeLessThanOrEqual(24);
      }),
      { numRuns: 200 },
    );
  });

  it('never reuses one string for two different outcomes', () => {
    fc.assert(
      fc.property(exportedStringArb, exportedStringArb, ([firstName, first], [secondName, second]) => {
        if (firstName === secondName) {
          expect(second).toBe(first);
          return;
        }

        // Two distinct user-facing outcomes reading identically would make them
        // indistinguishable — the in-progress indications especially, which
        // replace or sit beside the labels they belong to (Requirements 6.8, 8.10).
        expect(second, `${firstName} and ${secondName} are the same string`).not.toBe(
          first,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('distinguishes an in-progress indication from the label it accompanies', () => {
    // Stated as examples because there are exactly three such pairs: the
    // property above covers the general rule, these name the pairs that matter
    // (Requirements 6.8, 8.10, and the two header disclosure names in 1.6, 8.1).
    expect(MARK_ALL_READ_IN_PROGRESS).not.toBe(MARK_ALL_READ_LABEL);
    expect(messages.SIGN_OUT_IN_PROGRESS).not.toBe(SIGN_OUT_LABEL);
    expect(messages.PRIMARY_NAVIGATION_TOGGLE).not.toBe(messages.ACCOUNT_MENU_LABEL);
  });
});
