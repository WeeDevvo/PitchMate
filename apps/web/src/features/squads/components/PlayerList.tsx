/**
 * The Player_List: everyone in the squad, one Player_Row each, in the
 * Player_Order — or the statement that the squad has no players yet.
 *
 * ### A list, not a table
 *
 * The rows render as a `<ul>` of `<li>`, which is what the design settled on after
 * considering a `<table>`: a row carries a navigation control, a rating badge, and
 * up to two admin controls, which reads as a list of composed items rather than as
 * a data grid, and either structure satisfies the association requirement. The
 * list semantics also state *how many* players there are, which a set of bare divs
 * does not.
 *
 * The association Requirement 19.6 asks for is already made by {@link PlayerRow}:
 * each row is a `role="group"` named by the rendered player name inside its own
 * navigation control, so every label, badge, and control a screen reader then
 * meets inside that `<li>` belongs unambiguously to that player. This component
 * adds no second naming mechanism — an `aria-label` here would be a copy of the
 * name that could drift from the visible one. What it does add is
 * `role="list"` on the `<ul>`: `PlayerList.css` removes the markers, and WebKit
 * drops list semantics from a list styled that way, so the explicit role is what
 * keeps the rows programmatically a list of rows in every browser.
 *
 * ### The order is re-established here, not assumed
 *
 * `composePlayerList` already returns its rows in the Player_Order, so sorting
 * again changes nothing for the Squad_Screen — {@link comparePlayerRows} is the
 * same comparator, and sorting an ordered collection by it is idempotent. It is
 * done anyway because it makes the *rendered* order a function of the row set
 * alone rather than of the order a caller happened to pass, which is precisely
 * what Property 15 claims over two permutations of one input. The alternative —
 * trusting every present and future call site to have sorted first — would make
 * that property a statement about the callers rather than about this component.
 *
 * A copy is sorted, so a caller's collection is never reordered in place.
 *
 * ### An empty list is an absence, not a failure
 *
 * When the parsed Squad_Member collection is empty the list is replaced by the
 * fixed {@link NO_PLAYERS_STATEMENT} — no `role="alert"`, no live region, no
 * retry control, and no Generic_Squads_Failure, because an accepted empty
 * membership set is a normal answer (Requirement 7.12). No empty `<ul>` is
 * rendered either: a list announcing zero items beside a statement saying the same
 * thing would say it twice.
 *
 * Note which emptiness this is. A `GetSquad` result carrying no member is the only
 * way to reach this statement; a failed or not-found `GetSquad` renders no
 * Player_List at all — the FailureNotice or the Not_Found_Treatment stands in its
 * place — and a failed leaderboard leaves every row rendered with the
 * Rating_Unavailable presentation (Requirements 7.10, 7.11). Those are the
 * Squad_Screen's branches, and none of them reaches this component.
 *
 * ### It renders rows and decides nothing else
 *
 * No eligibility rule, no rating rule, and no navigation lives here: the callbacks
 * pass straight through to each row, which delegates its own decisions to the pure
 * predicates in `lib/`. This component's whole contribution is the structure and
 * the order.
 *
 * No colour value appears in this file or in `PlayerList.css`; both read the
 * feature token table (Requirement 18.9).
 *
 * Requirements: 7.4, 7.12, 19.6
 */
import { useMemo, type ReactElement } from 'react';

import { PlayerRow, type ViewerContext } from './PlayerRow';
import { NO_PLAYERS_STATEMENT } from '../lib/messages';
import { comparePlayerRows, type PlayerListRow } from '../lib/playerList';
import type { PromotionMachine } from '../state/usePromotion';

// The feature token table, so a list rendered outside the App_Shell frame still
// resolves every custom property `PlayerList.css` reads (Requirement 18.9).
import '../styles/squadsTokens.css';
import './PlayerList.css';

/**
 * The selector of the rendered list, so a test can assert the structure and the
 * row order without depending on any rendered copy.
 */
export const PLAYER_LIST_SELECTOR = '[data-squads-player-list="true"]';

/**
 * The selector of the no-players statement, so a test can assert it stands exactly
 * where the list does not (Requirement 7.12).
 */
export const PLAYER_LIST_EMPTY_SELECTOR = '[data-squads-player-list-empty="true"]';

export interface PlayerListProps {
  /** The squad these rows belong to, needed to build each Player_Stats_Route path. */
  readonly squadId: string;

  /**
   * The composed rows — one per parsed Squad_Member (Requirement 7.2). Any order
   * is accepted; the rendered order is the Player_Order regardless.
   */
  readonly rows: readonly PlayerListRow[];

  /** Who is looking, and whether they hold Admin_Authority. */
  readonly viewer: ViewerContext;

  /** Called with a row's membership identity to open that player's stats. */
  readonly onOpenPlayer: (membershipId: string) => void;

  /**
   * Called with a row's membership identity to begin promoting it. Needed only
   * where no {@link promotion} machine is supplied; see `PlayerRow`.
   */
  readonly onPromote?: (membershipId: string) => void;

  /**
   * The promotion machine, passed straight to each row so the confirming
   * `PromotionControl` composes inside the row it belongs to rather than once per
   * screen — which is what lets a confirmation return focus to the control that
   * opened it (Requirement 19.7).
   */
  readonly promotion?: PromotionMachine;

  /** Called with a row's membership identity to begin editing that guest. */
  readonly onEditGuest: (membershipId: string) => void;
}

/**
 * Render the Player_List: one Player_Row per row in the Player_Order, or the fixed
 * statement that the squad has no players yet.
 *
 * Requirements: 7.4, 7.12, 19.6
 */
export function PlayerList({
  squadId,
  rows,
  viewer,
  onOpenPlayer,
  onPromote,
  promotion,
  onEditGuest,
}: PlayerListProps): ReactElement {
  // 7.4: the rendered order is the comparator's, so it is determined by the row
  // set alone and never by the order the caller supplied. The copy keeps the
  // caller's collection untouched.
  const ordered = useMemo(() => [...rows].sort(comparePlayerRows), [rows]);

  // 7.12: an accepted empty membership set is an absence — the statement stands
  // alone, with no error indication and no empty list beside it.
  if (ordered.length === 0) {
    return (
      <p className="squads-player-list__empty" data-squads-player-list-empty="true">
        {NO_PLAYERS_STATEMENT}
      </p>
    );
  }

  return (
    <ul
      className="squads-player-list"
      // 19.6: the markers are removed by the stylesheet, so the role is stated
      // explicitly to keep the rows a list of rows in every browser.
      role="list"
      data-squads-player-list="true"
    >
      {ordered.map((row) => (
        <li className="squads-player-list__item" key={row.membershipId}>
          {/* Each row names itself as a group, so every value inside this item is
              programmatically associated with that player (Requirement 19.6). */}
          <PlayerRow
            squadId={squadId}
            row={row}
            viewer={viewer}
            onOpenPlayer={onOpenPlayer}
            onEditGuest={onEditGuest}
            {...(onPromote === undefined ? {} : { onPromote })}
            {...(promotion === undefined ? {} : { promotion })}
          />
        </li>
      ))}
    </ul>
  );
}

export default PlayerList;
