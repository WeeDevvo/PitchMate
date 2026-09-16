/**
 * One Player_Row of the Player_List: a squad membership, everything the squad
 * knows about it in words, and the one control that opens its stats.
 *
 * The row renders, in this order (design.md → PlayerList and PlayerRow):
 *
 *  1. the **navigation control** — a `<button>` whose accessible name is the
 *     player's own name, present on every row including a Former_Player's
 *     (Requirements 9.1, 9.5, 9.8);
 *  2. the **membership labels** — role or guest, state, and the Former_Player
 *     label, with an inactive row's leading dash glyph (Requirements 7.5–7.8);
 *  3. the **Rating_Presentation** — one of a Display_Rating, a Provisional_Band,
 *     or the Rating_Unavailable label (Requirement 8.5);
 *  4. the **Promotion_Control** and the **guest edit control**, only while the
 *     caller holds Admin_Authority and only where the row is eligible
 *     (Requirements 10.2, 12.7, 13.1).
 *
 * ### No eligibility rule is written here
 *
 * Both admin controls are gated by a pure predicate from `lib/` —
 * {@link isPromotable} and {@link isGuestEditable} — and this component adds no
 * condition of its own, not even an apparently harmless one. That is the whole
 * point of Requirements 13.3 and 12.7 asking for predicates: the accepted sets are
 * pinned by property tests over role × state × guest × placeholder × self, and a
 * component-local `&&` would be a second rule those properties never see. It also
 * means a row's Former_Player *presentation* and its *controls* cannot disagree,
 * because both trace back to `isAnonymisedPlaceholder`.
 *
 * The controls are **absent** rather than disabled for an ineligible row, which is
 * what makes "no admin call from a non-admin session" structural (Requirement
 * 10.4). Absence is still not the access control: Requirement 10.5 keeps the
 * backend authoritative, and a `403` or `404` on either call is an outcome message
 * that changes nothing on screen.
 *
 * Each control delegates to a callback and performs no call of its own, so the row
 * stays assertable without a transport or a router. The confirming Promotion
 * Control — the confirmation naming the player, the pending state, the live-region
 * outcome — is `PromotionControl`'s job and arrives with the Admin_Section; this
 * row's job is to decide *whether* a promotion affordance exists and to hand the
 * activation on.
 *
 * ### The Player_Stats_Route is built once, and the row states its target
 *
 * The navigation control carries the path {@link playerStatsPath} builds for this
 * row's squad and membership identities in
 * {@link PLAYER_ROW_STATS_PATH_ATTRIBUTE}, and activation calls `onOpenPlayer`,
 * which the Squad_Screen supplies as
 * `(membershipId) => navigate(playerStatsPath(squadId, membershipId))`. The path is
 * therefore built by exactly one function (Requirement 9.2) and is *recoverable
 * from the rendered row*, so the seam a later feature registers against can be
 * asserted against the pattern rather than trusted. Navigation stays the screen's,
 * as it is for a Squad_Card: no `href` and no `location` assignment exists here, so
 * no full-document reload is possible (Requirement 9.4).
 *
 * A native `<button>` gives keyboard reachability, Enter, and Space for free
 * (Requirements 9.1, 19.4). The player's name is the control's only content, so its
 * accessible name is that name and cannot drift from what is displayed.
 *
 * ### The row is a named group, so no value is orphaned
 *
 * The root is a `role="group"` labelled by the name inside its navigation control,
 * so a screen reader entering the row hears whose row it is and every label, badge,
 * and control it then meets belongs to that player unambiguously (Requirement
 * 19.6). `aria-labelledby` points at the rendered name rather than repeating it in
 * an `aria-label`, so the group's name and the visible name are the same node and
 * cannot diverge. The `RatingBadge` additionally names the player in its own
 * accessible name, because a rating must be perceivable from that name alone
 * (Requirement 8.8).
 *
 * ### The rating decision is not repeated either
 *
 * A `PlayerListRow` carries what rating data was available for its membership —
 * whether a leaderboard was obtained, and this membership's entry if it had one —
 * and choosing between the three presentations belongs to
 * {@link selectRatingPresentation} (Requirement 8.6). {@link presentationOf} adapts
 * the row to that function by handing it a leaderboard holding this row's own entry
 * and nothing else, which is sound because only that entry could ever have matched.
 * No branch here decides what a missing entry means, and no arithmetic touches a
 * rating value.
 *
 * No colour value appears in this file or in `PlayerRow.css`; both read the feature
 * token table (Requirement 18.9).
 *
 * Requirements: 7.5, 7.6, 7.7, 7.8, 9.1, 9.4, 9.5, 9.8, 19.3
 */
