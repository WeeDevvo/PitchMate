/**
 * Redirect_Target capture store — the pre-auth hand-off for post-authentication
 * navigation.
 *
 * A person may arrive at an auth screen from a deep link they were trying to
 * reach (e.g. `/login?redirect=/squads/123`). That intended destination — the
 * candidate Redirect_Target — is captured BEFORE authentication and held here
 * until a Session is established, at which point the wiring
 * ({@link createAuthNavigation}) takes it, resolves it with
 * `resolveRedirectTarget`, navigates, and — crucially — clears it so it cannot
 * be reused on a subsequent authentication (Requirement 11.6).
 *
 * This module is intentionally small and split into a pure capture helper and a
 * tiny stateful holder:
 *
 * - {@link redirectCandidateFromSearch} is framework-free (no DOM, no
 *   `window`): it reads a candidate from a supplied URL query string, so it can
 *   be unit-tested browserlessly and reused by the React binder.
 * - {@link createRedirectTargetStore} is a minimal in-memory single-value
 *   holder with take-once semantics ({@link RedirectTargetStore.take} returns
 *   and clears), which is what enforces single-use (Requirement 11.6).
 *
 * Requirements: 11.1, 11.6
 */

/**
 * The default query-string parameter carrying a pre-auth Redirect_Target
 * candidate (e.g. `/login?redirect=/squads/123`). The name is a plain
 * convention, overridable where a candidate is captured.
 */
export const REDIRECT_PARAM_NAME = 'redirect';

/**
 * Read a candidate Redirect_Target from a URL query string, or `null` when
 * absent/empty.
 *
 * Pure and framework-free: it parses only the supplied `search` string and
 * never touches `window.location`. The raw parameter value is returned
 * unvalidated — safety/same-origin resolution is the sole responsibility of
 * `resolveRedirectTarget`, so this helper never decides what is safe; it only
 * surfaces what was captured.
 *
 * @param search the URL query string (with or without a leading `?`)
 * @param paramName the parameter to read; defaults to {@link REDIRECT_PARAM_NAME}
 */
export function redirectCandidateFromSearch(
  search: string,
  paramName: string = REDIRECT_PARAM_NAME,
): string | null {
  // `URLSearchParams` tolerates a leading `?` and performs percent-decoding of
  // the value, matching how the value was encoded into the link.
  const params = new URLSearchParams(search);
  const value = params.get(paramName);
  if (value === null || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * A single-value holder for the captured Redirect_Target candidate with
 * take-once semantics.
 *
 * The holder deals only in the raw captured candidate string; it performs no
 * safety validation (that is `resolveRedirectTarget`'s job). {@link take}
 * returns the current candidate and clears it, which is what guarantees a
 * captured target is used at most once (Requirement 11.6).
 */
export interface RedirectTargetStore {
  /**
   * Capture a candidate Redirect_Target, replacing any previously captured one.
   * A `null`/`undefined`/empty candidate clears the store.
   */
  capture(candidate: string | null | undefined): void;
  /**
   * Return the captured candidate and clear it (single-use, Requirement 11.6),
   * or `null` when none is held.
   */
  take(): string | null;
  /** Return the captured candidate without clearing it, or `null` when none. */
  peek(): string | null;
}

/**
 * Create an in-memory {@link RedirectTargetStore}.
 *
 * State lives in a closure, so nothing is persisted and the capture never
 * survives a full reload — a Redirect_Target is a transient, single-use pre-auth
 * hand-off, not durable session state.
 */
export function createRedirectTargetStore(): RedirectTargetStore {
  let captured: string | null = null;

  return {
    capture(candidate: string | null | undefined): void {
      captured =
        typeof candidate === 'string' && candidate.length > 0
          ? candidate
          : null;
    },
    take(): string | null {
      const value = captured;
      captured = null;
      return value;
    },
    peek(): string | null {
      return captured;
    },
  };
}
