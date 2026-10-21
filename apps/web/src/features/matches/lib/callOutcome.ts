/**
 * How a settled Matches_Api call is classified, from its status, its problem
 * code, and whether its body parsed.
 *
 * Concealment: the backend answers every existence-sensitive match read with one
 * code-agnostic `404`, and an organiser-only write by a non-organiser with `403`.
 * Both, and a `401`, become the same `not-found` here, so no screen can tell a
 * missing match from one the caller may not see.
 *
 * A `400` or `409` is a rejection the person can act on. Its reason comes from
 * the ProblemDetails `code` when it is one this feature recognises, and from the
 * status otherwise. A reason never carries the backend's message text.
 */

export type RejectionReason =
  | 'validation'
  | 'invalid-state'
  | 'threshold-not-met'
  | 'result-required'
  | 'conflict';

export interface SettledCall {
  /** The response status, or `null` when no response arrived. */
  readonly status: number | null;
  /** True when the call was abandoned at the facade's deadline. */
  readonly timedOut: boolean;
  /** The ProblemDetails `code` extension of a failure body, or `null`. */
  readonly problemCode: string | null;
  /** True when the success body parsed. */
  readonly parsed: boolean;
}

export type CallOutcomeKind =
  | { readonly kind: 'success' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'rejected'; readonly reason: RejectionReason }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'transport-failure' }
  | { readonly kind: 'parse-failure' };

const CONCEALED_STATUSES: readonly number[] = [401, 403, 404];

const REJECTION_REASONS_BY_STATUS: Readonly<Record<number, RejectionReason>> = {
  400: 'validation',
  409: 'conflict',
};

/** The `MatchErrorCode` names that carry a reason worth telling apart. */
const REJECTION_REASONS_BY_PROBLEM_CODE: Readonly<Record<string, RejectionReason>> =
  {
    ValidationFailed: 'validation',
    InvalidState: 'invalid-state',
    ThresholdNotMet: 'threshold-not-met',
    ResultRequired: 'result-required',
    LiveTrackingDisabled: 'validation',
    AlreadyParticipant: 'conflict',
    ConcurrencyConflict: 'conflict',
  };

function rejectionReasonFromProblemCode(
  problemCode: string | null,
): RejectionReason | undefined {
  if (problemCode === null || !Object.hasOwn(REJECTION_REASONS_BY_PROBLEM_CODE, problemCode)) {
    return undefined;
  }

  return REJECTION_REASONS_BY_PROBLEM_CODE[problemCode];
}

/** Classify one settled call. Total: every input yields exactly one outcome. */
export function classifyOutcome(call: SettledCall): CallOutcomeKind {
  if (call.timedOut) {
    return { kind: 'timeout' };
  }

  const { status } = call;

  if (status === null) {
    return { kind: 'transport-failure' };
  }

  if (CONCEALED_STATUSES.includes(status)) {
    return { kind: 'not-found' };
  }

  const statusReason = Object.hasOwn(REJECTION_REASONS_BY_STATUS, status)
    ? REJECTION_REASONS_BY_STATUS[status]
    : undefined;

  if (statusReason !== undefined) {
    return {
      kind: 'rejected',
      reason: rejectionReasonFromProblemCode(call.problemCode) ?? statusReason,
    };
  }

  if (status >= 200 && status <= 299) {
    return call.parsed ? { kind: 'success' } : { kind: 'parse-failure' };
  }

  return { kind: 'transport-failure' };
}
