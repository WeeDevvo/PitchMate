/**
 * The Squads_Feature's one classification of a settled Squads_Api call.
 *
 * Requirement 17.8 asks for **exactly seven** outcomes — success, not-found,
 * authentication failure, rejected input, timeout, transport failure, parse
 * failure — decided by a **pure function**, so the seven-way decision is
 * testable without a transport, a browser, or a clock. Everything the decision
 * needs arrives in a {@link SettledCall}: the status (or its absence), whether
 * our own Squad_Call_Timeout fired, the ProblemDetails `code` extension, and
 * whether the body was accepted by its parser. `api/squadsApi.ts` gathers those
 * four signals and calls this once; it makes no outcome decision of its own.
 *
 * Three properties of the union are deliberate, and each is structural rather
 * than editorial:
 *
 *  - **No backend text leaves this module.** A rejection carries a
 *    {@link RejectionReason} — one of five names this module declares — and
 *    nothing else. The problem's `detail`, its `title`, the status code, and the
 *    request path have no way through: the return type has no field that could
 *    hold them, so a screen reaching for the backend's wording would find none
 *    (Requirement 17.2).
 *  - **There is no `forbidden` kind.** `403` folds into `not-found` alongside
 *    `404` — see {@link classifyOutcome}.
 *  - **A not-found outcome carries nothing.** It is evidence about nothing, so
 *    there is no field on it distinguishing an absent squad from an
 *    inaccessible one, and no caller can derive a statement that a squad,
 *    membership, or invite does or does not exist (Requirement 17.7).
 *
 * `CallResult<T>` in `api/squadsApi.ts` is this union with the parsed value
 * attached to its `success` member; the kinds and the rejection reasons are
 * declared here so both the seam and the screens read one set of names.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirement 18.2).
 *
 * Requirements: 16.3, 17.2, 17.7, 17.8
 */

/**
 * Why the backend rejected what was sent, named in this feature's own terms.
 *
 * A closed union of five names, mapped from the backend's stable
 * `SquadErrorCode` / `StatsErrorCode` `code` extension. It exists solely so a
 * screen can pick the right *fixed* message from `lib/messages.ts`; it is not
 * the backend's code, and it carries no backend wording (Requirement 17.2).
 *
 * The five are the distinctions a screen actually acts on:
 *
 * | Reason                 | What a screen does with it                          |
 * | ---------------------- | --------------------------------------------------- |
 * | `display-name-in-use`  | tells the admin the name is taken, keeps the form open |
 * | `invite-unusable`      | renders `INVITE_UNUSABLE`, identically for missing, revoked, and expired |
 * | `invite-limit-reached` | tells the admin to revoke an invite before generating another |
 * | `validation`           | presents the backend as the authority on acceptability (3.9) |
 * | `conflict`             | the state moved under the request; the action can be re-submitted |
 */
export type RejectionReason =
  | 'display-name-in-use'
  | 'invite-unusable'
  | 'invite-limit-reached'
  | 'validation'
  | 'conflict';

/**
 * The four signals a settled call presents to the classification, and the only
 * thing this module reads.
 *
 * Nothing here is renderable: there is no `detail`, no `title`, no body, and no
 * request path, so no backend text can reach a message by way of this type
 * (Requirement 17.2).
 */
export interface SettledCall {
  /**
   * The HTTP status, or `null` when **no response reached us** — a network
   * error, a DNS failure, or an abort. `null` is not `0`: a status of `0` would
   * be a response claiming an impossible status, and is treated as one.
   */
  readonly status: number | null;

  /**
   * Whether **our own** Squad_Call_Timeout fired (Requirement 16.3). Kept
   * separate from `status === null` precisely so a lapsed 10-second limit is
   * distinguishable from a transport failure and from a parse failure, even
   * though all three lead a screen to the same Generic_Squads_Failure.
   */
  readonly timedOut: boolean;

  /**
   * The ProblemDetails `code` extension exactly as the body carried it, or
   * `null` when the body carried none. The backend emits the `SquadErrorCode` /
   * `StatsErrorCode` member name here (`'DisplayNameInUse'`,
   * `'InviteUnusable'`, …). It is read only to name a {@link RejectionReason}
   * and is never carried out of this module.
   */
  readonly problemCode: string | null;

