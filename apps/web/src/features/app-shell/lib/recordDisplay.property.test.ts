import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  BODY_DISPLAY_MAX_LENGTH,
  NEUTRAL_NOTIFICATION_TYPE_LABEL,
  NOTIFICATION_TYPE_LABELS,
  TITLE_DISPLAY_MAX_LENGTH,
  recordDisplay,
  type RecordDisplay,
} from './recordDisplay';
import {
  CATALOGUED_NOTIFICATION_TYPES,
  type CataloguedNotificationType,
  type NotificationRecord,
  type NotificationType,
  type ReadState,
} from './notificationParsing';

/**
 * Property tests for the App_Shell's single pure Notification_Record display
 * derivation, placed beside the module they cover as Requirement 14.2 asks, and
 * run well above the 100-iteration floor.
 *
 * These carry **Property 20: Record display derives text, fallbacks, and cues
 * without error**:
 *
 *  - *truncation* — the displayed title is a prefix of the supplied title of at
 *    most 120 characters and the displayed body a prefix of at most 500, each
 *    flagged as shortened exactly when the supplied value exceeded its limit
 *    (Requirement 5.5);
 *  - *the blank-title fallback* — an empty or whitespace-only title is replaced by
 *    a label naming the record's Notification_Type, never left blank
 *    (Requirement 5.13);
 *  - *the blank-body omission* — an empty or whitespace-only body is omitted as
 *    `null` rather than rendered as an empty line (Requirement 5.13);
 *  - *an unrecognised type* — a Notification_Type outside the eight catalogued
 *    kinds takes the neutral indication and leaves the supplied title and body
 *    unchanged (Requirement 5.10);
 *  - *the eight catalogued labels* — each catalogued kind is named, distinctly,
 *    and reported as recognised (Requirements 5.10, 5.13);
 *  - *cue independence* — the derivation reads neither the creation instant nor
 *    the Read_State, which is what leaves the relative time label and the
 *    non-colour unread cue intact for a record with a blank title, a truncated
 *    body, or an unrecognised type (Requirements 5.6, 5.13);
 *  - *no error outcome* — every input, malformed values included, yields one
 *    complete display with a non-empty title and a non-empty type label and
 *    raises nothing (Requirement 5.13).
 *
 * The expectations are re-derived here from the acceptance criteria rather than
 * lifted from the module's branch structure, so a change of implementation cannot
 * silently drag the expectation along with it. The two limits are read from the
 * module so a test can never disagree with it about *where* a boundary sits —
 * their literal values, and the eight labels, are asserted once, separately, so a
 * wrong constant is still caught.
 *
 * Generators land squarely on the boundaries: titles of 119, 120, and 121
 * characters and bodies of 499, 500, and 501, plus values whose cut falls between
 * the two halves of a surrogate pair.
 *
 * The input domain is a parsed Notification_Record — a plain object of validated
 * fields — widened to absent, wrong-typed, and non-object values, which is the
 * totality the module states. It is deliberately not widened to objects whose
 * property *reads* throw: `lib/notificationParsing.ts` is what stands between the
 * wire and this function, and nothing downstream of it can present an accessor.
 *
 * Validates: Requirements 5.5, 5.6, 5.10, 5.13
 */

/** The greatest length a parser-accepted `title` and `body` can carry. */
const SUPPLIED_TITLE_MAX_LENGTH = 200;
const SUPPLIED_BODY_MAX_LENGTH = 2000;

/** Whether a UTF-16 code unit is the leading half of a surrogate pair. */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** Whether a string ends in a surrogate half with no partner — a broken glyph. */
function endsInLoneSurrogate(value: string): boolean {
  return value.length > 0 && isHighSurrogate(value.charCodeAt(value.length - 1));
}

/**
 * An independent reading of Requirement 5.13's notion of *empty or consisting
 * only of whitespace characters*.
 */
function isBlankText(value: string): boolean {
  return value.trim().length === 0;
}

/** Single UTF-16 code units that are not whitespace, so never blank on their own. */
const visibleUnitArb: fc.Arbitrary<string> = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?-_()[]{}"\'/\\@#£$%&*+=<>|~^'.split(
    '',
  ),
  'é',
  'ß',
  'ñ',
  'ø',
  'Ω',
  'д',
  '中',
  '—',
  '…',
);

