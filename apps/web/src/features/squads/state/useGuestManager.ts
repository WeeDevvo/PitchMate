/**
 * The Guest_Manager's machine — one reducer-backed hook issuing every
 * `CreateGuest` and `EditGuest` call and holding the outcome of each.
 *
 * `components/GuestManager.tsx` and `components/GuestForm.tsx` render from this
 * machine and call nothing themselves, so there is exactly one issue site per
 * operation and one place where each response is accepted.
 *
 * ### Six behaviours worth stating
 *
 * 1. **The post-mutation re-read is not this hook's call.** A successful create
 *    or edit calls the injected {@link GuestManagerOptions.refresh} — which is
 *    `useSquadScreen`'s `refresh()`, the machine that owns both squad reads — so
 *    the recomposed Player_List comes from the one place squad reads are issued
 *    (Requirements 12.6, 12.10). This hook issues no `GetSquad` and no
 *    `GetSquadLeaderboard` of its own. The two re-reads differ only in what they
 *    ask that seam for: a create asks for the leaderboard as well, because a new
 *    guest may appear on it (Requirement 12.6); an edit changes no membership and
 *    asks for the `GetSquad` alone (Requirement 12.10).
 * 2. **The tier selection is mapped by `lib/skillTier.ts`, not here.**
 *    `skillTierFieldsForCreate` decides that the default omits `skillTier`
 *    entirely (Requirement 12.5) and `skillTierFieldsForEdit` decides the
 *    `updateSkillTier` flag rule (Requirement 12.9). Neither the 0-based tier
 *    codes nor the flag rule is re-derived below.
 * 3. **The submitted Player_Display_Name is the trimmed one**
 *    (Requirement 12.2), taken from `validateDisplayName` in
 *    `lib/nameValidation.ts`. A submission whose name does not validate, or a
 *    create whose Lawful_Basis_Acknowledgement is not given, issues **no call at
 *    all** and records nothing: Requirement 12.3 wants a validation message
 *    programmatically associated with the control, which is the form's to render,
 *    not an outcome message of this machine's.
 * 4. **One rejection is distinguishable, and only one.** Every non-success arm
 *    folds into a per-operation failure carrying no status code and no backend
 *    text (Requirement 17.2) — except the rejected Player_Display_Name, which
 *    Requirement 12.11 needs told apart so the form can say the name cannot be
 *    used within that squad. That is the api's own `'display-name-in-use'`
 *    rejection reason and nothing further; the form keeps every entered value and
 *    its submit control available, which falls out of the failure leaving no
 *    other state behind.
 * 5. **Single-flight per operation** (Requirement 12.13). A second create while
 *    one awaits a response issues nothing, and likewise a second edit. Create and
 *    edit are *different* operations, so one does not block the other — which is
 *    what "no second concurrent call to the same operation" says.
 * 6. **A `discarded` latch** (Requirements 12.12, 17.5). Unmounting, or the
 *    Auth_State transitioning to `unauthenticated`, aborts both calls through the
 *    caller `AbortSignal` the Squads_Api accepts and closes a latch so no late
 *    response is ever accepted — and so no late success triggers a re-read of a
 *    squad the person has left.
 *
 * ### How the two re-reads are told apart
 *
 * `useSquadScreen.refresh()` re-reads the leaderboard by default only where none
 * is held, which is right for an edit and not enough for a create: on a screen
 * whose leaderboard already loaded, Requirement 12.6's second call would never be
 * issued. So the create path passes `{ includeLeaderboard: true }`, which forces
 * exactly one further `GetSquadLeaderboard` whether or not one is held, and the
 * edit path passes nothing. Widening that seam rather than issuing a leaderboard
 * call here keeps `GetSquadLeaderboard` to a single issue site in the feature,
 * which is what the module-ownership rules require.
 *
 * ### No copy, no retry of its own
 *
 * No action and no state field carries a status code, a response body value, or a
 * message (Requirement 17.2); the components read `lib/messages.ts`. Nothing
 * re-issues a call by itself (Requirement 17.4) — both issue sites are a person
 * submitting the Guest_Form.
 *
 * The 10-second Squad_Call_Timeout, the abort chaining, and the
 * one-request-per-method discipline all belong to `api/squadsApi.ts`; none of it
 * is reimplemented here.
 *
 * Requirements: 12.2, 12.5, 12.6, 12.9, 12.10, 12.11, 12.12, 12.13, 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type {
  CallResult,
  CreateGuestRequest,
  EditGuestRequest,
  SquadsApi,
} from '../api/squadsApi';
import { validateDisplayName } from '../lib/nameValidation';
import type { CreatedGuest } from '../lib/parse/createdGuest';
import {
  skillTierFieldsForCreate,
  skillTierFieldsForEdit,
  type SkillTierCreateOption,
  type SkillTierEditOption,
} from '../lib/skillTier';
import type { SquadRefreshOptions } from './useSquadScreen';

// --- State ------------------------------------------------------------------

/** Which of the two guest operations a phase or a failure concerns. */
export type GuestOperation = 'create' | 'edit';

