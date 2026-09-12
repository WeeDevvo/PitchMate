/**
 * The Squad_Screen's load machine — one reducer-backed hook holding **two
 * independent slots** and issuing every `GetSquad` and `GetSquadLeaderboard`
 * call.
 *
 * The screen renders from this machine and calls nothing itself, which is what
 * makes "one pair of calls per mount" a structural fact rather than an
 * aspiration (Requirements 6.2, 7.1): there are exactly two issue sites below,
 * guarded by one latch.
 *
 * ### Two slots, two concurrent calls
 *
 * `GetSquad` and `GetSquadLeaderboard` are issued **in the same tick**, not one
 * after the other (Requirement 7.13). Each settles its own slot, so neither
 * waits on the other:
 *
 * | slot | phases |
 * | --- | --- |
 * | `detail` | `loading → loaded \| notFound \| failed`, plus `refreshing` while a held Squad_Detail is re-read |
 * | `leaderboard` | `loading → loaded \| unavailable` |
 *
 * The asymmetry between the two slots is the point. `detail` has a failure
 * phase because a Squad_Detail is the screen; `leaderboard` has none, because
 * **every** non-success arm collapses to `unavailable` and a leaderboard that
 * never arrives costs the rows their rating and nothing else (Requirement 7.10).
 * A Player_List therefore renders as soon as the Squad_Detail lands, with
 * Rating_Unavailable on every row until — and, where the leaderboard is
 * unavailable, after — the second call settles (Requirement 7.13).
 *
 * ### Seven behaviours worth stating
 *
 * 1. **`GetSquad` governs membership.** The Player_List is composed from
 *    `detail.members` alone, through the pure `composePlayerList` +
 *    `comparePlayerRows` in `lib/playerList.ts`; nothing here re-derives a row
 *    or an order. A leaderboard that loads while the detail did not contributes
 *    **nothing**, and its value is dropped rather than held (Requirement 7.11) —
 *    so no player identity can ever be rendered from the leaderboard alone.
 * 2. **A malformed `squadId` issues no call at all** — not the detail call and
 *    not the leaderboard call (Requirement 6.6). The check is
 *    `isSquadIdentifier` from `lib/identifiers.ts`, and the machine
 *    short-circuits straight to `detail = notFound`, so an unparseable identity
 *    and an inaccessible squad are indistinguishable on screen.
 * 3. **`notFound` and `failed` are different phases.** Only the api's
 *    `not-found` reaches `notFound`; every other non-success arm reaches
 *    `failed`, which the screen renders as the Generic_Squads_Failure plus a
 *    retry control and **never** as the Not_Found_Treatment (Requirement 6.7).
 * 4. **Nothing at all while unauthenticated** (Requirement 17.5). Mounting
 *    while the Auth_State is `unauthenticated` issues no call and holds no
 *    squad data. A later transition *to* `authenticated` within the same mount
 *    issues the pair the mount owed.
 * 5. **A `discarded` latch** (Requirement 17.5). Unmounting, or the Auth_State
 *    transitioning to `unauthenticated`, aborts both calls through the caller
 *    `AbortSignal` the Squads_Api accepts, discards both slots, and closes a
 *    latch so nothing is ever accepted afterwards. The latch is belt-and-braces:
 *    each slot's call also carries a token, and discarding bumps both, so a late
 *    response is unacceptable even where a remount has reopened the latch.
 * 6. **A held Squad_Detail survives a refresh, and does not survive a
 *    failure.** `refreshing` keeps the previously accepted detail rendered
 *    alongside a busy state; `loading` holds none, which is the state
 *    Requirement 6.9 renders with neither Player_List nor Admin_Section.
 * 7. **The caller's own membership is resolved, never assumed.** See
 *    {@link resolveCallerMembership}: the Squad_Detail's members first, the
 *    `ListMySquads` Squad_Summary as the fallback, and no Admin_Authority at all
 *    when neither identifies the caller (Requirement 6.10). The rule itself is
 *    `resolveAdminAuthority` in `lib/adminAuthority.ts` and is not re-derived
 *    here.
 *
 * ### `usePublishSquadScopeFromRoute` is the screen's job, not this hook's
 *
 * The App_Shell's Squad_Scope publisher is called **once by `SquadScreen`**, not
 * from here — the Squad_Route's parameter is named `squadId` precisely so it
 * matches the shell's `SQUAD_SCOPE_ROUTE_PARAMETER` and the publisher needs no
 * argument. Keeping it out of this hook keeps the machine free of routing and of
 * the shell, so it can be driven by folding actions over the reducer.
 *
 * ### No copy, no backend detail, no retry of its own
 *
 * No action and no state field carries a status code, a rejection reason, or a
 * response body value (Requirement 17.2); the screen reads `lib/messages.ts`.
 * `auth-failure` is deliberately not special-cased into a session handover — it
 * renders the same generic failure as any other arm, and it renders no squad
 * data. Nothing re-issues a call by itself (Requirement 17.4):
 * {@link SquadScreenMachine.retry} is a person activating a control, and
 * {@link SquadScreenMachine.refresh} is the post-mutation re-read the admin
 * machines trigger, which is likewise a consequence of an activation.
 *
 * The 10-second Squad_Call_Timeout, the abort chaining, and the
 * one-request-per-method discipline all belong to `api/squadsApi.ts`; none of it
 * is reimplemented here.
 *
 * Requirements: 6.2, 6.6, 6.7, 6.9, 6.10, 7.1, 7.10, 7.11, 7.13, 17.2, 17.4, 17.5
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import type { MemberRole, MembershipStateValue } from '../lib/enumCodes';
import { isSquadIdentifier } from '../lib/identifiers';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { SquadDetail } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { composePlayerList, type PlayerListRow } from '../lib/playerList';

// --- State ------------------------------------------------------------------

/**
 * How far the `GetSquad` load has got.
 *
 * - `idle` — nothing issued: before the mount call, and after the `discarded`
 *   latch closes.
 * - `loading` — a call awaits a response and **no** Squad_Detail is held, which
 *   is the state that renders neither Player_List nor Admin_Section
 *   (Requirement 6.9).
 * - `refreshing` — a call awaits a response and a previously accepted
 *   Squad_Detail **is** held, which keeps rendering. Entered by an explicit
 *   refresh and by the post-mutation re-reads the admin machines trigger.
 * - `notFound` — the call reported not-found, or the requested identity was not
 *   syntactically valid and no call was issued at all (Requirement 6.6). The
 *   screen renders the Not_Found_Treatment and nothing else.
 * - `failed` — the call did not yield a Squad_Detail for any other reason. Never
 *   the Not_Found_Treatment (Requirement 6.7).
 */
