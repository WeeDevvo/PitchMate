/**
 * Defensive navigation helper for the marketing landing page.
 *
 * The sign up, log in, privacy, and terms surfaces are owned by other features
 * and may not yet be reachable. Rather than leaving a visitor at a dead end, a
 * call to action funnels its activation — whether triggered by pointer or by
 * keyboard — through this single code path. The helper attempts navigation to
 * `href` and applies a bounded time budget (3 seconds by default). If the
 * destination is not confirmed reachable within the budget, or the attempt
 * fails, it resolves `{ ok: false }` so the caller can keep the visitor on the
 * page and surface a retryable error.
 *
 * This module is deliberately free of React and router dependencies: it is pure
 * budget/funnel logic. The actual navigation mechanism is supplied as an
 * injectable `attempt`, which keeps the helper testable and lets the calling
 * component wire in client-side routing (see the shared CTA control).
 *
 * Requirements: 3.2, 3.3, 3.7, 8.5
 */

/** The outcome of a navigation attempt. */
export interface NavResult {
  /** True only when the destination was confirmed reachable within the budget. */
  ok: boolean;
}

/**
 * Attempts navigation to `href`, resolving once the destination is confirmed
 * reachable and rejecting (or never resolving) when it is not. The helper
 * enforces the time budget, so an attempt that hangs is treated as a failure.
 */
export type NavigationAttempt = (href: string) => Promise<unknown>;

/** Optional overrides for {@link navigateWithFallback}, primarily for testing. */
export interface NavigateWithFallbackOptions {
  /**
   * The navigation mechanism. Defaults to a full-document navigation via
   * `window.location.assign`, which unloads the current page on success.
   */
  attempt?: NavigationAttempt;
}

/** The default navigation time budget, in milliseconds (Requirements 3.2, 3.3, 3.7). */
export const DEFAULT_NAV_TIMEOUT_MS = 3000;

/**
 * The default navigation attempt: a full-document navigation to `href`.
 *
 * On success the browser unloads the current document, so the returned promise
 * effectively never needs to resolve; the time budget in
 * {@link navigateWithFallback} covers the case where navigation never begins.
 * If the environment has no usable `window.location`, or the assignment throws,
 * the returned promise rejects so the caller can degrade gracefully.
 */
function defaultAttempt(href: string): Promise<unknown> {
  return new Promise((_resolve, reject) => {
    try {
      if (typeof window === 'undefined' || !window.location) {
        reject(new Error('No window.location available for navigation'));
        return;
      }
      window.location.assign(href);
      // Intentionally left pending: a successful full-page navigation replaces
      // the document. The budget decides the outcome if navigation stalls.
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Attempt navigation to `href` within a bounded time budget.
 *
 * Both keyboard and pointer activation funnel through this one function
 * (Requirement 3.6 at the call site). The attempt races a timer of `timeoutMs`:
 * - the attempt resolves first → `{ ok: true }`;
 * - the attempt rejects → `{ ok: false }`;
 * - the timer fires first → `{ ok: false }`.
 *
 * The returned promise always settles exactly once, and the timer is always
 * cleared, regardless of which branch wins.
 *
 * Requirements: 3.2, 3.3, 3.7, 8.5
 */
export function navigateWithFallback(
  href: string,
  timeoutMs: number = DEFAULT_NAV_TIMEOUT_MS,
  options: NavigateWithFallbackOptions = {},
): Promise<NavResult> {
  const attempt = options.attempt ?? defaultAttempt;

  return new Promise<NavResult>((resolve) => {
    let settled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: NavResult) => {
      if (settled) return;
      settled = true;
      if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined;
      }
      resolve(result);
    };

    timerId = setTimeout(() => settle({ ok: false }), timeoutMs);

    try {
      attempt(href).then(
        () => settle({ ok: true }),
        () => settle({ ok: false }),
      );
    } catch {
      // A synchronous throw from the attempt is a failure like any other.
      settle({ ok: false });
    }
  });
}
