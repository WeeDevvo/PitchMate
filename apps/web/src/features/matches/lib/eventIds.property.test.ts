/**
 * Event identities are GUID version 7, which the backend's event-id policy
 * requires: for any time and random bytes the identity is well formed, says
 * version 7 with the RFC 9562 variant, carries the time it was minted at, and
 * sorts after every identity minted earlier.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { readUuid } from '../../../wire';
import { EVENT_ID_RANDOM_BYTES, eventIdFrom, eventIdTimestampMs } from './eventIds';

const MAX_TIMESTAMP_MS = 2 ** 48 - 1;
const timestamp = fc.integer({ min: 0, max: MAX_TIMESTAMP_MS });
const randomBytes = fc.uint8Array({ minLength: EVENT_ID_RANDOM_BYTES, maxLength: EVENT_ID_RANDOM_BYTES });

describe('eventIdFrom', () => {
  it('mints a well-formed version 7 identity carrying its time', () => {
    fc.assert(
      fc.property(timestamp, randomBytes, (nowMs, random) => {
        const id = eventIdFrom(nowMs, random);

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(readUuid(id, 'event id').ok).toBe(true);
        expect(eventIdTimestampMs(id)).toBe(nowMs);
      }),
    );
  });

  it('sorts an identity minted later after one minted earlier', () => {
    fc.assert(
      fc.property(timestamp, timestamp, randomBytes, randomBytes, (first, second, a, b) => {
        fc.pre(first !== second);
        const [earlier, later] = first < second ? [first, second] : [second, first];
        expect(eventIdFrom(earlier, a) < eventIdFrom(later, b)).toBe(true);
      }),
    );
  });

  it('refuses too few random bytes', () => {
    expect(() => eventIdFrom(0, new Uint8Array(EVENT_ID_RANDOM_BYTES - 1))).toThrow(RangeError);
  });
});