export type SquadDetailPhase =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'loaded'
  | 'notFound'
  | 'failed';

/**
 * How far the `GetSquadLeaderboard` load has got.
 *
 * There is no failure phase, and that is deliberate: a leaderboard is a
 * decoration over a Player_List whose membership comes from elsewhere, so every
 * non-success arm — not-found, auth-failure, rejected-input, timeout,
 * transport-failure, parse-failure — is the single `unavailable` phase, and a
 * leaderboard failure never fails the screen (Requirement 7.10).
 */
export type LeaderboardPhase = 'idle' | 'loading' | 'loaded' | 'unavailable';

/**
 * Everything the Squad_Screen renders from: the two slots, each with its phase
 * and its held value.
 *
 * A held value is `null` for "nothing held", which is the distinction the
 * requirements turn on — `loading` versus `refreshing` (Requirement 6.9), and a
 * leaderboard that decorates the rows versus one that does not (Requirement
 * 7.10).
 */
export interface SquadScreenState {
  /** How far the `GetSquad` load has got. */
  readonly detailPhase: SquadDetailPhase;
  /** The accepted Squad_Detail, or `null` when none is held. */
  readonly detail: SquadDetail | null;
  /** How far the `GetSquadLeaderboard` load has got. */
  readonly leaderboardPhase: LeaderboardPhase;
  /** The accepted Display_Rating_Leaderboard, or `null` when none is held. */
  readonly leaderboard: DisplayRatingLeaderboard | null;
}

