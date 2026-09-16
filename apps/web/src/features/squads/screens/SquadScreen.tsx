/**
 * The Squad_Screen — `/app/squads/:squadId`: what the squad is, who plays in it,
 * where matches and stats will live, and, for an admin, how to run it.
 *
 * Everything it renders was built before it, so this file composes and decides
 * rather than implements. What it owns is exactly the five things no component
 * below it can:
 *
 * 1. **Which surface the `detail` slot's phase calls for** — the loading
 *    indication, the `Not_Found_Treatment`, the `FailureNotice`, or the squad
 *    itself (Requirements 6.4, 6.7, 6.9).
 * 2. **The section order**, which Requirement 6.8 fixes as a document-order fact:
 *    squad detail, players, matches, stats, administration, each introduced by
 *    exactly one level-two heading.
 * 3. **The one level-one heading** — the parsed Squad_Name once a Squad_Detail is
 *    held (Requirement 6.3).
 * 4. **The Squad_Scope**, published once through the App_Shell's
 *    `usePublishSquadScopeFromRoute` so the shell's notification surfaces scope
 *    themselves to the open squad.
 * 5. **Navigation** — to a Player_Stats_Route, through `playerStatsPath`
 *    (Requirement 9.4).
 *
 * ### Why the caller's own standing needs a third call
 *
 * Requirement 6.3 asks for a text label naming **the caller's** Member_Role, and
 * Requirement 10.2 gates every admin surface on the caller's Admin_Authority. A
 * `GetSquad` body carries a squad's memberships but identifies none of them as the
 * caller's, so neither value can be read from it: Requirement 6.10 names the
 * `ListMySquads` summary as the other source, and that is what
 * {@link useSquadsHome} — the feature's one `ListMySquads` machine — is reused for
 * here. One call per mount, aborted and discarded on unmount and on a lost session
 * like every other, and no second issue site introduced for the endpoint.
 *
 * A listing that fails, or that names no membership for this squad, leaves the
 * caller unidentified — which `resolveCallerMembership` answers with a pair of
 * absences and `resolveAdminAuthority` answers with `false`, exactly as
 * Requirement 6.10 specifies. So a failed listing degrades the role label and the
 * admin section and touches nothing else; it is deliberately **not** the
 * `FailureNotice`, which belongs to the squad the screen is about.
 *
 * ### The two calls degrade independently
 *
 * `useSquadScreen` issues `GetSquad` and `GetSquadLeaderboard` concurrently and
 * settles them into two slots (Requirement 7.13). The Player_List therefore
 * renders as soon as the Squad_Detail lands, and every row shows
 * Rating_Unavailable until the leaderboard settles — and permanently, where it is
 * unavailable (Requirements 7.10, 8.13). Nothing here special-cases that: a
 * composed row carries `leaderboardObtained: false` while the machine holds no
 * leaderboard, and `RatingBadge` reads it.
 *
 * ### Which sections exist in which state
 *
 * | `detail` phase | rendered |
 * | --- | --- |
 * | `notFound` | the `Not_Found_Treatment` alone, which carries the route's `h1` (6.4, 6.5) |
 * | `loading` | the `h1` fallback, the detail region's busy state, and the two placeholders — **no** Player_List and **no** Admin_Section (6.9) |
 * | `failed` | the `h1` fallback, the `FailureNotice` with its retry, and the two placeholders — never the not-found treatment (6.7) |
 * | `loaded` / `refreshing` | the `h1` Squad_Name and all five sections, the fifth only while Admin_Authority holds (6.3, 10.2, 10.3) |
 *
 * The players section is rendered only where a Squad_Detail is held, because a
 * heading introducing a list that Requirement 6.9 forbids would announce a list
 * that is not there. The two Placeholder_Sections render in every state that is not
 * the not-found treatment: they hold no squad data, so nothing about them depends
 * on the call (Requirement 15.1), and neither can disclose anything about a squad
 * that could not be read.
 *
 * ### It issues nothing itself
 *
 * Every call in this subtree belongs to a machine: `GetSquad` and
 * `GetSquadLeaderboard` to `useSquadScreen`, `ListMySquads` to `useSquadsHome`,
 * `PromoteToAdmin` to `usePromotion`, and the four admin operations to the
 * machines the `AdminSection`'s children own. This file holds no `AbortController`,
 * no timer, and no `api` call site.
 *
 * Requirements: 6.1, 6.3, 6.4, 6.7, 6.8, 6.9, 6.10, 7.10, 7.13, 10.3, 15.1
 */
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SQUAD_SCOPE_ROUTE_PARAMETER, usePublishSquadScopeFromRoute } from '../../app-shell';
import { useAuth } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { AdminSection } from '../components/AdminSection';
import { FailureNotice } from '../components/FailureNotice';
import { LoadingIndication } from '../components/LoadingIndication';
import { NotFoundTreatment } from '../components/NotFoundTreatment';
import { PlaceholderSection } from '../components/PlaceholderSection';
import { PlayerList } from '../components/PlayerList';
import type { ViewerContext } from '../components/PlayerRow';
import type { MemberRole } from '../lib/enumCodes';
import {
  ADMIN_ROLE_LABEL,
  MATCHES_PLACEHOLDER_STATEMENT,
  MATCHES_SECTION_HEADING,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
  PLAYERS_SECTION_HEADING,
  SQUAD_DETAIL_SECTION_HEADING,
  SQUAD_LOADING_LABEL,
  SQUAD_SCREEN_HEADING,
  SQUADS_RETRY_LABEL,
  STATS_PLACEHOLDER_STATEMENT,
  STATS_SECTION_HEADING,
  YOUR_ROLE_LABEL,
} from '../lib/messages';
import { playerStatsPath } from '../lib/routePaths';
import { usePromotion } from '../state/usePromotion';
import { useSquadScreen } from '../state/useSquadScreen';
import { useSquadsHome } from '../state/useSquadsHome';

