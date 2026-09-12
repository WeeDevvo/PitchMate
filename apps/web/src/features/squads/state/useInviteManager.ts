/**
 * The Invite_Manager's machine — one reducer-backed hook holding the displayed
 * invite listing and the transient Invite_Reveal, and issuing every
 * `ListInvites`, `GenerateInvite`, and `RevokeInvite` call.
 *
 * `components/InviteManager.tsx` renders from this machine and calls nothing
 * itself, which is what makes "one `ListInvites` per mount" a structural fact
 * rather than an aspiration (Requirement 11.1): there is exactly one issue site
 * per operation below, each guarded by one latch.
 *
 * ### Six behaviours worth stating
 *
 * 1. **One `ListInvites` per mount, none from a re-render** (Requirement 11.1). A
 *    `startedRef` latch closes on the first issued call and only the unmount
 *    cleanup reopens it, so a remount is a fresh mount and a re-render is not.
 * 2. **A generated invite reveals once, and is then unrecoverable**
 *    (Requirement 11.7). The Invite_Link and Invite_Code live in
 *    {@link InviteManagerState.reveal} and nowhere else: they are cleared by
 *    {@link InviteManagerMachine.dismissReveal}, by the next generate
 *    activation, and by the `discarded` latch that unmount closes. This module
 *    writes **no** `localStorage`, **no** `sessionStorage`, no URL, and no log —
 *    a source scan finds no storage or console call here at all — so once the
 *    reveal state is cleared neither value exists anywhere in the feature.
 * 3. **A successful generate or revoke issues exactly one further list**
 *    (Requirements 11.6, 11.10). Both go through the same `issueListCall`, so
 *    the two cannot drift apart, and neither re-derives the Invite_Order.
 * 4. **Single-flight per operation** (Requirement 11.11). A second generate while
 *    one awaits a response issues nothing; likewise a second revoke, for the same
 *    invite or a different one — Requirement 11.11 makes the discipline
 *    per-operation, not per-invite, so `revokingInviteId` holds the one revoke in
 *    flight and doubles as the control's disabled state.
 * 5. **A failure never disturbs the listing** (Requirement 11.12). Every
 *    non-success arm of every one of the three calls folds into
 *    {@link InviteManagerState.failure} — an operation name and nothing else —
 *    and the last accepted listing keeps rendering unchanged. Only a *first*
 *    list, which has no listing to keep, reaches the `failed` phase.
 * 6. **A `discarded` latch** (Requirements 11.7, 11.12, 17.5). Unmounting, or the
 *    Auth_State transitioning to `unauthenticated`, aborts all three calls
 *    through the caller `AbortSignal` the Squads_Api accepts, discards the
 *    listing *and the reveal*, and closes a latch so nothing is ever accepted
 *    afterwards. The latch is belt-and-braces: each operation's call also carries
 *    a token, and discarding bumps all three, so a late response is unacceptable
 *    even where a remount has reopened the latch.
 *
 * ### The Invite_Order is applied once, on acceptance
 *
 * `orderInviteSummaries` from `lib/inviteOrder.ts` runs in the reducer, so the
 * held listing is already in rendered order and no component sorts anything
 * (Requirement 11.3). Nothing here filters by Invite_State either: a revoked or
 * expired invite still renders, just without a revoke control, and that is the
 * entry's decision (Requirement 11.9).
 *
 * ### No copy, no backend detail, no retry of its own
 *
 * No action and no state field carries a status code, a rejection reason, or a
 * response body value (Requirement 17.2) — the active-invite-limit rejection
 * Requirement 11.12 names folds into the same failure as a timeout, which is
 * exactly what that requirement asks for. The outcome copy is
 * `lib/messages.ts`, read by the components. Nothing re-issues a call by itself
 * (Requirement 17.4): every issue site below is a consequence of a mount or of a
 * person activating a control.
 *
 * The 10-second Squad_Call_Timeout, the abort chaining, and the
 * one-request-per-method discipline all belong to `api/squadsApi.ts`; none of it
 * is reimplemented here.
 *
 * Requirements: 11.1, 11.3, 11.6, 11.7, 11.10, 11.11, 11.12, 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type {
  CallResult,
  GenerateInviteRequest,
  SquadsApi,
} from '../api/squadsApi';
import { orderInviteSummaries } from '../lib/inviteOrder';
import type { GeneratedInvite } from '../lib/parse/generatedInvite';
import type { InviteSummary } from '../lib/parse/inviteSummary';

// --- State ------------------------------------------------------------------

/**
 * How far the `ListInvites` load has got.
 *
 * - `idle` — nothing issued: before the mount call, and after the `discarded`
 *   latch closes.
 * - `loading` — a call awaits a response and **no** listing is held.
 * - `refreshing` — a call awaits a response and a previously accepted listing
 *   **is** held, which keeps rendering. Entered by the retry control and by the
 *   further list a successful generate or revoke triggers.
 * - `listed` — a listing has been accepted; it may be empty. Also the phase a
 *   *failed refresh* returns to, because the last accepted listing keeps
 *   rendering unchanged (Requirement 11.12).
 * - `failed` — a list call did not yield a listing and none was held.
 */
