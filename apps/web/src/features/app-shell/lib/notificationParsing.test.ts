/**
 * Example-based tests for the App_Shell's notification list parser and printer.
 *
 * These pin the specific boundaries Requirement 10 names — the top-level shapes
 * that are a parse-failure, the seven properties and their accepted forms, the
 * `type` and `readState` code maps, the 200-element parse cap, and the printer's
 * wire form. The universal properties (totality, candidate acceptance, and the
 * print/parse round trip) are covered by the `fast-check` properties in
 * `notificationParsing.property.test.ts`.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10, 10.11, 10.12
 */

import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_LIST_PARSE_CAP,
  notificationTypeCode,
  notificationTypeFromCode,
  parseNotificationList,
  printNotificationRecord,
  type NotificationRecord,
} from './notificationParsing';

const NOTIFICATION_ID = '0195f1a2-3b4c-7d8e-9f01-23456789abcd';
const SQUAD_ID = 'ABCDEF01-2345-6789-ABCD-EF0123456789';

/** A wire candidate carrying every property in its accepted form (10.2). */
function wireRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    notificationId: NOTIFICATION_ID,
    type: 4,
    squadId: SQUAD_ID,
    title: 'Match drafted',
    body: 'Tell the squad which days you can make.',
    createdAt: '2026-03-01T18:30:00Z',
    readState: 0,
    ...overrides,
  };
}

/** The single record of a parsed outcome, failing the test if there isn't one. */
function onlyRecord(body: unknown): NotificationRecord {
  const parse = parseNotificationList(body);

  expect(parse.kind).toBe('parsed');

  if (parse.kind !== 'parsed') {
    throw new Error('unreachable');
  }

  expect(parse.records).toHaveLength(1);

  return parse.records[0];
}

describe('parseNotificationList top-level shape', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['an object', { records: [] }],
    ['a string', '[]'],
    ['a number', 0],
    ['a boolean', true],
  ])('yields a parse-failure for %s (10.10)', (_name, body) => {
    expect(parseNotificationList(body)).toEqual({ kind: 'parse-failure' });
  });

  it('yields a parsed outcome carrying no record for an empty array (10.11)', () => {
    expect(parseNotificationList([])).toEqual({ kind: 'parsed', records: [] });
  });

  it('raises nothing for a value nested a hundred levels deep (10.12)', () => {
    let nested: unknown = 'leaf';

    for (let depth = 0; depth < 100; depth += 1) {
      nested = { nested };
    }

    expect(parseNotificationList(nested)).toEqual({ kind: 'parse-failure' });
    expect(parseNotificationList([nested])).toEqual({ kind: 'parsed', records: [] });
  });

  it('costs only the candidate whose property read raises (10.12)', () => {
    const hostile = {
      get title(): string {
        throw new Error('hostile');
      },
    };

    const parse = parseNotificationList([hostile, wireRecord()]);

    expect(parse).toMatchObject({ kind: 'parsed' });
    expect(parse.kind === 'parsed' && parse.records).toHaveLength(1);
  });
});