// The feature token table, so the screen resolves its own custom properties
// whether or not the App_Shell frame around it declared them. No colour value is
// written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './SquadScreen.css';

/**
 * The selector of the Squad_Screen wrapper, so a test can scope a query to the
 * screen without depending on the shell frame that usually surrounds it.
 */
export const SQUAD_SCREEN_SELECTOR = '[data-squads-squad-screen="true"]';

/**
 * The selector of the Squad_Detail region — the first of the five sections
 * (Requirement 6.8).
 */
export const SQUAD_DETAIL_SECTION_SELECTOR = '[data-squads-detail-section="true"]';

/** The selector of the Player_List region — the second section. */
export const PLAYERS_SECTION_SELECTOR = '[data-squads-players-section="true"]';

/**
 * The selector of the caller's Member_Role label, so a test can read the label
 * Requirement 6.3 asks for without depending on the surrounding wording.
 */
export const CALLER_ROLE_SELECTOR = '[data-squads-caller-role="true"]';

/** The label of each named Member_Role — a total lookup, so none is missable. */
const ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  owner: OWNER_ROLE_LABEL,
  admin: ADMIN_ROLE_LABEL,
  member: MEMBER_ROLE_LABEL,
};

/**
 * The caller's Member_Role in words, including its absence (Requirement 6.3).
 *
 * A membership the feature could not identify, and one whose read model carried
 * no role, are both stated in text rather than left as a blank space — the same
 * treatment the Squad_Card gives an absent role (Requirement 1.6).
 */
function roleLabelOf(role: MemberRole | null): string {
  return role === null ? NO_ROLE_RECORDED_LABEL : ROLE_LABELS[role];
}

export interface SquadScreenProps {
  /**
   * The Squads_Api facade — the feature's only transport seam, constructed by
   * `appRouter.tsx` from the Authenticated_Api_Client and handed in as a prop
   * (Requirement 16.2). This screen holds no client and builds none.
   */
  readonly api: SquadsApi;

  /**
   * The matches Placeholder_Section's body, threaded from
   * `createSquadsShellRoutes` so the later match-lifecycle feature fills the
   * section without this file changing (Requirement 15.3).
   */
  readonly matchesContent?: ReactNode;

  /** The stats Placeholder_Section's body. See {@link matchesContent}. */
  readonly statsContent?: ReactNode;
}

/**
 * Render the Squad_Screen.
 *
 * Requirements: 6.3, 6.4, 6.7, 6.8, 6.9, 6.10, 7.10, 7.13, 10.3, 15.1
 */
