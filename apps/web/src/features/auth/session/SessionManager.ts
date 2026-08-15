/**
 * The client's single source of session truth for the auth feature.
 *
 * A {@link SessionManager} owns the in-memory {@link Session} (the Access_Token,
 * Refresh_Token, and the Access_Token expiry instant), keeps it in step with the
 * injected {@link SessionStore} persistence seam, and publishes the derived
 * {@link AuthState} to subscribers so the React `AuthContext` (task 8.1) can wrap
 * it. It is deliberately framework-agnostic: no React, no DOM, no wall-clock
 * access. Time is supplied through the injected `now()` clock (Requirement 9.6)
 * and every collaborator — storage, the backend {@link AuthApi}, the
 * unauthenticated navigation callback — is injected via {@link SessionManagerDeps},
 * so the whole model is deterministic and testable in a browserless environment.
 *
 * Responsibilities implemented in THIS module (task 7.2 — the core):
 *
 * - {@link SessionManager.bootstrap} — restore a valid persisted Session at app
 *   start, or discard partial/absent state and report `unauthenticated`
 *   (Requirements 8.3, 8.4, 8.5).
 * - {@link SessionManager.establish} — replace the current Session and persist it
 *   atomically, then notify subscribers (Requirements 8.1, 8.3).
 * - {@link SessionManager.getState} — report `authenticated` iff a Session is
 *   currently held (Requirement 8.7).
 * - {@link SessionManager.subscribe} — register/unregister state-change listeners.
 *
 * Also implemented here (task 7.6 — just-in-time single-flight refresh):
 *
 * - {@link SessionManager.getAccessTokenForRequest} — return a bearer token for
 *   the current request, running (or joining) one in-flight refresh when the
 *   Access_Token is within its renewal margin (Requirements 9.1, 9.2, 9.3, 9.4,
 *   9.5).
 *
 * Also implemented here (task 7.10 — explicit sign-out that always ends
 * unauthenticated):
 *
 * - {@link SessionManager.signOut} — best-effort backend revoke of the current
 *   Refresh_Token bounded by `signOutTimeoutMs`, followed by unconditional
 *   in-memory + persisted teardown regardless of the backend outcome, with a
 *   guard against concurrent sign-out (Requirements 10.1, 10.2, 10.3, 10.5).
 *
 * Requirements: 8.1, 8.3, 8.4, 8.5, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2,
 * 10.3, 10.5
 */

import { isRefreshRequired } from '../lib/accessTokenExpiry';
import type { PersistedSession, SessionStore } from './SessionStore';

/**
 * The derived, coarse authentication state the rest of the app observes.
 *
 * It is a pure function of whether a {@link Session} is currently held:
 * `authenticated` when one is, `unauthenticated` otherwise (Requirement 8.7).
 */
export type AuthState = 'authenticated' | 'unauthenticated';

/**
 * The in-memory Session: the token pair plus the Access_Token expiry instant.
 *
 * The Access_Token is treated as an opaque bearer credential plus an expiry
 * instant — the client never decodes it for authentication decisions
 * (Requirement 12.3). Structurally identical to {@link PersistedSession}; the
 * two are kept as distinct names so the in-memory model and the persistence
 * seam can evolve independently.
 */
export interface Session {
  /** Opaque bearer Access_Token. */
  readonly accessToken: string;
  /** Rotating, revocable Refresh_Token. */
  readonly refreshToken: string;
  /** Access_Token expiry instant, in epoch milliseconds. */
  readonly expiresAtMs: number;
}

/**
 * The result of a backend refresh call, as a discriminated union expressive
 * enough for the single-flight refresh logic in task 7.6.
 *
 * - `success` carries the rotated {@link Session} (new Access_Token, new
 *   Refresh_Token, new expiry) that supersedes the current one (Requirement 9.2).
 * - `invalid-or-expired` means the Refresh_Token was rejected as invalid or
 *   expired; the caller must clear the Session and become `unauthenticated`
 *   (Requirement 9.3). Mirrors {@link AuthOutcome} `invalid-or-expired-token`.
 * - `transport-failure` means a timeout or network failure with no definitive
 *   answer from the backend; the caller may retry and, if all attempts fail,
 *   retains the current Session (Requirement 9.4). Mirrors {@link AuthOutcome}
 *   `timeout-or-network`.
 */
export type RefreshResult =
  | { readonly kind: 'success'; readonly session: Session }
  | { readonly kind: 'invalid-or-expired' }
  | { readonly kind: 'transport-failure' };