  /**
   * Whether the body was **accepted by its parser** — a fully populated typed
   * value rather than a parse failure (Requirement 16.4). Only consulted for a
   * `2xx`, because no other status carries a value a screen would render.
   */
  readonly parsed: boolean;
}

/**
 * The outcome of a settled call: exactly one of seven kinds (Requirement 17.8).
 *
 * A discriminated union rather than a bare string union, because a rejection is
 * the one outcome that carries anything — its {@link RejectionReason}. Every
 * other kind is a bare tag, so there is no field on which unmapped backend
 * content could ride along.
 */
export type CallOutcomeKind =
  | { readonly kind: 'success' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'auth-failure' }
  | { readonly kind: 'rejected-input'; readonly reason: RejectionReason }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'transport-failure' }
  | { readonly kind: 'parse-failure' };

/**
 * The statuses that mean "the backend understood the request and rejected it",
 * each paired with the reason to use when the body names none.
 *
 * Both the set of rejecting statuses and their defaults come from this one
 * table, so the membership test and the fallback cannot disagree. The defaults
 * mirror what the backend can actually answer with each status:
 *
 *  - `400` — `ValidationFailed`, `ExpiryRequired`, `UnsupportedStatistic`: all
 *    validation.
 *  - `409` — `DisplayNameInUse` and four state conflicts; a `409` whose code is
 *    unnamed is a conflict rather than a guess at which one.
 *  - `410` — emitted for `InviteUnusable` and nothing else, so the status alone
 *    names the reason.
 */
const REJECTION_REASONS_BY_STATUS: Readonly<Record<number, RejectionReason>> = {
  400: 'validation',
  409: 'conflict',
  410: 'invite-unusable',
};

/**
 * The backend problem codes that name a {@link RejectionReason}, read from
 * `SquadErrorCode` and `StatsErrorCode` rather than guessed.
 *
 * `Unauthorized`, `NotAMember`, and `AlreadyMember` are deliberately absent:
 * the first two are answered as `403`/`404` and the third as a `200` no-op, so
 * none of them ever accompanies a rejecting status. A code this table does not
 * name — an unmapped one, or a new one a later backend adds — falls back to the
 * status default, so an outcome is always named and nothing is thrown.
 */
const REJECTION_REASONS_BY_PROBLEM_CODE: Readonly<
  Record<string, RejectionReason>
> = {
  DisplayNameInUse: 'display-name-in-use',
  InviteUnusable: 'invite-unusable',
  InviteLimitReached: 'invite-limit-reached',
  ValidationFailed: 'validation',
  ExpiryRequired: 'validation',
  UnsupportedStatistic: 'validation',
  OwnerConstraint: 'conflict',
  ClaimNotEligible: 'conflict',
  SquadPendingDeletion: 'conflict',
  ConcurrencyConflict: 'conflict',
};

/** The lowest status that counts as a success. */
const SUCCESS_STATUS_MIN = 200;

/** The highest status that counts as a success. */
const SUCCESS_STATUS_MAX = 299;

/**
 * The reason a problem code names, or `undefined` when it names none.
 *
 * Total over every input and free of exceptions. The candidate is never
 * coerced, so a hostile `toString` or `valueOf` never runs, and the own-property
 * guard keeps inherited names — `'toString'`, `'constructor'`, `'__proto__'` —
 * from reading a `Function` out of the table's prototype.
 */
function rejectionReasonFromProblemCode(
  problemCode: string | null,
): RejectionReason | undefined {
  // A body carrying no `code` extension, or a value that is not a string at
  // all, names no reason. No coercion is attempted.
  if (typeof problemCode !== 'string') {
    return undefined;
  }

  // An inherited property name is not a problem code. Guarding here rather than
  // on the read is what keeps a `Function` from ever being typed as a reason.
  if (!Object.hasOwn(REJECTION_REASONS_BY_PROBLEM_CODE, problemCode)) {
    return undefined;
  }

  // The annotation is what makes the absent case visible in the type: an index
  // read alone is typed as though every string were a key.
  const reason: RejectionReason | undefined =
    REJECTION_REASONS_BY_PROBLEM_CODE[problemCode];
  return reason;
}

