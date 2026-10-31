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
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  HOME_ROUTE,
  SQUAD_SCOPE_ROUTE_PARAMETER,
  usePublishSquadScopeFromRoute,
} from '../../app-shell';
import { useAuth } from '../../auth';
import { TabNav } from '../../../ui';
import type { SquadsApi } from '../api/squadsApi';
import { AdminSection } from '../components/AdminSection';
import { FailureNotice } from '../components/FailureNotice';
import { LeaveSquadControl } from '../components/LeaveSquadControl';
import { LoadingIndication } from '../components/LoadingIndication';
import { NotFoundTreatment } from '../components/NotFoundTreatment';
import { PlaceholderSection } from '../components/PlaceholderSection';
import { PlayersPanel } from '../components/PlayersPanel';
import type { ViewerContext } from '../components/PlayerRow';
import type { SquadRole } from '../lib/wireEnums';
import {
  ADMIN_ROLE_LABEL,
  ADMIN_TAB_LABEL,
  LEADERBOARDS_TAB_LABEL,
  MATCHES_PLACEHOLDER_STATEMENT,
  MATCHES_SECTION_HEADING,
  MATCHES_TAB_LABEL,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
  PLAYERS_SECTION_HEADING,
  PLAYERS_TAB_LABEL,
  SQUAD_OVERLINE,
  SQUAD_TABS_LABEL,
  SQUAD_DETAIL_SECTION_HEADING,
  SQUAD_LOADING_LABEL,
  SQUAD_SCREEN_HEADING,
  SQUADS_RETRY_LABEL,
  STATS_PLACEHOLDER_STATEMENT,
  STATS_SECTION_HEADING,
  YOUR_ROLE_LABEL,
} from '../lib/messages';
import { playerStatsPath } from '../lib/routePaths';
import { playerCountLabel } from '../lib/squadCardView';
import { squadTabOf, squadTabPath, squadTabsFor, type SquadTab } from '../lib/squadTabs';
import { usePromotion } from '../state/usePromotion';
import {
  DEMOTE_CALL,
  LEAVE_CALL,
  REMOVE_CALL,
  useMembershipAction,
} from '../state/useMembershipAction';
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
const ROLE_LABELS: Readonly<Record<SquadRole, string>> = {
  Owner: OWNER_ROLE_LABEL,
  Admin: ADMIN_ROLE_LABEL,
  Member: MEMBER_ROLE_LABEL,
};

/**
 * The caller's Member_Role in words, including its absence (Requirement 6.3).
 *
 * A membership the feature could not identify, and one whose read model carried
 * no role, are both stated in text rather than left as a blank space — the same
 * treatment the Squad_Card gives an absent role (Requirement 1.6).
 */
function roleLabelOf(role: SquadRole | null): string {
  return role === null ? NO_ROLE_RECORDED_LABEL : ROLE_LABELS[role];
}

