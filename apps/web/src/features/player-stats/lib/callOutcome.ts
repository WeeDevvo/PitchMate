/**
 * The Player_Stats_Feature's one classification of a settled `GetPlayerProfile`
 * call.
 *
 * Requirement 12.8 asks for the outcome of a settled call to be decided in
 * **exactly one pure module**, and for that module to be the **only** one in the
 * feature containing an HTTP status value. This is that module: everything the
 * decision needs arrives in a {@link SettledCall}, so the five-way decision is
 * testable without a transport, a browser, or a clock, and `api/playerStatsApi.ts`
 * gathers the three signals, calls this once, and makes no outcome decision of
 * its own.
 *
 * Three narrowings against the Squads_Feature's seven-kind classifier are
 * deliberate, and each is structural rather than editorial:
 *
 *  - **There is no authentication arm.** `StatsEndpoints` resolves the caller
 *    from the token's subject claim and answers a fixed, `code`-free `404` when
 *    it cannot — the same response it gives for a non-existent squad, a
 *    non-existent membership, a cross-squad membership, and a non-member
 *    caller. The operation declares no `401` at all. So there is no
 *    authentication outcome to represent, and Requirement 3.4 — never branch on
 *    one, never hand the session off on the strength of one — holds because the
 *    returned type has **no member a screen could act upon**, not because every
 *    caller remembers not to.
 *  - **There is no rejection reason, and no problem body is read.** The `404`
 *    body is the fixed `{ title, detail }` with no `code` extension, and the
 *    other declared statuses (`400`, `500`, `503`) are none of them
 *    client-actionable here — the route constrains both identities to a `guid`,
 *    so there is nothing for a person to correct. {@link SettledCall} therefore
 *    declares **three** fields rather than the squads seam's four: no
 *    `problemCode`, so no backend wording, status, or detail has a field to
 *    travel in (Requirements 3.7, 12.5).
 *  - **A not-found outcome carries nothing.** It is evidence about nothing, so
 *    there is no field on it distinguishing an absent player from an
 *    inaccessible one, and no caller can derive a statement that a squad or a
 *    membership does or does not exist (Requirement 3.2).
 *
 * `CallResult<T>` in `api/playerStatsApi.ts` is this union with the parsed
 * profile attached to its `success` member; the kinds are declared here so both
 * the seam and the screen read one set of names.
 *
 * React-free and DOM-free like every module under `lib/`, and importing nothing
 * at all — in particular not `@pitchmate/api-client` (Requirement 14.3).
 *
 * Requirements: 3.2, 3.4, 3.7, 12.5, 12.8
 */

/**
 * The three signals a settled call presents to the classification, and the only
 * thing this module reads.
 *
 * Nothing here is renderable: there is no `detail`, no `title`, no body, no
 * header, and no request path, so no value from a rejected response can reach a
 * message by way of this type (Requirements 3.7, 12.5). There is deliberately
 * no `problemCode` either — the only status with a body worth reading would be a
 * rejection this feature can act on, and the operation declares none.
 */
export interface SettledCall {
  /**
   * The HTTP status, or `null` when **no response reached us** — a network
   * error, a DNS failure, or an abort. `null` is not `0`: a status of `0` would
   * be a response claiming an impossible status, and is treated as one.
   */
  readonly status: number | null;

  /**
   * Whether **our own** Profile_Call_Timeout fired (Requirement 12.4). Kept
   * separate from `status === null` precisely so a lapsed limit stays
   * distinguishable from a caller abort and from a transport rejection, even
   * though all three lead the screen to the same Generic_Profile_Failure.
   */
  readonly timedOut: boolean;

  /**
   * Whether the body was **accepted by the Response_Parser** — a fully
   * populated typed value rather than a parse failure. Only consulted for a
   * `2xx`, because no other status carries a value a screen would render.
   */
  readonly parsed: boolean;
}

/**
 * The outcome of a settled call: exactly one of five kinds (Requirement 12.8).
 *
 * Every kind is a bare tag. No arm declares a field, so there is nowhere for a
 * status, a header, a response body, or a problem-response member to ride along
 * into the screen (Requirements 3.7, 12.5) — the parsed profile is attached by
 * `CallResult`'s own `success` arm at the seam, not here.
 *
 * A discriminated union rather than a bare string union, so the seam's
 * `CallResult<T>` is this shape widened by one field and the two read as one
 * vocabulary.
 */