/**
 * How far one guest operation has got.
 *
 * - `idle` — nothing issued, or the outcome has been cleared by a form opening.
 * - `pending` — a call awaits a response, which is the disabled state of the
 *   submit control and the single-flight guard (Requirement 12.13).
 * - `succeeded` — the call succeeded and the re-read was triggered; the form
 *   closes from here.
 * - `failed` — the call did not succeed, for the reason in the matching failure
 *   field. The form stays rendered with every entered value retained and its
 *   submit control available for a further submission (Requirements 12.11, 12.12).
 */
export type GuestOperationPhase = 'idle' | 'pending' | 'succeeded' | 'failed';

/**
 * Why a guest operation did not succeed.
 *
 * Exactly two values, because exactly two presentations are asked for: the
 * rejected Player_Display_Name of Requirement 12.11, which names the field, and
 * everything else of Requirement 12.12, which does not. No status code, no
 * further rejection reason, and no backend text (Requirement 17.2).
 */
export type GuestFailure = 'display-name-rejected' | 'generic';

/** Everything the Guest_Manager and the Guest_Form render from. */
export interface GuestManagerState {
  /** How far the `CreateGuest` operation has got. */
  readonly createPhase: GuestOperationPhase;
  /** Why the last `CreateGuest` call did not succeed, or `null`. */
  readonly createFailure: GuestFailure | null;
  /** How far the `EditGuest` operation has got. */
  readonly editPhase: GuestOperationPhase;
  /** Why the last `EditGuest` call did not succeed, or `null`. */
  readonly editFailure: GuestFailure | null;
}

