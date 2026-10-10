/**
 * The Player_Stats_Screen's load machine — one reducer-backed hook holding the
 * last accepted Player_Profile and issuing every `GetPlayerProfile` call.
 *
 * The screen renders from this machine and calls nothing itself, which is what
 * makes "one call per subject" a structural fact rather than an aspiration
 * (Requirements 2.1, 2.4): there is exactly one issue site below, guarded by one
 * latch and one subject key.
 *
 * ### One slot, keyed on the subject
 *
 * There is a single slot — the Player_Profile — moving through
 * `loading → loaded | notFound | failed`, plus `refreshing` while a held profile
 * is re-read. The one structural difference from the Squads_Feature's
 * `useSquadScreen` is that the slot is **keyed on the subject rather than on the
 * mount**: a Pairwise_Link navigates from one profile to another *on the same
 * route pattern*, so `react-router` keeps the screen mounted and only the
 * parameters change. {@link PlayerStatsState.subjectKey} is what lets the
 * machine and the screen tell "the state describes the subject on screen" from
 * "the state describes the subject we just left" (Requirement 2.4).
 *
 * ### Five behaviours worth stating
 *
 * 1. **A held profile survives a refresh, and does not survive a failure.**
 *    `refreshing` keeps the previously accepted profile rendered alongside a
 *    busy state (Requirement 2.3); `loading` holds none, which is the state
 *    Requirement 2.2 renders as a bare loading indication.
 * 2. **`notFound` and `failed` are different phases.** Only the api's
 *    `not-found` reaches `notFound`; every other non-success arm reaches
 *    `failed`, which the screen renders as the Generic_Profile_Failure plus a
 *    retry control and **never** as the Not_Found_Treatment (Requirements 3.1,
 *    4.1, 4.3).
 * 3. **An unidentifiable subject is a `notFound`, not a failure.** A route whose
 *    squad identity or membership identity is not a well-formed identifier
 *    issues no call at all and short-circuits to the same phase a concealed
 *    absence reaches, so a malformed path is presented identically to an
 *    inaccessible one (Requirement 3.3).
 * 4. **Neither failing phase holds a profile.** `notFound`, `failed`, and
 *    `unidentifiable` each clear the held value, so no partially populated
 *    profile can linger behind a failure (Requirements 3.1, 4.1).
 * 5. **Nothing re-issues a call by itself** (Requirement 2.6). A `requested`
 *    action is always the consequence of a mount, a change of subject, or a
 *    person activating the retry control.
 *
 * ### No copy, no backend detail, no retry of its own
 *
 * No action and no state field carries a status code, a rejection reason, or a
 * response body value (Requirements 3.7, 12.5) — `notFound` and `failed` carry
 * nothing at all. The screen reads every user-facing string from
 * `lib/messages.ts`; this module holds none. The Profile_Call_Timeout, the abort
 * chaining, and the outcome classification all belong to `api/playerStatsApi.ts`
 * and `lib/callOutcome.ts`; none of it is reimplemented here.
 *
 * Requirements: 2.2, 2.3, 2.7, 3.1, 4.1
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { subjectKey, type Subject } from '../lib/subject';

// --- State ------------------------------------------------------------------

/**
 * How far the `GetPlayerProfile` load has got.
 *
 * - `idle` — nothing issued: before the first call, and after the `discarded`
 *   latch closes.
 * - `loading` — a call awaits a response and **no** Player_Profile is held,
 *   which is the state that renders a bare loading indication and no profile
 *   value (Requirement 2.2).
 * - `refreshing` — a call awaits a response and a previously accepted
 *   Player_Profile **is** held, which keeps rendering beside a busy state
 *   (Requirement 2.3).
 * - `notFound` — the call reported not-found, or the requested subject was not
 *   syntactically valid and no call was issued at all (Requirement 3.3). The
 *   screen renders the Not_Found_Treatment and nothing else (Requirement 3.1).
 * - `failed` — the call did not yield a Player_Profile for any other reason: a
 *   transport failure, our own lapsed Profile_Call_Timeout, or a body the
 *   Response_Parser rejected. Never the Not_Found_Treatment (Requirements 4.1,
 *   4.3).
 */
export type ProfilePhase =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'loaded'
  | 'notFound'
  | 'failed';

/**
 * Everything the Player_Stats_Screen renders from: the phase, the held profile,
 * and the subject the state describes.
 *
 * A held profile is `null` for "nothing held", which is the distinction
 * Requirements 2.2 and 2.3 turn on — `loading` versus `refreshing` — and the one
 * Requirements 3.1 and 4.1 turn on, since neither boundary presentation renders
 * a profile value.
 */