/**
 * The result of a backend sign-out call, for the sign-out logic in task 7.10.
 *
 * Either outcome ends the local Session identically — sign-out always tears
 * down in-memory and persisted state regardless of the backend result
 * (Requirements 10.2, 10.3) — so this is a coarse success/failure signal used
 * only for diagnostics, never to gate teardown.
 */
export type SignOutResult =
  | { readonly kind: 'success' }
  | { readonly kind: 'failure' };

/**
 * The backend-call seam the {@link SessionManager} depends on for refresh and
 * sign-out.
 *
 * This is a minimal, typed boundary — the real facade (`api/authApi.ts`, task
 * 9.1) will implement it over the generated `@pitchmate/api-client`, adapting
 * transport/HTTP concerns onto the {@link RefreshResult} / {@link SignOutResult}
 * shapes. Keeping it behind an interface means the Session model is tested with
 * a hand-written fake and carries no knowledge of `openapi-fetch` or HTTP.
 */
export interface AuthApi {
  /**
   * Exchange the current Refresh_Token for a rotated {@link Session}.
   * Consumed by {@link SessionManager.getAccessTokenForRequest} (task 7.6).
   */
  refresh(refreshToken: string): Promise<RefreshResult>;
  /**
   * Revoke the current Refresh_Token server-side.
   * Consumed by {@link SessionManager.signOut} (task 7.10).
   */
  signOut(refreshToken: string): Promise<SignOutResult>;
}

/**
 * The injected collaborators and tunables a {@link SessionManager} needs.
 *
 * Everything the manager touches beyond its own in-memory state arrives here,
 * so the model is fully deterministic and testable: no global clock, no direct
 * storage or network access, no navigation side effect it performs itself.
 */
export interface SessionManagerDeps {
  /** Persistence seam; the manager loads/saves/clears through it (Req 8.3, 8.5). */
  readonly storage: SessionStore;
  /** Backend refresh/sign-out seam, used by tasks 7.6/7.10. */
  readonly api: AuthApi;
  /** Injected time source, in epoch milliseconds (Requirement 9.6). */
  readonly now: () => number;
  /** Renewal margin in ms, already clamped by the caller (task 7.6 uses it). */
  readonly renewalMarginMs: number;
  /** Per-attempt refresh timeout in ms; default 10_000 (task 7.6 uses it). */
  readonly refreshTimeoutMs: number;
  /** Sign-out call timeout in ms; must be <= 5_000 (task 7.10 uses it). */
  readonly signOutTimeoutMs: number;
  /** Invoked when the Session becomes unrecoverable, to route to Log_In_Screen. */
  readonly onUnauthenticated: () => void;
}

/**
 * The client session model contract.
 *
 * The four core methods ({@link SessionManager.bootstrap},
 * {@link SessionManager.establish}, {@link SessionManager.getState},
 * {@link SessionManager.subscribe}) are implemented in task 7.2; the two async
 * methods are completed in tasks 7.6 and 7.10.
 */
export interface SessionManager {
  /** Restore a persisted Session at startup, else discard it (Req 8.3, 8.4, 8.5). */
  bootstrap(): AuthState;
  /** Replace and persist the current Session, notifying subscribers (Req 8.1). */
  establish(session: Session): void;
  /** Report the current auth state (Req 8.7). */
  getState(): AuthState;
  /**
   * Return a bearer token for the current request, refreshing first if needed.
   * Just-in-time single-flight refresh (Requirements 9.1, 9.5) — task 7.6.
   */
  getAccessTokenForRequest(): Promise<
    { token: string } | { error: 'refresh-failed' } | { error: 'unauthenticated' }
  >;
  /** Explicit sign-out; always ends unauthenticated (Requirements 10.*) — task 7.10. */
  signOut(): Promise<void>;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: AuthState) => void): () => void;
}

/**
 * The concrete {@link SessionManager}, closing over injected {@link SessionManagerDeps}.
 *
 * State is held in two private fields kept mutually consistent:
 * - `currentSession` — the in-memory {@link Session}, or `null` when none is held.
 *   This is the single source of truth for {@link getState}: `authenticated` iff
 *   it is non-null (Requirement 8.7).
 * - `listeners` — the set of state-change subscribers, notified on every
 *   transition (establish now; refresh/sign-out in later tasks).
 */