/** Single code units including whitespace, for the interior of a value. */
const unitArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 9, arbitrary: visibleUnitArb },
  { weight: 1, arbitrary: fc.constantFrom(' ', '\t', '\u00a0', '\u3000') },
);

/** Code points outside the BMP, each two UTF-16 code units long. */
const astralArb: fc.Arbitrary<string> = fc.constantFrom(
  '😀',
  '🎉',
  '🐐',
  '𝒜',
  '🇬',
);

/**
 * A non-blank value of exactly `length` UTF-16 code units. The first unit is
 * always visible, so no generated value trims away to nothing.
 */
function textOfExactLength(length: number): fc.Arbitrary<string> {
  if (length <= 0) {
    return fc.constant('');
  }

  return fc
    .tuple(
      visibleUnitArb,
      fc.array(unitArb, { minLength: length - 1, maxLength: length - 1 }),
    )
    .map(([head, rest]) => head + rest.join(''));
}

/**
 * A non-blank value long enough to be cut, whose cut at `limit` would fall
 * between the two halves of a surrogate pair: `limit - 1` single units, then one
 * astral code point straddling the limit, then a little more text.
 */
function pairSplittingTextArb(limit: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      textOfExactLength(limit - 1),
      astralArb,
      fc.array(unitArb, { minLength: 0, maxLength: 6 }),
    )
    .map(([prefix, astral, tail]) => prefix + astral + tail.join(''));
}

/**
 * Lengths of a supplied title, weighted onto the 120-character boundary and the
 * ends of the parser-accepted 1..200 range.
 */
const titleLengthArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      1,
      2,
      TITLE_DISPLAY_MAX_LENGTH - 1,
      TITLE_DISPLAY_MAX_LENGTH,
      TITLE_DISPLAY_MAX_LENGTH + 1,
      TITLE_DISPLAY_MAX_LENGTH + 2,
      SUPPLIED_TITLE_MAX_LENGTH - 1,
      SUPPLIED_TITLE_MAX_LENGTH,
    ),
  },
  { weight: 2, arbitrary: fc.integer({ min: 1, max: SUPPLIED_TITLE_MAX_LENGTH }) },
);

/** The same for a supplied body, weighted onto the 500-character boundary. */
const bodyLengthArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      1,
      2,
      BODY_DISPLAY_MAX_LENGTH - 1,
      BODY_DISPLAY_MAX_LENGTH,
      BODY_DISPLAY_MAX_LENGTH + 1,
      BODY_DISPLAY_MAX_LENGTH + 2,
      SUPPLIED_BODY_MAX_LENGTH - 1,
      SUPPLIED_BODY_MAX_LENGTH,
    ),
  },
  { weight: 2, arbitrary: fc.integer({ min: 1, max: SUPPLIED_BODY_MAX_LENGTH }) },
);

/** A supplied title carrying readable text, at any accepted length. */
const suppliedTitleArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: titleLengthArb.chain(textOfExactLength) },
  { weight: 1, arbitrary: pairSplittingTextArb(TITLE_DISPLAY_MAX_LENGTH) },
);

/** A supplied body carrying readable text, at any accepted length. */
const suppliedBodyArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: bodyLengthArb.chain(textOfExactLength) },
  { weight: 1, arbitrary: pairSplittingTextArb(BODY_DISPLAY_MAX_LENGTH) },
);

/**
 * Values Requirement 5.13 calls empty or whitespace-only. `trim` is the arbiter,
 * so a non-breaking space and an ideographic space belong here alongside spaces,
 * tabs, and newlines.
 */
const blankTextArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      '   ',
      '\t',
      '\n',
      '\r\n',
      '\u00a0',
      '\u3000',
      '\u2028',
      '\u000b',
      '\f',
      '\ufeff',
      ' \t\r\n ',
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u3000', '\ufeff'), {
        minLength: 1,
        maxLength: 40,
      })
      .map((units) => units.join('')),
  },
);

/**
 * One case sitting exactly on a boundary: a title one character either side of
 * 120 or on it, and a body likewise around 500. Every value here is single code
 * units, so its length in characters is its length in code units.
 */