import { useId, type ReactElement } from 'react';

import { MembershipLabels } from './MembershipLabels';
import { RatingBadge } from './RatingBadge';
import { EDIT_GUEST_LABEL, PROMOTE_TO_ADMIN_LABEL } from '../lib/messages';
import { isGuestEditable, type PlayerListRow } from '../lib/playerList';
import { isPromotable } from '../lib/promotionEligibility';
import {
  selectRatingPresentation,
  type RatingPresentation,
} from '../lib/ratingPresentation';
import { playerStatsPath } from '../lib/routePaths';

// The feature token table, so a row rendered outside the App_Shell frame still
// resolves every custom property `PlayerRow.css` reads (Requirement 18.9).
import '../styles/squadsTokens.css';
import './PlayerRow.css';

/**
 * The selector of a Player_Row, so a Player_List test can count the rows and read
 * their membership identities without depending on any rendered copy.
 */
export const PLAYER_ROW_SELECTOR = '[data-squads-player-row="true"]';

/**
 * The attribute carrying a row's membership identity, so a test can assert the
 * rendered set holds one row per Squad_Member and no other identity.
 */
export const PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE = 'data-membership-id';

/** The selector of the row's single navigation control (Requirement 9.1). */
export const PLAYER_ROW_OPEN_SELECTOR = '[data-squads-player-open="true"]';

/**
 * The attribute carrying the Player_Stats_Route path that control opens, built by
 * `playerStatsPath` — so the seam is recoverable from the rendered row
 * (Requirements 9.2, 9.3).
 */
export const PLAYER_ROW_STATS_PATH_ATTRIBUTE = 'data-player-stats-path';

/** The selector of the Promotion_Control, rendered only where eligible. */
export const PLAYER_ROW_PROMOTE_SELECTOR = '[data-squads-player-promote="true"]';

/** The selector of the guest edit control, rendered only where eligible. */
export const PLAYER_ROW_EDIT_GUEST_SELECTOR =
  '[data-squads-player-edit-guest="true"]';

/**
 * What the feature knows about the person looking at the Player_List: which
 * membership is theirs, and whether they hold Admin_Authority.
 *
 * `membershipId` is `null` when neither the `GetSquad` result nor the
 * `ListMySquads` summary identified the caller's own membership — in which case
 * `isAdmin` is `false` as well, because `resolveAdminAuthority` has nothing to
 * resolve authority from (Requirement 6.10).
 *
 * `isAdmin` is a *resolved* value rather than a role and a state, so no component
 * re-runs the authority rule.
 */
export interface ViewerContext {
  /** The caller's own membership identity in this squad, or `null`. */
  readonly membershipId: string | null;

  /** The caller's Admin_Authority, as resolved by `resolveAdminAuthority`. */
  readonly isAdmin: boolean;
}

/**
 * The Rating_Presentation of one row, chosen by the feature's single pure selector.
 *
 * The row already knows whether a leaderboard was obtained and which entry, if
 * any, was its own, so the selector is handed a leaderboard containing exactly
 * that entry. Only this membership's entry could match the row's identity, so the
 * restriction changes no outcome — and it keeps the three-way decision in one
 * place instead of re-implementing it per component (Requirements 8.3, 8.5, 8.6,
 * 8.10).
 */
function presentationOf(row: PlayerListRow): RatingPresentation {
  if (!row.leaderboardObtained) {
    return selectRatingPresentation(row, null);
  }

  return selectRatingPresentation(row, {
    entries: row.ratingEntry === null ? [] : [row.ratingEntry],
  });
}

export interface PlayerRowProps {
  /** The squad this row belongs to, needed to build the Player_Stats_Route path. */
  readonly squadId: string;