/** The initial state: nothing issued, nothing held, in either slot. */
export function initialSquadScreenState(): SquadScreenState {
  return {
    detailPhase: 'idle',
    detail: null,
    leaderboardPhase: 'idle',
    leaderboard: null,
  };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine, each dispatched from exactly one place.
 *
 * No action carries a status code, a rejection reason, or a response body value
 * beyond the parsed value itself: `detailFailed` and `leaderboardUnavailable`
 * carry nothing at all, so there is nothing of the backend's wording to leak
 * into the interface (Requirement 17.2).
 */
export type SquadScreenAction
  /** The requested identity is not syntactically valid (Requirement 6.6). */
  = | { readonly type: 'unidentifiable' }
  | { readonly type: 'detailRequested' }
  | { readonly type: 'detailAccepted'; readonly detail: SquadDetail }
  | { readonly type: 'detailNotFound' }
  | { readonly type: 'detailFailed' }
  | { readonly type: 'leaderboardRequested' }
  | {
      readonly type: 'leaderboardAccepted';
      readonly leaderboard: DisplayRatingLeaderboard;
    }
  | { readonly type: 'leaderboardUnavailable' }
  | { readonly type: 'discarded' };

/**
 * The state a settled non-detail leaves the leaderboard slot in.
 *
 * A Squad_Detail that did not arrive takes any held leaderboard down with it
 * (Requirement 7.11): with no membership to decorate, an entry could only
 * contribute a player identity the Squad_Detail never confirmed, so the value is
 * dropped rather than parked. The slot reads `unavailable` rather than `idle`
 * because that is what a retry needs to see to know it owes a second
 * leaderboard call.
 */
const DROPPED_LEADERBOARD = {
  leaderboardPhase: 'unavailable',
  leaderboard: null,
} as const satisfies Pick<SquadScreenState, 'leaderboardPhase' | 'leaderboard'>;

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole machine can be exercised by folding actions over it.
 *
 * The two slots are independent in both directions but for one asymmetry: a
 * detail that fails or is not found drops the leaderboard (Requirement 7.11),
 * while a leaderboard that is unavailable leaves the detail entirely alone
 * (Requirement 7.10). A leaderboard accepted *before* the detail settles is
 * kept, because that is the ordinary outcome of two concurrent calls and says
 * nothing yet about whether the detail will arrive.
 */
export function reduceSquadScreen(
  state: SquadScreenState,
  action: SquadScreenAction,
): SquadScreenState {
  switch (action.type) {
    // 6.6: no call was issued for either slot, so the leaderboard is not merely
    // dropped — it was never requested. Presented identically to a not-found.
    case 'unidentifiable':
      return {
        detailPhase: 'notFound',
        detail: null,
        ...DROPPED_LEADERBOARD,
      };

    // 6.9: which busy phase a call enters is decided by whether a Squad_Detail
    // is held, not by which control issued it — so the retry control and the
    // admin machines' re-read need no phase knowledge of their own.
    case 'detailRequested':
      return {
        ...state,
        detailPhase: state.detail === null ? 'loading' : 'refreshing',
      };

    // 6.3, 7.2: exactly the parsed Squad_Detail, which is the authority on the
    // Player_List's membership.
    case 'detailAccepted':
      return { ...state, detailPhase: 'loaded', detail: action.detail };

    // 6.4: the Not_Found_Treatment renders no Squad_Name, no Player_List, and no
    // Admin_Section, so the held detail goes with it.
    case 'detailNotFound':
      return { detailPhase: 'notFound', detail: null, ...DROPPED_LEADERBOARD };

    // 6.7: the failure surface renders no partially populated Squad_Detail, so
    // the held detail goes with the failure rather than lingering behind it. A
    // retry from here therefore enters `loading`.
    case 'detailFailed':
      return { detailPhase: 'failed', detail: null, ...DROPPED_LEADERBOARD };

    // 7.10: the leaderboard has no `refreshing` phase, because a re-read is only
    // ever issued when nothing is held.
    case 'leaderboardRequested':
      return { ...state, leaderboardPhase: 'loading' };

    case 'leaderboardAccepted':
      return {
        ...state,
        leaderboardPhase: 'loaded',
        leaderboard: action.leaderboard,
      };

    // 7.10: every non-success arm, folded into one phase. The Player_List still
    // renders; every row shows Rating_Unavailable.
    case 'leaderboardUnavailable':
      return { ...state, ...DROPPED_LEADERBOARD };

    // 17.5: an ended session or a departed screen displays no squad data.
    case 'discarded':
      return initialSquadScreenState();

    default:
      return state;
  }
}

// --- The caller's own membership --------------------------------------------

/** The caller's Member_Role and Membership_State within the squad, or absence. */
export interface CallerMembership {
  /** The caller's Member_Role, or `null` when it was not identified. */
  readonly role: MemberRole | null;
  /** The caller's Membership_State, or `null` when it was not identified. */
  readonly state: MembershipStateValue | null;
}

/** Neither result identified the caller's membership (Requirement 6.10). */
const UNIDENTIFIED_CALLER: CallerMembership = { role: null, state: null };

/**
 * Resolve the caller's Member_Role and Membership_State from the parsed values
 * available, in the order Requirement 6.10 fixes.
 *
 * 1. **The Squad_Detail's members**, matched on the caller's membership
 *    identity. This is the freshest and most specific statement of the caller's
 *    standing *in this squad*, and it is the only one that can have been
 *    affected by an admin action taken on this screen.
 * 2. **The `ListMySquads` Squad_Summary** for the same squad, when the detail's
 *    members do not identify the caller — which is the ordinary case, since the
 *    caller need not be handed their own membership identity to open a squad.
 *    The summary's own `role` and `state` are already nullable at the wire
 *    (Requirement 16.8), so a summary that names neither resolves to absence
 *    rather than to a default.
 * 3. **Absence**, when neither identifies the caller — which
 *    `resolveAdminAuthority` answers `false` for without a branch of its own.
 *
 * Identities are compared **exactly**: an identity is opaque to this feature, so
 * it is neither trimmed nor case-folded. The summary is consulted only when it
 * names the same squad as the held detail, so a summary for a different squad
 * can never lend the caller a role here.
 *
 * Pure, total, and free of exceptions, so the whole of Requirement 6.10 is
 * testable without rendering anything.
 *
 * @param detail the parsed Squad_Detail, or `null` when none is held
 * @param callerMembershipId the caller's membership identity within this squad,
 *   where it is known — `null` or `undefined` when it is not
 * @param callerSummary the caller's `ListMySquads` Squad_Summary for this squad,
 *   where one is held — `null` or `undefined` when none is
 *
 * Requirements: 6.10
 */
export function resolveCallerMembership(
  detail: SquadDetail | null,
  callerMembershipId: string | null | undefined,
  callerSummary: SquadSummary | null | undefined,
): CallerMembership {
  const identified =
    callerMembershipId !== null && callerMembershipId !== undefined;

  if (detail !== null && identified) {
    const member = detail.members.find(
      (candidate) => candidate.membershipId === callerMembershipId,
    );

    if (member !== undefined) {
      return { role: member.role, state: member.state };
    }
  }

  // 6.10: the fallback. Guarded on the squad identity so a summary for another
  // squad contributes nothing, which keeps the resolution squad-scoped.
  if (
    callerSummary !== null &&
    callerSummary !== undefined &&
    (detail === null || callerSummary.squadId === detail.squadId)
  ) {
    return { role: callerSummary.role, state: callerSummary.state };
  }

  return UNIDENTIFIED_CALLER;
}

// --- Hook surface -----------------------------------------------------------

/** Options for {@link useSquadScreen}. Every seam is injected. */
export interface SquadScreenOptions {
  /**
   * The Squads_Api facade — the feature's only transport seam. Its identity is
   * read through a ref, so re-creating it on a render issues no further call.
   */
  readonly api: SquadsApi;
  /**
   * The requested squad identity, exactly as the route carried it and
   * **unasserted**: `undefined` when the path segment is absent, and any string
   * when it is present. A value `isSquadIdentifier` rejects issues no call at
   * all and short-circuits to `notFound` (Requirement 6.6).
   *
   * Read through a ref at issue time, so no re-render — including one carrying a
   * different identity — issues a call of its own (Requirement 6.2). A different
   * squad is a different mount.
   */
  readonly squadId: string | undefined;
  /**
   * The caller's own membership identity within this squad, where the caller
   * knows it. Used to find the caller in `SquadDetail.members`
   * (Requirement 6.10).
   *
   * Taken as an option rather than fetched: this machine issues the two squad
   * reads and nothing else, so whoever already holds the caller's identity
   * supplies it.
   */
  readonly callerMembershipId?: string | null;
  /**
   * The caller's `ListMySquads` Squad_Summary for this squad, where one is held
   * — the fallback when the detail's members do not identify the caller
   * (Requirement 6.10). Likewise an option rather than a call of its own.
   */
  readonly callerSummary?: SquadSummary | null;
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

/**
 * What a re-read may be asked for beyond its `GetSquad` call.
 *
 * The one option exists because the two post-mutation re-reads differ in exactly
 * this: a created guest may appear on the leaderboard, so Requirement 12.6 asks
 * for one further `GetSquadLeaderboard` alongside the `GetSquad` **whether or not
 * a leaderboard is already held**, while an edited guest changes no membership
 * and Requirement 12.10 asks for the `GetSquad` alone.
 *
 * Expressed here rather than by a second issue site in the calling machine: this
 * hook is the feature's only place either squad read is issued, and widening the
 * seam keeps that true.
 */
export interface SquadRefreshOptions {
  /**
   * Force one further `GetSquadLeaderboard` call even where a leaderboard is
   * held (Requirement 12.6).
   *
   * Omitted or `false` keeps the default conditional behaviour — a leaderboard
   * call only where none is held. Either way the call is still a no-op while a
   * `GetSquadLeaderboard` call awaits a response, so a forced re-read is
   * *exactly one* further call and never a second concurrent one.
   */
  readonly includeLeaderboard?: boolean;
}

/** What the Squad_Screen reads and activates. */
export interface SquadScreenMachine extends SquadScreenState {
  /**
   * Whether a `GetSquad` call awaits a response — the programmatically
   * determinable busy state of Requirement 6.9, true in both the nothing-held
   * and the detail-held case.
   */
  readonly busy: boolean;
  /**
   * Whether the Not_Found_Treatment is displayed — for a not-found result and
   * for an unparseable identity alike, which is what makes the two
   * indistinguishable (Requirements 6.4, 6.6).
   */
  readonly notFound: boolean;
  /**
   * Whether the Generic_Squads_Failure and its retry control are displayed. Never
   * true at the same time as {@link SquadScreenMachine.notFound}
   * (Requirement 6.7).
   */
  readonly failed: boolean;
  /**
   * The Player_List in the Player_Order, composed by `composePlayerList` from
   * the held Squad_Detail and — only where one is held — the leaderboard.
   *
   * Empty whenever no Squad_Detail is held, so a leaderboard that loaded while
   * the detail did not renders no Player_Row at all (Requirement 7.11). Every
   * row carries `leaderboardObtained: false` while the leaderboard is still
   * loading or is unavailable, which is what the Rating_Unavailable presentation
   * reads (Requirements 7.10, 7.13).
   */
  readonly players: readonly PlayerListRow[];
  /** The caller's own Member_Role and Membership_State (Requirement 6.10). */
  readonly caller: CallerMembership;
  /**
   * Whether the caller holds Admin_Authority, decided by `resolveAdminAuthority`
   * over {@link SquadScreenMachine.caller} — the rule is not re-derived here.
   *
   * Additionally `false` whenever no Squad_Detail is held, because there is no
   * squad on screen to administer: a loading, not-found, or failed detail
   * renders no Admin_Section (Requirements 6.4, 6.9).
   */
  readonly adminAuthority: boolean;
  /**
   * Issue exactly one further `GetSquad` call, and one further
   * `GetSquadLeaderboard` call only where no leaderboard is held.
   *
   * This is the retry control's only behaviour (Requirement 6.7); nothing
   * re-issues itself (Requirement 17.4). The conditional second call is what
   * stops a recovered screen from being stuck on Rating_Unavailable after a
   * failure dropped the leaderboard (Requirement 7.11), while a leaderboard
   * already held is left alone rather than re-read for no reason.
   *
   * A no-op while a `GetSquad` call awaits a response, a no-op once the
   * `discarded` latch has closed, and a no-op for an unparseable identity.
   */
  retry(): void;
  /**
   * Re-read the squad after a successful admin mutation — the entry point the
   * Invite_Manager, Guest_Manager, Promotion, and Feature_Toggle machines call
   * so a promotion, a guest edit, or a feature toggle is reflected without a
   * navigation (Requirement 6.2's "explicit refresh").
   *
   * Issues one further `GetSquad` always. By default the leaderboard is re-read
   * only where none is held, exactly as {@link SquadScreenMachine.retry} does —
   * which is what Requirement 12.10 asks of a successful `EditGuest`, whose
   * change touches no membership. Passing `includeLeaderboard: true` additionally
   * issues exactly one further `GetSquadLeaderboard` whether or not one is held,
   * which is what Requirement 12.6 asks of a successful `CreateGuest`, whose new
   * guest may appear on the leaderboard.
   *
   * Named separately from `retry` because the two call sites mean different
   * things: one is a person retrying a failure, the other is a mutation's
   * re-read. A held Squad_Detail keeps rendering throughout, under the
   * `refreshing` phase.
   */
  refresh(options?: SquadRefreshOptions): void;
}

/**
 * Run the Squad_Screen load machine.
 *
 * Mounting while `authenticated` with a well-formed identity issues exactly one
 * `GetSquad` and one `GetSquadLeaderboard` call, concurrently, and no re-render
 * issues another (Requirements 6.2, 7.1, 7.13). Mounting with an identity
 * `isSquadIdentifier` rejects issues neither call (Requirement 6.6). Mounting
 * while `unauthenticated` issues neither either. Unmounting, or the Auth_State
 * transitioning to `unauthenticated`, aborts both calls and disregards their
 * outcomes (Requirement 17.5).
 *
 * `usePublishSquadScopeFromRoute()` is **not** called here — the Squad_Screen
 * calls it once itself; see the module note.
 *
 * Requirements: 6.2, 6.6, 6.7, 6.9, 6.10, 7.1, 7.10, 7.11, 7.13, 17.2, 17.4, 17.5
 */
export function useSquadScreen(options: SquadScreenOptions): SquadScreenMachine {
  const {
    api,
    squadId,
    callerMembershipId = null,
    callerSummary = null,
    authState = 'authenticated',
  } = options;

  const [state, rawDispatch] = useReducer(
    reduceSquadScreen,
    undefined,
    initialSquadScreenState,
  );

  // The state as of the last *dispatch* rather than the last render, so each
  // slot's single-flight decision and busy-phase choice are made against current
  // values. The reducer is pure, so folding it twice costs nothing, and this
  // avoids a second source of truth that is always a render behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: SquadScreenAction): void => {
    stateRef.current = reduceSquadScreen(stateRef.current, action);
    rawDispatch(action);
  }, []);

  // The injected facade and the requested identity, held by reference and
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

  /** The two calls awaiting a response, so the latch can abort both (17.5). */
  const detailControllerRef = useRef<AbortController | null>(null);
  const leaderboardControllerRef = useRef<AbortController | null>(null);
  /**
   * The token of each slot's most recently issued call. Discarding bumps both,
   * which makes every outstanding response unacceptable independently of the
   * latch below — so a response arriving after this screen was left can never be
   * accepted, even though a remount reopens the latch.
   */
  const detailTokenRef = useRef(0);
  const leaderboardTokenRef = useRef(0);
  /** Closed by unmount and by an ended session (Requirement 17.5). */
  const discardedRef = useRef(false);
  /** Whether this mount has already issued its pair (Requirements 6.2, 7.1). */
  const startedRef = useRef(false);
  /** The Auth_State as last observed, so a *transition* can be recognised. */
  const previousAuthStateRef = useRef<AuthState | null>(null);

  /**
   * Abandon everything: abort both calls awaiting a response, make every
   * outstanding response unacceptable, and display no squad data.
   *
   * Used by the unmount cleanup and by the transition to `unauthenticated`
   * (Requirement 17.5). Idempotent, so several triggers in one tick do the work
   * once.
   */
  const discard = useCallback((): void => {
    discardedRef.current = true;
    detailTokenRef.current += 1;
    leaderboardTokenRef.current += 1;

    detailControllerRef.current?.abort();
    detailControllerRef.current = null;
    leaderboardControllerRef.current?.abort();
    leaderboardControllerRef.current = null;

    dispatch({ type: 'discarded' });
  }, [dispatch]);

  /**
   * Issue one `GetSquad` call.
   *
   * The only issue site in the feature for this endpoint. It is called from the
   * mount effect and from {@link SquadScreenMachine.retry} /
   * {@link SquadScreenMachine.refresh}, and it issues exactly one request per
   * call — the Squads_Api never retries, and neither does this
   * (Requirement 17.4).
   */
  const issueDetailCall = useCallback((): void => {
    if (discardedRef.current) {
      return;
    }

    // 6.6: no call is issued for an unparseable identity, from any entry point.
    const identity = squadIdRef.current;
    if (!isSquadIdentifier(identity)) {
      return;
    }

    // One activation, one call. A further activation while a call awaits a
    // response changes nothing rather than stacking a second call behind it.
    const { detailPhase } = stateRef.current;
    if (detailPhase === 'loading' || detailPhase === 'refreshing') {
      return;
    }

    const token = detailTokenRef.current + 1;
    detailTokenRef.current = token;

    const controller = new AbortController();
    detailControllerRef.current = controller;

    dispatch({ type: 'detailRequested' });

    /**
     * Apply a settled outcome, or `null` for a rejected promise. The Squads_Api
     * settles every outcome into a `CallResult`, so `null` is defence against a
     * seam that throws rather than an expected path.
     */
    const settle = (result: CallResult<SquadDetail> | null): void => {
      if (detailControllerRef.current === controller) {
        detailControllerRef.current = null;
      }

      // 17.5: a response for a discarded machine, or for a superseded call,
      // changes nothing at all — no detail, no failure, no message.
      if (discardedRef.current || token !== detailTokenRef.current) {
        return;
      }

      if (result !== null && result.kind === 'success') {
        dispatch({ type: 'detailAccepted', detail: result.value });
        return;
      }

      // 6.4, 6.7: not-found is its own phase and everything else is the generic
      // failure, so a failure can never render the Not_Found_Treatment.
      const notFound = result !== null && result.kind === 'not-found';
      dispatch({ type: notFound ? 'detailNotFound' : 'detailFailed' });
    };

    void apiRef.current.getSquad(identity, controller.signal).then(settle, () => {
      settle(null);
    });
  }, [dispatch]);

  /**
   * Issue one `GetSquadLeaderboard` call for the Display_Rating statistic — the
   * statistic itself is named once, in `api/squadsApi.ts` (Requirement 7.1).
   *
   * Every non-success arm settles the slot as `unavailable`, so this call can
   * never fail the screen (Requirement 7.10).
   */
  const issueLeaderboardCall = useCallback((): void => {
    if (discardedRef.current) {
      return;
    }

    // 6.6: neither call is issued for an unparseable identity.
    const identity = squadIdRef.current;
    if (!isSquadIdentifier(identity)) {
      return;
    }

    if (stateRef.current.leaderboardPhase === 'loading') {
      return;
    }

    const token = leaderboardTokenRef.current + 1;
    leaderboardTokenRef.current = token;

    const controller = new AbortController();
    leaderboardControllerRef.current = controller;

    dispatch({ type: 'leaderboardRequested' });

    const settle = (result: CallResult<DisplayRatingLeaderboard> | null): void => {
      if (leaderboardControllerRef.current === controller) {
        leaderboardControllerRef.current = null;
      }

      if (discardedRef.current || token !== leaderboardTokenRef.current) {
        return;
      }

      if (result !== null && result.kind === 'success') {
        dispatch({ type: 'leaderboardAccepted', leaderboard: result.value });
        return;
      }

      // 7.10, 17.2: every other arm is the same `unavailable`, carrying nothing
      // of the backend's own wording, and no Generic_Squads_Failure.
      dispatch({ type: 'leaderboardUnavailable' });
    };

    void apiRef.current
      .getDisplayRatingLeaderboard(identity, controller.signal)
      .then(settle, () => {
        settle(null);
      });
  }, [dispatch]);

  /**
   * Re-read the squad: one further `GetSquad`, plus one further
   * `GetSquadLeaderboard` where no leaderboard is held or where the caller asked
   * for one regardless (Requirement 12.6).
   *
   * Shared by {@link SquadScreenMachine.retry} and
   * {@link SquadScreenMachine.refresh} so the two cannot drift apart. Both are
   * consequences of an activation; nothing here re-issues itself
   * (Requirement 17.4).
   */
  const reload = useCallback(
    (options?: SquadRefreshOptions): void => {
      // Read before the detail call, which may itself drop a held leaderboard.
      const { leaderboard, leaderboardPhase } = stateRef.current;

      issueDetailCall();

      // 12.6: a forced re-read does not consult whether a leaderboard is held; a
      // call already awaiting a response still suppresses it, so either path
      // issues at most one further `GetSquadLeaderboard`.
      const wanted =
        options?.includeLeaderboard === true || leaderboard === null;

      if (wanted && leaderboardPhase !== 'loading') {
        issueLeaderboardCall();
      }
    },
    [issueDetailCall, issueLeaderboardCall],
  );

  /**
   * The mount and Auth_State effect.
   *
   * Its dependencies do not change on a re-render, so no re-render issues a call
   * (Requirement 6.2). A transition to `unauthenticated` discards; a mount while
   * `unauthenticated` simply waits, issuing nothing (Requirement 17.5).
   */
  useEffect(() => {
    const previous = previousAuthStateRef.current;
    previousAuthStateRef.current = authState;

    if (authState !== 'authenticated') {
      // 17.5: only a *transition* from an authenticated session is a loss of
      // session. Mounting while unauthenticated has nothing to abandon, and
      // latching there would deny the pair a later sign-in owes.
      if (previous === 'authenticated') {
        discard();
      }
      return;
    }

    // 6.2, 7.1: one pair per mount. The latch also covers the
    // authenticated-later case: whichever effect run issues the pair, no other
    // run issues a second.
    if (discardedRef.current || startedRef.current) {
      return;
    }

    startedRef.current = true;

    // 6.6: an unparseable identity issues no call at all — not the detail call
    // and not the leaderboard call — and renders the Not_Found_Treatment.
    if (!isSquadIdentifier(squadIdRef.current)) {
      dispatch({ type: 'unidentifiable' });
      return;
    }

    // 7.13: both issued in this tick, so neither waits on the other.
    issueDetailCall();
    issueLeaderboardCall();
  }, [authState, discard, dispatch, issueDetailCall, issueLeaderboardCall]);

  // 17.5: leaving the Squad_Screen aborts both calls awaiting a response and
  // disregards them. `startedRef` and the latch are reopened so a remount is a
  // fresh mount with exactly one pair; the bumped tokens keep the abandoned
  // calls' responses unacceptable regardless.
  useEffect(() => {
    return () => {
      discard();
      startedRef.current = false;
      discardedRef.current = false;
      previousAuthStateRef.current = null;
    };
  }, [discard]);

  const retry = useCallback((): void => {
    reload();
  }, [reload]);

  // 12.6, 12.10: the options are passed straight through, so which of the two
  // re-reads a mutation wants is the caller's statement and this remains the one
  // place either squad read is issued.
  const refresh = useCallback(
    (options?: SquadRefreshOptions): void => {
      reload(options);
    },
    [reload],
  );

  // 7.2, 7.3, 7.4, 7.11: the row set and its order come from `composePlayerList`
  // over the held Squad_Detail alone. No detail, no rows — whatever the
  // leaderboard slot holds.
  const players = useMemo(
    () =>
      state.detail === null
        ? []
        : composePlayerList(state.detail, state.leaderboard),
    [state.detail, state.leaderboard],
  );

  const caller = useMemo(
    () => resolveCallerMembership(state.detail, callerMembershipId, callerSummary),
    [callerMembershipId, callerSummary, state.detail],
  );

  return useMemo(
    () => ({
      detailPhase: state.detailPhase,
      detail: state.detail,
      leaderboardPhase: state.leaderboardPhase,
      // 7.11: a leaderboard is exposed only alongside the membership it
      // decorates. The reducer already drops it on a failed or not-found
      // detail; this is the same rule stated where it is read.
      leaderboard: state.detail === null ? null : state.leaderboard,
      busy:
        state.detailPhase === 'loading' || state.detailPhase === 'refreshing',
      notFound: state.detailPhase === 'notFound',
      failed: state.detailPhase === 'failed',
      players,
      caller,
      // 10.1: the rule itself lives in `lib/adminAuthority.ts`. The held-detail
      // guard is this machine's own: no squad on screen, no Admin_Section.
      adminAuthority:
        state.detail !== null && resolveAdminAuthority(caller.role, caller.state),
      retry,
      refresh,
    }),
    [
      caller,
      players,
      refresh,
      retry,
      state.detail,
      state.detailPhase,
      state.leaderboard,
      state.leaderboardPhase,
    ],
  );
}