export type CallOutcomeKind =
  | { readonly kind: 'success' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'transport-failure' }
  | { readonly kind: 'parse-failure' };

/**
 * The statuses the endpoint conceals every inaccessible and absent subject
 * behind.
 *
 * `404` is the one the backend actually emits — for an absent squad, an absent
 * membership, a cross-squad membership, a non-member caller, and a missing,
 * malformed, or expired token alike. `401` and `403` are folded in even though
 * the operation declares neither: if a later contract drift started emitting
 * either, a distinct outcome would hand back exactly the distinction the
 * concealment exists to remove, and an authentication arm would exist for a
 * screen to act upon. Folding them keeps one non-disclosing branch
 * (Requirements 3.2, 3.4).
 */
const CONCEALED_STATUSES: readonly number[] = [401, 403, 404];

/** The lowest status that counts as a success. */
const SUCCESS_STATUS_MIN = 200;

/** The highest status that counts as a success. */
const SUCCESS_STATUS_MAX = 299;

/**
 * The outcome of a settled `GetPlayerProfile` call — exactly one of the five
 * kinds (Requirement 12.8).
 *
 * Pure and total: no clock, no transport, no DOM, no exception, and the same
 * answer for the same input. Every input classifies, including a status no
 * backend would send — a `1xx`, a `3xx`, a `0`, a negative or fractional value,
 * `NaN`, either infinity — all of which fall to `transport-failure` along with
 * every `5xx`.
 *
 * The order of the decisions is itself part of the specification:
 *
 * | Signal                        | Outcome             | Why |
 * | ----------------------------- | ------------------- | --- |
 * | `timedOut`                    | `timeout`           | our own limit, checked first and independently of any status, so a response racing the timer cannot mask it (12.4) |
 * | `status === null`             | `transport-failure` | no response: network failure, DNS, abort |
 * | `401`, `403`, `404`           | `not-found`         | the endpoint's uniform concealment — see {@link CONCEALED_STATUSES} |
 * | `2xx` and not `parsed`        | `parse-failure`     | the body was not what the Response_Parser accepts |
 * | `2xx` and `parsed`            | `success`           | |
 * | anything else, `5xx` included | `transport-failure` | a failed aggregation (`503`), a `500`, and a `400` are none of them client-actionable, so none is a rejection a person could correct |
 *
 * **Why `timedOut` wins.** A call can both lapse and settle, and Requirement
 * 12.4 asks for the timeout to stay distinguishable from a caller abort and
 * from a transport rejection. Reading it first is the mechanism: a status that
 * arrives after our own limit has fired never reaches a branch.
 *
 * What the outcomes *look like* stays the screen's decision: `not-found`
 * becomes the Not_Found_Treatment, and the other three failures become one
 * Generic_Profile_Failure with a retry control. This function states no
 * message and reads none.
 *
 * @param call the three signals of a settled call, gathered by `api/playerStatsApi.ts`
 * @returns exactly one of the five outcome kinds
 *
 * Requirements: 3.2, 3.4, 3.7, 12.5, 12.8
 */
export function classifyOutcome(call: SettledCall): CallOutcomeKind {
  // 12.4: our own Profile_Call_Timeout, read before anything else so a lapsed
  // limit stays distinguishable from a caller abort and from a transport
  // rejection even when a response races the timer.
  if (call.timedOut) {
    return { kind: 'timeout' };
  }

  const status = call.status;

  // No response reached us — a network error, a DNS failure, or an abort.
  if (status === null) {
    return { kind: 'transport-failure' };
  }

  // 3.2, 3.4: the endpoint's uniform concealment, with `401` and `403` folded
  // into it, so the feature has one non-disclosing branch, states nothing about
  // existence, and offers no authentication outcome to act upon.
  if (CONCEALED_STATUSES.includes(status)) {
    return { kind: 'not-found' };
  }

  // A success carries a body, and the Response_Parser's verdict on that body
  // decides between a profile the screen can render and a parse failure.
  if (status >= SUCCESS_STATUS_MIN && status <= SUCCESS_STATUS_MAX) {
    return call.parsed ? { kind: 'success' } : { kind: 'parse-failure' };
  }

  // Everything else: `400`, every `5xx`, the `503` of a failed aggregation,
  // every `1xx`, every `3xx`, and every status no backend would send. None is
  // client-actionable — the route constrains both identities to a `guid`, so
  // there is nothing for a person to correct.
  return { kind: 'transport-failure' };
}
