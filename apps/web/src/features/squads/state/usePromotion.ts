/**
 * The Promotion_Control's machine — one reducer-backed hook issuing every
 * `PromoteToAdmin` call and holding which memberships have one in flight.
 *
 * `components/PromotionControl.tsx` renders from this machine and calls nothing
 * itself, so there is exactly one issue site for the endpoint and one place where
 * a response is accepted.
 *
 * ### Five behaviours worth stating
 *
 * 1. **Single-flight per membership** (Requirement 13.6). The guard is the
 *    membership identity, not the operation: two different memberships may have a
 *    call in flight at the same time, because promoting two players is two
 *    independent actions on two independent controls, while a second activation of
 *    the *same* control issues nothing. {@link PromotionState.pending} therefore
 *    holds a set of identities rather than a single flag, and doubles as each
 *    control's disabled state.
 * 2. **The re-read is not this hook's call.** A successful promotion calls the
 *    injected {@link PromotionOptions.refresh} — `useSquadScreen`'s `refresh()`,
 *    the machine that owns `GetSquad` — so the Player_Row's Member_Role label
 *    comes from the backend's own answer rather than from a local edit
 *    (Requirement 13.5). This hook issues no `GetSquad` of its own and holds no
 *    Player_List.
 * 3. **Eligibility is not decided here.** Which rows carry a Promotion_Control at
 *    all is `isPromotable` in `lib/promotionEligibility.ts` (Requirement 13.3),
 *    and the confirmation naming the player is the component's `ConfirmDialog`
 *    (Requirement 13.4). This machine is handed a membership identity that has
 *    already passed both.
 * 4. **One outcome at a time, carrying nothing of the backend**
 *    (Requirements 13.5, 13.7). {@link PromotionState.outcome} names the
 *    membership and whether it was promoted, which is all the live region needs;
 *    every non-success arm — not-found, the "cannot be promoted" rejection,
 *    timeout, transport-failure, parse-failure, auth-failure — folds into the same
 *    `failed`, with no status code and no backend text (Requirement 17.2). The
 *    control returns to available for a further activation, which falls out of the
 *    identity leaving `pending`.
 * 5. **A `discarded` latch** (Requirements 13.7, 17.5). Unmounting, or the
 *    Auth_State transitioning to `unauthenticated`, aborts every call awaiting a
 *    response through the caller `AbortSignal` the Squads_Api accepts and closes a
 *    latch, so no late response is accepted and no late success triggers a re-read
 *    of a squad the person has left.
 *
 * ### No copy, no retry of its own
 *
 * No action and no state field carries a message (Requirement 17.2); the component
 * reads `lib/messages.ts`. Nothing re-issues a call by itself
 * (Requirement 17.4) — the one issue site is a person confirming a promotion. The
 * feature offers no demotion, no ownership transfer, and no removal, so there is
 * no other operation for this machine to hold (Requirement 13.8).
 *
 * The 10-second Squad_Call_Timeout, the abort chaining, and the
 * one-request-per-method discipline all belong to `api/squadsApi.ts`; none of it
 * is reimplemented here.
 *
 * Requirements: 13.5, 13.6, 13.7, 13.8, 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';

// --- State ------------------------------------------------------------------

/**
 * How one settled promotion turned out: the backend accepted it, or it did not
 * happen.
 *
 * Two values, because two presentations are asked for — the confirmation of
 * Requirement 13.5 and the failure of Requirement 13.7 — and because folding every
 * non-success arm into one is what keeps a status code out of the interface
 * (Requirement 17.2).
 */
export type PromotionOutcomeKind = 'promoted' | 'failed';

/** Which membership settled, and how (Requirements 13.5, 13.7). */
export interface PromotionOutcome {
  /** The membership the outcome concerns, so the message can name the player. */
  readonly membershipId: string;
  /** Whether the promotion was accepted. */
  readonly kind: PromotionOutcomeKind;
}

/** Everything the Promotion_Controls render from. */
export interface PromotionState {
  /**
   * The memberships whose `PromoteToAdmin` call awaits a response — each one's
   * control disabled, and each one's second activation a no-op
   * (Requirement 13.6).
   *
   * A collection rather than a flag because the guard is per membership: two
   * controls may be in flight at once, and neither blocks the other.
   */
  readonly pending: readonly string[];
  /**
   * The most recently settled promotion, or `null` when none has settled since
   * the last clearing — what the live region announces (Requirements 13.5, 13.7).
   *
   * One outcome rather than one per membership: the region announces the latest
   * settlement, and a person promoting two players in succession hears the second
   * rather than a growing list.
   */
  readonly outcome: PromotionOutcome | null;
}