export type InviteListPhase =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'listed'
  | 'failed';

/**
 * Which of the three invite operations a failure concerns.
 *
 * The whole of what a failure carries. There is no field on which a status code,
 * a rejection reason, or the backend's own wording could ride along
 * (Requirement 17.2), so the component picks its message from
 * `lib/messages.ts` by operation alone.
 */
export type InviteOperation = 'list' | 'generate' | 'revoke';

/**
 * The two values the Invite_Reveal presents, held for exactly as long as it is
 * displayed (Requirements 11.6, 11.7).
 *
 * Deliberately **not** the whole {@link GeneratedInvite}: the reveal needs the
 * redeemable address and the code, so the invite identity and expiry are not
 * retained. The less that is held, the less there is to leak.
 */
export interface InviteReveal {
  /** The backend's `redeemableLink`, presented and copied exactly as returned. */
  readonly redeemableLink: string;
  /** The Invite_Code, presented alongside it. */
  readonly code: string;
}

/** Everything the Invite_Manager renders from. */
export interface InviteManagerState {
  /** How far the `ListInvites` load has got. */
  readonly listPhase: InviteListPhase;
  /**
   * The accepted Invite_Summary listing **already in the Invite_Order**, or
   * `null` when none is held. Ordering happens once, on acceptance, through the
   * pure `orderInviteSummaries` (Requirement 11.3).
   */
  readonly invites: readonly InviteSummary[] | null;
  /** Whether a `GenerateInvite` call awaits a response (Requirement 11.11). */
  readonly generating: boolean;
  /**
   * The invite whose `RevokeInvite` call awaits a response, or `null` when none
   * does — the disabled state of that one revoke control, and the single-flight
   * guard for the operation (Requirement 11.11).
   */
  readonly revokingInviteId: string | null;
  /**
   * The Invite_Link and Invite_Code of the invite just generated, or `null`
   * whenever no reveal is displayed — which is before the first generate, after
   * a dismissal, from the next generate activation, and after the `discarded`
   * latch closes (Requirement 11.7).
   */
  readonly reveal: InviteReveal | null;
  /**
   * The operation whose last call did not succeed, or `null` when none has. Set
   * by every non-success arm of all three calls and cleared when that operation
   * is next activated (Requirement 11.12).
   */
  readonly failure: InviteOperation | null;
}

