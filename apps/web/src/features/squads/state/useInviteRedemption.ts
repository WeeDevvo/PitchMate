/**
 * The Invite_Landing_Route's machine — one reducer-backed hook that extracts the
 * Invite_Secret from the rendered path, issues the anonymous `PreviewInvite`
 * while there is no session, issues **at most one** `RedeemInvite` per rendered
 * path once there is one, and navigates on success by *replacing* the history
 * entry.
 *
 * The screen renders from this machine and calls nothing itself, so the counting
 * claims below are structural facts rather than aspirations: there is exactly one
 * `previewInvite` issue site and exactly one `redeemInvite` issue site, each
 * behind its own latch.
 *
 * ### The `redeemAttempted` latch, which is the heart of this machine
 *
 * Requirement 5.7 asks for **at most one** `RedeemInvite` for a given rendered
 * Invite_Landing_Route path — whether authentication was present at mount or
 * arrived later, and however many re-renders or subsequent Auth_State
 * transitions occur. That is more than a "once per mount" latch, because the
 * trigger is not the mount: it is *being authenticated while this path is
 * rendered*, which can happen at the first effect run, at the fourth, or after
 * the Auth_State has flipped twice.
 *
 * The latch is therefore **keyed on the path** rather than on the mount:
 * {@link useInviteRedemption} records the path it attempted redemption for and
 * refuses to attempt again for that same path. A re-render leaves the key
 * unchanged, so it issues nothing. An Auth_State transition leaves the key
 * unchanged, so it issues nothing. Only a genuinely different rendered path —
 * `react-router` keeps this component mounted when only the `code` segment
 * changes — opens the latch, and that is a different invite with a different
 * secret, which is a redemption the requirement never forbade.
 *
 * A person activating the retry control after a failure is neither a re-render
 * nor an Auth_State transition, so {@link InviteRedemptionMachine.retry}
 * deliberately issues a further call past the latch (Requirement 5.13). Nothing
 * else does.
 *
 * ### The rest of the behaviour, briefly
 *
 * 1. **Extraction first, and it can end the story** (Requirements 5.9, 5.11).
 *    The secret is read from the rendered path by the pure
 *    `extractInviteSecretFromPath`. An extraction failure settles immediately on
 *    `incompleteLink` and **no call of either kind is issued**.
 * 2. **`unauthenticated` → one `previewInvite`, then the handover surface**
 *    (Requirements 5.2, 5.6). The parsed Invite_Preview's instruction is carried
 *    on {@link InviteRedemptionState.instruction}; every non-success arm of the
 *    call leaves it `null`, which is the screen's cue to render its own fixed
 *    instruction from `lib/messages.ts`. A preview failure is therefore **not a
 *    dead end**: the phase is `handover` either way, and the sign-up and log-in
 *    controls stay rendered.
 * 3. **`authenticated` → no `previewInvite`, ever** (Requirement 5.2). The
 *    preview is issued only while the Auth_State is `unauthenticated` and only
 *    where no redemption has been attempted for this path — so a mount that was
 *    already authenticated issues no preview at all, and a later loss of session
 *    does not go back and issue one.
 * 4. **Single-flight** (Requirement 5.12). A second `RedeemInvite` is never
 *    concurrent with the first: the issue site returns early while the phase is
 *    `redeeming`, and the two kinds of call are mutually exclusive by Auth_State
 *    anyway, so one controller and one token cover both.
 * 5. **Success replaces the history entry** (Requirement 5.8). The current path
 *    carries the Invite_Secret, so pushing would leave it one back-activation
 *    away.
 * 6. **A transition back to `unauthenticated` is not a discard to an inert
 *    state** (Requirement 5.14). It aborts the call awaiting a response,
 *    disregards its outcome, navigates **nowhere**, and returns the screen to the
 *    handover surface. This is where this machine differs from its siblings,
 *    which latch a `discarded` flag and render nothing further.
 *
 * ### One `unusable` state, and nothing disclosed
 *
 * An invite that matches nothing, is revoked, or is expired reaches **one**
 * phase, `unusable`, identical for all three (Requirement 5.13 as numbered in
 * this task, Requirement 5.10 in the requirements document). The backend answers
 * all three with `410 InviteUnusable`, which the Squads_Api classifies as
 * `rejected-input` with the `invite-unusable` reason; a `404`/`403` is folded in
 * beside it, because that is the same non-disclosing answer about the same
 * invite. Nothing on the phase says which of the three applied, so the response
 * reveals nothing about which invites exist.
 *
 * Every other non-success arm — `auth-failure`, `timeout`,
 * `transport-failure`, `parse-failure`, and any other rejection reason — folds
 * into `failed`, which the screen renders as the Generic_Squads_Failure with a
 * retry control and a control to the Squads_Home.
 *
 * ### What never appears on the state
 *
 * No phase and no action carries a status code, a rejection reason, a
 * ProblemDetails value, or any backend wording (Requirement 17.2). Above all,
 * **the Invite_Secret is never on the state**: it is derived from the path into a
 * local value, handed to a request body, and put nowhere else — not on a phase,
 * not on an action, not into a message (Requirements 4.10, 17.2). No message in
 * `lib/messages.ts` takes an interpolation parameter, so there is no
 * message-shaped hole it could travel through either.
 *
 * `instruction` is the one string here, and it is the *preview's own* generic
 * instruction, which Requirement 5.2 asks to be rendered. It is not error text:
 * no failing arm of any call ever sets it, so the "no backend-supplied text"
 * property of Requirement 17.2 is untouched by it.
 *
 * ### What belongs to the screen rather than here
 *
 * The handover targets are built by the screen, not by this hook. Requirement 5.4
 * asks for one control to the Auth_Feature's sign-up route and one to its log-in
 * route, each carrying the requested Invite_Landing_Route path as the
 * Redirect_Capture query value, and Requirement 5.5 insists those come from the
 * Auth_Feature's own `SIGN_UP_ROUTE`, `LOG_IN_ROUTE`, and `REDIRECT_PARAM_NAME`
 * exports rather than feature-local copies. Those are rendered values, not state
 * transitions, so `screens/InviteLandingScreen.tsx` composes them from the same
 * `path` it hands this hook. This machine only says *whether* the handover
 * surface is displayed, through {@link InviteRedemptionMachine.handover}.
 *
 * The 10-second Squad_Call_Timeout, the abort chaining, and the
 * one-request-per-method discipline all belong to `api/squadsApi.ts`; none of it
 * is reimplemented here.
 *
 * Requirements: 4.10, 5.2, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14,
 * 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { HOME_ROUTE } from '../../app-shell';
import type { AuthState } from '../../auth';
import type {
  CallResult,
  RedeemInviteRequest,
  SquadsApi,
} from '../api/squadsApi';
import { extractInviteSecretFromPath } from '../lib/inviteSecret';
import type { InvitePreview } from '../lib/parse/invitePreview';
import type { Redemption } from '../lib/parse/redemption';
import { squadPath } from '../lib/routePaths';

// --- State ------------------------------------------------------------------

/**
 * Where the Invite_Landing_Route has got to.
 *
 * - `incompleteLink` — the Invite_Secret could not be read from the path, so
 *   neither call was issued (Requirement 5.9). Terminal for that path.
 * - `idle` — a secret was read and nothing has been issued yet. It lasts from
 *   the first render to the first effect run, which React flushes before paint,
 *   so it is not a surface a person sees; the screen renders it as the handover
 *   surface, which is what it becomes a moment later while unauthenticated.
 * - `previewing` — the one `PreviewInvite` call awaits a response
 *   (Requirement 5.2). The handover controls stay rendered throughout.
 * - `handover` — the preview has settled, either way (Requirements 5.2, 5.6),
 *   and the surface the machine returns to on a loss of session (5.14).
 * - `redeeming` — a `RedeemInvite` call awaits a response; the screen renders a
 *   busy indication and **neither** the instruction nor the controls (5.12).
 * - `redeemed` — the redemption succeeded and the navigation has been performed,
 *   replacing the history entry (Requirement 5.8).
 * - `unusable` — the presented secret matches no invite, is revoked, or is
 *   expired; one phase for all three (Requirement 5.10).
 * - `failed` — the call did not settle into an outcome about the invite at all,
 *   whatever the reason: the Generic_Squads_Failure, a retry control, and a
 *   control to the Squads_Home (Requirement 5.13).
 */