  /** The composed row: a Squad_Member plus its derived facts and rating data. */
  readonly row: PlayerListRow;

  /** Who is looking, and whether they hold Admin_Authority. */
  readonly viewer: ViewerContext;

  /**
   * Called with this row's membership identity when its navigation control is
   * activated by pointer, by Enter, or by Space. The Squad_Screen passes
   * `(membershipId) => navigate(playerStatsPath(squadId, membershipId))`
   * (Requirement 9.4).
   */
  readonly onOpenPlayer: (membershipId: string) => void;

  /** Called with this row's membership identity to begin promoting it. */
  readonly onPromote: (membershipId: string) => void;

  /** Called with this row's membership identity to begin editing that guest. */
  readonly onEditGuest: (membershipId: string) => void;
}

/**
 * Render one Player_Row: the player's name as the control that opens their stats,
 * their membership facts in words, their Rating_Presentation, and the admin
 * controls the caller is entitled to on this row.
 *
 * Requirements: 7.5, 7.6, 7.7, 7.8, 9.1, 9.4, 9.5, 9.8, 19.3
 */
export function PlayerRow({
  squadId,
  row,
  viewer,
  onOpenPlayer,
  onPromote,
  onEditGuest,
}: PlayerRowProps): ReactElement {
  const nameId = useId();

  // 13.1, 13.2, 12.7: both decisions are the predicates', never this component's.
  const promotable = isPromotable(row, viewer.membershipId, viewer.isAdmin);
  const guestEditable = isGuestEditable(row, viewer.isAdmin);

  return (
    <div
      className="squads-player-row"
      // 19.6: the row is a group named by the player, so every value inside it is
      // programmatically associated with whose row it is.
      role="group"
      aria-labelledby={nameId}
      data-squads-player-row="true"
      data-membership-id={row.membershipId}
      // 7.7: the muted surface of an inactive row hangs off the state itself, so
      // the cue cannot be applied to a row whose label says otherwise.
      data-membership-state={row.state}
    >
      {/* 9.1, 9.5, 9.8: one keyboard-operable control per row, named by the
          player, present even for a Former_Player — and carrying the path
          `playerStatsPath` built, so the seam is recoverable from the row (9.2). */}
      <button
        type="button"
        className="squads-player-row__open"
        data-squads-player-open="true"
        data-player-stats-path={playerStatsPath(squadId, row.membershipId)}
        onClick={() => onOpenPlayer(row.membershipId)}
      >
        <span id={nameId} className="squads-player-row__name">
          {row.displayName}
        </span>
      </button>

      {/* 7.5, 7.6, 7.7, 7.8, 19.3: every membership fact in words. */}
      <MembershipLabels
        role={row.role}
        state={row.state}
        isGuest={row.isGuest}
        isFormerPlayer={row.isFormerPlayer}
      />

      {/* 8.5, 8.8: exactly one Rating_Presentation, named for this player. */}
      <RatingBadge playerName={row.displayName} presentation={presentationOf(row)} />

      {/* 10.2, 13.1: present only where the promotion predicate holds. The
          confirmation, the pending state, and the outcome message belong to the
          promotion surface the Admin_Section owns; the row hands the activation on. */}
      {promotable && (
        <button
          type="button"
          className="squads-player-row__action"
          data-squads-player-promote="true"
          // The visible label names the act; the accessible name adds whose row it
          // is, composed here because no message carries an interpolation
          // parameter. It contains the visible label, so the two agree.
          aria-label={`${PROMOTE_TO_ADMIN_LABEL}: ${row.displayName}`}
          onClick={() => onPromote(row.membershipId)}
        >
          {PROMOTE_TO_ADMIN_LABEL}
        </button>
      )}

      {/* 12.7, 7.8: present only on an editable guest row — never on a registered
          membership, and never on a Former_Player. */}
      {guestEditable && (
        <button
          type="button"
          className="squads-player-row__action"
          data-squads-player-edit-guest="true"
          aria-label={`${EDIT_GUEST_LABEL}: ${row.displayName}`}
          onClick={() => onEditGuest(row.membershipId)}
        >
          {EDIT_GUEST_LABEL}
        </button>
      )}
    </div>
  );
}

export default PlayerRow;