/** The initial state: neither operation attempted. */
export function initialGuestManagerState(): GuestManagerState {
  return {
    createPhase: 'idle',
    createFailure: null,
    editPhase: 'idle',
    editFailure: null,
  };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * The only payload any action carries beyond an operation name is a
 * {@link GuestFailure}, which is one of two names this feature declares — so
 * there is nothing of the backend's wording to leak into the interface
 * (Requirement 17.2).
 */
export type GuestManagerAction =
  | { readonly type: 'requested'; readonly operation: GuestOperation }
  | { readonly type: 'succeeded'; readonly operation: GuestOperation }
  | {
      readonly type: 'failed';
      readonly operation: GuestOperation;
      readonly failure: GuestFailure;
    }
  | { readonly type: 'outcomeCleared'; readonly operation: GuestOperation }
  | { readonly type: 'discarded' };

/**
 * The state of one operation's two fields, applied to whichever operation the
 * action named.
 *
 * Written as one helper over both operations so the create and the edit paths
 * cannot drift apart: the two differ in which call they issue and in nothing
 * else about how an outcome is recorded.
 */
function withOperation(
  state: GuestManagerState,
  operation: GuestOperation,
  phase: GuestOperationPhase,
  failure: GuestFailure | null,
): GuestManagerState {
  return operation === 'create'
    ? { ...state, createPhase: phase, createFailure: failure }
    : { ...state, editPhase: phase, editFailure: failure };
}

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it.
 */
export function reduceGuestManager(
  state: GuestManagerState,
  action: GuestManagerAction,
): GuestManagerState {
  switch (action.type) {
    // 12.13: the pending phase is the submit control's disabled state, and a
    // fresh attempt clears the previous outcome of that operation alone.
    case 'requested':
      return withOperation(state, action.operation, 'pending', null);

    // 12.6, 12.10: the re-read is triggered by the hook, not recorded here — this
    // machine holds no squad data of its own to refresh.
    case 'succeeded':
      return withOperation(state, action.operation, 'succeeded', null);

    // 12.11, 12.12: the form keeps rendering with its entered values; nothing
    // here clears them, because nothing here holds them.
    case 'failed':
      return withOperation(state, action.operation, 'failed', action.failure);

    // Called when the Guest_Form opens or closes, so a settled outcome cannot
    // close a form that has just been reopened.
    case 'outcomeCleared':
      return withOperation(state, action.operation, 'idle', null);

    // 17.5: an ended session or a departed screen holds no outcome at all.
    case 'discarded':
      return initialGuestManagerState();

    default:
      return state;
  }
}

// --- Submissions ------------------------------------------------------------

/**
 * What the Guest_Form submits to create a guest.
 *
 * The display name is passed **untrimmed**, because trimming it is
 * `validateDisplayName`'s job and the trimmed value is what gets submitted
 * (Requirement 12.2). The tier is the *selection*, not a code: mapping it is
 * `lib/skillTier.ts`'s job (Requirement 12.5).
 */
export interface GuestCreateSubmission {
  /** The Player_Display_Name as entered. */
  readonly displayName: string;
  /** The tier selection, defaulting to seeding no tier (Requirement 12.5). */
  readonly skillTier: SkillTierCreateOption;
  /** Whether the Lawful_Basis_Acknowledgement was given (Requirement 12.3). */
  readonly lawfulBasisAcknowledged: boolean;
}

/**
 * What the Guest_Form submits to edit a guest.
 *
 * No acknowledgement: Requirement 12.8 renders no such control on an edit.
 */
export interface GuestEditSubmission {
  /** The guest's membership identity, from the Player_Row being edited. */
  readonly membershipId: string;
  /** The Player_Display_Name as entered, prefilled from the row. */
  readonly displayName: string;
  /** The tier selection, defaulting to leaving the tier unchanged (12.9). */
  readonly skillTier: SkillTierEditOption;
}

// --- Hook surface -----------------------------------------------------------

/**
 * The failure one settled non-success outcome records.
 *
 * The single place the one distinguishable rejection is told from the rest: the
 * api's `'display-name-in-use'` reason becomes the failure Requirement 12.11
 * presents, and every other arm — not-found, auth-failure, any other rejection
 * reason, timeout, transport-failure, parse-failure — becomes the generic one of
 * Requirement 12.12. Nothing else of the outcome is read (Requirement 17.2).
 *
 * Pure and total, and at module scope so both issue sites read the same rule.
 */
function guestFailureOf(result: CallResult<unknown> | null): GuestFailure {
  return result !== null &&
    result.kind === 'rejected-input' &&
    result.reason === 'display-name-in-use'
    ? 'display-name-rejected'
    : 'generic';
}

/** Options for {@link useGuestManager}. Every seam is injected. */
export interface GuestManagerOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The squad the guest belongs to, taken from the parsed Squad_Detail the
   * Squad_Screen is rendering. The Response_Parser already validated it as an
   * identifier, so it is not re-validated here.
   */
  readonly squadId: string;
  /**
   * The post-mutation re-read: `useSquadScreen`'s `refresh()`, which issues one
   * further `GetSquad` and — where asked with `{ includeLeaderboard: true }` —
   * one further `GetSquadLeaderboard` (Requirements 12.6, 12.10).
   *
   * Injected rather than reimplemented so that each squad read keeps exactly one
   * issue site in the feature; which of the two re-reads a success wants is this
   * hook's statement, made at the two `settle` sites below.
   */
  readonly refresh: (options?: SquadRefreshOptions) => void;
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

/** What the Guest_Manager and the Guest_Form read and activate. */
export interface GuestManagerMachine extends GuestManagerState {
  /**
   * Whether a `CreateGuest` call awaits a response — the submit control's
   * disabled state while creating (Requirement 12.13).
   */
  readonly creating: boolean;
  /** Whether an `EditGuest` call awaits a response (Requirement 12.13). */
  readonly editing: boolean;
  /**
   * Submit exactly one `CreateGuest` call with the trimmed Player_Display_Name,
   * the mapped tier fields, and the acknowledgement, then — on success — trigger
   * exactly one further `GetSquad` **and** exactly one further
   * `GetSquadLeaderboard`, because the created guest may appear on the
   * leaderboard (Requirements 12.2, 12.5, 12.6).
   *
   * Issues **nothing** while the name does not validate or the
   * Lawful_Basis_Acknowledgement is not given (Requirement 12.3), while a create
   * call awaits a response (Requirement 12.13), and once the `discarded` latch
   * has closed.
   */
  create(submission: GuestCreateSubmission): void;
  /**
   * Submit exactly one `EditGuest` call for one membership identity, conveying
   * whether the tier changes and only then the tier, and — on success — trigger
   * exactly one further `GetSquad` and no leaderboard call of its own
   * (Requirements 12.9, 12.10).
   *
   * Issues nothing while the name does not validate, while an edit call awaits a
   * response, and once the latch has closed.
   */
  edit(submission: GuestEditSubmission): void;
  /**
   * Clear one operation's settled outcome — called when the Guest_Form opens and
   * when it closes, so a `succeeded` phase cannot close a form that was just
   * reopened, and a previous failure is not presented against a fresh attempt.
   */
  clearOutcome(operation: GuestOperation): void;
}

/**
 * Run the Guest_Manager machine.
 *
 * Issues no call on mount: both calls are consequences of a person submitting the
 * Guest_Form (Requirement 17.4). Unmounting, or the Auth_State transitioning to
 * `unauthenticated`, aborts both calls awaiting a response and disregards their
 * outcomes — including their re-reads (Requirements 12.12, 17.5).
 *
 * Requirements: 12.2, 12.5, 12.6, 12.9, 12.10, 12.11, 12.12, 12.13, 17.2, 17.4, 17.5
 */
export function useGuestManager(
  options: GuestManagerOptions,
): GuestManagerMachine {
  const { api, squadId, refresh, authState = 'authenticated' } = options;

  const [state, rawDispatch] = useReducer(
    reduceGuestManager,
    undefined,
    initialGuestManagerState,
  );

  // The state as of the last *dispatch* rather than the last render, so each
  // operation's single-flight decision is made against current values. The
  // reducer is pure, so folding it twice costs nothing, and this avoids a second
  // source of truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: GuestManagerAction): void => {
    stateRef.current = reduceGuestManager(stateRef.current, action);
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

  /** The two calls awaiting a response, so the latch can abort both (17.5). */
  const createControllerRef = useRef<AbortController | null>(null);
  const editControllerRef = useRef<AbortController | null>(null);
  /**
   * The token of each operation's most recently issued call. Discarding bumps
   * both, which makes every outstanding response unacceptable independently of
   * the latch below — so a response arriving after this screen was left can never
   * be accepted, even though a remount reopens the latch.
   */
  const createTokenRef = useRef(0);
  const editTokenRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirement 17.5). */
  const discardedRef = useRef(false);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon everything: abort both calls awaiting a response, make every
   * outstanding response unacceptable, and hold no outcome (Requirement 17.5).
   *
   * Idempotent, so several triggers in one tick do the work once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    createTokenRef.current += 1;
    editTokenRef.current += 1;

    createControllerRef.current?.abort();
    createControllerRef.current = null;
    editControllerRef.current?.abort();
    editControllerRef.current = null;

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  /** Whether an activation may issue a call at all (Requirement 17.5). */
  const blocked = useCallback(
    (): boolean =>
      discardedRef.current || authStateRef.current !== 'authenticated',
    [],
  );

  /**
   * Issue one `CreateGuest` call (Requirements 12.2, 12.5, 12.6).
   *
   * The only issue site in the feature for this endpoint, and it issues exactly
   * one request per activation — the Squads_Api never retries, and neither does
   * this (Requirement 17.4).
   */
  const issueCreateCall = useCallback(
    (submission: GuestCreateSubmission): void => {
      if (blocked()) {
        return;
      }

      // 12.13: one activation, one call.
      if (stateRef.current.createPhase === 'pending') {
        return;
      }

      // 12.2, 12.3: no call at all unless the name validates and the
      // acknowledgement is given. Nothing is recorded either — the validation
      // message belongs to the control, not to this machine's outcome surface.
      const name = validateDisplayName(submission.displayName);
      if (!name.ok || !submission.lawfulBasisAcknowledged) {
        return;
      }

      // 12.2, 12.5: the trimmed name, and the tier fields `lib/skillTier.ts`
      // decides — which omit `skillTier` entirely while the default is selected.
      const command: CreateGuestRequest = {
        displayName: name.value,
        lawfulBasisAcknowledged: true,
        ...skillTierFieldsForCreate(submission.skillTier),
      };

      const token = createTokenRef.current + 1;
      createTokenRef.current = token;

      const controller = new AbortController();
      createControllerRef.current = controller;

      dispatch({ type: 'requested', operation: 'create' });

      /**
       * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
       * settles every outcome into a `CallResult`, so `null` is defence against a
       * seam that throws rather than an expected path.
       */
      const settle = (result: CallResult<CreatedGuest> | null): void => {
        if (createControllerRef.current === controller) {
          createControllerRef.current = null;
        }

        // 17.5: a response for a discarded machine, or for a superseded call,
        // changes nothing at all — and triggers no re-read.
        if (discardedRef.current || token !== createTokenRef.current) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          dispatch({ type: 'succeeded', operation: 'create' });
          // 12.6: the recomposed Player_List comes from the machine that owns
          // both squad reads; the created guest's identity is not held here. The
          // leaderboard is forced because the new guest may appear on it, so the
          // one further `GetSquadLeaderboard` is issued whether or not a
          // leaderboard is already held.
          refreshRef.current({ includeLeaderboard: true });
          return;
        }

        dispatch({
          type: 'failed',
          operation: 'create',
          failure: guestFailureOf(result),
        });
      };

      void apiRef.current
        .createGuest(squadIdRef.current, command, controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [blocked, dispatch],
  );

  /**
   * Issue one `EditGuest` call (Requirements 12.9, 12.10).
   *
   * The command conveys whether the tier changes and, only when it does, the
   * tier — decided by `skillTierFieldsForEdit`, so leaving it unchanged cannot
   * overwrite it.
   */
  const issueEditCall = useCallback(
    (submission: GuestEditSubmission): void => {
      if (blocked()) {
        return;
      }

      if (stateRef.current.editPhase === 'pending') {
        return;
      }

      const name = validateDisplayName(submission.displayName);
      if (!name.ok) {
        return;
      }

      const command: EditGuestRequest = {
        displayName: name.value,
        ...skillTierFieldsForEdit(submission.skillTier),
      };

      const token = editTokenRef.current + 1;
      editTokenRef.current = token;

      const controller = new AbortController();
      editControllerRef.current = controller;

      dispatch({ type: 'requested', operation: 'edit' });

      const settle = (result: CallResult<void> | null): void => {
        if (editControllerRef.current === controller) {
          editControllerRef.current = null;
        }

        if (discardedRef.current || token !== editTokenRef.current) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          dispatch({ type: 'succeeded', operation: 'edit' });
          // 12.10: exactly one further `GetSquad` and no more — the edit changes
          // no membership, so the leaderboard is not forced, which leaves a held
          // leaderboard alone and still fills an empty slot.
          refreshRef.current();
          return;
        }

        dispatch({
          type: 'failed',
          operation: 'edit',
          failure: guestFailureOf(result),
        });
      };

      void apiRef.current
        .editGuest(
          squadIdRef.current,
          submission.membershipId,
          command,
          controller.signal,
        )
        .then(settle, () => {
          settle(null);
        });
    },
    [blocked, dispatch],
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

  // 17.5: leaving the Squad_Screen aborts both calls awaiting a response and
  // disregards them. The latch is reopened so a remount is a fresh mount; the
  // bumped tokens keep the abandoned calls' responses unacceptable regardless.
  useEffect(() => {
    return () => {
      discard();
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  const create = useCallback(
    (submission: GuestCreateSubmission): void => {
      issueCreateCall(submission);
    },
    [issueCreateCall],
  );

  const edit = useCallback(
    (submission: GuestEditSubmission): void => {
      issueEditCall(submission);
    },
    [issueEditCall],
  );

  const clearOutcome = useCallback(
    (operation: GuestOperation): void => {
      dispatch({ type: 'outcomeCleared', operation });
    },
    [dispatch],
  );

  return useMemo(
    () => ({
      createPhase: state.createPhase,
      createFailure: state.createFailure,
      editPhase: state.editPhase,
      editFailure: state.editFailure,
      creating: state.createPhase === 'pending',
      editing: state.editPhase === 'pending',
      create,
      edit,
      clearOutcome,
    }),
    [
      clearOutcome,
      create,
      edit,
      state.createFailure,
      state.createPhase,
      state.editFailure,
      state.editPhase,
    ],
  );
}