/** The initial state: nothing issued, nothing held, nothing revealed. */
export function initialInviteManagerState(): InviteManagerState {
  return {
    listPhase: 'idle',
    invites: null,
    generating: false,
    revokingInviteId: null,
    reveal: null,
    failure: null,
  };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * The three failure actions carry nothing at all, so there is nothing of the
 * backend's wording to leak into the interface (Requirement 17.2). The one action
 * carrying a secret is `generateAccepted`, whose reveal the reducer parks in the
 * single field three other actions clear.
 */
export type InviteManagerAction =
  | { readonly type: 'listRequested' }
  | {
      readonly type: 'listAccepted';
      readonly summaries: readonly InviteSummary[];
    }
  | { readonly type: 'listFailed' }
  | { readonly type: 'generateRequested' }
  | { readonly type: 'generateAccepted'; readonly reveal: InviteReveal }
  | { readonly type: 'generateFailed' }
  | { readonly type: 'revealDismissed' }
  | { readonly type: 'revokeRequested'; readonly inviteId: string }
  | { readonly type: 'revokeSucceeded' }
  | { readonly type: 'revokeFailed' }
  | { readonly type: 'discarded' };

/**
 * The failure field after an operation is activated again: cleared where it named
 * that operation, and left alone otherwise.
 *
 * A generate failure therefore survives a revoke, and vice versa, so one
 * operation's outcome message is never silently erased by an unrelated one.
 */
function clearFailureFor(
  failure: InviteOperation | null,
  operation: InviteOperation,
): InviteOperation | null {
  return failure === operation ? null : failure;
}

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it.
 */
export function reduceInviteManager(
  state: InviteManagerState,
  action: InviteManagerAction,
): InviteManagerState {
  switch (action.type) {
    // Which busy phase a list call enters is decided by whether a listing is
    // held, not by which control issued it — so the retry control and the
    // post-generate / post-revoke re-list need no phase knowledge of their own.
    case 'listRequested':
      return {
        ...state,
        listPhase: state.invites === null ? 'loading' : 'refreshing',
        failure: clearFailureFor(state.failure, 'list'),
      };

    // 11.2, 11.3: exactly the parsed listing, ordered once here, empty or not.
    case 'listAccepted':
      return {
        ...state,
        listPhase: 'listed',
        invites: orderInviteSummaries(action.summaries),
      };

    // 11.12: the listing last accepted keeps rendering unchanged. Only a first
    // list — which has none to keep — reaches `failed`.
    case 'listFailed':
      return {
        ...state,
        listPhase: state.invites === null ? 'failed' : 'listed',
        failure: 'list',
      };

    // 11.7: a second generate clears the first reveal before it can produce a
    // second, so at most one Invite_Link and Invite_Code are ever retained.
    case 'generateRequested':
      return {
        ...state,
        generating: true,
        reveal: null,
        failure: clearFailureFor(state.failure, 'generate'),
      };

    // 11.6: the reveal is the *only* place the returned values are held.
    case 'generateAccepted':
      return { ...state, generating: false, reveal: action.reveal };

    case 'generateFailed':
      return { ...state, generating: false, failure: 'generate' };

    // 11.7: dismissal discards both values from every value the feature retains.
    case 'revealDismissed':
      return { ...state, reveal: null };

    case 'revokeRequested':
      return {
        ...state,
        revokingInviteId: action.inviteId,
        failure: clearFailureFor(state.failure, 'revoke'),
      };

    // 11.10: the refreshed listing arrives from the further `ListInvites` the
    // hook issues, not from any local edit of the held listing.
    case 'revokeSucceeded':
      return { ...state, revokingInviteId: null };

    case 'revokeFailed':
      return { ...state, revokingInviteId: null, failure: 'revoke' };

    // 11.7, 17.5: an ended session or a departed screen displays no invite data
    // and retains no revealed secret.
    case 'discarded':
      return initialInviteManagerState();

    default:
      return state;
  }
}

// --- Hook surface -----------------------------------------------------------

/** Options for {@link useInviteManager}. Every seam is injected. */
export interface InviteManagerOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The squad whose invites these are, taken from the parsed Squad_Detail the
   * Squad_Screen is rendering. The Response_Parser already validated it as an
   * identifier, so it is not re-validated here.
   */
  readonly squadId: string;
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

/** What the Invite_Manager reads and activates. */
export interface InviteManagerMachine extends InviteManagerState {
  /**
   * Whether a `ListInvites` call awaits a response — the programmatically
   * determinable busy state of the listing, true in both the nothing-held and
   * the listing-held case.
   */
  readonly busy: boolean;
  /**
   * Issue exactly one further `ListInvites` call.
   *
   * The retry control's only behaviour, and a no-op while a list call awaits a
   * response or once the `discarded` latch has closed. Nothing re-issues itself
   * (Requirement 17.4).
   */
  retry(): void;
  /**
   * Submit exactly one `GenerateInvite` call with the selected validity choice,
   * then — on success — reveal the returned values and issue exactly one further
   * `ListInvites` call (Requirements 11.5, 11.6).
   *
   * A no-op while a generate call awaits a response (Requirement 11.11) and once
   * the latch has closed. The expiring-or-non-expiring choice is the component's;
   * this hook passes the body through unaltered.
   */
  generate(command: GenerateInviteRequest): void;
  /**
   * Submit exactly one `RevokeInvite` call for one invite identity, then — on
   * success — issue exactly one further `ListInvites` call (Requirement 11.10).
   *
   * The confirmation Requirement 11.10 asks for is the component's
   * `ConfirmDialog`; this is called after it is confirmed. A no-op while any
   * revoke call awaits a response (Requirement 11.11) and once the latch has
   * closed.
   */
  revoke(inviteId: string): void;
  /**
   * Discard the revealed Invite_Link and Invite_Code (Requirement 11.7).
   *
   * Called when the Invite_Reveal is dismissed. After this the values exist
   * nowhere in the feature: they were never written to storage, put in a URL, or
   * logged, and this was the one place they were held.
   */
  dismissReveal(): void;
}

/**
 * Run the Invite_Manager machine.
 *
 * Mounting while `authenticated` issues exactly one `ListInvites` call, and no
 * re-render issues another (Requirement 11.1). Mounting while `unauthenticated`
 * issues none. Unmounting, or the Auth_State transitioning to `unauthenticated`,
 * aborts every call awaiting a response, discards the listing and the reveal, and
 * disregards every late outcome (Requirements 11.7, 17.5).
 *
 * Requirements: 11.1, 11.3, 11.6, 11.7, 11.10, 11.11, 11.12, 17.2, 17.4, 17.5
 */
export function useInviteManager(
  options: InviteManagerOptions,
): InviteManagerMachine {
  const { api, squadId, authState = 'authenticated' } = options;

  const [state, rawDispatch] = useReducer(
    reduceInviteManager,
    undefined,
    initialInviteManagerState,
  );

  // The state as of the last *dispatch* rather than the last render, so each
  // operation's single-flight decision and the list's busy-phase choice are made
  // against current values. The reducer is pure, so folding it twice costs
  // nothing, and this avoids a second source of truth that is a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: InviteManagerAction): void => {
    stateRef.current = reduceInviteManager(stateRef.current, action);
    rawDispatch(action);
  }, []);

  // The injected facade and the squad identity, held by reference and
  // synchronised in effects rather than during render. Declared before the mount
  // effect so they have run by the time that effect reads them.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const squadIdRef = useRef(squadId);
  useEffect(() => {
    squadIdRef.current = squadId;
  }, [squadId]);

  const authStateRef = useRef(authState);
  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  /** The three calls awaiting a response, so the latch can abort them (17.5). */
  const listControllerRef = useRef<AbortController | null>(null);
  const generateControllerRef = useRef<AbortController | null>(null);
  const revokeControllerRef = useRef<AbortController | null>(null);
  /**
   * The token of each operation's most recently issued call. Discarding bumps all
   * three, which makes every outstanding response unacceptable independently of
   * the latch below — so a response arriving after this screen was left can never
   * be accepted, even though a remount reopens the latch.
   */
  const listTokenRef = useRef(0);
  const generateTokenRef = useRef(0);
  const revokeTokenRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirement 17.5). */
  const discardedRef = useRef(false);
  /** Whether this mount has already issued its one list (Requirement 11.1). */
  const startedRef = useRef(false);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon everything: abort all three calls awaiting a response, make every
   * outstanding response unacceptable, and display no invite data — including
   * the revealed Invite_Link and Invite_Code (Requirements 11.7, 17.5).
   *
   * Idempotent, so several triggers in one tick do the work once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    listTokenRef.current += 1;
    generateTokenRef.current += 1;
    revokeTokenRef.current += 1;

    listControllerRef.current?.abort();
    listControllerRef.current = null;
    generateControllerRef.current?.abort();
    generateControllerRef.current = null;
    revokeControllerRef.current?.abort();
    revokeControllerRef.current = null;

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  /** Whether an activation may issue a call at all (Requirement 17.5). */
  const blocked = useCallback(
    (): boolean =>
      discardedRef.current || authStateRef.current !== 'authenticated',
    [],
  );

  /**
   * Issue one `ListInvites` call.
   *
   * The only issue site in the feature for this endpoint. It is called from the
   * mount effect, from {@link InviteManagerMachine.retry}, and from the success
   * arms of generate and revoke, and it issues exactly one request per call — the
   * Squads_Api never retries, and neither does this (Requirement 17.4).
   *
   * A no-op while a list call awaits a response: that call already delivers the
   * refreshed listing, so stacking a second behind it would issue a request
   * nobody asked for.
   */
  const issueListCall = useCallback((): void => {
    if (blocked()) {
      return;
    }

    const { listPhase } = stateRef.current;
    if (listPhase === 'loading' || listPhase === 'refreshing') {
      return;
    }

    const token = listTokenRef.current + 1;
    listTokenRef.current = token;

    const controller = new AbortController();
    listControllerRef.current = controller;

    dispatch({ type: 'listRequested' });

    /**
     * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
     * settles every outcome into a `CallResult`, so `null` is defence against a
     * seam that throws rather than an expected path.
     */
    const settle = (result: CallResult<readonly InviteSummary[]> | null): void => {
      if (listControllerRef.current === controller) {
        listControllerRef.current = null;
      }

      // 17.5: a response for a discarded machine, or for a superseded call,
      // changes nothing at all — no listing, no failure, no message.
      if (discardedRef.current || token !== listTokenRef.current) {
        return;
      }

      if (result !== null && result.kind === 'success') {
        dispatch({ type: 'listAccepted', summaries: result.value });
        return;
      }

      // 11.12, 17.2: every other arm is the same failure, carrying nothing of
      // the backend's own wording, and leaving the held listing alone.
      dispatch({ type: 'listFailed' });
    };

    void apiRef.current
      .listInvites(squadIdRef.current, controller.signal)
      .then(settle, () => {
        settle(null);
      });
  }, [blocked, dispatch]);

  /**
   * Issue one `GenerateInvite` call for the selected validity choice
   * (Requirements 11.5, 11.6).
   *
   * On success the returned Invite_Link and Invite_Code become the reveal — the
   * only place they are held — and exactly one further `ListInvites` follows.
   */
  const issueGenerateCall = useCallback(
    (command: GenerateInviteRequest): void => {
      if (blocked()) {
        return;
      }

      // 11.11: one activation, one call. A further activation while a call awaits
      // a response changes nothing rather than stacking a second behind it.
      if (stateRef.current.generating) {
        return;
      }

      const token = generateTokenRef.current + 1;
      generateTokenRef.current = token;

      const controller = new AbortController();
      generateControllerRef.current = controller;

      dispatch({ type: 'generateRequested' });

      const settle = (result: CallResult<GeneratedInvite> | null): void => {
        if (generateControllerRef.current === controller) {
          generateControllerRef.current = null;
        }

        if (discardedRef.current || token !== generateTokenRef.current) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          // 11.6: exactly the two values the reveal presents; the identity and
          // the expiry the response also carried are not retained.
          dispatch({
            type: 'generateAccepted',
            reveal: {
              redeemableLink: result.value.redeemableLink,
              code: result.value.code,
            },
          });
          issueListCall();
          return;
        }

        // 11.12, 17.2: the active-invite-limit rejection folds in here with every
        // other arm, carrying nothing that names it.
        dispatch({ type: 'generateFailed' });
      };

      void apiRef.current
        .generateInvite(squadIdRef.current, command, controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [blocked, dispatch, issueListCall],
  );

  /**
   * Issue one `RevokeInvite` call for one invite identity, and exactly one
   * further `ListInvites` on success (Requirement 11.10).
   */
  const issueRevokeCall = useCallback(
    (inviteId: string): void => {
      if (blocked()) {
        return;
      }

      // 11.11: per-operation, not per-invite — a second revoke of any invite
      // while one awaits a response issues nothing.
      if (stateRef.current.revokingInviteId !== null) {
        return;
      }

      const token = revokeTokenRef.current + 1;
      revokeTokenRef.current = token;

      const controller = new AbortController();
      revokeControllerRef.current = controller;

      dispatch({ type: 'revokeRequested', inviteId });

      const settle = (result: CallResult<void> | null): void => {
        if (revokeControllerRef.current === controller) {
          revokeControllerRef.current = null;
        }

        if (discardedRef.current || token !== revokeTokenRef.current) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          dispatch({ type: 'revokeSucceeded' });
          issueListCall();
          return;
        }

        dispatch({ type: 'revokeFailed' });
      };

      void apiRef.current
        .revokeInvite(squadIdRef.current, inviteId, controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [blocked, dispatch, issueListCall],
  );

  /**
   * The mount and Auth_State effect.
   *
   * Its dependencies do not change on a re-render, so no re-render issues a call
   * (Requirement 11.1). A transition to `unauthenticated` discards; a mount while
   * `unauthenticated` simply waits, issuing nothing (Requirement 17.5).
   */
  useEffect(() => {
    const previous = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;

    if (authState !== 'authenticated') {
      // 17.5: only a *transition* from an authenticated session is a loss of
      // session. Mounting while unauthenticated has nothing to abandon, and
      // latching there would deny the list a later sign-in owes.
      if (previous === 'authenticated') {
        discard();
      }
      return;
    }

    // 11.1: one list per mount. The latch also covers the authenticated-later
    // case: whichever effect run issues the call, no other run issues a second.
    if (discardedRef.current || startedRef.current) {
      return;
    }

    startedRef.current = true;
    issueListCall();
  }, [authState, discard, issueListCall]);

  // 11.7, 17.5: leaving the Squad_Screen aborts every call awaiting a response,
  // disregards it, and discards the revealed values. `startedRef` and the latch
  // are reopened so a remount is a fresh mount with exactly one list; the bumped
  // tokens keep the abandoned calls' responses unacceptable regardless.
  useEffect(() => {
    return () => {
      discard();
      startedRef.current = false;
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  const retry = useCallback((): void => {
    issueListCall();
  }, [issueListCall]);

  const generate = useCallback(
    (command: GenerateInviteRequest): void => {
      issueGenerateCall(command);
    },
    [issueGenerateCall],
  );

  const revoke = useCallback(
    (inviteId: string): void => {
      issueRevokeCall(inviteId);
    },
    [issueRevokeCall],
  );

  const dismissReveal = useCallback((): void => {
    dispatch({ type: 'revealDismissed' });
  }, [dispatch]);

  return useMemo(
    () => ({
      listPhase: state.listPhase,
      invites: state.invites,
      generating: state.generating,
      revokingInviteId: state.revokingInviteId,
      reveal: state.reveal,
      failure: state.failure,
      busy: state.listPhase === 'loading' || state.listPhase === 'refreshing',
      retry,
      generate,
      revoke,
      dismissReveal,
    }),
    [
      dismissReveal,
      generate,
      retry,
      revoke,
      state.failure,
      state.generating,
      state.invites,
      state.listPhase,
      state.reveal,
      state.revokingInviteId,
    ],
  );
}