export type InviteRedemptionPhase =
  | 'incompleteLink'
  | 'idle'
  | 'previewing'
  | 'handover'
  | 'redeeming'
  | 'redeemed'
  | 'unusable'
  | 'failed';

/**
 * Everything the Invite_Landing_Route renders from.
 *
 * Two fields, and neither can carry an Invite_Secret, a status, or a backend
 * failure message (Requirements 4.10, 17.2).
 */
export interface InviteRedemptionState {
  /** Where the route has got to. */
  readonly phase: InviteRedemptionPhase;
  /**
   * The instruction carried by the parsed Invite_Preview (Requirement 5.2), or
   * `null` for "use the fixed instruction" — which covers every arm on which the
   * preview did not yield one, and the case where no preview was issued at all
   * (Requirement 5.6).
   *
   * This is the preview's deliberately generic wording: it names no squad, no
   * identity, and no membership count, because the anonymous endpoint answers
   * the same pair whatever secret was presented. It is never set from a failing
   * call, so no backend failure text can reach it (Requirement 17.2).
   */
  readonly instruction: string | null;
}

/**
 * The state the machine holds for a rendered path before anything is issued.
 *
 * The extraction runs here rather than in the reducer, so the reducer stays a
 * pure function of its two arguments alone. `extractInviteSecretFromPath` is
 * itself pure, total, and free of exceptions (Requirement 5.11), so this is too
 * — and it never keeps the secret it read: only whether there was one.
 *
 * @param path the rendered Invite_Landing_Route path
 * @returns `incompleteLink` for an unreadable path, `idle` otherwise
 *
 * Requirements: 5.9, 5.11
 */
