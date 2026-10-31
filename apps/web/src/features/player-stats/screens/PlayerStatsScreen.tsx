/**
 * The Player_Stats_Screen — `/app/squads/:squadId/players/:membershipId`: one
 * membership's squad-scoped record, rating, progression, streaks, bibs,
 * pairwise standings, and live-match detail.
 *
 * Everything it renders was built before it, so this file composes and decides
 * rather than implements. What it owns is exactly the five things no component
 * below it can:
 *
 * 1. **The subject**, read from the route's own two parameters through
 *    `readSubject` and from no other source — no context, no prop, no stored
 *    value, nothing carried over from the Squad_Screen (Requirement 1.4). A pair
 *    that is not two well-formed identities yields `null`, which the machine
 *    turns into the same presentation a concealed absence reaches, with no call
 *    issued (Requirement 3.3).
 * 2. **The Squad_Scope**, published once through the App_Shell's
 *    `usePublishSquadScopeFromRoute` — needing no argument, because the dynamic
 *    segment is named `squadId` and so matches the shell's own
 *    `SQUAD_SCOPE_ROUTE_PARAMETER` (Requirement 1.5). The shell's notification
 *    surfaces therefore scope themselves to the squad this profile belongs to,
 *    and withdraw the scope when the screen leaves.
 * 3. **Which of the four bodies the machine's phase calls for** — the
 *    Not_Found_Treatment alone, the Failure_Notice alone, the loading indication
 *    while no Player_Profile is held, or the section stack with a busy
 *    indication beside it while a held profile is re-read (Requirements 2.2,
 *    2.3, 3.1, 4.1).
 * 4. **The section order**, which Requirement 16.3 and the design fix as a
 *    document-order fact: identity header, record, rating, progression,
 *    streaks, bibs, the four Pairwise_Sections, rich stats — ten `StatSection`s
 *    after the header, each with one level-two heading.
 * 5. **The way out**, rendered in *every* condition including not-found and
 *    failed (Requirement 1.6), so a person who cannot see a profile is never
 *    left reaching for the browser's own history.
 *
 * ### Exactly one level-one heading, in every condition
 *
 * On a loaded profile the `h1` is the parsed Player_Display_Name, contributed by
 * the identity header (Requirement 5.1). The Not_Found_Treatment contributes its
 * own fixed heading, which names neither squad nor player nor identity
 * (Requirement 3.6). The two remaining bodies have no name to render, so this
 * file renders {@link PLAYER_STATS_HEADING}. One heading in each of the four
 * cases, never two and never none, which is what keeps the outline well-formed
 * (Requirement 16.1).
 *
 * ### It issues nothing, formats nothing, and words nothing
 *
 * Every `GetPlayerProfile` call belongs to `state/usePlayerStatsScreen.ts`,
 * which is the feature's only issue site — so there is no `AbortController`, no
 * timer, and no api call site here, and "one call per subject" stays a
 * structural fact rather than a convention this file has to honour
 * (Requirements 2.1, 2.4). Every count, percentage, duration, and instant is
 * formatted by a `lib/` module inside the component that renders it. Every
 * string comes from `lib/messages.ts`, and every path from the squads barrel's
 * builders, so no wording and no path literal appears here (Requirement 1.7).
 *
 * The three derivations below the condition selection — the Progression_Series,
 * the Rating_Condition, and the Rich_Condition — are each a call to one pure
 * `lib/` function on the held profile. They are reached through those functions
 * rather than re-decided here, so a guard added between a profile and its
 * condition is caught by the properties that cover them.
 *
 * Requirements: 1.4, 1.5, 1.6, 2.2, 2.3, 3.1, 4.1, 4.3, 16.3
 */