const TAB_LABELS: Readonly<Record<SquadTab, string>> = {
  players: PLAYERS_TAB_LABEL,
  matches: MATCHES_TAB_LABEL,
  leaderboards: LEADERBOARDS_TAB_LABEL,
  admin: ADMIN_TAB_LABEL,
};

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
  // Each tab is its own address; the screen reads which one it is showing.
  const tab = squadTabOf(useLocation().pathname);

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

  // Promotion and demotion announce on the same row, so each success clears
  // the other's settled outcome — a row never reads "now an admin" beside "no
  // longer an admin". The demotion machine is created below, so its clearing
  // is reached through a ref.
  const clearDemotionOutcomeRef = useRef<() => void>(() => undefined);
  const refreshSquadOnly = machine.refresh;
  const refreshAfterPromotion = useCallback((): void => {
    refreshSquadOnly();
    clearDemotionOutcomeRef.current();
  }, [refreshSquadOnly]);

  const promotion = usePromotion({
    api,
    squadId: detailSquadId,
    refresh: refreshAfterPromotion,
    authState,
  });
  const clearPromotionOutcome = promotion.clearOutcome;

  // Remove, demote and transfer change rows, so success re-reads the squad, as
  // promotion does. They can also change the caller's own standing — a
  // transfer makes the owner an admin, and an admin's own row can be removed or
  // demoted, because no result names the caller's membership — and that
  // standing comes from `ListMySquads`, so it is re-read too. Leaving ends the
  // caller's access, so success goes home.
  const refreshSquad = machine.refresh;
  const relistStanding = listing.retry;
  const refreshAfterChange = useCallback((): void => {
    refreshSquad();
    relistStanding();
  }, [refreshSquad, relistStanding]);

  const removal = useMembershipAction({
    api,
    squadId: detailSquadId,
    perform: REMOVE_CALL,
    onSucceeded: refreshAfterChange,
    authState,
  });

  const refreshAfterDemotion = useCallback((): void => {
    refreshAfterChange();
    clearPromotionOutcome();
  }, [clearPromotionOutcome, refreshAfterChange]);

  const demotion = useMembershipAction({
    api,
    squadId: detailSquadId,
    perform: DEMOTE_CALL,
    onSucceeded: refreshAfterDemotion,
    authState,
  });
  const clearDemotionOutcome = demotion.clearOutcome;
  useEffect(() => {
    clearDemotionOutcomeRef.current = clearDemotionOutcome;
  }, [clearDemotionOutcome]);

  const goHome = useCallback((): void => {
    navigate(HOME_ROUTE);
  }, [navigate]);

  const leaving = useMembershipAction({
    api,
    squadId: detailSquadId,
    perform: LEAVE_CALL,
    onSucceeded: goHome,
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

  /** The Admin tab's link, which the guest edit form returns focus to. */
  const adminTabRef = useRef<HTMLAnchorElement | null>(null);

  const editGuest = useCallback((membershipId: string): void => {
    // The Guest_Form lives in the Admin_Section, on the Admin tab, while the
    // edit control is on a Players row. So editing switches to the Admin tab —
    // the screen stays mounted across tabs, so the edit target carries over —
    // and the form, on closing, returns focus to the Admin tab's link: the row
    // control that opened it is no longer on the page (Requirement 19.7).
    editOpenerRef.current = adminTabRef.current;

    setEditingMembershipId(membershipId);
    if (detailSquadId !== '') {
      navigate(squadTabPath(detailSquadId, 'admin'));
    }
  }, [detailSquadId, navigate]);

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

  const activePlayers = machine.players.filter((row) => row.state === 'Active').length;
  const offeredTabs = squadTabsFor(machine.adminAuthority);

  /** The page under the tab bar, for the tab the address names. */
  let tabPage: ReactNode = null;

  if (detail !== null) {
    if (tab === 'players') {
      tabPage = (
        <section
          className="squad-screen__section"
          data-squads-players-section="true"
          aria-labelledby={playersHeadingId}
        >
          {/* Named by the tab already, so the heading is for the outline only. */}
          <h2 className="pm-sr" id={playersHeadingId}>
            {PLAYERS_SECTION_HEADING}
          </h2>
          {/* 7.10, 7.13: every row renders its membership facts immediately, with
              Rating_Unavailable in the rating column until — or unless — the
              leaderboard settles. The rows carry that fact already. */}
          <PlayersPanel
            squadId={detail.squadId}
            rows={machine.players}
            viewer={viewer}
            onOpenPlayer={openPlayer}
            promotion={promotion}
            removal={removal}
            demotion={demotion}
            onEditGuest={editGuest}
          />
          {/* The caller's own way out — or, for the owner, why there is none yet. */}
          <LeaveSquadControl
            squadId={detail.squadId}
            callerRole={machine.caller.role}
            callerState={machine.caller.state}
            machine={leaving}
          />
        </section>
      );
    } else if (tab === 'matches') {
      // 6.8 §3, 15.1: the matches Placeholder_Section, heading always, injected
      // body in place of the statement where one is supplied.
      tabPage = (
        <PlaceholderSection
          heading={MATCHES_SECTION_HEADING}
          emptyStatement={MATCHES_PLACEHOLDER_STATEMENT}
          content={matchesContent}
        />
      );
    } else if (tab === 'leaderboards') {
      // 6.8 §4, 15.1: the stats Placeholder_Section.
      tabPage = (
        <PlaceholderSection
          heading={STATS_SECTION_HEADING}
          emptyStatement={STATS_PLACEHOLDER_STATEMENT}
          content={statsContent}
        />
      );
    } else if (machine.adminAuthority) {
      // 6.8 §5, 10.2, 10.3: administration, only where `resolveAdminAuthority`
      // holds — which the section asks itself, so there is no subtree here from
      // which an admin call could be issued without authority (Requirement 10.4).
      tabPage = (
        <AdminSection
          squadId={detail.squadId}
          squadName={detail.name}
          api={api}
          flags={detail.features}
          onSquadChanged={machine.refresh}
          onCallerStandingChanged={refreshAfterChange}
          rows={machine.players}
          viewerRole={machine.caller.role}
          viewerState={machine.caller.state}
          editingMembershipId={editingMembershipId}
          onEditingFinished={finishEditing}
          editOpenerRef={editOpenerRef}
          authState={authState}
        />
      );
    } else {
      // The Admin tab's address, for someone without admin authority: the tab is
      // absent for them, so they are shown the squad's Players tab instead —
      // replacing the address, so the back button does not return them here.
      // They are a member, so there is nothing about the squad to conceal.
      tabPage = <Navigate to={squadTabPath(detail.squadId, 'players')} replace />;
    }
  }

  return (
    <div className="squad-screen" data-squads-squad-screen="true">
      {/* The design system's squad header: the overline with the player count,
          the squad's name, and the caller's role. A plain element, not a
          `<header>`: outside a sectioning element that would be a second banner
          landmark beside the shell's. */}
      <div className="squad-screen__header">
        {detail !== null && (
          <p className="squad-screen__overline">
            {SQUAD_OVERLINE} · {playerCountLabel(activePlayers)}
          </p>
        )}
        {/* 6.3, 19.1: the screen's one level-one heading — the parsed Squad_Name
            once one is held, and a fixed noun while none is. */}
        <h1 className="squad-screen__heading">
          {detail === null ? SQUAD_SCREEN_HEADING : detail.name}
        </h1>

        {/* 6.8 §1: the Squad_Detail region — the caller's role once read, or the
            loading or failure state while it is not. */}
        <section
          className="squad-screen__detail"
          data-squads-detail-section="true"
          aria-labelledby={detailHeadingId}
        >
          <h2 className="pm-sr" id={detailHeadingId}>
            {SQUAD_DETAIL_SECTION_HEADING}
          </h2>
          {detailBody}
        </section>
      </div>

      {detail !== null && (
        <>
          {/* Each tab is an address. Admin is offered to an admin only — absent,
              not disabled, for a member. */}
          <TabNav
            label={SQUAD_TABS_LABEL}
            active={tab}
            tabs={offeredTabs.map((offered) => ({
              id: offered,
              label: TAB_LABELS[offered],
              ...(offered === 'players' ? { count: activePlayers } : {}),
              ...(offered === 'admin' ? { icon: 'shield' as const } : {}),
            }))}
            renderLink={({ tab: linked, className, current, children }) => (
              <Link
                ref={linked.id === 'admin' ? adminTabRef : undefined}
                to={squadTabPath(detail.squadId, linked.id as SquadTab)}
                className={className}
                aria-current={current}
              >
                {children}
              </Link>
            )}
          />
          <div className="squad-screen__tab-page">{tabPage}</div>
        </>
      )}
    </div>
  );
}

export default SquadScreen;