export function initialInviteRedemptionState(
  path: string,
): InviteRedemptionState {
  return {
    phase: extractInviteSecretFromPath(path).ok ? 'idle' : 'incompleteLink',
    instruction: null,
  };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * Only one action carries a value at all, and that value is the preview's own
 * instruction. No action carries a status code, a rejection reason, a response
 * body, or the Invite_Secret (Requirements 4.10, 17.2).
 */
export type InviteRedemptionAction =
  | { readonly type: 'previewRequested' }
  | { readonly type: 'previewAccepted'; readonly instruction: string }
  | { readonly type: 'previewSettledWithoutInstruction' }
  | { readonly type: 'redeemRequested' }
  | { readonly type: 'redeemed' }
  | { readonly type: 'redeemUnusable' }
  | { readonly type: 'redeemFailed' }
  | { readonly type: 'handedBack' }
  | { readonly type: 'restarted'; readonly state: InviteRedemptionState };

/**
 * The one reducer. Pure, total, and free of timers, transport, navigation, and
 * DOM — so the whole machine can be exercised by folding actions over it.
 */
export function reduceInviteRedemption(
  state: InviteRedemptionState,
  action: InviteRedemptionAction,
): InviteRedemptionState {
  switch (action.type) {
    // 5.2: the one preview call. The instruction held so far is kept, so a
    // re-entry to this phase never blanks a surface that was already readable.
    case 'previewRequested':
      return { phase: 'previewing', instruction: state.instruction };

    // 5.2: the instruction the parsed Invite_Preview carried.
    case 'previewAccepted':
      return { phase: 'handover', instruction: action.instruction };

    // 5.6: a failed, timed-out, or unparseable preview is not a dead end — the
    // same handover phase, with `null` standing for the screen's fixed
    // instruction, and the sign-up and log-in controls still rendered.
    case 'previewSettledWithoutInstruction':
      return { phase: 'handover', instruction: null };

    // 5.12: a busy phase rendering neither the instruction nor the controls. The
    // instruction is retained rather than dropped, because a loss of session
    // returns to the handover surface and should not have lost it (5.14).
    case 'redeemRequested':
      return { phase: 'redeeming', instruction: state.instruction };

    // 5.8: the navigation has already been performed by the time this lands.
    case 'redeemed':
      return { phase: 'redeemed', instruction: state.instruction };

    // 5.10: one phase for "matches no invite", "revoked", and "expired" alike.
    // Nothing on it distinguishes them, so nothing can be disclosed from it.
    case 'redeemUnusable':
      return { phase: 'unusable', instruction: state.instruction };

    // 5.13: the Generic_Squads_Failure, a retry control, and a control to the
    // Squads_Home. No automatic further call follows (Requirement 17.4).
    case 'redeemFailed':
      return { phase: 'failed', instruction: state.instruction };

    // 5.14: the Auth_State became `unauthenticated` while this route is
    // rendered. Back to the handover surface — not to an inert state, and with
    // no navigation — keeping whatever instruction the preview had established.
    case 'handedBack':
      return { phase: 'handover', instruction: state.instruction };

    // A different Invite_Landing_Route path is now rendered under the same
    // mount: a different invite, so the machine starts again from the new
    // path's extraction and holds nothing of the previous one.
    case 'restarted':
      return action.state;

    default:
      return state;
  }
}

// --- Hook surface -----------------------------------------------------------

/**
 * How this machine performs navigation.
 *
 * A function rather than a `useNavigate` call inside the hook, for the reason
 * every seam in this feature is injected: the replacing navigation of
 * Requirement 5.8 is then observable without a router, and the screen supplies
 * `useNavigate()` — whose signature this deliberately matches — as the one
 * adapter.
 */
export type InviteRedemptionNavigate = (
  path: string,
  options: { readonly replace: boolean },
) => void;

/** Options for {@link useInviteRedemption}. Every seam is injected. */
export interface InviteRedemptionOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The rendered Invite_Landing_Route path, as the router reports it — the value
   * the Invite_Secret is extracted from (Requirement 5.11) **and the key the
   * `redeemAttempted` latch is held against** (Requirement 5.7).
   */
  readonly path: string;
  /**
   * Where a successful redemption goes. Called at most once per successful
   * redemption, always with `replace: true` (Requirement 5.8).
   */
  readonly navigate: InviteRedemptionNavigate;
  /**
   * The Auth_State, as the Auth_Feature's `useAuth().state` reports it. It
   * decides which call the machine owes: `unauthenticated` owes one
   * `PreviewInvite` (Requirement 5.2), `authenticated` owes one `RedeemInvite`
   * (Requirement 5.7) and forbids the preview outright (Requirement 5.2).
   *
   * Defaults to `unauthenticated` — the state a person arriving from an invite
   * link is usually in, and the one that issues no authenticated call.
   */
  readonly authState?: AuthState;
  /**
   * The path of the Squads_Home, used as the destination of a successful
   * redemption that yields no squad identity. Defaults to the App_Shell's own
   * `HOME_ROUTE`, which is where `appRouter.tsx` mounts the Squads_Home, so the
   * fallback destination is not a second spelling of that path.
   */
  readonly squadsHomePath?: string;
}

