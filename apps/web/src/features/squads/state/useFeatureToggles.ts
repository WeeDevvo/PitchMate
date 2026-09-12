/**
 * The Feature_Toggle set's machine — one reducer-backed hook issuing every
 * `SetFeatureFlag` call, holding which flags have one in flight, and holding **no
 * toggle state of its own**.
 *
 * That last clause is the design. Requirement 14.7 asks that every rendered
 * Feature_Toggle state be derived solely from a backend-supplied Feature_Flag and
 * that no optimistic state outlive its call, so this machine deliberately has
 * nowhere to put an optimistic value: the toggles render from the
 * `SquadDetail.features` the Squad_Screen already holds, and a change is reflected
 * only once the backend has been asked again. A toggle can therefore never
 * contradict the backend, because there is no second source for it to contradict
 * it with.
 *
 * ### Five behaviours worth stating
 *
 * 1. **Single-flight per flag** (Requirement 14.4). The guard is the
 *    Squad_Feature, not the operation: two different features may have a call in
 *    flight at once, while a second change of the *same* toggle issues nothing.
 *    {@link FeatureTogglesState.pending} holds a set of features and doubles as
 *    each toggle's disabled and busy state.
 * 2. **One `SetFeatureFlag` per change** (Requirement 14.3), carrying that flag
 *    and the requested enabled state and nothing else. The Squad_Feature is
 *    written to the wire through `codeFromSquadFeature`, so no numeric enum
 *    literal appears here.
 * 3. **The refreshed state comes from the `GetSquad` re-read**
 *    (Requirements 14.2, 14.5). A success calls the injected
 *    {@link FeatureTogglesOptions.refresh} — `useSquadScreen`'s `refresh()` — and
 *    the Squad_Detail it re-reads carries `features`, which is the whole
 *    Feature_Flag collection. No `GetFeatureFlags` call is issued on that path,
 *    which is precisely what Requirement 14.2 restricts.
 * 4. **`GetFeatureFlags` exists for the one case the re-read cannot serve**
 *    (Requirement 14.7). Where no `refresh` seam is supplied — a Feature_Toggle
 *    set rendered without a Squad_Detail re-read behind it — a success issues
 *    exactly one `GetFeatureFlags` and its parsed flags become
 *    {@link FeatureTogglesState.flags}, still a backend-supplied value and still
 *    no optimistic state. On the Squad_Screen the seam is always supplied, so that
 *    call is never issued there. It is the fallback that keeps "the rendered state
 *    is the backend's" true even where `GetSquad` is not available to say so.
 * 5. **A `discarded` latch** (Requirements 14.6, 17.5). Unmounting, or the
 *    Auth_State transitioning to `unauthenticated`, aborts every call awaiting a
 *    response through the caller `AbortSignal` the Squads_Api accepts and closes a
 *    latch, so no late response is accepted and no late success triggers a re-read
 *    of a squad the person has left.
 *
 * ### The outcome carries the accepted state, not a prediction
 *
 * {@link FeatureToggleOutcome} carries the requested enabled state on its `set`
 * arm, because Requirement 14.5 has the live region name the feature *and its new
 * state*. It is recorded only after the backend accepted the change, it is never
 * read to render a toggle, and it does not outlive
 * {@link FeatureTogglesMachine.clearOutcome} — so it is an announcement, not
 * optimistic state (Requirement 14.7). Every non-success arm folds into `failed`,
 * carrying no status code and no backend text (Requirements 14.6, 17.2), and the
 * toggle keeps rendering the last state the backend supplied.
 *
 * The copy is `lib/messages.ts`, read by the component. Nothing re-issues a call
 * by itself (Requirement 17.4). The 10-second Squad_Call_Timeout, the abort
 * chaining, and the one-request-per-method discipline all belong to
 * `api/squadsApi.ts`; none of it is reimplemented here.
 *
 * Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { codeFromSquadFeature, type SquadFeatureValue } from '../lib/enumCodes';
import type { FeatureFlag } from '../lib/parse/featureFlags';

// --- State ------------------------------------------------------------------

/**
 * How one settled `SetFeatureFlag` call turned out.
 *
 * The `set` arm carries the enabled state the backend accepted, which the live
 * region names alongside the feature (Requirement 14.5). The `failed` arm carries
 * the feature and nothing else: not-found, a rejection, a timeout, a transport
 * failure, and a parse failure are one presentation, so there is nothing of the
 * backend's wording to leak (Requirements 14.6, 17.2).
 */