/**
 * The outcome of a settled Squads_Api call — exactly one of the seven kinds
 * (Requirement 17.8).
 *
 * Pure and total: no clock, no transport, no DOM, no exception, and the same
 * answer for the same input. Every input classifies, including a status no
 * backend would send — a `1xx`, a `0`, a fractional value, `NaN` — which falls
 * to `transport-failure` along with every `5xx`.
 *
 * The order of the decisions is itself part of the specification:
 *
 * | Signal                    | Outcome          | Why |
 * | ------------------------- | ---------------- | --- |
 * | `timedOut`                | `timeout`        | our own limit, checked first and independently of any status, so a response racing the timer cannot mask it (16.3) |
 * | `status === null`         | `transport-failure` | no response, aborted, network error |
 * | `401`                     | `auth-failure`   | the session outcome belongs to the Auth_Feature (17.6) |
 * | `403`, `404`              | `not-found`      | the backend's uniform concealment, extended — see below |
 * | `400`, `409`, `410`       | `rejected-input` | reason from the problem `code`, else from the status |
 * | `2xx` and not `parsed`    | `parse-failure`  | the body was not what the parser accepts (16.4) |
 * | `2xx` and `parsed`        | `success`        | |
 * | anything else, `5xx` included | `transport-failure` | a stats computation failure (`503`) is not a client-actionable rejection, and there is nothing for a person to correct |
 *
 * **Why `403` folds into `not-found`.** The union has no `forbidden` kind, which
 * is deliberate. The backend already answers an authorisation failure on an
 * existence-sensitive read with `404`, so a non-member cannot distinguish "not
 * allowed" from "does not exist"; rendering a distinct forbidden surface for
 * the endpoints that *do* answer `403` would hand back exactly the distinction
 * that masking exists to remove. Folding them leaves the feature one
 * non-disclosing branch. What that branch *looks like* stays the screen's
 * decision: only the screen-level `GetSquad` turns `not-found` into the
 * Not_Found_Treatment, while an admin action renders that action's outcome
 * message and leaves the rendered detail untouched (10.5, 13.7).
 *
 * **Why `timedOut` wins.** A call can both lapse and settle, and Requirement
 * 16.3 asks for the timeout to stay distinguishable from a transport failure
 * and from a parse failure. Reading it first is the mechanism: a status that
 * arrives after our own limit has fired never reaches a branch.
 *
 * @param call the four signals of a settled call, gathered by `api/squadsApi.ts`
 * @returns exactly one of the seven outcome kinds
 *
 * Requirements: 16.3, 17.2, 17.7, 17.8
 */
export function classifyOutcome(call: SettledCall): CallOutcomeKind {
  // 16.3: our own Squad_Call_Timeout, read before anything else so it stays
  // distinguishable from a transport failure and from a parse failure.
  if (call.timedOut) {
    return { kind: 'timeout' };
  }

  const status = call.status;

  // 17.1: no response reached us — a network error, a DNS failure, or an abort.
  if (status === null) {
    return { kind: 'transport-failure' };
  }

  // 17.6: the session outcome is the Auth_Feature's to handle, not this
  // feature's; the screen changes nothing but its outcome message.
  if (status === 401) {
    return { kind: 'auth-failure' };
  }

  // 17.7: the backend's `404` concealment, with `403` folded into it, so the
  // feature has one non-disclosing branch and states nothing about existence.
  if (status === 403 || status === 404) {
    return { kind: 'not-found' };
  }

  // 17.2: the backend understood the request and rejected it. The reason is a
  // name this module declares — taken from the problem `code` when that code is
  // one we know, and from the status otherwise — never the backend's wording.
  const statusReason: RejectionReason | undefined =
    REJECTION_REASONS_BY_STATUS[status];
  if (statusReason !== undefined) {
    return {
      kind: 'rejected-input',
      reason: rejectionReasonFromProblemCode(call.problemCode) ?? statusReason,
    };
  }

  // 16.4: a success carries a body, and the parser's verdict on that body
  // decides between a value a screen can render and a parse failure.
  if (status >= SUCCESS_STATUS_MIN && status <= SUCCESS_STATUS_MAX) {
    return call.parsed ? { kind: 'success' } : { kind: 'parse-failure' };
  }

  // Everything else: every `5xx`, the `503` a stats computation failure answers
  // with, every `1xx`, every `3xx`, and every status no backend would send. None
  // of them is client-actionable, so none of them is a rejection a person could
  // correct.
  return { kind: 'transport-failure' };
}
