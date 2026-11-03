/**
 * Identities for live-tracking events, minted on the device.
 *
 * The backend dedupes every event on its identity and accepts only a GUID
 * version 7, so a retried batch never records a goal twice. A v7 identity is
 * the Unix time in milliseconds in its first 48 bits, then the version, then
 * random bits with the RFC 9562 variant, so identities minted later sort later.
 *
 * Pure: the caller supplies the clock and the random bytes.
 */

/** How many random bytes one identity takes. */
export const EVENT_ID_RANDOM_BYTES = 10;

const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * The version 7 identity for `nowMs` and the given random bytes, in the
 * lower-case hyphenated form the wire uses. A time outside the 48-bit range is
 * clamped into it; only the first {@link EVENT_ID_RANDOM_BYTES} bytes are read.
 */
export function eventIdFrom(nowMs: number, random: ArrayLike<number>): string {
  if (random.length < EVENT_ID_RANDOM_BYTES) {
    throw new RangeError(`An event identity needs ${EVENT_ID_RANDOM_BYTES} random bytes.`);
  }

  const timestamp = Math.min(MAX_TIMESTAMP_MS, Math.max(0, Math.floor(nowMs)));
  const bytes = new Array<number>(16);

  // 48-bit big-endian milliseconds. Division keeps it exact past 32 bits.
  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }

  for (let index = 0; index < EVENT_ID_RANDOM_BYTES; index += 1) {
    bytes[6 + index] = random[index] & 0xff;
  }

  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const text = bytes.map(hex).join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/** The millisecond timestamp a version 7 identity carries. */
export function eventIdTimestampMs(eventId: string): number {
  return parseInt(eventId.replace(/-/g, '').slice(0, 12), 16);
}