class DefaultSessionManager implements SessionManager {
  private readonly deps: SessionManagerDeps;
  private currentSession: Session | null = null;
  private readonly listeners = new Set<(state: AuthState) => void>();
  /**
   * The single in-flight refresh, or `null` when none is running.
   *
   * This is the single-flight latch (Requirement 9.5): the first caller that
   * finds a refresh is required starts the refresh and stores its promise here;
   * every concurrent caller that arrives while it is non-null awaits the SAME
   * promise instead of starting another backend call. It is reset to `null` in
   * a `finally` once the refresh settles, so a later expiry can start a fresh
   * one. The promise resolves to the shared caller-facing outcome (a token on
   * success, or `refresh-failed` on either an invalid/expired Refresh_Token or
   * exhausted transport retries).
   */
  private pendingRefresh: Promise<
    { token: string } | { error: 'refresh-failed' }
  > | null = null;
  /**
   * The single in-flight sign-out, or `null` when none is running.
   *
   * This is the sign-out concurrency guard (Requirement 10.5): the first caller
   * starts the sign-out and latches its promise here; any concurrent caller
   * that arrives while it is non-null joins the SAME promise instead of starting
   * a second backend sign-out or a duplicate teardown. It is reset to `null` in
   * a `finally` once the sign-out settles, so a later session can be signed out
   * again.
   */
  private pendingSignOut: Promise<void> | null = null;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
  }

  /**
   * Restore a usable Session from persistence at app start, or discard partial
   * state and report `unauthenticated`.
   *
   * Delegates the validity decision to {@link SessionStore.load}, which returns
   * `null` whenever persisted state is absent or cannot be interpreted as a
   * valid Session because a token is missing (Requirement 8.5). On a valid
   * result the Session becomes the in-memory current Session and the state is
   * `authenticated` (Requirement 8.4); the persisted bytes are already correct,
   * so no re-save is needed (persistence survives a full-document reload —
   * Requirement 8.3). On `null` any partial persisted state is proactively
   * cleared so a later reload cannot resurrect it, no Session is held, and the
   * state is `unauthenticated` (Requirement 8.5).
   *
   * This does not notify subscribers: bootstrap runs before any listener is
   * attached, and callers read the returned {@link AuthState} directly.
   *
   * Requirements: 8.3, 8.4, 8.5
   */
  bootstrap(): AuthState {
    const persisted = this.deps.storage.load();

    if (persisted === null) {
      // Absent or partial persisted state: discard it and stay unauthenticated.
      this.deps.storage.clear();
      this.currentSession = null;
      return 'unauthenticated';
    }

    this.currentSession = toSession(persisted);
    return 'authenticated';
  }

  /**
   * Replace the current Session with the given one and persist it atomically,
   * then notify subscribers.
   *
   * The in-memory Session and the persisted state are updated together so both
   * reflect the new Session (Requirements 8.1, 8.3). Persistence is best-effort
   * at the storage layer, but the in-memory Session is the authoritative source
   * of truth, so it is set unconditionally. Subscribers are notified after the
   * state is fully in place, moving observers to `authenticated`.
   *
   * Requirements: 8.1, 8.3
   */
  establish(session: Session): void {
    this.deps.storage.save(toPersistedSession(session));
    this.currentSession = session;
    this.notify();
  }

  /**
   * Report the current auth state: `authenticated` iff a Session is currently
   * held, else `unauthenticated` (Requirement 8.7).
   */
  getState(): AuthState {
    return this.currentSession === null ? 'unauthenticated' : 'authenticated';
  }

  /**
   * Register a state-change listener and return an idempotent unsubscribe.
   *
   * Listeners are held in a set, so registering the same function twice is a
   * no-op and the returned unsubscribe removes exactly this registration. The
   * listener is invoked on every subsequent state transition (currently
   * {@link establish}; refresh/sign-out transitions are added in later tasks);
   * it is not called eagerly on subscribe — callers seed initial state via
   * {@link getState}.
   */
  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Return a bearer token for the current request, refreshing just-in-time.
   *
   * Decides, then acts:
   *
   * - No Session held → `unauthenticated`; there is nothing to present and
   *   nothing to refresh.
   * - A Session is held and {@link isRefreshRequired} is `false` → the current
   *   Access_Token is still comfortably valid, so it is returned as-is with no
   *   backend call (Requirement 9.1). The decision reads time only through the
   *   injected `now()` clock (Requirement 9.6).
   * - A Session is held and a refresh IS required → a just-in-time,
   *   single-flight refresh runs (Requirement 9.5): the first caller starts it,
   *   any concurrent caller joins the same in-flight refresh, and all callers
   *   receive the one shared outcome. On success the token pair is rotated and
   *   the new Access_Token is returned (Requirement 9.2); on an invalid/expired
   *   Refresh_Token the Session is torn down and the caller gets `refresh-failed`
   *   (Requirement 9.3); on repeated transport failures the Session is retained
   *   and the caller gets `refresh-failed` (Requirement 9.4).
   *
   * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
   */
  async getAccessTokenForRequest(): Promise<
    { token: string } | { error: 'refresh-failed' } | { error: 'unauthenticated' }
  > {
    const session = this.currentSession;
    if (session === null) {
      return { error: 'unauthenticated' };
    }

    const refreshRequired = isRefreshRequired({
      expiresAtMs: session.expiresAtMs,
      nowMs: this.deps.now(),
      renewalMarginMs: this.deps.renewalMarginMs,
    });
    if (!refreshRequired) {
      // Access_Token still valid within the renewal margin — no backend call.
      return { token: session.accessToken };
    }

    return this.refreshSingleFlight();
  }

  /**
   * Perform or join the single in-flight refresh (Requirement 9.5).
   *
   * If no refresh is running, start one via {@link runRefresh} and latch its
   * promise in {@link pendingRefresh}; the `finally` clears the latch once the
   * refresh settles so a later expiry can start another. If a refresh is
   * already running, return the SAME promise so this caller joins it rather
   * than issuing a second backend call. Either way, every joined caller resolves
   * to the one shared outcome.
   */
  private refreshSingleFlight(): Promise<
    { token: string } | { error: 'refresh-failed' }
  > {
    if (this.pendingRefresh === null) {
      this.pendingRefresh = this.runRefresh().finally(() => {
        this.pendingRefresh = null;
      });
    }
    return this.pendingRefresh;
  }

  /**
   * Run the refresh routine: exchange the Refresh_Token, rotating on success,
   * tearing down on rejection, and retrying bounded transport failures.
   *
   * Attempts {@link AuthApi.refresh} up to three times total (the first attempt
   * plus two retries), driven by its {@link RefreshResult}:
   *
   * - `success` → rotate the token pair: persist the returned Session, adopt it
   *   as the current Session, and return its new Access_Token. The superseded
   *   Refresh_Token is dropped on the floor — no field or closure retains a
   *   reference to the old Session, so the rotated-out token cannot be reused
   *   (Requirement 9.2).
   * - `invalid-or-expired` → the Refresh_Token was rejected, so the Session is
   *   unrecoverable: clear persistence, drop the in-memory Session, notify
   *   subscribers of the move to `unauthenticated`, and invoke
   *   `onUnauthenticated` to route to Log_In_Screen. Return `refresh-failed`
   *   immediately without retrying (Requirement 9.3).
   * - `transport-failure` → an inconclusive timeout/network failure with no
   *   answer from the backend; loop to the next attempt. If every attempt fails
   *   this way, the Session is left untouched (still `authenticated`, still
   *   persisted) and the caller gets `refresh-failed` so it can back off and
   *   retry later (Requirement 9.4).
   *
   * Per-attempt wall-clock bounding by `refreshTimeoutMs` is owned by the
   * {@link AuthApi} facade, which surfaces a lapsed timeout as a
   * `transport-failure`; this loop treats that signal as the failure, keeping
   * the model deterministic and free of real timers.
   *
   * Requirements: 9.2, 9.3, 9.4
   */
  private async runRefresh(): Promise<
    { token: string } | { error: 'refresh-failed' }
  > {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const session = this.currentSession;
      if (session === null) {
        // Session was torn down concurrently; nothing left to refresh.
        return { error: 'refresh-failed' };
      }

      const result = await this.deps.api.refresh(session.refreshToken);

      if (result.kind === 'success') {
        // Rotate: adopt the new Session and persist it, discarding the old
        // token pair entirely (Requirement 9.2).
        this.deps.storage.save(toPersistedSession(result.session));
        this.currentSession = result.session;
        return { token: result.session.accessToken };
      }

      if (result.kind === 'invalid-or-expired') {
        // Unrecoverable: tear down and route to Log_In_Screen (Requirement 9.3).
        this.deps.storage.clear();
        this.currentSession = null;
        this.notify();
        this.deps.onUnauthenticated();
        return { error: 'refresh-failed' };
      }

      // transport-failure: fall through to retry the next attempt.
    }

    // Every attempt failed inconclusively: retain the Session (Requirement 9.4).
    return { error: 'refresh-failed' };
  }

  /**
   * Explicit sign-out that always ends unauthenticated.
   *
   * Best-effort revoke, then unconditional local teardown:
   *
   * - When a Session is held, the backend sign-out endpoint is called with the
   *   current Refresh_Token so the server can revoke it (Requirement 10.1). The
   *   call is bounded by `signOutTimeoutMs` (at most 5 seconds — Requirement
   *   10.3): it races the backend call against a timer that resolves rather than
   *   rejects, and any rejection from the call itself is caught, so neither a
   *   hanging backend nor a transport error can block or escape teardown. When
   *   no Session is held there is no Refresh_Token to revoke, so the backend
   *   call is skipped and teardown still runs idempotently.
   * - Regardless of whether the backend call succeeded, failed, rejected, or
   *   timed out, the local Session is torn down unconditionally: persisted state
   *   is cleared, the in-memory Session is dropped, and subscribers are notified
   *   so observers move to `unauthenticated` (Requirements 10.2, 10.3). This is
   *   what guarantees a reload after sign-out cannot restore a usable Session.
   *
   * Concurrency is guarded by {@link pendingSignOut} (Requirement 10.5): a
   * second sign-out that arrives while one is in flight joins the same promise
   * instead of starting another backend call or a duplicate teardown; the latch
   * is cleared once the sign-out settles.
   *
   * This does NOT navigate anywhere: routing to the Public_Post_Sign_Out_Route
   * (Requirement 10.4) is wired at the app edge (task 19.1). `onUnauthenticated`
   * is deliberately not invoked here — sign-out only tears down local state and
   * publishes the state change.
   *
   * Requirements: 10.1, 10.2, 10.3, 10.5
   */
  async signOut(): Promise<void> {
    // Concurrency guard: join an in-flight sign-out rather than starting a
    // second one (Requirement 10.5).
    if (this.pendingSignOut === null) {
      this.pendingSignOut = this.runSignOut().finally(() => {
        this.pendingSignOut = null;
      });
    }
    return this.pendingSignOut;
  }

  /**
   * Run the sign-out routine: best-effort backend revoke, then unconditional
   * local teardown.
   *
   * The backend call (Requirement 10.1) is attempted only when a Session — and
   * therefore a Refresh_Token — is actually held; it is bounded by
   * `signOutTimeoutMs` and can never reject or hang past the timeout, because
   * teardown must always win (Requirements 10.2, 10.3). Teardown then runs for
   * every outcome.
   */
  private async runSignOut(): Promise<void> {
    const session = this.currentSession;
    if (session !== null) {
      // Best-effort revoke, bounded by the sign-out timeout; swallow every
      // failure so teardown always proceeds (Requirements 10.1, 10.3).
      await this.callSignOutWithinTimeout(session.refreshToken);
    }

    // Unconditional teardown for every outcome (Requirements 10.2, 10.3).
    this.deps.storage.clear();
    if (this.currentSession !== null) {
      this.currentSession = null;
      this.notify();
    }
  }

  /**
   * Call {@link AuthApi.signOut}, bounded by `signOutTimeoutMs`, resolving
   * (never rejecting) on backend rejection or timeout.
   *
   * The backend promise is raced against a `setTimeout`-based timer that
   * resolves once the bound (at most 5 seconds — Requirement 10.3) elapses, so
   * a slow or hanging backend cannot block teardown. The backend call is wrapped
   * so any rejection is contained rather than escaping. When the backend answers
   * first the timer is cleared to avoid leaving a dangling timeout / open handle.
   */
  private callSignOutWithinTimeout(refreshToken: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(finish, this.deps.signOutTimeoutMs);

      this.deps.api.signOut(refreshToken).then(finish, finish);
    });
  }

  /**
   * Notify every subscribed listener of the current {@link AuthState}.
   *
   * The state is computed once via {@link getState} and passed to each listener.
   * Iterating a copy guards against listeners that subscribe/unsubscribe during
   * notification, avoiding mutation-during-iteration surprises.
   */
  private notify(): void {
    const state = this.getState();
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}

/** Narrow a {@link PersistedSession} to the in-memory {@link Session} shape. */
function toSession(persisted: PersistedSession): Session {
  return {
    accessToken: persisted.accessToken,
    refreshToken: persisted.refreshToken,
    expiresAtMs: persisted.expiresAtMs,
  };
}

/** Project an in-memory {@link Session} onto the {@link PersistedSession} shape. */
function toPersistedSession(session: Session): PersistedSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAtMs: session.expiresAtMs,
  };
}

/**
 * Create a {@link SessionManager} over the given {@link SessionManagerDeps}.
 *
 * This factory is the module's public entry point; the concrete class stays
 * private so consumers depend only on the {@link SessionManager} contract and
 * inject their own storage, API, clock, margins, timeouts, and unauthenticated
 * navigation callback.
 */
export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  return new DefaultSessionManager(deps);
}
