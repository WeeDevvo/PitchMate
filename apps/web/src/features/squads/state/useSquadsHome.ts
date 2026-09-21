/**
 * The Squads_Home's load machine — one reducer-backed hook holding the displayed
 * Squad_Summary collection and issuing every `ListMySquads` call.
 *
 * The screen renders from this machine and calls nothing itself, which is what
 * makes "one call per mount" a structural fact rather than an aspiration
 * (Requirement 1.1): there is exactly one issue site below, guarded by one latch.
 *
 * ### Five behaviours worth stating
 *
 * 1. **One call per mount, none from a re-render** (Requirement 1.1). A
 *    `startedRef` latch closes on the first issued call and only the unmount
 *    cleanup reopens it, so a remount is a fresh mount and a re-render is not.
 *    The injected api is read through a ref, so a caller re-creating the facade
 *    on a render cannot issue a second call either.
 * 2. **Nothing at all while unauthenticated** (Requirement 1.13). Mounting while
 *    the Auth_State is `unauthenticated` issues no call and holds no collection,
 *    so no squad data is requested outside an authenticated session. A later
 *    transition *to* `authenticated` within the same mount issues the one call
 *    the mount owed.
 * 3. **A `discarded` latch** (Requirements 1.11, 17.5). Unmounting, or the
 *    Auth_State transitioning to `unauthenticated`, aborts the call awaiting a
 *    response through the caller `AbortSignal` the Squads_Api accepts, discards
 *    the displayed collection, and closes a latch so no Squad_Summary is ever
 *    accepted afterwards. The latch is belt-and-braces: every call also carries a
 *    token, and discarding bumps the token, so a late response is unacceptable
 *    even where the latch has been reopened by a remount.
 * 4. **A held collection survives a refresh, and does not survive a failure**
 *    (Requirements 1.15, 2.5). `refreshing` keeps the previously accepted
 *    summaries rendered alongside a busy state; `failed` holds none, because the
 *    failure surface renders no Squad_Card.
 * 5. **`listed` carries the collection, empty or not** (Requirement 2.1). The
 *    machine invents no `empty` state: an accepted empty collection is `listed`
 *    with nothing in it, and the screen renders the Squads_Empty_State from that.
 *
 * ### No copy, no backend detail
 *
 * Every non-success arm of `CallResult` — `not-found`, `auth-failure`,
 * `rejected-input`, `timeout`, `transport-failure`, `parse-failure` — folds into
 * the single `failed` phase (Requirements 2.5, 17.2). The machine carries no
 * status code, no rejection reason, and no backend text, and holds no message of
 * its own: the screen reads `lib/messages.ts`. `auth-failure` is deliberately not
 * special-cased into a session handover here — it renders the same generic
 * failure as any other, and it renders no squad data, which is what Requirement
 * 17.5 asks of it. The Auth_Feature owns session ending, and the App_Shell's
 * Route_Guard owns the boundary.
 *
 * ### No retry of its own
 *
 * Nothing here re-issues a call by itself (Requirement 17.4). {@link
 * SquadsHomeMachine.retry} is issued by a person activating the retry control —
 * and by the post-create/post-join fallback, which is likewise a consequence of
 * an activation. A further activation while a call awaits a response is ignored,
 * so one activation yields exactly one call (Requirement 2.6).
 *
 * The 10-second Squad_Call_Timeout, the abort chaining, and the
 * one-request-per-method discipline all belong to `api/squadsApi.ts`; none of it
 * is reimplemented here.
 *
 * Requirements: 1.1, 1.10, 1.11, 1.13, 1.15, 2.1, 2.5, 2.6, 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { orderSquadSummaries } from '../lib/squadOrder';

// --- State ------------------------------------------------------------------

/**
 * How far the `ListMySquads` load has got.
 *
 * - `idle` — nothing issued: before the mount call, and after the `discarded`
 *   latch closes.
 * - `loading` — a call awaits a response and **no** collection is held
 *   (Requirement 1.10).
 * - `refreshing` — a call awaits a response and a previously accepted collection
 *   **is** held, which keeps rendering (Requirement 1.15).
 * - `listed` — a collection has been accepted; it may be empty (Requirement 2.1).
 * - `failed` — the call did not yield a collection, whatever the reason
 *   (Requirement 2.5).
 */
export type SquadsHomePhase =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'listed'
  | 'failed';

/**
 * Everything the Squads_Home renders from.
 *
 * `summaries` is `null` for "no collection held" and an array — possibly empty —
 * for "this collection was accepted". The distinction is the one the requirements
 * turn on: `loading` versus `refreshing` (Requirements 1.10, 1.15), and an
 * accepted empty collection versus no collection at all (Requirement 2.1).
 */