export type FeatureToggleOutcome =
  | {
      readonly kind: 'set';
      readonly feature: SquadFeatureValue;
      readonly enabled: boolean;
    }
  | { readonly kind: 'failed'; readonly feature: SquadFeatureValue };

/** Everything the Feature_Toggle set renders from beyond the Squad_Detail. */
export interface FeatureTogglesState {
  /**
   * The features whose `SetFeatureFlag` call awaits a response — each one's toggle
   * disabled with a busy state, and each one's second change a no-op
   * (Requirement 14.4).
   *
   * A collection rather than a flag because the guard is per flag: two toggles may
   * be in flight at once, and neither blocks the other.
   */
  readonly pending: readonly SquadFeatureValue[];
  /**
   * The most recently settled change, or `null` when none has settled since the
   * last clearing — what the live region announces (Requirements 14.5, 14.6).
   */
  readonly outcome: FeatureToggleOutcome | null;
  /**
   * The Feature_Flag collection a fallback `GetFeatureFlags` supplied, or `null`
   * whenever none was issued — which, on the Squad_Screen, is always
   * (Requirements 14.2, 14.7).
   *
   * A caller holding a Squad_Detail renders from `detail.features` and ignores
   * this; a caller with no re-read behind it renders from this once it is
   * non-null. Either way the value came from the backend.
   */
  readonly flags: readonly FeatureFlag[] | null;
}