const boundaryCaseArb: fc.Arbitrary<{
  readonly titleOffset: number;
  readonly bodyOffset: number;
  readonly title: string;
  readonly body: string;
}> = fc
  .tuple(fc.constantFrom(-1, 0, 1), fc.constantFrom(-1, 0, 1))
  .chain(([titleOffset, bodyOffset]) =>
    fc.record({
      titleOffset: fc.constant(titleOffset),
      bodyOffset: fc.constant(bodyOffset),
      title: textOfExactLength(TITLE_DISPLAY_MAX_LENGTH + titleOffset),
      body: textOfExactLength(BODY_DISPLAY_MAX_LENGTH + bodyOffset),
    }),
  );

/** Any supplied title: readable text or blank. */
const anyTitleArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: suppliedTitleArb },
  { weight: 1, arbitrary: blankTextArb },
);

/** Any supplied body: readable text or blank. */
const anyBodyArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: suppliedBodyArb },
  { weight: 1, arbitrary: blankTextArb },
);

/** One of the eight catalogued kinds. */
const cataloguedTypeArb: fc.Arbitrary<NotificationType> = fc
  .constantFrom(...CATALOGUED_NOTIFICATION_TYPES)
  .map((value) => ({ kind: 'catalogued', value }) as NotificationType);

/**
 * A Notification_Type outside the eight catalogued kinds: an unrecognised marker
 * retaining a backend code, and — for the same reason the module checks the label
 * table rather than the tag alone — a marker tagged catalogued that names a kind
 * no label exists for.
 */
const unrecognisedTypeArb: fc.Arbitrary<NotificationType> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .oneof(
        fc.integer({ min: CATALOGUED_NOTIFICATION_TYPES.length, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: -1 }),
        fc.constantFrom(8, 9, 42, -1, 2_147_483_647),
      )
      .map((code) => ({ kind: 'unrecognised', code }) as NotificationType),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom('member_joined', 'MATCH-DRAFTED', 'squad-renamed', '')
      .map(
        (value) =>
          ({
            kind: 'catalogued',
            value: value as CataloguedNotificationType,
          }) as NotificationType,
      ),
  },
);

/** Any Notification_Type, catalogued or not. */
const anyTypeArb: fc.Arbitrary<NotificationType> = fc.oneof(
  { weight: 1, arbitrary: cataloguedTypeArb },
  { weight: 1, arbitrary: unrecognisedTypeArb },
);

const readStateArb: fc.Arbitrary<ReadState> = fc.constantFrom<ReadState>(
  'unread',
  'read',
);

/** A well-formed Notification_Record around the fields under test. */
function makeRecord(
  title: string,
  body: string,
  type: NotificationType,
  readState: ReadState = 'unread',
  createdAtMs = 1_700_000_000_000,
): NotificationRecord {
  return {
    notificationId: '1f0a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
    type,
    squadId: '0e1d2c3b-4a59-6879-8796-a5b4c3d2e1f0',
    title,
    body,
    createdAtMs,
    readState,
  };
}

/** A parser-shaped record over the whole input domain of this function. */
const recordArb: fc.Arbitrary<NotificationRecord> = fc
  .tuple(
    anyTitleArb,
    anyBodyArb,
    anyTypeArb,
    readStateArb,
    fc.integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 }),
  )
  .map(([title, body, type, readState, createdAtMs]) =>
    makeRecord(title, body, type, readState, createdAtMs),
  );

/** Applies the function to a value of any shape at all. */
function displayOf(value: unknown): RecordDisplay {
  return recordDisplay(value as NotificationRecord);
}

/**
 * Values no parsed Notification_List can contain: non-objects, records with
 * absent or wrong-typed fields, and arbitrary structures. They exist here to show
 * the derivation stays total.
 */
const malformedInputArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      undefined,
      null,
      0,
      -1,
      Number.NaN,
      '',
      'a notification',
      true,
      false,
      [],
      {},
      { title: 'A title' },
      { body: 'A body' },
      { type: 0 },
      { type: { kind: 'catalogued' } },
      { type: null },
      { title: null, body: null, type: undefined },
      { title: 42, body: [], type: 'member-joined' },
      { title: { text: 'nested' }, body: { text: 'nested' } },
    ),
  },
  {
    weight: 2,
    arbitrary: fc.record(
      {
        title: fc.oneof(anyTitleArb, fc.constant(undefined), fc.constant(null), fc.integer()),
        body: fc.oneof(anyBodyArb, fc.constant(undefined), fc.constant(null), fc.integer()),
        type: fc.oneof(
          anyTypeArb,
          fc.constant(undefined),
          fc.constant(null),
          fc.integer(),
          fc.string(),
        ),
      },
      { requiredKeys: [] },
    ),
  },
  {
    weight: 2,
    arbitrary: fc.anything({
      withBigInt: true,
      withBoxedValues: true,
      withDate: true,
      withMap: true,
      withNullPrototype: true,
      withObjectString: true,
      withSet: true,
      withTypedArray: true,
    }),
  },
);