import { type ReactElement, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  SQUAD_SCOPE_ROUTE_PARAMETER,
  usePublishSquadScopeFromRoute,
} from '../../app-shell';
import { useAuth } from '../../auth';
import { PLAYER_STATS_ROUTE, squadPath } from '../../squads';
import type { PlayerStatsApi } from '../api/playerStatsApi';
import { BibAppearances } from '../components/BibAppearances';
import { FailureNotice } from '../components/FailureNotice';
import { LoadingIndication } from '../components/LoadingIndication';
import { NotFoundTreatment } from '../components/NotFoundTreatment';
import { PairwiseSection } from '../components/PairwiseSection';
import { PlayerIdentityHeader } from '../components/PlayerIdentityHeader';
import { ProgressionChart } from '../components/ProgressionChart';
import { ProgressionTable } from '../components/ProgressionTable';
import { RatingPanel } from '../components/RatingPanel';
import { RecordPanel } from '../components/RecordPanel';
import { RichStatsPanel } from '../components/RichStatsPanel';
import { StatSection } from '../components/StatSection';
import { StreakPanel } from '../components/StreakPanel';
import { useConditionFocus, type ScreenCondition } from '../components/surfaceFocus';
import {
  BACK_TO_SQUAD_LABEL,
  BEST_PARTNERSHIPS_HEADING,
  BIBS_SECTION_HEADING,
  BOGEY_OPPONENTS_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  MOST_PLAYED_WITH_HEADING,
  PLAYER_STATS_HEADING,
  PROGRESSION_SECTION_HEADING,
  RATING_SECTION_HEADING,
  RECORD_SECTION_HEADING,
  RICH_STATS_SECTION_HEADING,
  STREAKS_SECTION_HEADING,
} from '../lib/messages';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { toProgressionSeries } from '../lib/progression';
import { resolveRatingCondition } from '../lib/ratingCondition';
import { resolveRichCondition } from '../lib/richStats';
import { readSubject } from '../lib/subject';
import { usePlayerStatsScreen } from '../state/usePlayerStatsScreen';

// The feature token table, so the screen resolves its own custom properties
// whether or not the App_Shell frame around it declared them. No colour value is
// written in either file (Requirement 15.2).
import '../styles/playerStatsTokens.css';
import './PlayerStatsScreen.css';

/**
 * The selector of the screen wrapper, so a test can scope a query to the screen
 * without depending on the shell frame that usually surrounds it.
 */
export const PLAYER_STATS_SCREEN_SELECTOR = '[data-player-stats-screen="true"]';

/**
 * The selector of the control back to the squad, which is rendered in every
 * condition (Requirement 1.6) — including the two that render no profile at all.
 */
export const SQUAD_RETURN_CONTROL_SELECTOR = '[data-player-stats-squad-return="true"]';

/**
 * The `data-player-stats-condition` attribute, naming which of the four bodies
 * is on screen, so a test can state the condition it means rather than
 * inferring it from the markup it finds.
 */
export const SCREEN_CONDITION_ATTRIBUTE = 'data-player-stats-condition';

/**
 * The name of the route's membership parameter, taken from the pattern the
 * squads barrel declares rather than spelled again here.
 *
 * Requirement 1.2 has this feature import the Player_Stats_Route and restate
 * it nowhere, and the parameter name is part of the pattern: the final dynamic
 * segment follows the pattern's last colon. Deriving it means the screen cannot
 * read a parameter the registered route does not provide — a pair that would
 * leave the subject unreadable and render an unexplained not-found for every
 * visit.
 *
 * The squad parameter is *not* derived the same way: it comes from the
 * App_Shell's own `SQUAD_SCOPE_ROUTE_PARAMETER`, which is the name the shell's
 * scope publication reads, so this screen and the shell cannot disagree about
 * its spelling.
 */
const MEMBERSHIP_ROUTE_PARAMETER = PLAYER_STATS_ROUTE.slice(
  PLAYER_STATS_ROUTE.lastIndexOf(':') + 1,
);

export interface PlayerStatsScreenProps {
  /**
   * The Player_Stats_Api facade — the feature's only transport seam, constructed
   * by `appRouter.tsx` from the Authenticated_Api_Client and handed in as a prop
   * (Requirement 12.1). This screen holds no client and builds none.
   */
  readonly api: PlayerStatsApi;
}

/**
 * The control back to the squad the route names.
 *
 * Declared once and rendered in all four conditions — inside the
 * Not_Found_Treatment, which owns its own copy of it, beside the retry control
 * in the failure notice, and at the foot of the loading and loaded bodies
 * (Requirement 1.6). It is shaped like the treatment's control because it is the
 * same affordance, and its path is built by the squads barrel's `squadPath` so
 * it cannot drift from where the Squad_Screen is registered.
 *
 * @param squadId the squad identity the route carries, used unasserted: an
 *   absent segment arrives as the empty string, which builds a path no dynamic
 *   segment matches — a control that resolves nowhere rather than one that
 *   resolves to the wrong squad
 */