/** What the Invite_Landing_Route reads and activates. */
export interface InviteRedemptionMachine extends InviteRedemptionState {
  /**
   * Whether a call of either kind awaits a response — the programmatically
   * determinable busy state of Requirement 5.12.
   */
  readonly busy: boolean;
  /**
   * Whether the handover surface is displayed: the instruction, and the sign-up
   * and log-in controls the screen builds from the Auth_Feature's exports
   * (Requirements 5.2, 5.4, 5.6, 5.14).
   *
   * False while `redeeming`, which renders neither of them (Requirement 5.12),
   * and false on every settled redemption phase.
   */
  readonly handover: boolean;
  /** Whether a `RedeemInvite` call awaits a response (Requirement 5.12). */
  readonly redeeming: boolean;
  /** Whether the incomplete-link message is displayed (Requirement 5.9). */
  readonly incompleteLink: boolean;
  /** Whether the single unusable-invite message is displayed (Req 5.10). */
  readonly unusable: boolean;
  /** Whether the Generic_Squads_Failure is displayed (Requirement 5.13). */
  readonly failed: boolean;
  /**
   * Issue exactly one further `RedeemInvite` call for the same Invite_Secret.
   *
   * This is the retry control's only behaviour (Requirement 5.13). It is the one
   * thing that issues a redemption past the `redeemAttempted` latch, and
   * legitimately so: Requirement 5.7 forbids a further call *in consequence of a
   * re-render or an Auth_State transition*, and a person activating a control is
   * neither. Nothing re-issues itself (Requirement 17.4).
   *
   * A no-op unless the phase is `failed` — there is nothing to retry from
   * `unusable`, which is a settled answer about the invite rather than a failure
   * — and a no-op while the Auth_State is not `authenticated`.
   */
  retry(): void;
}

