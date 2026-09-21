/**
 * The Invite_Instant presentation: how the Invite_Manager writes out the creation
 * and expiry instants Requirement 11.2 asks each entry to state.
 *
 * Two functions, one for each half of a `<time>` element:
 *
 * - {@link formatInviteInstant} — the **text** a person reads, in their own locale
 *   and time zone, because an admin reads an invite's expiry against the clock on
 *   their wall rather than against UTC.
 * - {@link inviteInstantAttribute} — the **`dateTime` attribute** beside it: one
 *   unambiguous instant, so assistive technology and a test both have an exact
 *   value to read rather than a localised string whose shape varies by runtime.
 *
 * They live here rather than in `components/InviteManager.tsx` for the reason
 * every other pure function in this feature does: a rendering test states its
 * expectation through the same function the component renders through, so a
 * changed format cannot make a test pass while the screen says something else, and
 * neither has to reimplement the other (design.md → Testing Strategy).
 *
 * ### Both are total, and neither throws
 *
 * The instants they receive are the epoch milliseconds `lib/parse/inviteSummary`
 * already normalised and validated, so an unrepresentable value does not arise on
 * the real path. They are total anyway, because a function that throws on one
 * input is a function a listing can be broken by: a value outside the range a
 * `Date` can represent yields the value itself as text and **no** `dateTime`
 * attribute, rather than the string "Invalid Date" or an exception from
 * `toISOString`.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all (Requirement 18.2). `Date` and `Intl` are globals of the
 * language rather than DOM interfaces.
 *
 * Requirements: 11.2
 */

/**
 * How an instant is written out: a month named rather than numbered, so no reader
 * has to guess whether the day or the month comes first, and a 2-digit clock time.
 *
 * The locale and time zone are deliberately **not** stated, so both come from the
 * runtime — the reader's own in a browser.
 */
const INSTANT_FORMAT: Readonly<Intl.DateTimeFormatOptions> = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * The largest magnitude a `Date` can represent — ±100,000,000 days from the epoch.
 * Beyond it every `Date` operation yields an invalid date and `toISOString`
 * throws.
 */
export const MAX_TIME_VALUE = 8_640_000_000_000_000;

/**
 * Whether an epoch-millisecond value names a point in time a `Date` can
 * represent.
 *
 * Total over every `number`: a fractional value is representable (a `Date` holds
 * it to the millisecond, and the parser produces integers anyway), while `NaN`,
 * either infinity, and anything beyond {@link MAX_TIME_VALUE} are not.
 */
export function isRepresentableInstant(instantMs: number): boolean {
  return Number.isFinite(instantMs) && Math.abs(instantMs) <= MAX_TIME_VALUE;
}

/**
 * An instant as an invite entry states it (Requirement 11.2).
 *
 * Pure, total, and free of exceptions. Deterministic for a given runtime: the
 * locale and time zone are the runtime's, so two calls in one process always agree
 * even though two runtimes may not — which is exactly why the machine-readable
 * form in {@link inviteInstantAttribute} is rendered beside it.
 *
 * @param instantMs epoch milliseconds, as the Response_Parser normalised them
 * @returns the localised text, or the value itself when no `Date` can hold it
 */
export function formatInviteInstant(instantMs: number): string {
  if (!isRepresentableInstant(instantMs)) {
    return String(instantMs);
  }

  return new Date(instantMs).toLocaleString(undefined, INSTANT_FORMAT);
}

/**
 * The machine-readable form of an instant, for a `<time>` element's `dateTime`.
 *
 * ISO-8601 with an explicit `Z`, the same shape `lib/parse/primitives.printInstant`
 * emits, so the attribute names the same point on the time line the response
 * carried whatever offset it was written with.
 *
 * @param instantMs epoch milliseconds, as the Response_Parser normalised them
 * @returns the ISO-8601 instant, or `undefined` when no `Date` can hold the value
 *   — which omits the attribute rather than emitting a broken one
 */
export function inviteInstantAttribute(instantMs: number): string | undefined {
  return isRepresentableInstant(instantMs)
    ? new Date(instantMs).toISOString()
    : undefined;
}