function SquadReturnControl({ squadId }: { readonly squadId: string }): ReactElement {
  return (
    <Link
      className="player-stats-squad-link"
      to={squadPath(squadId)}
      data-player-stats-squad-return="true"
    >
      {BACK_TO_SQUAD_LABEL}
    </Link>
  );
}

/**
 * The section stack for a held Player_Profile, in the one reading order the
 * design fixes.
 *
 * A function rather than inline JSX so the condition selection above it reads as
 * four branches rather than as one branch and ninety lines. It derives nothing
 * of its own: the three conditions it needs are resolved by the `lib/` functions
 * that own them, and each section's figures are formatted inside the component
 * that renders them.
 *
 * Requirements: 2.3, 11.7, 16.3
 */
function profileSections(
  profile: PlayerProfile,
  squadId: string,
  busy: boolean,
): ReactNode {
  // 8.1: ordered by completion instant, so the chart and the table read the
  // same way on every load whatever order the backend sent the points in.
  const series = toProgressionSeries(profile.progression);

  // 7.1: resolved from the Rating_Summary and the Appearance_Count, in that one
  // place, so the panel renders a condition rather than deciding one.
  const ratingCondition = resolveRatingCondition(
    profile.rating,
    profile.record.appearances,
  );

  // 11.1, 11.2: the squad's tracking is off, or it is on with nothing recorded,
  // or there is detail to render.
  const richCondition = resolveRichCondition(profile.rich);

  return (
    <>
      {/* 5.1: the screen's one level-one heading, the membership labels, and the
          statement that every figure below counts this squad's matches only. */}
      <PlayerIdentityHeader
        displayName={profile.displayName}
        state={profile.state}
        isGuest={profile.isGuest}
      />

      {/* 2.3: a re-read keeps the whole profile rendered and states that it is
          being refreshed beside it, rather than replacing it with a wait. */}
      {busy ? <LoadingIndication /> : null}

      <StatSection heading={RECORD_SECTION_HEADING}>
        <RecordPanel record={profile.record} winPercentage={profile.winPercentage} />
      </StatSection>

      <StatSection heading={RATING_SECTION_HEADING}>
        <RatingPanel playerName={profile.displayName} condition={ratingCondition} />
      </StatSection>

      {/* 8.4, 8.5: the chart conveys the shape and announces nothing; the table
          beside it carries every figure in text, announced exactly once. Both
          render nothing for an empty series, and the table states that there is
          no history yet (Requirement 8.6). */}
      <StatSection heading={PROGRESSION_SECTION_HEADING}>
        <ProgressionChart series={series} />
        <ProgressionTable series={series} />
      </StatSection>

      {/* Side by side where there is room; the order is unchanged. */}
      <div className="player-stats-pair">
        <StatSection heading={STREAKS_SECTION_HEADING}>
          <StreakPanel
            winStreak={profile.winStreak}
            unbeatenStreak={profile.unbeatenStreak}
          />
        </StatSection>

        <StatSection heading={BIBS_SECTION_HEADING}>
          <BibAppearances bibAppearances={profile.bibAppearances} />
        </StatSection>
      </div>

      {/* 10.1: each of the four renders its *own* `StatSection`, heading
          included, so none is wrapped in a second one — two nested regions and
          two level-two headings would be the defect. The squad identity is the
          route's, so every Pairwise_Link opens a profile inside this squad. */}
      <div className="player-stats-pair">
        <PairwiseSection
          heading={MOST_PLAYED_WITH_HEADING}
          squadId={squadId}
          variant="co-appearance"
          entries={profile.mostPlayedWith}
        />
        <PairwiseSection
          heading={MOST_PLAYED_AGAINST_HEADING}
          squadId={squadId}
          variant="co-appearance"
          entries={profile.mostPlayedAgainst}
        />
        <PairwiseSection
          heading={BEST_PARTNERSHIPS_HEADING}
          squadId={squadId}
          variant="paired-stat"
          entries={profile.bestPartnerships}
        />
        <PairwiseSection
          heading={BOGEY_OPPONENTS_HEADING}
          squadId={squadId}
          variant="paired-stat"
          entries={profile.bogeyOpponents}
        />
      </div>

      {/* 11.7: last, and the only section a tracking condition can empty. Every
          section above it renders identically in all three conditions. */}
      <StatSection heading={RICH_STATS_SECTION_HEADING}>
        <RichStatsPanel condition={richCondition} />
      </StatSection>
    </>
  );
}