describe('parseNotificationList candidate acceptance', () => {
  it('parses a well-formed candidate into a Notification_Record (10.2)', () => {
    expect(onlyRecord([wireRecord()])).toEqual({
      notificationId: NOTIFICATION_ID,
      type: { kind: 'catalogued', value: 'match-drafted' },
      squadId: SQUAD_ID,
      title: 'Match drafted',
      body: 'Tell the squad which days you can make.',
      createdAtMs: Date.UTC(2026, 2, 1, 18, 30, 0, 0),
      readState: 'unread',
    });
  });

  it('retains title and body untruncated at their accepted maxima (10.2)', () => {
    const title = 'T'.repeat(200);
    const body = 'B'.repeat(2000);
    const record = onlyRecord([wireRecord({ title, body })]);

    expect(record.title).toBe(title);
    expect(record.body).toBe(body);
  });

  it('accepts an empty body and an identity in either letter case (10.2)', () => {
    const record = onlyRecord([
      wireRecord({ body: '', notificationId: NOTIFICATION_ID.toUpperCase() }),
    ]);

    expect(record.body).toBe('');
    expect(record.notificationId).toBe(NOTIFICATION_ID.toUpperCase());
  });

  it.each([
    ['not an object', 7],
    ['an array', []],
    ['null', null],
    ['a candidate omitting a property', { ...wireRecord(), title: undefined }],
    ['a candidate supplying null for a property', wireRecord({ body: null })],
    ['a title of 0 characters', wireRecord({ title: '' })],
    ['a title of 201 characters', wireRecord({ title: 'T'.repeat(201) })],
    ['a body of 2001 characters', wireRecord({ body: 'B'.repeat(2001) })],
    ['an identity not in the accepted form', wireRecord({ squadId: 'not-an-identity' })],
    ['an identity with a non-hexadecimal digit', wireRecord({ squadId: SQUAD_ID.replace('A', 'Z') })],
    ['a createdAt with no UTC designator', wireRecord({ createdAt: '2026-03-01T18:30:00' })],
    ['a createdAt that is not a date-time', wireRecord({ createdAt: 'yesterday' })],
    ['a createdAt naming an impossible day', wireRecord({ createdAt: '2026-02-30T00:00:00Z' })],
    ['a createdAt supplied as epoch milliseconds', wireRecord({ createdAt: 1_772_390_000_000 })],
    ['a fractional type code', wireRecord({ type: 1.5 })],
    ['a string-encoded type code', wireRecord({ type: '4' })],
    ['a fractional readState code', wireRecord({ readState: 0.5 })],
    ['a negative readState code', wireRecord({ readState: -1 })],
    ['a string-encoded readState code', wireRecord({ readState: '1' })],
  ])('drops %s (10.3, 10.4, 10.5)', (_name, candidate) => {
    expect(parseNotificationList([candidate])).toEqual({ kind: 'parsed', records: [] });
  });

  it('keeps the valid candidates of a mixed response in their supplied order (10.3)', () => {
    const first = wireRecord({ title: 'first' });
    const second = wireRecord({ title: 'second' });
    const parse = parseNotificationList([first, { title: 'invalid' }, second, null]);

    expect(parse.kind === 'parsed' && parse.records.map((record) => record.title)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('parseNotificationList createdAt offsets', () => {
  it.each([
    ['a lowercase UTC designator', '2026-03-01T18:30:00z', Date.UTC(2026, 2, 1, 18, 30)],
    ['a positive offset', '2026-03-01T19:30:00+01:00', Date.UTC(2026, 2, 1, 18, 30)],
    ['a negative offset', '2026-03-01T13:30:00-05:00', Date.UTC(2026, 2, 1, 18, 30)],
    ['a basic-form offset', '2026-03-01T19:30:00+0100', Date.UTC(2026, 2, 1, 18, 30)],
    ['an hour-only offset', '2026-03-01T19:30:00+01', Date.UTC(2026, 2, 1, 18, 30)],
    ['no seconds field', '2026-03-01T18:30Z', Date.UTC(2026, 2, 1, 18, 30)],
    ['a fractional part', '2026-03-01T18:30:00.250Z', Date.UTC(2026, 2, 1, 18, 30, 0, 250)],
    ['a fractional part beyond milliseconds', '2026-03-01T18:30:00.2509Z', Date.UTC(2026, 2, 1, 18, 30, 0, 250)],
  ])('reads %s as the intended instant (10.2)', (_name, createdAt, expected) => {
    expect(onlyRecord([wireRecord({ createdAt })]).createdAtMs).toBe(expected);
  });
});

describe('notification type codes', () => {
  it.each([
    [0, 'member-joined'],
    [1, 'promoted-to-admin'],
    [2, 'removed-from-squad'],
    [3, 'ownership-transferred'],
    [4, 'match-drafted'],
    [5, 'match-confirmed'],
    [6, 'teams-rolled'],
    [7, 'result-posted'],
  ])('maps code %i to the catalogued type (10.5)', (code, value) => {
    expect(notificationTypeFromCode(code)).toEqual({ kind: 'catalogued', value });
    expect(notificationTypeCode({ kind: 'catalogued', value: value as never })).toBe(code);
  });

  it.each([8, 42, -1])('retains the integer code %i as unrecognised (10.6)', (code) => {
    expect(notificationTypeFromCode(code)).toEqual({ kind: 'unrecognised', code });
    expect(notificationTypeCode({ kind: 'unrecognised', code })).toBe(code);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, '4', null, undefined, {}])(
    'treats %o as a type that cannot be interpreted (10.5)',
    (code) => {
      expect(notificationTypeFromCode(code)).toBeNull();
    },
  );

  it('keeps an unrecognised record in the list with its code (10.6)', () => {
    const record = onlyRecord([wireRecord({ type: 12 })]);

    expect(record.type).toEqual({ kind: 'unrecognised', code: 12 });
  });
});

describe('the Notification_List parse cap', () => {
  it('parses only the first 200 elements and discards the rest (10.11)', () => {
    expect(NOTIFICATION_LIST_PARSE_CAP).toBe(200);

    const body = Array.from({ length: 250 }, (_element, index) =>
      wireRecord({ title: `notification ${index}` }),
    );
    const parse = parseNotificationList(body);

    expect(parse.kind).toBe('parsed');
    expect(parse.kind === 'parsed' && parse.records).toHaveLength(200);
    expect(parse.kind === 'parsed' && parse.records[199].title).toBe('notification 199');
  });

  it('does not let an element beyond the cap turn the outcome into a failure (10.11)', () => {
    const body: unknown[] = Array.from({ length: 200 }, () => wireRecord());
    body.push('not a record');

    expect(parseNotificationList(body)).toMatchObject({ kind: 'parsed' });
  });
});

describe('printNotificationRecord', () => {
  it('emits exactly the seven wire properties with a UTC designator (10.7)', () => {
    const record = onlyRecord([wireRecord({ readState: 1 })]);

    expect(printNotificationRecord(record)).toEqual({
      notificationId: NOTIFICATION_ID,
      type: 4,
      squadId: SQUAD_ID,
      title: 'Match drafted',
      body: 'Tell the squad which days you can make.',
      createdAt: '2026-03-01T18:30:00.000Z',
      readState: 1,
    });
  });

  it('emits the code retained by an unrecognised type marker (10.7)', () => {
    const record = onlyRecord([wireRecord({ type: 12 })]);

    expect(printNotificationRecord(record)).toMatchObject({ type: 12 });
  });

  it('round-trips a record through printing and parsing (10.8)', () => {
    const record = onlyRecord([
      wireRecord({ type: 99, readState: 1, body: '', createdAt: '2026-03-01T13:30:00-05:00' }),
    ]);

    expect(onlyRecord([printNotificationRecord(record)])).toEqual(record);
  });

  it('raises nothing for a value that is not a Notification_Record (10.12)', () => {
    expect(() => printNotificationRecord(undefined as never)).not.toThrow();
    expect(parseNotificationList([printNotificationRecord(null as never)])).toEqual({
      kind: 'parsed',
      records: [],
    });
  });
});