/** The initial state: nothing in flight, nothing settled, no fallback flags. */
export function initialFeatureTogglesState(): FeatureTogglesState {
  return { pending: [], outcome: null, flags: null };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * The only payloads are a Squad_Feature, a requested enabled state the backend has
 * already accepted, and a parsed Feature_Flag collection — so no action carries a
 * status code, a rejection reason, or a response body value beyond a parsed one
 * (Requirement 17.2).
 */
export type FeatureTogglesAction =
  | { readonly type: 'requested'; readonly feature: SquadFeatureValue }
  | {
      readonly type: 'set';
      readonly feature: SquadFeatureValue;
      readonly enabled: boolean;
    }
  | { readonly type: 'failed'; readonly feature: SquadFeatureValue }
  | { readonly type: 'flagsAccepted'; readonly flags: readonly FeatureFlag[] }
  | { readonly type: 'outcomeCleared' }
  | { readonly type: 'discarded' };

/** The pending collection with one feature added, at most once. */
function withPending(
  pending: readonly SquadFeatureValue[],
  feature: SquadFeatureValue,
): readonly SquadFeatureValue[] {
  return pending.includes(feature) ? pending : [...pending, feature];
}

/** The pending collection with one feature removed. */
function withoutPending(
  pending: readonly SquadFeatureValue[],
  feature: SquadFeatureValue,
): readonly SquadFeatureValue[] {
  return pending.filter((candidate) => candidate !== feature);
}

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it.
 *
 * Note what it never does: it never writes a toggle's enabled state anywhere a
 * renderer reads as *the* toggle state. `flags` is only ever a backend-supplied
 * collection, and `outcome` is an announcement (Requirement 14.7).
 */
export function reduceFeatureToggles(
  state: FeatureTogglesState,
  action: FeatureTogglesAction,
): FeatureTogglesState {
  switch (action.type) {
    // 14.4: the feature entering `pending` is both the toggle's disabled and busy
    // state and the guard against a second concurrent call for that flag. A
    // previous outcome for the *same* feature is cleared, so a fresh change is not
    // presented alongside the last one's result.
    case 'requested':
      return {
        ...state,
        pending: withPending(state.pending, action.feature),
        outcome:
          state.outcome?.feature === action.feature ? null : state.outcome,
      };

    // 14.5: the announcement. The *rendered* toggle state still comes from the
    // Squad_Detail or from `flags` — never from here.
    case 'set':
      return {
        ...state,
        pending: withoutPending(state.pending, action.feature),
        outcome: {
          kind: 'set',
          feature: action.feature,
          enabled: action.enabled,
        },
      };

    // 14.6: the toggle keeps rendering the last state the backend supplied, which
    // this action leaves untouched, and becomes available again by leaving
    // `pending`.
    case 'failed':
      return {
        ...state,
        pending: withoutPending(state.pending, action.feature),
        outcome: { kind: 'failed', feature: action.feature },
      };

    // 14.7: the fallback's parsed collection, replacing whatever it held. Still a
    // backend-supplied value, so a toggle rendered from it cannot contradict the
    // backend.
    case 'flagsAccepted':
      return { ...state, flags: action.flags };

    // Called once an announcement has been made, so the live region is not
    // re-announcing a settlement the person has already been told about.
    case 'outcomeCleared':
      return { ...state, outcome: null };

    // 17.5: an ended session or a departed screen holds no feature state at all.
    case 'discarded':
      return initialFeatureTogglesState();

    default:
      return state;
  }
}

// --- Hook surface -----------------------------------------------------------

/** Options for {@link useFeatureToggles}. Every seam is injected. */
export interface FeatureTogglesOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The squad whose features these are, taken from the parsed Squad_Detail the
   * Squad_Screen is rendering. The Response_Parser already validated it as an
   * identifier, so it is not re-validated here.
   */
  readonly squadId: string;
  /**
   * The post-change re-read: `useSquadScreen`'s `refresh()`, whose `GetSquad`
   * answer carries the refreshed `features` collection (Requirements 14.2, 14.5).
   *
   * **Optional, and its absence is the only reason `GetFeatureFlags` exists.**
   * Supplied — as the Squad_Screen always supplies it — a successful change
   * triggers the detail re-read and no `GetFeatureFlags` call is issued at all.
   * Omitted, a successful change issues exactly one `GetFeatureFlags`, because
   * there is then no `GetSquad` result to supply the refreshed state
   * (Requirement 14.7).
   */
  readonly refresh?: () => void;
  /**
   * The Auth_State, as the Auth_Feature's `useAuth().state` reports it. No call
   * is issued while it is `unauthenticated`, and a transition to
   * `unauthenticated` closes the `discarded` latch (Requirement 17.5).
   *
   * Defaults to `authenticated` so the machine can be driven without an
   * `AuthProvider`; the Squad_Screen supplies the real value.
   */
  readonly authState?: AuthState;
}

/** What the Feature_Toggle set reads and activates. */
export interface FeatureTogglesMachine extends FeatureTogglesState {
  /**
   * Whether this feature's `SetFeatureFlag` call awaits a response — that one
   * toggle's disabled and programmatically determinable busy state
   * (Requirement 14.4).
   */
  isPending(feature: SquadFeatureValue): boolean;
  /**
   * Submit exactly one `SetFeatureFlag` call conveying one Feature_Flag and the
   * requested enabled state, then — on success — obtain the refreshed state from
   * the backend (Requirements 14.3, 14.5).
   *
   * A no-op while a call for *that* feature awaits a response
   * (Requirement 14.4), and a no-op once the `discarded` latch has closed.
   */
  setEnabled(feature: SquadFeatureValue, enabled: boolean): void;
  /** Clear the settled outcome once it has been announced. */
  clearOutcome(): void;
}