export interface SquadsHomeState {
  /** How far the load has got. */
  readonly phase: SquadsHomePhase;
  /**
   * The accepted Squad_Summary collection **already in rendered order**, or
   * `null` when none is held. Ordering happens once, on acceptance, through the
   * pure `orderSquadSummaries` (Requirements 1.3, 1.4).
   */
  readonly summaries: readonly SquadSummary[] | null;
}

/** The initial state: nothing issued, nothing held. */
export function initialSquadsHomeState(): SquadsHomeState {
  return { phase: 'idle', summaries: null };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * No action carries a status code, a rejection reason, or a response body value:
 * `failed` carries nothing at all, so there is nothing of the backend's wording
 * to leak into the interface (Requirement 17.2).
 */
export type SquadsHomeAction =
  | { readonly type: 'requested' }
  | { readonly type: 'accepted'; readonly summaries: readonly SquadSummary[] }
  | { readonly type: 'failed' }
  | { readonly type: 'discarded' };

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it.
 */
export function reduceSquadsHome(
  state: SquadsHomeState,
  action: SquadsHomeAction,
): SquadsHomeState {
  switch (action.type) {
    // 1.10, 1.15: which busy phase a call enters is decided by whether a
    // collection is held, not by which control issued it — so the retry control
    // and the post-create fallback need no phase knowledge of their own.
    case 'requested':
      return state.summaries === null
        ? { phase: 'loading', summaries: null }
        : { phase: 'refreshing', summaries: state.summaries };

    // 1.2, 2.1: exactly the parsed collection, ordered once here, empty or not.
    case 'accepted':
      return {
        phase: 'listed',
        summaries: orderSquadSummaries(action.summaries),
      };

    // 2.5: the failure surface renders no Squad_Card and no Squads_Empty_State,
    // so the held collection goes with the failure rather than lingering behind
    // it. A retry from here therefore enters `loading`, which is what Requirement
    // 2.6 asks for.
    case 'failed':
      return { phase: 'failed', summaries: null };

    // 1.11, 17.5: an ended session or a departed screen displays no squad data.
    case 'discarded':
      return initialSquadsHomeState();

    default:
      return state;
  }
}

// --- Hook surface -----------------------------------------------------------

/** Options for {@link useSquadsHome}. Every seam is injected. */
export interface SquadsHomeOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The Auth_State, as the Auth_Feature's `useAuth().state` reports it. No call
   * is issued while it is `unauthenticated` (Requirement 1.13), and a transition
   * to `unauthenticated` closes the `discarded` latch (Requirements 1.11, 17.5).
   *
   * Defaults to `authenticated` so the machine can be driven without an
   * `AuthProvider`; the Squads_Home supplies the real value.
   */
  readonly authState?: AuthState;
}

/** What the Squads_Home reads and activates. */
export interface SquadsHomeMachine extends SquadsHomeState {
  /**
   * Whether a `ListMySquads` call awaits a response — the programmatically
   * determinable busy state of Requirements 1.10 and 1.15, true in both the
   * nothing-held and the collection-held case.
   */
  readonly busy: boolean;
  /** Whether the generic failure surface is displayed (Requirement 2.5). */
  readonly failed: boolean;
  /**
   * Issue exactly one further `ListMySquads` call.
   *
   * This is the retry control's only behaviour (Requirement 2.6) and the
   * post-create / post-join fallback's only behaviour, both of which are
   * activations by a person; nothing re-issues itself (Requirement 17.4).
   *
   * A no-op while a call awaits a response, and a no-op once the `discarded`
   * latch has closed.
   */
  retry(): void;
}

/**
 * Run the Squads_Home load machine.
 *
 * Mounting while `authenticated` issues exactly one `ListMySquads` call, and no
 * re-render issues another (Requirement 1.1). Mounting while `unauthenticated`
 * issues none (Requirement 1.13). Unmounting, or the Auth_State transitioning to
 * `unauthenticated`, aborts the call awaiting a response and disregards its
 * outcome (Requirements 1.11, 17.5).
 *
 * Requirements: 1.1, 1.10, 1.11, 1.13, 1.15, 2.1, 2.5, 2.6, 17.2, 17.4, 17.5
 */
