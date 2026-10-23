/**
 * The machine behind leaving, removing, demoting and transferring ownership:
 * one reducer-backed hook per action kind, issuing that action's call and
 * holding which targets have one in flight.
 *
 * It is `usePromotion` generalised over the call it issues. The Squad_Screen
 * makes one instance per action kind, each handed its facade method through
 * {@link MembershipActionOptions.perform}, so every endpoint still has exactly
 * one issue site and one place a response is accepted.
 *
 * ### What it shares with the promotion machine
 *
 * - **Single-flight per target.** The guard is the target key (a membership
 *   identity, or the squad identity for leaving), so a second activation of the
 *   same control issues nothing while two different rows may each have a call
 *   in flight.
 * - **The follow-up is injected.** A success calls
 *   {@link MembershipActionOptions.onSucceeded} — the screen's `refresh()` for
 *   remove, demote and transfer, and a navigation to the Squads_Home for leave —
 *   so this hook issues no `GetSquad` and performs no navigation of its own.
 * - **A `discarded` latch.** Unmounting, or the Auth_State transitioning to
 *   `unauthenticated`, aborts every call awaiting a response and makes its
 *   outcome unacceptable, including its follow-up.
 *
 * ### One more outcome than promotion
 *
 * The outcome is `classifyOutcome`'s, folded to three kinds: `succeeded`,
 * `conflict` (a `rejected-input` with reason `conflict`, which is how
 * `OwnerConstraint` arrives — the owner tried to leave, or the target became
 * the owner) and `failed` for every other arm. The extra kind exists so the
 * control can say *why* nothing changed when the reason is the squad's own
 * rules; it still carries no backend wording.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';

// --- State ------------------------------------------------------------------

/** How one settled membership action turned out. */
export type MembershipActionOutcomeKind = 'succeeded' | 'conflict' | 'failed';

/** Which target settled, and how. */
export interface MembershipActionOutcome {
  /** The target the outcome concerns. */
  readonly targetId: string;
  /** Whether the action was accepted, refused by a squad rule, or failed. */
  readonly kind: MembershipActionOutcomeKind;
}

/** Everything a membership-action control renders from. */
export interface MembershipActionState {
  /** The targets whose call awaits a response. */
  readonly pending: readonly string[];
  /** The most recently settled action, or `null`. */
  readonly outcome: MembershipActionOutcome | null;
}

/** The initial state: nothing in flight, nothing settled. */
export function initialMembershipActionState(): MembershipActionState {
  return { pending: [], outcome: null };
}

// --- Actions ----------------------------------------------------------------

/** Everything that can move the machine. The only payload is a target key. */
export type MembershipActionEvent =
  | { readonly type: 'requested'; readonly targetId: string }
  | {
      readonly type: 'settled';
      readonly targetId: string;
      readonly kind: MembershipActionOutcomeKind;
    }
  | { readonly type: 'outcomeCleared' }
  | { readonly type: 'discarded' };

/**
 * The one reducer. Pure and total, so the machine can be exercised by folding
 * events over it. Target keys are compared exactly.
 */
export function reduceMembershipAction(
  state: MembershipActionState,
  event: MembershipActionEvent,
): MembershipActionState {
  switch (event.type) {
    case 'requested':
      return {
        pending: state.pending.includes(event.targetId)
          ? state.pending
          : [...state.pending, event.targetId],
        outcome:
          state.outcome?.targetId === event.targetId ? null : state.outcome,
      };

    case 'settled':
      return {
        pending: state.pending.filter((candidate) => candidate !== event.targetId),
        outcome: { targetId: event.targetId, kind: event.kind },
      };

    case 'outcomeCleared':
      return { ...state, outcome: null };

    case 'discarded':
      return initialMembershipActionState();

    default:
      return state;
  }
}

/**
 * Fold a settled call into the three outcome kinds. Only a `conflict`
 * rejection is told apart from the generic failure.
 */
export function membershipActionOutcomeOf(
  result: CallResult<void> | null,
): MembershipActionOutcomeKind {
  if (result === null) {
    return 'failed';
  }

  if (result.kind === 'success') {
    return 'succeeded';
  }

  return result.kind === 'rejected-input' && result.reason === 'conflict'
    ? 'conflict'
    : 'failed';
}

// --- Hook surface -----------------------------------------------------------

/** Issue one call for one target through the facade. */
export type MembershipActionCall = (
  api: SquadsApi,
  squadId: string,
  targetId: string,
  signal: AbortSignal,
) => Promise<CallResult<void>>;

/** The membership calls, each a single facade method. */
export const LEAVE_CALL: MembershipActionCall = (api, squadId, _target, signal) =>
  api.leaveSquad(squadId, signal);

export const REMOVE_CALL: MembershipActionCall = (api, squadId, target, signal) =>
  api.removeMember(squadId, target, signal);

export const DEMOTE_CALL: MembershipActionCall = (api, squadId, target, signal) =>
  api.demoteToMember(squadId, target, signal);

export const TRANSFER_CALL: MembershipActionCall = (
  api,
  squadId,
  target,
  signal,
) => api.transferOwnership(squadId, target, signal);

/** Options for {@link useMembershipAction}. Every seam is injected. */
/**
 * Delete the squad. The target is the squad itself; the purge instant the call
 * answers with is shown on the Squads_Home's pending list, not here.
 */