/** The label Requirement 5.13 names for a supplied type value, derived here. */
function expectedTypeLabel(type: NotificationType): string {
  if (
    typeof type === 'object' &&
    type !== null &&
    type.kind === 'catalogued' &&
    (CATALOGUED_NOTIFICATION_TYPES as readonly string[]).includes(type.value)
  ) {
    return NOTIFICATION_TYPE_LABELS[type.value];
  }

  return NEUTRAL_NOTIFICATION_TYPE_LABEL;
}

/**
 * Asserts Requirement 5.5's truncation contract for one value: the displayed text
 * is a prefix of the supplied text, is within the limit, and is flagged as
 * shortened exactly when the supplied text exceeded the limit.
 */
function expectTruncationOf(
  supplied: string,
  displayed: string,
  truncated: boolean,
  limit: number,
): void {
  expect(supplied.startsWith(displayed)).toBe(true);
  expect(displayed.length).toBeLessThanOrEqual(limit);
  expect(truncated).toBe(supplied.length > limit);

  if (!truncated) {
    // Nothing was over the limit, so nothing may be dropped.
    expect(displayed).toBe(supplied);
    return;
  }

  // As much as the limit allows is shown: the full limit, or one unit less where
  // the cut would have left half of a surrogate pair behind.
  expect(
    displayed.length === limit ||
      (displayed.length === limit - 1 && isHighSurrogate(supplied.charCodeAt(limit - 1))),
  ).toBe(true);
  expect(endsInLoneSurrogate(displayed)).toBe(false);
}