/**
 * Render the Player_Stats_Screen.
 *
 * Requirements: 1.4, 1.5, 1.6, 2.2, 2.3, 3.1, 4.1, 4.3, 16.3
 */
export function PlayerStatsScreen({ api }: PlayerStatsScreenProps): ReactElement {
  const { state: authState } = useAuth();

  // 1.4: both identities from the route's own parameters and from no other
  // source. **Unasserted** — `readSubject` decides whether they are identities,
  // and a pair that is not issues no call at all (Requirement 3.3).
  const parameters = useParams();
  const routeSquadId = parameters[SQUAD_SCOPE_ROUTE_PARAMETER];
  const routeMembershipId = parameters[MEMBERSHIP_ROUTE_PARAMETER];

  // 1.5: called once, and needing no argument, because the route's dynamic
  // segment is named `squadId` — so the shell's notification surfaces scope
  // themselves to this squad with no other wiring.
  usePublishSquadScopeFromRoute();

  // A fresh object each render, which costs nothing: the load machine's issue
  // guard compares the subject's *key*, not its object identity, so a new pair
  // carrying the same identities issues no further call (Requirement 2.1).
  const subject = readSubject(routeSquadId, routeMembershipId);

  const machine = usePlayerStatsScreen({ api, subject, authState });
  const profile = machine.profile;

  /**
   * Which of the four bodies is on screen, in the design's order of precedence:
   * not-found, then failed, then nothing-held, then the profile.
   *
   * The machine's six phases collapse to four bodies — `idle` and `loading`
   * both hold no profile, and `refreshing` renders the held profile as `loaded`
   * does with a busy indication beside it. `notFound` and `failed` are never
   * both true, so the order settles precedence rather than resolving a conflict
   * (Requirement 4.3).
   */
  const condition: ScreenCondition = machine.notFound
    ? 'not-found'
    : machine.failed
      ? 'failed'
      : profile === null
        ? 'loading'
        : 'loaded';

  // 16.5: a change of condition replaces the whole body, so the control a person
  // was standing on routinely stops existing. This puts focus back inside the
  // main content region where it would otherwise have been dropped to the
  // document body, and moves it in no other case.
  const { ref, regionProps } = useConditionFocus(condition);

  // The squad the way-out control points at: the route's own segment, used
  // unasserted so the control is rendered in the malformed-path condition too.
  const squadId = routeSquadId ?? '';

  let body: ReactNode;

  if (condition === 'not-found') {
    // 3.1, 3.3: the Not_Found_Treatment and nothing else — no display name, no
    // record, no rating, no progression, no pairwise section, no rich value, and
    // no statement of which concealed cause applied. It carries the condition's
    // own level-one heading and its own control back to the squad.
    body = <NotFoundTreatment squadId={squadId} />;
  } else if (condition === 'failed') {
    // 4.1, 4.3: the Generic_Profile_Failure and its retry control, with no
    // partially populated profile beside it and never the Not_Found_Treatment.
    body = (
      <>
        <h1 className="player-stats-screen__heading">{PLAYER_STATS_HEADING}</h1>
        <FailureNotice onRetry={machine.retry} retryBusy={machine.busy}>
          <SquadReturnControl squadId={squadId} />
        </FailureNotice>
      </>
    );
  } else if (profile === null) {
    // 2.2: no Player_Profile is held — the `loading` condition — so the loading
    // indication and its programmatically determinable busy state stand alone;
    // no section skeletons, which would announce figures that have not arrived.
    body = (
      <>
        <h1 className="player-stats-screen__heading">{PLAYER_STATS_HEADING}</h1>
        <LoadingIndication />
        <SquadReturnControl squadId={squadId} />
      </>
    );
  } else {
    // The `loaded` condition. Branching on the held profile rather than on the
    // condition name is what narrows it for the stack below, and it cannot
    // disagree with the condition: the two are decided by the same test.
    body = (
      <>
        {profileSections(profile, squadId, machine.busy)}
        <SquadReturnControl squadId={squadId} />
      </>
    );
  }

  return (
    <div
      className="player-stats-screen"
      data-player-stats-screen="true"
      data-player-stats-condition={condition}
    >
      <div ref={ref} {...regionProps}>
        {body}
      </div>
    </div>
  );
}

export default PlayerStatsScreen;