export const DELETE_CALL: MembershipActionCall = (api, squadId, _target, signal) =>
  api.deleteSquad(squadId, signal).then((result): CallResult<void> =>
    result.kind === 'success' ? { kind: 'success', value: undefined } : result,
  );

/**
 * Restore a deleted squad. Run from the Squads_Home, where there is no current
 * squad, so the target is the squad being restored.
 */
export const RESTORE_CALL: MembershipActionCall = (api, _squadId, target, signal) =>
  api.restoreSquad(target, signal);

export interface MembershipActionOptions {
  /** The Squads_Api facade — the feature's only transport seam. */
  readonly api: SquadsApi;
  /** The squad acted on, from the parsed Squad_Detail. */
  readonly squadId: string;
  /** Which facade call this instance issues. */
  readonly perform: MembershipActionCall;
  /** The follow-up on success: a re-read, or leaving the screen. */
  readonly onSucceeded: (targetId: string) => void;
  /** The Auth_State; defaults to `authenticated`. */
  readonly authState?: AuthState;
}

/** What a membership-action control reads and activates. */
export interface MembershipActionMachine extends MembershipActionState {
  /** Whether this target's call awaits a response. */
  isPending(targetId: string): boolean;
  /**
   * Submit exactly one call for one target. A no-op while a call for that
   * target awaits a response, outside an authenticated session, and once the
   * `discarded` latch has closed.
   */
  run(targetId: string): void;
  /** Clear the settled outcome once it has been announced. */
  clearOutcome(): void;
}

/**
 * Run one membership-action machine. Issues no call on mount: every call is a
 * consequence of a person confirming the action.
 */
export function useMembershipAction(
  options: MembershipActionOptions,
): MembershipActionMachine {
  const { api, squadId, perform, onSucceeded, authState = 'authenticated' } =
    options;

  const [state, rawDispatch] = useReducer(
    reduceMembershipAction,
    undefined,
    initialMembershipActionState,
  );

  // The state as of the last dispatch, so the single-flight decision is made
  // against current values rather than the last render's.
  const stateRef = useRef(state);
  const dispatch = useCallback((event: MembershipActionEvent): void => {
    stateRef.current = reduceMembershipAction(stateRef.current, event);
    rawDispatch(event);
  }, []);

  // The injected seams, held by reference so re-creating one on a render
  // changes no callback identity and issues no call.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const squadIdRef = useRef(squadId);
  useEffect(() => {
    squadIdRef.current = squadId;
  }, [squadId]);

  const performRef = useRef(perform);
  useEffect(() => {
    performRef.current = perform;
  }, [perform]);

  const onSucceededRef = useRef(onSucceeded);
  useEffect(() => {
    onSucceededRef.current = onSucceeded;
  }, [onSucceeded]);

  const authStateRef = useRef(authState);
  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  const controllersRef = useRef(new Map<string, AbortController>());
  /** Bumped by discarding, so a response from before it is never accepted. */
  const generationRef = useRef(0);
  const discardedRef = useRef(false);
  const previousAuthStateRef = useRef<AuthState | null>(null);

  const discard = useCallback((): void => {
    discardedRef.current = true;
    generationRef.current += 1;

    for (const controller of controllersRef.current.values()) {
      controller.abort();
    }
    controllersRef.current.clear();

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  const run = useCallback(
    (targetId: string): void => {
      if (discardedRef.current || authStateRef.current !== 'authenticated') {
        return;
      }

      // One activation per target, one call.
      if (stateRef.current.pending.includes(targetId)) {
        return;
      }

      const generation = generationRef.current;
      const controller = new AbortController();
      controllersRef.current.set(targetId, controller);

      dispatch({ type: 'requested', targetId });

      const settle = (result: CallResult<void> | null): void => {
        if (controllersRef.current.get(targetId) === controller) {
          controllersRef.current.delete(targetId);
        }

        // A response for a discarded machine changes nothing, and triggers no
        // follow-up.
        if (discardedRef.current || generation !== generationRef.current) {
          return;
        }

        const kind = membershipActionOutcomeOf(result);
        dispatch({ type: 'settled', targetId, kind });

        if (kind === 'succeeded') {
          onSucceededRef.current(targetId);
        }
      };

      void performRef
        .current(apiRef.current, squadIdRef.current, targetId, controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [dispatch],
  );

  // Recognise a transition to `unauthenticated`; this machine has no mount call.
  useEffect(() => {
    const previous = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;

    if (authState !== 'authenticated' && previous === 'authenticated') {
      discard();
    }
  }, [authState, discard]);

  // Leaving the screen aborts every call in flight and disregards it. The latch
  // reopens so a remount is a fresh mount; the bumped generation keeps the
  // abandoned responses unacceptable regardless.
  useEffect(() => {
    return () => {
      discard();
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  const clearOutcome = useCallback((): void => {
    dispatch({ type: 'outcomeCleared' });
  }, [dispatch]);

  const isPending = useCallback(
    (targetId: string): boolean => state.pending.includes(targetId),
    [state.pending],
  );

  return useMemo(
    () => ({
      pending: state.pending,
      outcome: state.outcome,
      isPending,
      run,
      clearOutcome,
    }),
    [clearOutcome, isPending, run, state.outcome, state.pending],
  );
}