export function SquadScreen({
  api,
  matchesContent,
  statsContent,
}: SquadScreenProps): ReactElement {
  const { state: authState } = useAuth();
  const navigate = useNavigate();
  const idPrefix = useId();

  // The requested identity, **unasserted**: `useSquadScreen` decides whether it
  // is one, and a value that is not issues no call at all (Requirement 6.6). The
  // parameter name comes from the App_Shell rather than being spelled here, which
  // is what keeps the route's scope publishing below correct by construction.
  const squadId = useParams()[SQUAD_SCOPE_ROUTE_PARAMETER];

  // Called once, and needing no argument, because the route's parameter is named
  // `squadId` — so the shell's notification surfaces scope themselves to this
  // squad with no other wiring, and withdraw the scope when the screen leaves.
  usePublishSquadScopeFromRoute();

  // 6.10: the caller's own standing, from the one `ListMySquads` machine. See the
  // module note on why a third call is needed at all.
  const listing = useSquadsHome({ api, authState });
  const callerSummary = useMemo(
    () =>
      (listing.summaries ?? []).find((summary) => summary.squadId === squadId) ??
      null,
    [listing.summaries, squadId],
  );

  const machine = useSquadScreen({ api, squadId, callerSummary, authState });

  const detail = machine.detail;
  // The squad the mutations act on: the parsed identity rather than the requested
  // one, so no call can be built from a value a Response_Parser never accepted.
  const detailSquadId = detail?.squadId ?? '';

  const promotion = usePromotion({
    api,
    squadId: detailSquadId,
    refresh: machine.refresh,
    authState,
  });

  /**
   * The membership whose guest edit control was activated, and the control to
   * return focus to when the form closes (Requirement 19.7).
   *
   * Both are the screen's to hold because the affordance is a Player_Row control
   * while the form it opens belongs to the Guest_Manager (Requirement 12.7).
   */
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(
    null,
  );
  const editOpenerRef = useRef<HTMLElement | null>(null);

  const openPlayer = useCallback(
    (membershipId: string): void => {
      // 9.4: one client-side navigation, along the path the one pure function
      // builds. No `href` and no `location` assignment, so no full-document
      // reload is possible.
      navigate(playerStatsPath(detailSquadId, membershipId));
    },
    [detailSquadId, navigate],
  );

  const editGuest = useCallback((membershipId: string): void => {
    // The activated control is the focused element at the moment of activation,
    // for a pointer activation as much as for a keyboard one — so the opener is
    // captured rather than searched for by shape, and focus returns to the row
    // control the person actually used (Requirement 19.7).
    const active = document.activeElement;
    editOpenerRef.current = active instanceof HTMLElement ? active : null;

    setEditingMembershipId(membershipId);
  }, []);

  const finishEditing = useCallback((): void => {
    setEditingMembershipId(null);
  }, []);

  // 6.10: `membershipId` is `null` because no result the feature holds names the
  // caller's own membership within the squad — the summary carries a role and a
  // state, not an identity. `isPromotable` requires the `member` role, which the
  // caller cannot hold while Admin_Authority does, so the caller's own row still
  // carries no promotion affordance (Requirement 13.2).
  const viewer: ViewerContext = useMemo(
    () => ({ membershipId: null, isAdmin: machine.adminAuthority }),
    [machine.adminAuthority],
  );

  // 6.4, 6.5: the not-found treatment is the whole screen, and it carries the
  // route's single level-one heading — no squad name, no player list, no admin
  // section, and no statement of which cause applied.
  if (machine.notFound) {
    return (
      <div className="squad-screen" data-squads-squad-screen="true">
        <NotFoundTreatment />
      </div>
    );
  }

  // Each section is named by its own heading, so assistive technology announces
  // the region by the same words that are on screen.
  const detailHeadingId = `${idPrefix}-detail`;
  const playersHeadingId = `${idPrefix}-players`;

  /**
   * The Squad_Detail region's body: the busy state while nothing is held, the
   * generic failure while the call did not yield a Squad_Detail, and otherwise the
   * caller's own standing in the squad.
   *
   * Exactly one of the three, and never two: `machine.failed` and a held detail
   * are mutually exclusive by construction, since a failure drops what it held
   * (Requirement 6.7).
   */
  let detailBody: ReactNode;

  if (machine.failed) {
    detailBody = (
      <FailureNotice
        retryLabel={SQUADS_RETRY_LABEL}
        // 6.7, 17.4: one activation, one further `GetSquad` — and one further
        // leaderboard call, because the failure dropped the one it held.
        onRetry={machine.retry}
        retryBusy={machine.busy}
      />
    );
  } else if (detail === null) {
    // 6.9: a programmatically determinable busy state, with neither the
    // Player_List nor the Admin_Section beside it.
    detailBody = <LoadingIndication label={SQUAD_LOADING_LABEL} />;
  } else {
    detailBody = (
      <>
        {/* 6.3: the caller's Member_Role, in words. A label and a value, because
            no message of this feature takes an interpolation parameter. */}
        <p className="squad-screen__caller-role">
          <span className="squad-screen__caller-role-label">{YOUR_ROLE_LABEL}</span>
          <span
            className="squad-screen__caller-role-value"
            data-squads-caller-role="true"
          >
            {roleLabelOf(machine.caller.role)}
          </span>
        </p>
        {/* 6.9, 1.15: a re-read keeps the whole squad rendered and states that it
            is refreshing beside it, rather than replacing it with a busy state. */}
        {machine.busy ? <LoadingIndication label={SQUAD_LOADING_LABEL} /> : null}
      </>
    );
  }

  return (
    <div className="squad-screen" data-squads-squad-screen="true">
      {/* 6.3, 19.1: the screen's one level-one heading — the parsed Squad_Name
          once one is held, and a fixed noun while none is. */}
      <h1 className="squad-screen__heading">
        {detail === null ? SQUAD_SCREEN_HEADING : detail.name}
      </h1>

      {/* 6.8 §1: the Squad_Detail region. */}
      <section
        className="squad-screen__section"
        data-squads-detail-section="true"
        aria-labelledby={detailHeadingId}
      >
        <h2 className="squad-screen__section-heading" id={detailHeadingId}>
          {SQUAD_DETAIL_SECTION_HEADING}
        </h2>
        {detailBody}
      </section>

      {/* 6.8 §2: the Player_List — only where a Squad_Detail is held, because
          Requirement 6.9 renders no Player_List while none is. */}
      {detail !== null && (
        <section
          className="squad-screen__section"
          data-squads-players-section="true"
          aria-labelledby={playersHeadingId}
        >
          <h2 className="squad-screen__section-heading" id={playersHeadingId}>
            {PLAYERS_SECTION_HEADING}
          </h2>
          {/* 7.10, 7.13: every row renders its membership facts immediately, with
              Rating_Unavailable in the rating column until — or unless — the
              leaderboard settles. The rows carry that fact already. */}
          <PlayerList
            squadId={detail.squadId}
            rows={machine.players}
            viewer={viewer}
            onOpenPlayer={openPlayer}
            promotion={promotion}
            onEditGuest={editGuest}
          />
        </section>
      )}

      {/* 6.8 §3, 15.1: the matches Placeholder_Section, heading always, injected
          body in place of the statement where one is supplied. */}
      <PlaceholderSection
        heading={MATCHES_SECTION_HEADING}
        emptyStatement={MATCHES_PLACEHOLDER_STATEMENT}
        content={matchesContent}
      />

      {/* 6.8 §4, 15.1: the stats Placeholder_Section. */}
      <PlaceholderSection
        heading={STATS_SECTION_HEADING}
        emptyStatement={STATS_PLACEHOLDER_STATEMENT}
        content={statsContent}
      />

      {/* 6.8 §5, 10.2, 10.3: administration. Rendered only where a Squad_Detail is
          held, and within that only where `resolveAdminAuthority` holds — which
          the section asks itself, so there is no subtree here from which an admin
          call could be issued without authority (Requirement 10.4). */}
      {detail !== null && (
        <AdminSection
          squadId={detail.squadId}
          api={api}
          flags={detail.features}
          onSquadChanged={machine.refresh}
          rows={machine.players}
          viewerRole={machine.caller.role}
          viewerState={machine.caller.state}
          editingMembershipId={editingMembershipId}
          onEditingFinished={finishEditing}
          editOpenerRef={editOpenerRef}
          authState={authState}
        />
      )}
    </div>
  );
}

export default SquadScreen;
