/**
 * The App_Shell's single pure notification-call outcome mapper.
 *
 * Requirement 11.6 asks for **one** pure function, depending on neither React
 * nor the DOM, that maps every notification call outcome to exactly one of
 * `success`, `unauthenticated`, `not-found`, and `failure`. Every notification
 * call in `api/notificationsApi.ts` settles through this function, so the
 * calling sites in the notification centre never inspect a status code
 * themselves and no second interpretation of a status can drift from this one.
 *
 * The mapping (Requirements 11.6, 11.8, 11.9):
 *
 * | Returned response status                     | Outcome            |
 * | -------------------------------------------- | ------------------ |
 * | `200`–`299` inclusive                        | `success`          |
 * | `401`                                        | `unauthenticated`  |
 * | `404`                                        | `not-found`        |
 * | every other status                           | `failure`          |
 * | `null` — no response at all                  | `failure`          |
 *
 * `null` stands for *no response returned*: the transport failed to reach the
 * backend, or the Notification_Call_Timeout aborted the request. Requirement
 * 11.8 requires both to be indistinguishable from any other failure at the
 * calling site, which is exactly what folding them into `failure` achieves — a
 * failing call reveals nothing about *why* it failed (Requirement 11.10).
 *
 * `204` needs no special case here: it sits inside `200`–`299` and so maps to
 * `success`, as Requirement 11.7 requires. The other half of 11.7 — that a `204`
 * carries *no parsed response value* rather than an uninterpretable body — is a
 * concern of the Notifications_Api facade, which skips parsing for a success
 * outcome with an empty body. It is not a distinction this mapping can express,
 * because the mapping sees the status alone.
 *
 * Totality (Requirement 14.15): the function is total over every numeric status
 * and over `null`, and raises no exception. Because the success test is a pair
 * of range comparisons, a status that is not a real number in that range —
 * `NaN`, `Infinity`, `-Infinity`, a fractional status, a negative status, a
 * status far outside the HTTP range — falls through to `failure`, which is the
 * safe reading of a value no backend should have produced.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirements 14.16, 15.5).
 *
 * Requirements: 11.6, 11.7, 11.8, 11.9
 */

/**
 * The four outcomes every notification call settles as (Requirement 11.6).
 *
 * - `success` — a response arrived within the Notification_Call_Timeout with a
 *   status in `200`–`299`.
 * - `unauthenticated` — the session has ended; the notification centre performs
 *   the session expiry handover rather than showing a failure (Requirement 9.3).
 * - `not-found` — the resource does not exist; treated as a failed call by the
 *   caller and reported with the Generic_Notification_Failure message, so a
 *   failing call never reveals what exists (Requirements 11.5, 11.10).
 * - `failure` — everything else, including no response at all.
 */
export type CallOutcomeKind =
  | 'success'
  | 'unauthenticated'
  | 'not-found'
  | 'failure';

/** The lowest returned response status that maps to `success`. */
export const SUCCESS_STATUS_MIN = 200;

/** The highest returned response status that maps to `success`. */
export const SUCCESS_STATUS_MAX = 299;

/** The one returned response status that maps to `unauthenticated`. */
export const UNAUTHENTICATED_STATUS = 401;

/** The one returned response status that maps to `not-found`. */
export const NOT_FOUND_STATUS = 404;

/**
 * Map one notification call's returned response status to exactly one outcome.
 *
 * @param status the status of the response the call returned, or `null` where
 *   the call returned no response at all because the transport failed or the
 *   Notification_Call_Timeout aborted the request
 * @returns exactly one of `success`, `unauthenticated`, `not-found`, `failure`
 *
 * Requirements: 11.6, 11.7, 11.8, 11.9
 */
export function mapCallOutcome(status: number | null): CallOutcomeKind {
  // 11.8: no response — transport failure or timeout abort — is a failure, and
  // is reported identically to every other failure.
  if (status === null) {
    return 'failure';
  }

  // 11.6: `200`–`299` inclusive is success, which covers the `204` the mark-read
  // endpoint returns (Requirement 11.7). Written as range comparisons so that
  // `NaN` and the infinities fall through to failure below rather than needing a
  // guard of their own.
  if (status >= SUCCESS_STATUS_MIN && status <= SUCCESS_STATUS_MAX) {
    return 'success';
  }

  if (status === UNAUTHENTICATED_STATUS) {
    return 'unauthenticated';
  }

  if (status === NOT_FOUND_STATUS) {
    return 'not-found';
  }

  // 11.9: anything the three cases above did not claim is a failure.
  return 'failure';
}