export interface PlayerStatsState {
  /** How far the `GetPlayerProfile` load has got. */
  readonly phase: ProfilePhase;
  /** The accepted Player_Profile, or `null` when none is held. */
  readonly profile: PlayerProfile | null;
  /**
   * The `subjectKey` of the subject this state describes — the subject the most
   * recent request was issued for, and therefore the subject a held profile
   * belongs to and an outcome pertains to.
   *
   * `null` in the initial state, after a `discarded`, and for an unidentifiable
   * subject, because none of the three describes a subject at all. Recorded from
   * the `requested` action rather than from the response, because no other
   * action carries a subject: `accepted` carries the profile alone, so what the
   * profile belongs to is what was asked for.
   *
   * This is the value that makes a Pairwise_Link navigation to a sibling profile
   * a fresh load rather than a stale render (Requirement 2.4): the key the
   * screen holds and the key here differ until the new subject's own request is
   * recorded.
   */
  readonly subjectKey: string | null;
}

/** The initial state: nothing issued, nothing held, no subject described. */
export function initialPlayerStatsState(): PlayerStatsState {
  return { phase: 'idle', profile: null, subjectKey: null };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * No action carries a status code, a rejection reason, or a response body value
 * beyond the parsed profile itself: `notFound` and `failed` carry **nothing at
 * all**, so there is nothing of the backend's wording, status, or existence
 * claims to leak into the interface (Requirements 3.7, 12.5). There is no
 * authentication-failure action either, because the endpoint conceals an absent
 * session behind the same not-found response as an absent player and the api's
 * outcome union has no such arm (Requirement 3.4).
 */
export type PlayerStatsAction =
  /** Either route identity is not a well-formed identifier (Requirement 3.3). */
  | { readonly type: 'unidentifiable' }
  /** One call has been issued for the named subject. */
  | { readonly type: 'requested'; readonly subjectKey: string }
  | { readonly type: 'accepted'; readonly profile: PlayerProfile }
  | { readonly type: 'notFound' }
  | { readonly type: 'failed' }
  | { readonly type: 'discarded' };

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it without a browser
 * (Requirement 2.7).
 *
 * Two rules carry most of the behaviour:
 *
 * - **Which busy phase a request enters is decided by whether a profile is
 *   held**, not by which control issued it — so the mount effect, the
 *   subject-change effect, and the retry control need no phase knowledge of
 *   their own (Requirements 2.2, 2.3).
 * - **Every settled non-success clears the held profile**, so a boundary
 *   presentation can never render a partially populated profile beside it
 *   (Requirements 3.1, 4.1).
 *
 * @param state the current state
 * @param action the action to apply
 * @returns the next state, for every state and every action
 *
 * Requirements: 2.2, 2.3, 2.7, 3.1, 4.1
 */
export function reducePlayerStats(
  state: PlayerStatsState,
  action: PlayerStatsAction,
): PlayerStatsState {
  switch (action.type) {
    // 3.3: no call was issued, and there is no well-formed subject to describe.
    // Presented identically to a concealed not-found, which is the whole point.
    case 'unidentifiable':
      return { phase: 'notFound', profile: null, subjectKey: null };

    // 2.2, 2.3: a held profile keeps rendering through a re-read; with none
    // held there is nothing to render but the loading indication.
    case 'requested':
      return {
        phase: state.profile === null ? 'loading' : 'refreshing',
        profile: state.profile,
        subjectKey: action.subjectKey,
      };

    // The parsed Player_Profile, exactly as the Response_Parser produced it. The
    // subject carries over from the request it answers.
    case 'accepted':
      return { ...state, phase: 'loaded', profile: action.profile };

    // 3.1: the Not_Found_Treatment renders no Player_Display_Name, no record, no
    // rating, no progression, no Pairwise_Section, and no Rich_Stats value, so
    // the held profile goes with it. The subject stays, because the outcome
    // pertains to it.
    case 'notFound':
      return { ...state, phase: 'notFound', profile: null };

    // 4.1: the failure surface renders no partially populated profile, so the
    // held profile goes with the failure rather than lingering behind it. A
    // retry from here therefore enters `loading` (Requirement 2.8).
    case 'failed':
      return { ...state, phase: 'failed', profile: null };

    // 2.5: an ended session or a departed screen displays no profile value.
    case 'discarded':
      return initialPlayerStatsState();

    default:
      return state;
  }
}
// --- Hook surface -----------------------------------------------------------

/**
 * The issue guard's stand-in key for "the route carries no valid subject".
 *
 * The guard compares one string, so the unidentifiable case needs a value of
 * its own: `null` already means "nothing has been issued for the current
 * subject", and conflating the two would make a malformed route re-dispatch
 * `unidentifiable` on every render, or — worse — make a navigation *away* from a
 * malformed route look like no change at all.
 *
 * It cannot collide with a real key: `subjectKey` writes the squad identity's
 * length ahead of the pair, so every key it produces begins with a decimal
 * digit, and this one begins with a character no key and no identity contains.
 */
const NO_SUBJECT_ISSUE_KEY = '\u0000no-subject';

/** Options for {@link usePlayerStatsScreen}. Every seam is injected. */
export interface PlayerStatsScreenOptions {
  /**
   * The Player_Stats_Api facade — the feature's only transport seam. Its
   * identity is read through a ref, so re-creating it on a render issues no
   * further call (Requirement 2.1).
   */
  readonly api: PlayerStatsApi;
  /**
   * The subject to present, as `readSubject` resolved it from the route's two
   * parameters — or `null` when either identity is not a well-formed
   * identifier.
   *
   * A `null` subject issues **no call at all** and short-circuits to the same
   * phase a concealed absence reaches (Requirement 3.3). A *change* of subject
   * abandons the call in flight and issues exactly one call for the new one
   * (Requirement 2.4); an unchanged subject issues nothing, however often the
   * screen re-renders and however often a new `Subject` object carrying the same
   * pair is handed in — the guard compares `subjectKey`, not object identity.
   */
  readonly subject: Subject | null;
  /**
   * The Auth_State, as the Auth_Feature's `useAuth().state` reports it. No call
   * is issued while it is `unauthenticated` (Requirement 1.8), and a transition
   * *from* `authenticated` to `unauthenticated` closes the `discarded` latch
   * (Requirement 2.5).
   *
   * Defaults to `authenticated` so the machine can be driven without an
   * `AuthProvider`; the Player_Stats_Screen supplies the real value.
   */
  readonly authState?: AuthState;
}

/** What the Player_Stats_Screen reads and activates. */
export interface PlayerStatsScreenMachine extends PlayerStatsState {
  /**
   * Whether a `GetPlayerProfile` call awaits a response — the programmatically
   * determinable busy state of Requirements 2.2 and 2.3, true in both the
   * nothing-held and the profile-held case.
   */
  readonly busy: boolean;
  /**
   * Whether the Not_Found_Treatment is displayed — for a not-found result and
   * for an unidentifiable subject alike, which is what makes the two
   * indistinguishable (Requirements 3.1, 3.3).
   */
  readonly notFound: boolean;
  /**
   * Whether the Generic_Profile_Failure and its retry control are displayed.
   * Never true at the same time as
   * {@link PlayerStatsScreenMachine.notFound} (Requirement 4.3).
   */
  readonly failed: boolean;
  /**
   * Issue exactly one further `GetPlayerProfile` call for the subject the route
   * currently carries (Requirement 2.8).
   *
   * This is the retry control's only behaviour; nothing re-issues itself
   * (Requirement 2.6). A no-op while a call awaits a response, so activations
   * cannot stack concurrent calls for the same subject (Requirement 2.9); a
   * no-op once the `discarded` latch has closed; and a no-op for an
   * unidentifiable subject, which has nothing to call for.
   */
  retry(): void;
}

/**
 * Run the Player_Stats_Screen load machine.
 *
 * Mounting while `authenticated` with a well-formed subject issues exactly one
 * `GetPlayerProfile` call, and no re-render issues another (Requirement 2.1).
 * A change of subject while mounted aborts the call in flight, drops the
 * previous subject's profile, and issues exactly one call for the new subject
 * (Requirement 2.4). A `null` subject issues nothing and renders the
 * Not_Found_Treatment (Requirement 3.3). Mounting while `unauthenticated`
 * issues nothing and waits for a sign-in (Requirement 1.8). Unmounting, or the
 * Auth_State transitioning away from `authenticated`, aborts the call in flight
 * and disregards its outcome (Requirement 2.5).
 *
 * `usePublishSquadScopeFromRoute()` is **not** called here — the
 * Player_Stats_Screen calls it once itself, which keeps this machine free of
 * routing and of the App_Shell so it can be driven by folding actions over the
 * reducer (Requirement 2.7).
 *
 * Requirements: 1.8, 2.1, 2.4, 2.5, 2.6, 2.8, 2.9, 3.3
 */
export function usePlayerStatsScreen(
  options: PlayerStatsScreenOptions,
): PlayerStatsScreenMachine {
  const { api, subject, authState = 'authenticated' } = options;

  const [state, rawDispatch] = useReducer(
    reducePlayerStats,
    undefined,
    initialPlayerStatsState,
  );

  // The state as of the last *dispatch* rather than the last render, so the
  // single-flight decision of Requirement 2.9 and the busy-phase choice of
  // Requirements 2.2 and 2.3 are made against current values rather than a
  // render-stale copy. The reducer is pure, so folding it twice costs nothing,
  // and this avoids a second source of truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: PlayerStatsAction): void => {
    stateRef.current = reducePlayerStats(stateRef.current, action);
    rawDispatch(action);
  }, []);

  // The injected facade and the requested subject, held by reference and
  // synchronised in effects rather than during render — so no re-render issues a
  // call (Requirement 2.1). Declared before the issue effect below, which is
  // what guarantees they have been synchronised by the time it reads them.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const subjectRef = useRef(subject);
  useEffect(() => {
    subjectRef.current = subject;
  }, [subject]);

  /** The one call awaiting a response, so it can be aborted (2.4, 2.5). */
  const controllerRef = useRef<AbortController | null>(null);
  /**
   * The token of the most recently issued call. Abandoning bumps it, which makes
   * every outstanding response unacceptable independently of the latch below —
   * so a response for a subject we have left, or for a screen we have left, can
   * never be accepted even though a remount reopens the latch.
   */
  const tokenRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirement 2.5). */
  const discardedRef = useRef(false);
  /**
   * The key the current call was issued for, or `null` when nothing has been
   * issued for the subject now on screen.
   *
   * This — rather than a mount-scoped `started` flag — is what makes the guard
   * **subject-keyed**, and it is the one structural difference from the
   * Squads_Feature's `useSquadScreen`. A Pairwise_Link navigates to a sibling
   * profile *on the same route pattern*, so `react-router` keeps this screen
   * mounted and only the parameters change; comparing the key is what turns that
   * into a fresh load rather than a stale render (Requirement 2.4).
   */
  const startedForSubjectRef = useRef<string | null>(null);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * The key of the subject this render carries — the guard's whole input, and
   * the issue effect's only non-auth dependency.
   *
   * Derived during render rather than in the effect so that React compares the
   * *key* between renders: two distinct `Subject` objects carrying the same pair
   * yield the same key and so re-run nothing (Requirement 2.1).
   */
  const issueKey =
    subject === null ? NO_SUBJECT_ISSUE_KEY : subjectKey(subject);

  /**
   * Abandon the call awaiting a response: abort it, and make its response
   * unacceptable whenever it arrives.
   *
   * Shared by the change of subject (Requirement 2.4) and by
   * {@link discard} (Requirement 2.5), because both need exactly this and
   * neither needs the other's latch behaviour. Idempotent, and a no-op when no
   * call is in flight.
   */
  const abandon = useCallback((): void => {
    tokenRef.current += 1;

    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  /**
   * Abandon everything and display no Player_Profile: abort the call awaiting a
   * response, make every outstanding response unacceptable, close the latch so
   * nothing is accepted afterwards, and clear the issue guard.
   *
   * Used by the unmount cleanup and by the transition to `unauthenticated`
   * (Requirement 2.5). Idempotent, so several triggers in one tick do the work
   * once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    abandon();
    startedForSubjectRef.current = null;

    dispatch({ type: 'discarded' });
  }, [abandon, dispatch]);

  /**
   * Issue one `GetPlayerProfile` call for the subject the route currently
   * carries.
   *
   * The **only** issue site in the feature. It is called from the issue effect
   * below and from {@link PlayerStatsScreenMachine.retry}, and it issues exactly
   * one request per call — the Player_Stats_Api never retries, and neither does
   * this (Requirement 2.6).
   */
  const issueCall = useCallback((): void => {
    if (discardedRef.current) {
      return;
    }

    // 3.3: no call is issued for an unidentifiable subject, from any entry
    // point — including the retry control.
    const current = subjectRef.current;
    if (current === null) {
      return;
    }

    // 2.9: one activation, one call. A further activation while a call awaits a
    // response changes nothing rather than stacking a second call behind it.
    const { phase } = stateRef.current;
    if (phase === 'loading' || phase === 'refreshing') {
      return;
    }

    const token = tokenRef.current + 1;
    tokenRef.current = token;

    const controller = new AbortController();
    controllerRef.current = controller;

    // The subject is recorded from the request rather than from the response,
    // because no outcome action carries one: what a profile belongs to is what
    // was asked for (Requirement 2.4).
    dispatch({ type: 'requested', subjectKey: subjectKey(current) });

    /**
     * Apply a settled outcome, or `null` for a rejected promise. The
     * Player_Stats_Api settles every outcome into a `CallResult`, so `null` is
     * defence against a seam that throws rather than an expected path.
     */
    const settle = (result: CallResult<PlayerProfile> | null): void => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      // 2.4, 2.5: a response for a discarded machine, or for a superseded call
      // — the previous subject's, after a Pairwise_Link navigation — changes
      // nothing at all: no profile, no failure, no message.
      if (discardedRef.current || token !== tokenRef.current) {
        return;
      }

      if (result !== null && result.kind === 'success') {
        dispatch({ type: 'accepted', profile: result.value });
        return;
      }

      // 3.1, 4.1, 4.3: not-found is its own phase and **every** other arm is the
      // generic failure, so a failure can never render the Not_Found_Treatment.
      // There is no authentication arm to map, because the union has none
      // (Requirement 3.4).
      const notFound = result !== null && result.kind === 'not-found';
      dispatch({ type: notFound ? 'notFound' : 'failed' });
    };

    void apiRef.current
      .getPlayerProfile(current.squadId, current.membershipId, controller.signal)
      .then(settle, () => {
        settle(null);
      });
  }, [dispatch]);

  /**
   * The subject and Auth_State effect — the feature's one automatic issue point.
   *
   * It depends on the **subject key** and the Auth_State and on nothing else
   * that changes, so a re-render issues no call (Requirement 2.1) while a change
   * of subject issues exactly one (Requirement 2.4). A transition to
   * `unauthenticated` discards; a mount while `unauthenticated` simply waits,
   * issuing nothing (Requirement 1.8).
   */
  useEffect(() => {
    const previous = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;

    if (authState !== 'authenticated') {
      // 2.5: only a *transition* from an authenticated session is a loss of
      // session. Mounting while unauthenticated has nothing to abandon, and
      // latching there would deny the load a later sign-in owes.
      if (previous === 'authenticated') {
        discard();
      }
      return;
    }

    if (discardedRef.current) {
      return;
    }

    // 2.1: the subject on screen has already been issued for, so this effect run
    // is a re-render — a new `api` object, a new `Subject` object carrying the
    // same pair, a parent's state change — and issues nothing.
    if (startedForSubjectRef.current === issueKey) {
      return;
    }

    // 2.4: a different subject. The previous subject's call is aborted and its
    // response made unacceptable, and its profile goes with it — so the screen
    // renders no value from the subject we have left, not even transiently
    // beside a busy state.
    if (startedForSubjectRef.current !== null) {
      abandon();
      dispatch({ type: 'discarded' });
    }

    startedForSubjectRef.current = issueKey;

    // 3.3: an unidentifiable subject issues no call at all and reaches the same
    // phase a concealed absence reaches.
    if (issueKey === NO_SUBJECT_ISSUE_KEY) {
      dispatch({ type: 'unidentifiable' });
      return;
    }

    issueCall();
  }, [abandon, authState, discard, dispatch, issueCall, issueKey]);

  // 2.5: leaving the Player_Stats_Screen aborts the call awaiting a response and
  // disregards it. The latch and the issue guard are reopened so a remount is a
  // fresh load with exactly one call; the bumped token keeps the abandoned
  // call's response unacceptable regardless.
  useEffect(() => {
    return () => {
      discard();
      startedForSubjectRef.current = null;
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  // 2.8: one further call for the route's current subject, and nothing else. The
  // reducer decides which busy phase that enters, so the control needs no phase
  // knowledge of its own.
  const retry = useCallback((): void => {
    issueCall();
  }, [issueCall]);

  return useMemo(
    () => ({
      phase: state.phase,
      profile: state.profile,
      subjectKey: state.subjectKey,
      busy: state.phase === 'loading' || state.phase === 'refreshing',
      notFound: state.phase === 'notFound',
      failed: state.phase === 'failed',
      retry,
    }),
    [retry, state.phase, state.profile, state.subjectKey],
  );
}