/** The initial state: nothing in flight, nothing settled. */
export function initialPromotionState(): PromotionState {
  return { pending: [], outcome: null };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * The only payload is a membership identity — which the caller supplied — so no
 * action carries a status code, a rejection reason, or a response body value
 * (Requirement 17.2).
 */
export type PromotionAction =
  | { readonly type: 'requested'; readonly membershipId: string }
  | { readonly type: 'promoted'; readonly membershipId: string }
  | { readonly type: 'failed'; readonly membershipId: string }
  | { readonly type: 'outcomeCleared' }
  | { readonly type: 'discarded' };

/** The pending collection with one membership added, at most once. */
function withPending(
  pending: readonly string[],
  membershipId: string,
): readonly string[] {
  return pending.includes(membershipId) ? pending : [...pending, membershipId];
}

/** The pending collection with one membership removed. */
function withoutPending(
  pending: readonly string[],
  membershipId: string,
): readonly string[] {
  return pending.filter((candidate) => candidate !== membershipId);
}

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it.
 *
 * Identities are compared **exactly**: a membership identity is opaque to this
 * feature, so it is neither trimmed nor case-folded.
 */
export function reducePromotion(
  state: PromotionState,
  action: PromotionAction,
): PromotionState {
  switch (action.type) {
    // 13.6: the identity entering `pending` is both the control's disabled state
    // and the guard against a second concurrent call for that membership. A
    // previous outcome for the *same* membership is cleared, so a fresh attempt
    // is not presented alongside the last one's result.
    case 'requested':
      return {
        pending: withPending(state.pending, action.membershipId),
        outcome:
          state.outcome?.membershipId === action.membershipId
            ? null
            : state.outcome,
      };

    // 13.5: the promoted Member_Role label comes from the re-read the hook
    // triggers, not from an edit of any row held here — this machine holds none.
    case 'promoted':
      return {
        pending: withoutPending(state.pending, action.membershipId),
        outcome: { membershipId: action.membershipId, kind: 'promoted' },
      };

    // 13.7: the Player_List last accepted keeps rendering unchanged — again,
    // trivially, because this machine holds none — and the control becomes
    // available again by leaving `pending`.
    case 'failed':
      return {
        pending: withoutPending(state.pending, action.membershipId),
        outcome: { membershipId: action.membershipId, kind: 'failed' },
      };

    // Called once an announcement has been made, so the live region is not
    // re-announcing a settlement the person has already been told about.
    case 'outcomeCleared':
      return { ...state, outcome: null };

    // 17.5: an ended session or a departed screen holds no outcome at all.
    case 'discarded':
      return initialPromotionState();

    default:
      return state;
  }
}

// --- Hook surface -----------------------------------------------------------

/** Options for {@link usePromotion}. Every seam is injected. */
export interface PromotionOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The squad whose membership is being promoted, taken from the parsed
   * Squad_Detail the Squad_Screen is rendering. The Response_Parser already
   * validated it as an identifier, so it is not re-validated here.
   */
  readonly squadId: string;
  /**
   * The post-promotion re-read: `useSquadScreen`'s `refresh()`, which issues
   * exactly one further `GetSquad` (Requirement 13.5).
   *
   * Injected rather than reimplemented so that `GetSquad` keeps exactly one issue
   * site in the feature.
   */
  readonly refresh: () => void;
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

/** What the Promotion_Controls read and activate. */
export interface PromotionMachine extends PromotionState {
  /**
   * Whether this membership's `PromoteToAdmin` call awaits a response — that one
   * control's disabled and busy state (Requirement 13.6).
   */
  isPending(membershipId: string): boolean;
  /**
   * Submit exactly one `PromoteToAdmin` call for one membership identity, then —
   * on success — trigger exactly one further `GetSquad` (Requirement 13.5).
   *
   * Called after the component's confirmation is confirmed (Requirement 13.4). A
   * no-op while a call for *that* membership awaits a response
   * (Requirement 13.6), and a no-op once the `discarded` latch has closed.
   */
  promote(membershipId: string): void;
  /** Clear the settled outcome once it has been announced. */
  clearOutcome(): void;
}

/**
 * Run the Promotion machine.
 *
 * Issues no call on mount: every call is a consequence of a person confirming a
 * promotion (Requirement 17.4). Unmounting, or the Auth_State transitioning to
 * `unauthenticated`, aborts every call awaiting a response and disregards its
 * outcome, including its re-read (Requirements 13.7, 17.5).
 *
 * Requirements: 13.5, 13.6, 13.7, 17.2, 17.4, 17.5
 */
export function usePromotion(options: PromotionOptions): PromotionMachine {
  const { api, squadId, refresh, authState = 'authenticated' } = options;

  const [state, rawDispatch] = useReducer(
    reducePromotion,
    undefined,
    initialPromotionState,
  );

  // The state as of the last *dispatch* rather than the last render, so the
  // per-membership single-flight decision is made against current values. The
  // reducer is pure, so folding it twice costs nothing, and this avoids a second
  // source of truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: PromotionAction): void => {
    stateRef.current = reducePromotion(stateRef.current, action);
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
   * The calls awaiting a response, one per membership, so the latch can abort
   * every one of them (Requirement 17.5). A Map rather than a single ref because
   * the operation is concurrent across memberships.
   */
  const controllersRef = useRef(new Map<string, AbortController>());
  /**
   * The generation of the machine. Discarding bumps it, which makes every
   * outstanding response unacceptable independently of the latch below — so a
   * response arriving after this screen was left can never be accepted, even
   * though a remount reopens the latch.
   *
   * One counter suffices where the siblings need one per slot: single-flight per
   * membership means a membership can have at most one call in flight, so a
   * response is identified by its membership plus this generation.
   */
  const generationRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirement 17.5). */
  const discardedRef = useRef(false);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon everything: abort every call awaiting a response, make every
   * outstanding response unacceptable, and hold no outcome (Requirement 17.5).
   *
   * Idempotent, so several triggers in one tick do the work once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    generationRef.current += 1;

    for (const controller of controllersRef.current.values()) {
      controller.abort();
    }
    controllersRef.current.clear();

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  /**
   * Issue one `PromoteToAdmin` call for one membership (Requirements 13.5, 13.6).
   *
   * The only issue site in the feature for this endpoint, and it issues exactly
   * one request per activation — the Squads_Api never retries, and neither does
   * this (Requirement 17.4).
   */
  const issuePromoteCall = useCallback(
    (membershipId: string): void => {
      // 17.5: nothing is issued for a discarded machine or outside an
      // authenticated session.
      if (discardedRef.current || authStateRef.current !== 'authenticated') {
        return;
      }

      // 13.6: one activation per membership, one call. A second activation of the
      // same control changes nothing rather than stacking a call behind the first.
      if (stateRef.current.pending.includes(membershipId)) {
        return;
      }

      const generation = generationRef.current;

      const controller = new AbortController();
      controllersRef.current.set(membershipId, controller);

      dispatch({ type: 'requested', membershipId });

      /**
       * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
       * settles every outcome into a `CallResult`, so `null` is defence against a
       * seam that throws rather than an expected path.
       */
      const settle = (result: CallResult<void> | null): void => {
        if (controllersRef.current.get(membershipId) === controller) {
          controllersRef.current.delete(membershipId);
        }

        // 17.5: a response for a discarded machine, or from before a remount,
        // changes nothing at all — and triggers no re-read.
        if (discardedRef.current || generation !== generationRef.current) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          dispatch({ type: 'promoted', membershipId });
          // 13.5: the promoted row's Member_Role label comes from the backend's
          // answer to the re-read, never from an assumption made here.
          refreshRef.current();
          return;
        }

        // 13.7, 17.2: every other arm is the same failure, carrying nothing of
        // the backend's own wording, and leaving the Player_List alone.
        dispatch({ type: 'failed', membershipId });
      };

      void apiRef.current
        .promoteToAdmin(squadIdRef.current, membershipId, controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [dispatch],
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

  const promote = useCallback(
    (membershipId: string): void => {
      issuePromoteCall(membershipId);
    },
    [issuePromoteCall],
  );

  const clearOutcome = useCallback((): void => {
    dispatch({ type: 'outcomeCleared' });
  }, [dispatch]);

  const isPending = useCallback(
    (membershipId: string): boolean => state.pending.includes(membershipId),
    [state.pending],
  );

  return useMemo(
    () => ({
      pending: state.pending,
      outcome: state.outcome,
      isPending,
      promote,
      clearOutcome,
    }),
    [clearOutcome, isPending, promote, state.outcome, state.pending],
  );
}