describe('Property 20: record display derives text, fallbacks, and cues without error', () => {
  it('displays a title within 120 characters, as a prefix, flagged exactly when shortened', () => {
    fc.assert(
      fc.property(suppliedTitleArb, anyBodyArb, anyTypeArb, (title, body, type) => {
        const display = displayOf(makeRecord(title, body, type));

        // 5.5: at most 120 characters of the supplied title, with the visible
        // indication driven by the flag beside it.
        expectTruncationOf(
          title,
          display.title,
          display.titleTruncated,
          TITLE_DISPLAY_MAX_LENGTH,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('displays a body within 500 characters, as a prefix, flagged exactly when shortened', () => {
    fc.assert(
      fc.property(anyTitleArb, suppliedBodyArb, anyTypeArb, (title, body, type) => {
        const display = displayOf(makeRecord(title, body, type));

        expect(display.body).not.toBeNull();
        expectTruncationOf(
          body,
          display.body as string,
          display.bodyTruncated,
          BODY_DISPLAY_MAX_LENGTH,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('keeps a title of 120 characters or fewer and a body of 500 or fewer whole', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: TITLE_DISPLAY_MAX_LENGTH }).chain(textOfExactLength),
        fc.integer({ min: 1, max: BODY_DISPLAY_MAX_LENGTH }).chain(textOfExactLength),
        anyTypeArb,
        (title, body, type) => {
          const display = displayOf(makeRecord(title, body, type));

          // 5.5 truncates *to at most* the limit; a value inside it is untouched
          // and carries no truncation indication.
          expect(display.title).toBe(title);
          expect(display.titleTruncated).toBe(false);
          expect(display.body).toBe(body);
          expect(display.bodyTruncated).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('shortens a title beyond 120 characters and a body beyond 500', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: TITLE_DISPLAY_MAX_LENGTH + 1, max: SUPPLIED_TITLE_MAX_LENGTH })
          .chain(textOfExactLength),
        fc
          .integer({ min: BODY_DISPLAY_MAX_LENGTH + 1, max: SUPPLIED_BODY_MAX_LENGTH })
          .chain(textOfExactLength),
        anyTypeArb,
        (title, body, type) => {
          const display = displayOf(makeRecord(title, body, type));

          expect(display.titleTruncated).toBe(true);
          expect(display.bodyTruncated).toBe(true);
          expect(display.title.length).toBeLessThan(title.length);
          expect((display.body as string).length).toBeLessThan(body.length);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('holds the truncation flags across the 119/120/121 and 499/500/501 boundaries', () => {
    fc.assert(
      fc.property(boundaryCaseArb, anyTypeArb, (boundaryCase, type) => {
        const { titleOffset, bodyOffset, title, body } = boundaryCase;
        const display = displayOf(makeRecord(title, body, type));

        // Only the value *above* its limit is shortened: 120 characters is
        // inside the bound, 121 is not.
        expect(display.titleTruncated).toBe(titleOffset > 0);
        expect(display.bodyTruncated).toBe(bodyOffset > 0);
        expect(display.title.length).toBe(
          titleOffset > 0 ? TITLE_DISPLAY_MAX_LENGTH : title.length,
        );
        expect((display.body as string).length).toBe(
          bodyOffset > 0 ? BODY_DISPLAY_MAX_LENGTH : body.length,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('never displays half of a surrogate pair at either cut', () => {
    fc.assert(
      fc.property(
        pairSplittingTextArb(TITLE_DISPLAY_MAX_LENGTH),
        pairSplittingTextArb(BODY_DISPLAY_MAX_LENGTH),
        anyTypeArb,
        (title, body, type) => {
          const display = displayOf(makeRecord(title, body, type));

          expect(display.titleTruncated).toBe(true);
          expect(display.bodyTruncated).toBe(true);
          expect(endsInLoneSurrogate(display.title)).toBe(false);
          expect(endsInLoneSurrogate(display.body as string)).toBe(false);
          expect(title.startsWith(display.title)).toBe(true);
          expect(body.startsWith(display.body as string)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('replaces an empty or whitespace-only title with a label naming the type', () => {
    fc.assert(
      fc.property(blankTextArb, anyBodyArb, anyTypeArb, (title, body, type) => {
        const display = displayOf(makeRecord(title, body, type));

        // 5.13: a row is never an unreadable blank strip, and the stand-in names
        // the record's Notification_Type rather than reporting an error.
        expect(display.title).toBe(expectedTypeLabel(type));
        expect(display.title).toBe(display.typeLabel);
        expect(display.title.trim().length).toBeGreaterThan(0);
        // Nothing of the supplied title was shortened, so no truncation
        // indication is claimed.
        expect(display.titleTruncated).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it('omits an empty or whitespace-only body', () => {
    fc.assert(
      fc.property(anyTitleArb, blankTextArb, anyTypeArb, (title, body, type) => {
        const display = displayOf(makeRecord(title, body, type));

        // 5.13: one unambiguous representation of *render no body*.
        expect(display.body).toBeNull();
        expect(display.bodyTruncated).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it('keeps a title and a body that carry readable text', () => {
    fc.assert(
      fc.property(suppliedTitleArb, suppliedBodyArb, anyTypeArb, (title, body, type) => {
        const display = displayOf(makeRecord(title, body, type));

        // The fallbacks apply to blank values only: readable text is never
        // swapped for a label or dropped.
        expect(isBlankText(title)).toBe(false);
        expect(display.title).not.toBe(display.typeLabel);
        expect(display.body).not.toBeNull();
        expect((display.body as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it('names each of the eight catalogued types and reports it as recognised', () => {
    fc.assert(
      fc.property(cataloguedTypeArb, suppliedTitleArb, anyBodyArb, (type, title, body) => {
        const display = displayOf(makeRecord(title, body, type));
        const value = (type as { readonly value: CataloguedNotificationType }).value;

        // 5.10 speaks of the eight catalogued types as the recognised set, and
        // 5.13 asks for a label naming the type.
        expect(display.typeIsRecognised).toBe(true);
        expect(display.typeLabel).toBe(NOTIFICATION_TYPE_LABELS[value]);
        expect(display.typeLabel.trim().length).toBeGreaterThan(0);
        expect(display.typeLabel).not.toBe(NEUTRAL_NOTIFICATION_TYPE_LABEL);
      }),
      { numRuns: 500 },
    );
  });

  it('gives an unrecognised type the neutral indication with title and body unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: TITLE_DISPLAY_MAX_LENGTH }).chain(textOfExactLength),
        fc.integer({ min: 1, max: BODY_DISPLAY_MAX_LENGTH }).chain(textOfExactLength),
        unrecognisedTypeArb,
        (title, body, type) => {
          const display = displayOf(makeRecord(title, body, type));

          // 5.10: a future backend notification type is displayed rather than
          // discarded, and the neutral label discloses no integer code.
          expect(display.typeIsRecognised).toBe(false);
          expect(display.typeLabel).toBe(NEUTRAL_NOTIFICATION_TYPE_LABEL);
          expect(display.title).toBe(title);
          expect(display.body).toBe(body);
          expect(display.titleTruncated).toBe(false);
          expect(display.bodyTruncated).toBe(false);
          expect(display.typeLabel).not.toMatch(/[0-9]/);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('derives the same title and body whatever the type, recognised or not', () => {
    fc.assert(
      fc.property(
        suppliedTitleArb,
        anyBodyArb,
        cataloguedTypeArb,
        unrecognisedTypeArb,
        (title, body, catalogued, unrecognised) => {
          const known = displayOf(makeRecord(title, body, catalogued));
          const unknown = displayOf(makeRecord(title, body, unrecognised));

          // 5.10: only the type indication differs — the text is untouched by
          // the app not knowing the kind.
          expect(unknown.title).toBe(known.title);
          expect(unknown.titleTruncated).toBe(known.titleTruncated);
          expect(unknown.body).toBe(known.body);
          expect(unknown.bodyTruncated).toBe(known.bodyTruncated);
          expect(unknown.typeLabel).not.toBe(known.typeLabel);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('leaves the time label and the unread cue untouched by any text outcome', () => {
    fc.assert(
      fc.property(
        anyTitleArb,
        anyBodyArb,
        anyTypeArb,
        fc.integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 }),
        fc.integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 }),
        (title, body, type, firstInstant, secondInstant) => {
          const unread = displayOf(makeRecord(title, body, type, 'unread', firstInstant));
          const read = displayOf(makeRecord(title, body, type, 'read', secondInstant));

          // 5.6 and 5.13: the row renders the relative time label from the
          // creation instant and the non-colour unread cue from the Read_State,
          // and this derivation consumes neither — so a blank title, a truncated
          // body, and an unrecognised type all still carry both.
          expect(unread).toStrictEqual(read);
          expect(Object.keys(unread).sort()).toStrictEqual([
            'body',
            'bodyTruncated',
            'title',
            'titleTruncated',
            'typeIsRecognised',
            'typeLabel',
          ]);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('yields one complete display for any record, and raises nothing', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        expect(() => recordDisplay(record)).not.toThrow();

        const display = recordDisplay(record);

        // 5.13: no input produces an error indication, because there is no
        // failure outcome here to indicate.
        expect(typeof display.title).toBe('string');
        expect(display.title.length).toBeGreaterThan(0);
        expect(display.title.length).toBeLessThanOrEqual(TITLE_DISPLAY_MAX_LENGTH);
        expect(display.body === null || typeof display.body === 'string').toBe(true);
        expect(display.body?.length ?? 1).toBeGreaterThan(0);
        expect(display.body?.length ?? 0).toBeLessThanOrEqual(BODY_DISPLAY_MAX_LENGTH);
        expect(typeof display.titleTruncated).toBe('boolean');
        expect(typeof display.bodyTruncated).toBe('boolean');
        expect(typeof display.typeLabel).toBe('string');
        expect(display.typeLabel.length).toBeGreaterThan(0);
        expect(typeof display.typeIsRecognised).toBe('boolean');
      }),
      { numRuns: 1000 },
    );
  });

  it('yields one complete display for a malformed value too, and raises nothing', () => {
    fc.assert(
      fc.property(malformedInputArb, (value) => {
        expect(() => displayOf(value)).not.toThrow();

        const display = displayOf(value);

        // A value that is not a Notification_Record reads as a blank title, an
        // omitted body, and the neutral label — never as an error and never as a
        // rendered `undefined`.
        expect(typeof display.title).toBe('string');
        expect(display.title.trim().length).toBeGreaterThan(0);
        expect(display.title.length).toBeLessThanOrEqual(TITLE_DISPLAY_MAX_LENGTH);
        expect(display.body === null || (display.body as string).length > 0).toBe(true);
        expect(display.typeLabel.trim().length).toBeGreaterThan(0);
        expect(typeof display.typeIsRecognised).toBe('boolean');
      }),
      { numRuns: 1000 },
    );
  });

  it('falls back for a record whose fields are absent or wrong-typed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(
          undefined,
          null,
          0,
          'text',
          true,
          [],
          {},
          { title: 7, body: 7, type: 7 },
          { title: null, body: null, type: null },
        ),
        (value) => {
          const display = displayOf(value);

          // No readable title and no readable body, so both fallbacks apply, and
          // an uninterpretable type takes the neutral label.
          expect(display.title).toBe(NEUTRAL_NOTIFICATION_TYPE_LABEL);
          expect(display.titleTruncated).toBe(false);
          expect(display.body).toBeNull();
          expect(display.bodyTruncated).toBe(false);
          expect(display.typeLabel).toBe(NEUTRAL_NOTIFICATION_TYPE_LABEL);
          expect(display.typeIsRecognised).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is deterministic: the same record always gives the same display', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        expect(recordDisplay(record)).toStrictEqual(recordDisplay(record));
      }),
      { numRuns: 500 },
    );
  });

  it('holds the stated limits, the eight labels, and the boundary lengths', () => {
    // The constants are the contract, so they are asserted literally here — the
    // generated properties read them from the module and so could not catch a
    // wrong constant on their own.
    expect(TITLE_DISPLAY_MAX_LENGTH).toBe(120);
    expect(BODY_DISPLAY_MAX_LENGTH).toBe(500);
    expect(NEUTRAL_NOTIFICATION_TYPE_LABEL).toBe('Notification');
    expect(NOTIFICATION_TYPE_LABELS).toStrictEqual({
      'member-joined': 'Member joined',
      'promoted-to-admin': 'Promoted to admin',
      'removed-from-squad': 'Removed from squad',
      'ownership-transferred': 'Ownership transferred',
      'match-drafted': 'Match drafted',
      'match-confirmed': 'Match confirmed',
      'teams-rolled': 'Teams rolled',
      'result-posted': 'Result posted',
    });

    // A label exists for each of the eight catalogued kinds, and no two kinds
    // share one, so the fallback title identifies the kind it stands in for.
    const labels = CATALOGUED_NOTIFICATION_TYPES.map(
      (value) => NOTIFICATION_TYPE_LABELS[value],
    );

    expect(labels).toHaveLength(8);
    expect(new Set(labels).size).toBe(8);
    expect(labels).not.toContain(NEUTRAL_NOTIFICATION_TYPE_LABEL);

    const catalogued: NotificationType = { kind: 'catalogued', value: 'match-drafted' };

    // The two boundaries, stated outright: 120 and 121, 500 and 501.
    const title120 = 'a'.repeat(120);
    const title121 = 'a'.repeat(121);
    const body500 = 'b'.repeat(500);
    const body501 = 'b'.repeat(501);

    expect(displayOf(makeRecord(title120, body500, catalogued))).toStrictEqual({
      title: title120,
      titleTruncated: false,
      body: body500,
      bodyTruncated: false,
      typeLabel: 'Match drafted',
      typeIsRecognised: true,
    });
    expect(displayOf(makeRecord(title121, body501, catalogued))).toStrictEqual({
      title: title120,
      titleTruncated: true,
      body: body500,
      bodyTruncated: true,
      typeLabel: 'Match drafted',
      typeIsRecognised: true,
    });

    // A blank title takes the label; a blank body is omitted.
    expect(displayOf(makeRecord('   ', '\t\n', catalogued))).toStrictEqual({
      title: 'Match drafted',
      titleTruncated: false,
      body: null,
      bodyTruncated: false,
      typeLabel: 'Match drafted',
      typeIsRecognised: true,
    });

    // An unrecognised code keeps the text and takes the neutral label.
    expect(
      displayOf(makeRecord('Squad renamed', 'The squad has a new name.', {
        kind: 'unrecognised',
        code: 99,
      })),
    ).toStrictEqual({
      title: 'Squad renamed',
      titleTruncated: false,
      body: 'The squad has a new name.',
      bodyTruncated: false,
      typeLabel: 'Notification',
      typeIsRecognised: false,
    });
  });
});