export function useSquadsHome(options: SquadsHomeOptions): SquadsHomeMachine {
  const { api, authState = 'authenticated' } = options;

  const [state, rawDispatch] = useReducer(
    reduceSquadsHome,
    undefined,
    initialSquadsHomeState,
  );

  // The state as of the last *dispatch* rather than the last render, so the
  // single-flight decision and the busy-phase choice are made against current
  // values. The reducer is pure, so folding it twice costs nothing, and this
  // avoids a second source of truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: SquadsHomeAction): void => {
    stateRef.current = reduceSquadsHome(stateRef.current, action);
    rawDispatch(action);
  }, []);

  // The injected facade, held by reference and synchronised in an effect rather
  // than during render. Declared before the mount effect so it has run by the
  // time that effect reads it.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  /** The call awaiting a response, so the latch can abort it (Req 1.11, 17.5). */
  const controllerRef = useRef<AbortController | null>(null);
  /**
   * The token of the most recently issued call. Discarding bumps it, which makes
   * every outstanding response unacceptable independently of the latch below —
   * so a response arriving after this screen was left can never be accepted,
   * even though a remount reopens the latch.
   */
  const callTokenRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirements 1.11, 17.5). */
  const discardedRef = useRef(false);
  /** Whether this mount has already issued its one call (Requirement 1.1). */
  const startedRef = useRef(false);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon everything: abort the call awaiting a response, make every
   * outstanding response unacceptable, and display no squad data.
   *
   * Used by the unmount cleanup and by the transition to `unauthenticated`
   * (Requirements 1.11, 17.5). Idempotent, so several triggers in one tick do the
   * work once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    callTokenRef.current += 1;

    controllerRef.current?.abort();
    controllerRef.current = null;

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  /**
   * Issue one `ListMySquads` call.
   *
   * The only issue site in the feature for this endpoint. It is called from the
   * mount effect and from {@link SquadsHomeMachine.retry}, and it issues exactly
   * one request per call — the Squads_Api never retries, and neither does this
   * (Requirement 17.4).
   */
  const issueCall = useCallback((): void => {
    if (discardedRef.current) {
      return;
    }

    // 2.6: one activation, one call. A further activation while a call awaits a
    // response changes nothing rather than stacking a second call behind it.
    const { phase } = stateRef.current;
    if (phase === 'loading' || phase === 'refreshing') {
      return;
    }

    const token = callTokenRef.current + 1;
    callTokenRef.current = token;

    const controller = new AbortController();
    controllerRef.current = controller;

    dispatch({ type: 'requested' });

    /**
     * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
     * settles every outcome into a `CallResult`, so `null` is defence against a
     * seam that throws rather than an expected path.
     */
    const settle = (result: CallResult<readonly SquadSummary[]> | null): void => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      // 1.11, 17.5: a response for a discarded machine, or for a superseded
      // call, changes nothing at all — no summaries, no failure, no message.
      if (discardedRef.current || token !== callTokenRef.current) {
        return;
      }

      if (result !== null && result.kind === 'success') {
        dispatch({ type: 'accepted', summaries: result.value });
        return;
      }

      // 2.5, 17.2: every other arm — not-found, auth-failure, rejected-input,
      // timeout, transport-failure, parse-failure — is the same generic failure,
      // carrying nothing of the backend's own wording.
      dispatch({ type: 'failed' });
    };

    void apiRef.current.listMySquads(controller.signal).then(settle, () => {
      settle(null);
    });
  }, [dispatch]);

  /**
   * The mount and Auth_State effect.
   *
   * Its dependencies do not change on a re-render, so no re-render issues a call
   * (Requirement 1.1). A transition to `unauthenticated` discards; a mount while
   * `unauthenticated` simply waits, issuing nothing (Requirement 1.13).
   */
  useEffect(() => {
    const previous = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;

    if (authState !== 'authenticated') {
      // 1.11, 17.5: only a *transition* from an authenticated session is a loss
      // of session. Mounting while unauthenticated has nothing to abandon, and
      // latching there would deny the one call a later sign-in owes.
      if (previous === 'authenticated') {
        discard();
      }
      return;
    }

    // 1.1: one call per mount. The latch also covers the authenticated-later
    // case: whichever effect run issues the call, no other run issues a second.
    if (discardedRef.current || startedRef.current) {
      return;
    }

    startedRef.current = true;
    issueCall();
  }, [authState, discard, issueCall]);

  // 1.11, 17.5: leaving the Squads_Home aborts the call awaiting a response and
  // disregards it. `startedRef` and the latch are reopened so a remount is a
  // fresh mount with exactly one call; the bumped call token keeps the abandoned
  // call's response unacceptable regardless.
  useEffect(() => {
    return () => {
      discard();
      startedRef.current = false;
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  const retry = useCallback((): void => {
    issueCall();
  }, [issueCall]);

  return useMemo(
    () => ({
      phase: state.phase,
      summaries: state.summaries,
      busy: state.phase === 'loading' || state.phase === 'refreshing',
      failed: state.phase === 'failed',
      retry,
    }),
    [retry, state.phase, state.summaries],
  );
}