/**
 * Run the Invite_Landing_Route machine.
 *
 * Mounting extracts the Invite_Secret from `path`; an extraction failure settles
 * on `incompleteLink` and issues nothing (Requirement 5.9). Otherwise, while the
 * Auth_State is `unauthenticated` exactly one `PreviewInvite` is issued and the
 * handover surface follows however that call settles (Requirements 5.2, 5.6);
 * while it is `authenticated`, at most one `RedeemInvite` is issued for the
 * rendered path (Requirement 5.7) and a success navigates replacing the history
 * entry (Requirement 5.8). A transition to `unauthenticated` aborts, navigates
 * nowhere, and returns to the handover surface (Requirement 5.14).
 *
 * Requirements: 4.10, 5.2, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14,
 * 17.2, 17.4, 17.5
 */
export function useInviteRedemption(
  options: InviteRedemptionOptions,
): InviteRedemptionMachine {
  const {
    api,
    path,
    navigate,
    authState = 'unauthenticated',
    squadsHomePath = HOME_ROUTE,
  } = options;

  const [state, rawDispatch] = useReducer(
    reduceInviteRedemption,
    path,
    initialInviteRedemptionState,
  );

  // The state as of the last *dispatch* rather than the last render, so the
  // single-flight decision and the retry guard are made against current values.
  // The reducer is pure, so folding it twice costs nothing, and this avoids a
  // second source of truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: InviteRedemptionAction): void => {
    stateRef.current = reduceInviteRedemption(stateRef.current, action);
    rawDispatch(action);
  }, []);

  /**
   * The Invite_Secret for the rendered path, or `null` when the path carries
   * none (Requirements 5.9, 5.11).
   *
   * A local value derived by a pure function — deliberately **not** state and
   * **not** a message parameter. It reaches exactly one place: the
   * `RedeemInvite` request body (Requirement 4.10).
   */
  const secret = useMemo(() => {
    const extraction = extractInviteSecretFromPath(path);
    return extraction.ok ? extraction.secret : null;
  }, [path]);

  // The injected seams, held by reference and synchronised in effects rather
  // than during render, so re-creating any of them on a render issues no call
  // and re-runs no effect. Declared before the effects that read them.
  const apiRef = useRef(api);
  const navigateRef = useRef(navigate);
  const authStateRef = useRef(authState);
  const squadsHomePathRef = useRef(squadsHomePath);
  useEffect(() => {
    apiRef.current = api;
    navigateRef.current = navigate;
    squadsHomePathRef.current = squadsHomePath;
  }, [api, navigate, squadsHomePath]);

  /** The call awaiting a response, so it can be aborted (Req 5.14, 17.5). */
  const controllerRef = useRef<AbortController | null>(null);
  /**
   * The token of the most recently issued call. Abandoning bumps it, which makes
   * every outstanding response unacceptable — so a response arriving after a
   * loss of session, after a path change, or after this screen was left can
   * never be accepted, whatever the latches say by then.
   */
  const callTokenRef = useRef(0);
  /**
   * Closed by the unmount cleanup only. Unlike its siblings, this machine does
   * **not** latch on a loss of session: Requirement 5.14 asks it to keep
   * rendering the handover surface rather than to fall inert.
   */
  const unmountedRef = useRef(false);
  /**
   * The path whose `PreviewInvite` call has been issued, or `null` for none.
   *
   * Keyed on the path for the same reason the redemption latch is: a re-render
   * and an Auth_State transition leave it alone, and only a different invite
   * opens it (Requirement 5.2).
   */
  const previewedPathRef = useRef<string | null>(null);
  /**
   * **The `redeemAttempted` latch** (Requirement 5.7): the path a `RedeemInvite`
   * has been attempted for, or `null` for none.
   *
   * Holding the *path* rather than a boolean is what makes the guarantee the
   * requirement asks for. "At most one per rendered path" survives:
   *
   * - **re-renders** — the key does not change, so the effect's guard fails;
   * - **authentication arriving later** — whichever effect run finds the
   *   Auth_State `authenticated` sets the key, and no later run gets past it;
   * - **repeated Auth_State transitions** — the key stays set through
   *   `authenticated → unauthenticated → authenticated`, so the second
   *   authentication issues nothing;
   * - **a remount** — the cleanup clears it, because a remount is a fresh
   *   arrival at the route and owes its own single attempt.
   *
   * Only a different rendered path opens it, and that is a different invite.
   * {@link InviteRedemptionMachine.retry} bypasses it deliberately, being an
   * activation by a person rather than a re-render or a transition.
   */
  const redeemAttemptedPathRef = useRef<string | null>(null);
  /** The path last observed, so a path *change* under one mount is visible. */
  const renderedPathRef = useRef<string | null>(null);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon the call awaiting a response: abort it, and make its outcome — and
   * that of any earlier call — unacceptable.
   *
   * Deliberately says nothing about what is rendered. Its three callers each
   * decide that for themselves: a loss of session returns to the handover
   * surface (Requirement 5.14), a path change restarts, and the unmount cleanup
   * renders nothing at all. Idempotent, so several triggers in one tick do the
   * work once.
   */
  const abandonInFlight = useCallback((): void => {
    callTokenRef.current += 1;

    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  /**
   * Issue the one anonymous `PreviewInvite` call (Requirement 5.2).
   *
   * The only issue site for this endpoint in the feature. Every non-success arm
   * lands on the same handover phase with no instruction, so a failed preview
   * keeps the sign-up and log-in controls rather than blocking the handover
   * (Requirement 5.6). It issues exactly one request — the Squads_Api never
   * retries, and neither does this (Requirement 17.4).
   */
  const issuePreview = useCallback((): void => {
    if (unmountedRef.current) {
      return;
    }

    const token = callTokenRef.current + 1;
    callTokenRef.current = token;

    const controller = new AbortController();
    controllerRef.current = controller;

    dispatch({ type: 'previewRequested' });

    /**
     * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
     * settles every outcome into a `CallResult`, so `null` is defence against a
     * seam that throws rather than an expected path.
     */
    const settle = (result: CallResult<InvitePreview> | null): void => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      // 17.5: a response for an unmounted machine, or for a superseded call,
      // changes nothing at all.
      if (unmountedRef.current || token !== callTokenRef.current) {
        return;
      }

      // 5.2: the instruction the parsed Invite_Preview carried. The preview's
      // `requiresAuthentication` field is deliberately not read: this surface is
      // reached because there is no session, not because the backend said so.
      if (result !== null && result.kind === 'success') {
        dispatch({
          type: 'previewAccepted',
          instruction: result.value.message,
        });
        return;
      }

      // 5.6: every other arm — including the lapsed Squad_Call_Timeout and a
      // body the parser rejected — is the handover surface with the screen's own
      // fixed instruction. Nothing of the backend's wording travels here.
      dispatch({ type: 'previewSettledWithoutInstruction' });
    };

    void apiRef.current.previewInvite(controller.signal).then(settle, () => {
      settle(null);
    });
  }, [dispatch]);

  /**
   * Issue one `RedeemInvite` call for the rendered path's Invite_Secret.
   *
   * The only issue site for this endpoint on this route. It is called from the
   * effect below, once per rendered path under the `redeemAttempted` latch
   * (Requirement 5.7), and from {@link InviteRedemptionMachine.retry}
   * (Requirement 5.13).
   *
   * Single-flight: a call while one already awaits a response is refused rather
   * than stacked behind it, so there is never a second concurrent redemption
   * (Requirement 5.12).
   */
  const issueRedeem = useCallback((): void => {
    if (unmountedRef.current || secret === null) {
      return;
    }

    // 5.12: no second concurrent call.
    if (stateRef.current.phase === 'redeeming') {
      return;
    }

    const token = callTokenRef.current + 1;
    callTokenRef.current = token;

    const controller = new AbortController();
    controllerRef.current = controller;

    dispatch({ type: 'redeemRequested' });

    // 4.2: the landing route presents no Player_Display_Name field, so the body
    // carries the secret alone and the field is omitted rather than sent empty.
    const command: RedeemInviteRequest = { presentedSecret: secret };

    /** Apply a settled outcome, or `null` for a rejected promise. */
    const settle = (result: CallResult<Redemption> | null): void => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      // 5.14, 17.5: a response for an abandoned call — a loss of session, a path
      // change, an unmount — changes nothing and navigates nowhere.
      if (unmountedRef.current || token !== callTokenRef.current) {
        return;
      }

      if (result === null) {
        dispatch({ type: 'redeemFailed' });
        return;
      }

      if (result.kind === 'success') {
        // 5.8: the current path carries the Invite_Secret, so the history entry
        // is **replaced** rather than added — activating the browser back
        // control must not return to it.
        //
        // The identity-bearing branch is implemented although the backend does
        // not populate `squadId` today (`RedeemInviteResult` carries only the
        // membership and the outcome, and the already-a-member no-op carries
        // nothing at all), because the parser accepts the field the backend may
        // later add. The Squads_Home fallback is therefore the *normal* path
        // rather than an edge case; that screen issues its own single
        // `ListMySquads` on mount, so nothing further is issued from here.
        const squadId = result.value.squadId;
        navigateRef.current(
          squadId === null ? squadsHomePathRef.current : squadPath(squadId),
          { replace: true },
        );

        dispatch({ type: 'redeemed' });
        return;
      }

      // 5.10: matches no invite, revoked, or expired — one phase for all three.
      // The backend answers all three with `410 InviteUnusable`, classified as a
      // rejection with the `invite-unusable` reason; `not-found` is folded in
      // beside it because `403`/`404` is the same non-disclosing answer about the
      // same invite. Nothing distinguishes the three from here.
      if (
        result.kind === 'not-found' ||
        (result.kind === 'rejected-input' && result.reason === 'invite-unusable')
      ) {
        dispatch({ type: 'redeemUnusable' });
        return;
      }

      // 5.13, 17.2: everything else — a transport failure, the lapsed
      // Squad_Call_Timeout, a body the parser rejected, an ended session, any
      // other rejection reason — is the one generic failure, carrying nothing of
      // the backend's own wording, with a retry control and a control to the
      // Squads_Home.
      dispatch({ type: 'redeemFailed' });
    };

    void apiRef.current.redeemInvite(command, controller.signal).then(settle, () => {
      settle(null);
    });
  }, [dispatch, secret]);

  /**
   * The mount, path, and Auth_State effect — where both latches are read.
   *
   * Its dependencies do not change on a re-render, so no re-render issues a
   * call. Three things can bring it back: a path change (a different invite,
   * which restarts), an Auth_State change (which may owe the one redemption),
   * and a remount (a fresh arrival).
   */
  useEffect(() => {
    // A different Invite_Landing_Route path under the same mount — `react-router`
    // keeps this component mounted when only the `code` segment changes. That is
    // a different invite, so the previous one's call is abandoned, both
    // path-keyed latches are opened, and the machine starts again from the new
    // path's extraction. The previous Auth_State is forgotten too: a restart owes
    // its calls afresh rather than inheriting a transition from the invite before.
    const previousPath = renderedPathRef.current;
    if (previousPath !== null && previousPath !== path) {
      abandonInFlight();
      previewedPathRef.current = null;
      redeemAttemptedPathRef.current = null;
      previousAuthStateRef.current = null;
      dispatch({ type: 'restarted', state: initialInviteRedemptionState(path) });
    }
    renderedPathRef.current = path;

    const previousAuthState = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;
    authStateRef.current = authState;

    // 5.9: an unreadable path issues no `PreviewInvite` and no `RedeemInvite`.
    if (secret === null) {
      return;
    }

    if (authState === 'authenticated') {
      // 5.7: **the latch**. Whichever run first finds an authenticated session
      // attempts the redemption and records the path; no re-render, and no later
      // transition back to `authenticated`, gets past this.
      if (redeemAttemptedPathRef.current === path) {
        return;
      }

      redeemAttemptedPathRef.current = path;
      issueRedeem();
      return;
    }

    // 5.14: the session ended while this route is rendered. The call awaiting a
    // response is aborted and its outcome disregarded, **no navigation is
    // performed**, and the screen returns to the handover surface — this machine
    // does not fall inert the way its siblings do.
    if (previousAuthState === 'authenticated') {
      abandonInFlight();
      dispatch({ type: 'handedBack' });
      return;
    }

    // 5.2: exactly one `PreviewInvite` per rendered path, issued only while
    // there is no session. Two guards, and each earns its place: the latch stops
    // a re-render issuing a second, and the redemption key stops a session that
    // has *been* authenticated from ever issuing one — a preview belongs to the
    // signed-out handover, not to the aftermath of a redemption.
    if (
      previewedPathRef.current === path ||
      redeemAttemptedPathRef.current !== null
    ) {
      return;
    }

    previewedPathRef.current = path;
    issuePreview();
  }, [
    abandonInFlight,
    authState,
    dispatch,
    issuePreview,
    issueRedeem,
    path,
    secret,
  ]);

  // 17.5: leaving the route aborts the call awaiting a response and disregards
  // it. Both latches and the unmount flag are then reopened, because React's
  // strict-mode double invocation unmounts and remounts against these same refs
  // and a remount is a fresh arrival at the route owing exactly one call. The
  // bumped call token keeps the abandoned call's response unacceptable
  // regardless of what the flags say by the time it arrives.
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      abandonInFlight();

      unmountedRef.current = false;
      previewedPathRef.current = null;
      redeemAttemptedPathRef.current = null;
      renderedPathRef.current = null;
      previousAuthStateRef.current = null;
    };
  }, [abandonInFlight]);

  const retry = useCallback((): void => {
    // 5.13: retry belongs to the generic failure alone. `unusable` is a settled
    // answer about the invite rather than a failure, and retrying it would both
    // present a control that cannot help and re-present the secret for nothing.
    if (stateRef.current.phase !== 'failed') {
      return;
    }

    // A redemption requires a session; without one the surface is the handover,
    // which the Auth_State effect has already restored.
    if (authStateRef.current !== 'authenticated') {
      return;
    }

    issueRedeem();
  }, [issueRedeem]);

  return useMemo(
    () => ({
      phase: state.phase,
      instruction: state.instruction,
      busy: state.phase === 'previewing' || state.phase === 'redeeming',
      handover:
        state.phase === 'idle' ||
        state.phase === 'previewing' ||
        state.phase === 'handover',
      redeeming: state.phase === 'redeeming',
      incompleteLink: state.phase === 'incompleteLink',
      unusable: state.phase === 'unusable',
      failed: state.phase === 'failed',
      retry,
    }),
    [retry, state.instruction, state.phase],
  );
}
