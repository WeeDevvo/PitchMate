/**
 * The App_Shell's single pure Poll_Interval clamp.
 *
 * The unread-count poll loop is driven by a configured interval that reaches the
 * shell from outside it — `createShellRoutes({ pollIntervalSeconds })` — so the
 * value is untrusted: it may be absent, it may not be a number at all, and it
 * may be a number no poll loop should honour. Requirement 4.6 fixes exactly how
 * such a value becomes the *effective* Poll_Interval:
 *
 * | Configured value                       | Effective interval (seconds) |
 * | -------------------------------------- | ---------------------------- |
 * | absent, not numeric, or not finite     | 60 — the default             |
 * | below 15                               | 15 — the floor               |
 * | above 600                              | 600 — the ceiling            |
 * | anything else                          | the configured value         |
 *
 * The two steps are deliberately ordered: fold first, clamp second. Folding an
 * unusable value to the default *before* clamping means the default is itself
 * subject to the bounds, so there is one path out of this function and its
 * result is always inside `15..600` — which is what Requirement 14.9 asserts
 * over arbitrary inputs. Clamping first would have to answer what `NaN < 15`
 * means, and `NaN` compares false against every bound, so it would fall through
 * unclamped.
 *
 * The function is **total**: every input yields a finite number in
 * `15..600` and raises no exception. Totality is structural — a `typeof` test, a
 * finiteness test, then arithmetic comparisons on a value already known to be a
 * finite number. Nothing is coerced to a number or a string, so a hostile
 * `valueOf` or `toString` never runs.
 *
 * A configured value is **not rounded**. Requirement 4.6 says to use the
 * configured value when it is in range, and `22.5` is in range; the poll loop
 * multiplies the result into milliseconds for its timer, where a fraction of a
 * second is harmless. Rounding would be a behaviour this criterion does not ask
 * for.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirements 14.16, 15.5).
 *
 * Requirements: 4.6, 14.9
 */

/**
 * The effective Poll_Interval used when the configured value is absent, is not
 * numeric, or is not a finite number (Requirement 4.6).
 *
 * This is the Poll_Interval default named in the glossary, and it sits inside
 * {@link POLL_INTERVAL_MIN_SECONDS}..{@link POLL_INTERVAL_MAX_SECONDS}, so
 * folding to it can never itself produce an out-of-range result.
 */
export const POLL_INTERVAL_DEFAULT_SECONDS = 60;

/**
 * The lowest effective Poll_Interval (Requirement 4.6). A configured value below
 * this is raised to it rather than rejected — the floor exists to stop a
 * misconfiguration from hammering the unread-count endpoint.
 */
export const POLL_INTERVAL_MIN_SECONDS = 15;

/**
 * The highest effective Poll_Interval (Requirement 4.6). A configured value
 * above this is lowered to it, so the Unread_Count can never go stale for longer
 * than ten minutes.
 */
export const POLL_INTERVAL_MAX_SECONDS = 600;

/**
 * Derive the effective Poll_Interval in seconds from a configured value.
 *
 * Total over every input: the result is always a finite number in
 * {@link POLL_INTERVAL_MIN_SECONDS}..{@link POLL_INTERVAL_MAX_SECONDS}
 * inclusive, and no input raises an exception (Requirement 14.9).
 *
 * @param configured the configured Poll_Interval in seconds exactly as supplied,
 *   unasserted — `undefined` when absent, and possibly any other value
 * @returns the effective Poll_Interval in seconds, within
 *   {@link POLL_INTERVAL_MIN_SECONDS}..{@link POLL_INTERVAL_MAX_SECONDS}
 *
 * Requirements: 4.6, 14.9
 */
export function effectivePollIntervalSeconds(configured: unknown): number {
  // 4.6: absent or not numeric — `undefined`, `null`, a string (a *numeric*
  // string included, because `'30'` is not a number), a boolean, an array, an
  // object — folds to the default. No coercion is attempted.
  if (typeof configured !== 'number') {
    return POLL_INTERVAL_DEFAULT_SECONDS;
  }

  // 4.6: not a finite number — `NaN`, `Infinity`, `-Infinity` — folds to the
  // default too. This runs before the bound comparisons precisely because `NaN`
  // compares false against both bounds and would otherwise escape unclamped.
  if (!Number.isFinite(configured)) {
    return POLL_INTERVAL_DEFAULT_SECONDS;
  }

  // 4.6: below the floor is raised to the floor. `-0` and every negative value
  // land here, so the result is never zero or negative.
  if (configured < POLL_INTERVAL_MIN_SECONDS) {
    return POLL_INTERVAL_MIN_SECONDS;
  }

  // 4.6: above the ceiling is lowered to the ceiling.
  if (configured > POLL_INTERVAL_MAX_SECONDS) {
    return POLL_INTERVAL_MAX_SECONDS;
  }

  // 4.6: a finite value within the bounds is used as configured, unrounded.
  return configured;
}
