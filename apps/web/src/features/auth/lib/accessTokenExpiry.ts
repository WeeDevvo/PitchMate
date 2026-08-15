/**
 * Pure access-token expiry logic for the auth feature.
 *
 * Framework-free (no React, no DOM): this decides whether the Access_Token
 * should be proactively refreshed. The decision is deterministic and testable
 * because it compares an injected current instant (`nowMs`) against the
 * token's expiry instant (`expiresAtMs`) using only the injected time value —
 * it never reads the wall clock (no `Date.now()`), so callers control time
 * (Requirement 15.1).
 */

/** Requirements 9.1, 9.6, 15.5 */
export interface RefreshDecisionInput {
  /** Access_Token expiry instant, in epoch milliseconds. */
  readonly expiresAtMs: number;
  /** Current instant from the injected time source, in epoch milliseconds. */
  readonly nowMs: number;
  /** Renewal margin; default {@link RENEWAL_MARGIN_DEFAULT_MS}, clamped 15_000..300_000. */
  readonly renewalMarginMs: number;
}

/** Default renewal margin: refresh 60s before expiry. */
export const RENEWAL_MARGIN_DEFAULT_MS = 60_000;

/** Minimum accepted renewal margin (inclusive). */
export const RENEWAL_MARGIN_MIN_MS = 15_000;

/** Maximum accepted renewal margin (inclusive). */
export const RENEWAL_MARGIN_MAX_MS = 300_000;

/**
 * Decide whether the Access_Token requires a proactive refresh.
 *
 * "refresh required" (`true`) if and only if `nowMs >= expiresAtMs - renewalMarginMs`;
 * "no refresh required" (`false`) if and only if `nowMs < expiresAtMs - renewalMarginMs`.
 *
 * Uses only the injected `nowMs` — no wall-clock access — so the decision is
 * deterministic and testable.
 *
 * Requirements: 9.1, 9.6, 15.5
 */
export function isRefreshRequired(input: RefreshDecisionInput): boolean {
  const { expiresAtMs, nowMs, renewalMarginMs } = input;
  return nowMs >= expiresAtMs - renewalMarginMs;
}

/**
 * Clamp a configured renewal margin into the inclusive band
 * [{@link RENEWAL_MARGIN_MIN_MS}, {@link RENEWAL_MARGIN_MAX_MS}].
 *
 * Values below the minimum are raised to 15_000; values above the maximum are
 * lowered to 300_000.
 *
 * Requirements: 9.1, 9.6, 15.5
 */
export function clampRenewalMargin(marginMs: number): number {
  if (marginMs < RENEWAL_MARGIN_MIN_MS) {
    return RENEWAL_MARGIN_MIN_MS;
  }
  if (marginMs > RENEWAL_MARGIN_MAX_MS) {
    return RENEWAL_MARGIN_MAX_MS;
  }
  return marginMs;
}