/**
 * Run the Feature_Toggle machine.
 *
 * Issues no call on mount: the toggles render from the Squad_Detail the caller
 * already holds (Requirement 14.2), and every call is a consequence of a person
 * changing a toggle (Requirement 17.4). Unmounting, or the Auth_State
 * transitioning to `unauthenticated`, aborts every call awaiting a response and
 * disregards its outcome (Requirements 14.6, 17.5).
 *
 * Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 17.2, 17.4, 17.5
 */
export function useFeatureToggles(
  options: FeatureTogglesOptions,
): FeatureTogglesMachine {
  const { api, squadId, refresh, authState = 'authenticated' } = options;

  const [state, rawDispatch] = useReducer(
    reduceFeatureToggles,
    undefined,
    initialFeatureTogglesState,
  );

  // The state as of the last *dispatch* rather than the last render, so the
  // per-flag single-flight decision is made against current values. The reducer is
  // pure, so folding it twice costs nothing, and this avoids a second source of
  // truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: FeatureTogglesAction): void => {
    stateRef.current = reduceFeatureToggles(stateRef.current, action);
    rawDispatch(action);
  }, []);

  // The injected seams, held by reference and synchronised in effects rather than
  // during render, so a caller re-creating any of them on a render changes no
  // callback identity and issues no call.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const squadIdRef = useRef(squadId);
  useEffect(() => {
    squadIdRef.current = squadId;
  }, [squadId]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const authStateRef = useRef(authState);
  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  /**
   * The `SetFeatureFlag` calls awaiting a response, one per feature, so the latch
   * can abort every one of them (Requirement 17.5). A Map rather than a single ref
   * because the operation is concurrent across flags.
   */
  const setControllersRef = useRef(new Map<SquadFeatureValue, AbortController>());
  /** The fallback `GetFeatureFlags` call awaiting a response, where one is. */
  const flagsControllerRef = useRef<AbortController | null>(null);
  /**
   * The generation of the machine. Discarding bumps it, which makes every
   * outstanding response unacceptable independently of the latch below — so a
   * response arriving after this screen was left can never be accepted, even
   * though a remount reopens the latch.
   *
   * One counter suffices: single-flight per flag means a feature can have at most
   * one call in flight, so a response is identified by its feature plus this
   * generation, and the fallback read has its own controller.
   */
  const generationRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirement 17.5). */
  const discardedRef = useRef(false);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon everything: abort every call awaiting a response, make every
   * outstanding response unacceptable, and hold no feature state
   * (Requirement 17.5).
   *
   * Idempotent, so several triggers in one tick do the work once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    generationRef.current += 1;

    for (const controller of setControllersRef.current.values()) {
      controller.abort();
    }
    setControllersRef.current.clear();

    flagsControllerRef.current?.abort();
    flagsControllerRef.current = null;

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  /**
   * Issue one `GetFeatureFlags` call — the fallback of Requirement 14.7, reached
   * only where no `refresh` seam was supplied and so no `GetSquad` result can
   * supply the refreshed state.
   *
   * A no-op while one awaits a response: that call already delivers the refreshed
   * collection.
   */
  const issueFlagsCall = useCallback((): void => {
    if (discardedRef.current || flagsControllerRef.current !== null) {
      return;
    }

    const generation = generationRef.current;

    const controller = new AbortController();
    flagsControllerRef.current = controller;

    const settle = (result: CallResult<readonly FeatureFlag[]> | null): void => {
      if (flagsControllerRef.current === controller) {
        flagsControllerRef.current = null;
      }

      if (discardedRef.current || generation !== generationRef.current) {
        return;
      }

      // 14.6, 14.7: a read that did not yield a collection leaves the last
      // backend-supplied one rendering, and records nothing — the change's own
      // outcome has already been announced.
      if (result !== null && result.kind === 'success') {
        dispatch({ type: 'flagsAccepted', flags: result.value });
      }
    };

    void apiRef.current
      .getFeatureFlags(squadIdRef.current, controller.signal)
      .then(settle, () => {
        settle(null);
      });
  }, [dispatch]);

  /**
   * Issue one `SetFeatureFlag` call for one flag (Requirements 14.3, 14.4).
   *
   * The only issue site in the feature for this endpoint, and it issues exactly
   * one request per change — the Squads_Api never retries, and neither does this
   * (Requirement 17.4).
   */
  const issueSetCall = useCallback(
    (feature: SquadFeatureValue, enabled: boolean): void => {
      // 17.5: nothing is issued for a discarded machine or outside an
      // authenticated session.
      if (discardedRef.current || authStateRef.current !== 'authenticated') {
        return;
      }

      // 14.4: one change per flag, one call. A second change of the same toggle
      // changes nothing rather than stacking a call behind the first.
      if (stateRef.current.pending.includes(feature)) {
        return;
      }

      const generation = generationRef.current;

      const controller = new AbortController();
      setControllersRef.current.set(feature, controller);

      dispatch({ type: 'requested', feature });

      /**
       * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
       * settles every outcome into a `CallResult`, so `null` is defence against a
       * seam that throws rather than an expected path.
       */
      const settle = (result: CallResult<void> | null): void => {
        if (setControllersRef.current.get(feature) === controller) {
          setControllersRef.current.delete(feature);
        }

        // 17.5: a response for a discarded machine, or from before a remount,
        // changes nothing at all — and triggers no re-read.
        if (discardedRef.current || generation !== generationRef.current) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          dispatch({ type: 'set', feature, enabled });

          // 14.2, 14.7: the detail re-read where there is one, and the separate
          // feature read only where there is not.
          const reread = refreshRef.current;
          if (reread === undefined) {
            issueFlagsCall();
          } else {
            reread();
          }
          return;
        }

        // 14.6, 17.2: every other arm is the same failure, carrying nothing of
        // the backend's own wording, and leaving the rendered toggle on the last
        // state the backend supplied.
        dispatch({ type: 'failed', feature });
      };

      void apiRef.current
        .setFeatureFlag(
          squadIdRef.current,
          // 16.12: the wire's numeric code is read from the Enum_Code_Map, so no
          // numeric enum literal appears in this module.
          { feature: codeFromSquadFeature(feature), enabled },
          controller.signal,
        )
        .then(settle, () => {
          settle(null);
        });
    },
    [dispatch, issueFlagsCall],
  );

  /**
   * The Auth_State effect. It issues nothing — this machine has no mount call —
   * and exists only to recognise a *transition* to `unauthenticated`
   * (Requirement 17.5).
   */
  useEffect(() => {
    const previous = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;

    if (authState !== 'authenticated' && previous === 'authenticated') {
      discard();
    }
  }, [authState, discard]);

  // 17.5: leaving the Squad_Screen aborts every call awaiting a response and
  // disregards it. The latch is reopened so a remount is a fresh mount; the
  // bumped generation keeps the abandoned calls' responses unacceptable
  // regardless.
  useEffect(() => {
    return () => {
      discard();
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  const setEnabled = useCallback(
    (feature: SquadFeatureValue, enabled: boolean): void => {
      issueSetCall(feature, enabled);
    },
    [issueSetCall],
  );

  const clearOutcome = useCallback((): void => {
    dispatch({ type: 'outcomeCleared' });
  }, [dispatch]);

  const isPending = useCallback(
    (feature: SquadFeatureValue): boolean => state.pending.includes(feature),
    [state.pending],
  );

  return useMemo(
    () => ({
      pending: state.pending,
      outcome: state.outcome,
      flags: state.flags,
      isPending,
      setEnabled,
      clearOutcome,
    }),
    [
      clearOutcome,
      isPending,
      setEnabled,
      state.flags,
      state.outcome,
      state.pending,
    ],
  );
}
