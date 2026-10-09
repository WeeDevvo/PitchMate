/**
 * One Squad_Card of the Squads_Home: a squad the signed-in person belongs to,
 * stated in text and openable from the keyboard.
 *
 * ### One `<button>`, not a clickable box
 *
 * Requirement 1.14 asks for each card to be *exactly one* control, reachable and
 * operable by keyboard, whose accessible name includes that card's Squad_Name.
 * A native `<button>` gives all of that for free: it is in the tab order, Enter
 * and Space activate it, and its accessible name is computed from its own
 * contents — which here are the squad name and the two labels. A `<div>` with an
 * `onClick` would need `role`, `tabIndex`, and hand-rolled Enter and Space
 * handling, and every one of those is a place the keyboard path could rot
 * (Requirements 1.8, 1.14, 19.4).
 *
 * Because the labels sit *inside* the control, the accessible name states the
 * name, the role, and the state together — so a person listening to the card
 * hears everything a person reading it sees, without a second `aria-label`
 * duplicating (and eventually contradicting) the visible text.
 *
 * ### Absence is a label, not a blank
 *
 * A parsed Squad_Summary may carry no Member_Role and no Membership_State: the
 * backend projects `membership?.Role` and `membership?.State`, and the parser
 * keeps that absence as `null` rather than defaulting it (16.8). So the card
 * renders {@link NO_ROLE_RECORDED_LABEL} or
 * {@link NO_MEMBERSHIP_STATE_RECORDED_LABEL} **in place of** the missing label
 * rather than beside it — no card ever names owner, admin, or member for a
 * membership whose role was not carried, and no card ever names active or
 * inactive for a state that was not carried (Requirements 1.6, 1.7). Both
 * mappings are total lookups over the named values, so a role can neither go
 * unlabelled nor pick up a label it does not own.
 *
 * Every label is a word from `lib/messages.ts` and never a colour or an icon
 * alone (Requirement 19.3).
 *
 * ### Navigation is the screen's, and the path is built once
 *
 * Activation calls `onOpen(squadId)`. The Squads_Home supplies
 * `(squadId) => navigate(squadPath(squadId))`, which is the same injected-seam
 * arrangement `useInviteRedemption` uses for its navigation: the card stays
 * assertable without a router, one history entry is added by the router's own
 * push, and no full-document reload can occur because no `href` and no
 * `location` assignment is involved (Requirement 1.8). The path itself is built
 * only by `squadPath`, so a card and a route registration cannot disagree.
 *
 * Requirements: 1.5, 1.6, 1.7, 1.8, 1.14, 19.3, 19.4
 */
import { type ReactElement } from 'react';

import type { MembershipState, SquadRole } from '../lib/wireEnums';
import type { SquadSummary } from '../lib/parse/squadSummary';
import {
  ACTIVE_STATE_LABEL,
  ADMIN_ROLE_LABEL,
  INACTIVE_STATE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
} from '../lib/messages';

// The feature token table, so a card rendered outside the App_Shell frame still
// resolves every custom property `SquadCard.css` reads. No colour value is
// written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './SquadCard.css';

/**
 * The selector of a Squad_Card, so a Squads_Home test can count the cards and
 * read their squad identities without depending on the accessible name.
 */
export const SQUAD_CARD_SELECTOR = '[data-squads-card="true"]';

/**
 * The attribute carrying a card's squad identity, so a test can assert the
 * rendered set holds one card per parsed summary and no other identity.
 */
export const SQUAD_CARD_ID_ATTRIBUTE = 'data-squad-id';

/** The label of each named Member_Role — a total lookup, so none is missable. */
const ROLE_LABELS: Readonly<Record<SquadRole, string>> = {
  Owner: OWNER_ROLE_LABEL,
  Admin: ADMIN_ROLE_LABEL,
  Member: MEMBER_ROLE_LABEL,
};

/** The label of each named Membership_State. */
const STATE_LABELS: Readonly<Record<MembershipState, string>> = {
  Active: ACTIVE_STATE_LABEL,
  Inactive: INACTIVE_STATE_LABEL,
};

/**
 * The role label of a summary: the role's own word, or the statement that no
 * role is recorded (Requirements 1.5, 1.6).
 */
function roleLabelOf(role: SquadRole | null): string {
  return role === null ? NO_ROLE_RECORDED_LABEL : ROLE_LABELS[role];
}

/**
 * The state label of a summary: the state's own word, or the statement that no
 * membership state is recorded (Requirements 1.5, 1.7).
 */
function stateLabelOf(state: MembershipState | null): string {
  return state === null
    ? NO_MEMBERSHIP_STATE_RECORDED_LABEL
    : STATE_LABELS[state];
}

export interface SquadCardProps {
  /** The parsed Squad_Summary this card represents. */
  readonly summary: SquadSummary;

  /**
   * Called with the card's squad identity when the card is activated by pointer,
   * by Enter, or by Space. The Squads_Home passes
   * `(squadId) => navigate(squadPath(squadId))` (Requirement 1.8).
   */
  readonly onOpen: (squadId: string) => void;
}

/**
 * Render one Squad_Card: the squad name, the caller's role, and the caller's
 * membership state, inside the single control that opens that squad.
 *
 * Requirements: 1.5, 1.6, 1.7, 1.8, 1.14, 19.3
 */
export function SquadCard({ summary, onOpen }: SquadCardProps): ReactElement {
  return (
    <button
      // 1.8, 1.14: one native control per card — keyboard-operable, and no
      // navigation of its own, so no full-document reload is possible here.
      type="button"
      className="squads-card"
      data-squads-card="true"
      data-squad-id={summary.squadId}
      onClick={() => onOpen(summary.squadId)}
    >
      {/* 1.14: part of the control's own accessible name. */}
      <span className="squads-card__name">{summary.name}</span>
      <span className="squads-card__labels">
        {/* 1.5, 1.6, 19.3: the role in text, or the recorded absence of one. */}
        <span className="squads-card__label">{roleLabelOf(summary.role)}</span>
        {/* 1.5, 1.7, 19.3: the state in text, or the recorded absence of one. */}
        <span className="squads-card__label">{stateLabelOf(summary.state)}</span>
      </span>
    </button>
  );
}

export default SquadCard;
