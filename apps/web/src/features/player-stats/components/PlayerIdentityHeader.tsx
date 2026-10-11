/**
 * The Player_Stats_Screen's identity header — who the screen is about, what kind
 * of membership they are, and the scope of every figure below it.
 *
 * It is the one part of the loaded screen that is **not** a `StatSection`,
 * because it carries the screen's single level-one heading (Requirements 5.1,
 * 16.1) and every section heading is a level two. The ten sections below it
 * describe the subject; this says who the subject is.
 *
 * ### The name is rendered, never rewritten
 *
 * Requirement 5.1 asks for the Player_Display_Name "exactly as parsed and never
 * reformatted", so the heading renders the string it is given: no trimming, no
 * case change, no truncation, no ellipsis, and no substitution for a name made
 * entirely of whitespace or of characters a Latin font will not draw. A squad's
 * display names are unique *within that squad* and are the words the squad
 * actually uses for each other, so rewriting one would make the screen disagree
 * with the player list that opened it. Long and unusual names are handled by
 * wrapping in `PlayerIdentityHeader.css` rather than by editing the string.
 *
 * ### Three labels, in a fixed order, and each of them text
 *
 * | Condition | Label |
 * | --- | --- |
 * | a Membership_State is carried | that state's own label (5.2) |
 * | none is carried | the no-state-recorded label, and neither state name (5.3) |
 * | the Guest_Flag is set | the guest label (5.4) |
 * | the name is the Anonymised_Placeholder | the Former_Player label (5.5) |
 *
 * The membership-state label is always present — as a state or as the statement
 * that none was recorded — because an absence stated in words is the only
 * absence a reader can act on; a missing chip reads as "active" to anyone who
 * has seen an active profile. Requirement 5.3 is explicit that neither state
 * name may appear in that condition, which a single either/or expression makes
 * structural rather than a matter of remembering.
 *
 * Every label is **text** (Requirements 5.2, 16.6). The stylesheet gives the
 * guest and Former_Player labels a hue and gives all three an outline, but the
 * words carry the meaning on their own, so the header reads identically in
 * greyscale, under a forced-colours mode, and through a screen reader.
 *
 * The order is fixed — state, then guest, then Former_Player — so the header
 * does not reshuffle itself between two profiles that differ only in their
 * flags.
 *
 * ### A guest and a Former_Player get the whole screen
 *
 * Neither label gates anything. A guest is a player who lives inside one squad
 * with no account behind them, and Requirement 5.4 is explicit that a guest's
 * stats are not a reduced presentation. Erasure is anonymisation rather than
 * deletion, so a Former_Player keeps every statistic the Player_Profile carries
 * (Requirement 5.5). This component adds a label in each case and nothing else
 * changes, here or in the sections below.
 *
 * ### It renders no control at all
 *
 * Requirement 5.5 bars any control that would edit or act upon an erased
 * membership. Rather than hiding controls for one kind of profile — a branch
 * that would need re-checking every time the header grew — the header renders
 * **no** interactive element for **any** profile: no button, no link, no field,
 * no menu. Claiming a guest, renaming a membership, and promoting an admin are
 * squad-administration actions and live on the Squad_Screen, where the squad's
 * own roles are already in hand. The screen's only controls are the way back to
 * the squad, the retry, and the Pairwise_Links, and none of them is here.
 *
 * ### The squad-scope statement
 *
 * Ratings and stats are squad-scoped to the membership rather than to the
 * account, so a person who plays in three squads has three records and this
 * screen shows one of them. The statement sits in the header, immediately under
 * the name, because that is before a reader reaches a single figure
 * (Requirement 5.6).
 *
 * Every string comes from `lib/messages.ts` and the Anonymised_Placeholder
 * recognition from `lib/anonymisedName.ts`, so this component holds no copy and
 * decides no rule — it is the presentation of answers made elsewhere.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
import { type ReactElement } from 'react';

import { isAnonymisedPlaceholder } from '../lib/anonymisedName';
import {
  ACTIVE_STATE_LABEL,
  FORMER_PLAYER_LABEL,
  GUEST_LABEL,
  INACTIVE_STATE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
  SQUAD_SCOPE_STATEMENT,
} from '../lib/messages';
import { type MembershipState } from '../lib/wireEnums';
import '../styles/playerStatsTokens.css';
import './PlayerIdentityHeader.css';

/** The selector of the header, so a test can assert over its whole subtree. */
export const PLAYER_IDENTITY_HEADER_SELECTOR = '[data-player-stats-identity="true"]';

/** The selector of one identity label, so a test can read them in order. */
export const PLAYER_IDENTITY_LABEL_SELECTOR =
  '[data-player-stats-identity-label]';

/**
 * The kinds of identity label, which are also the values of the
 * `data-player-stats-identity-label` attribute — so a test can name the label it
 * means rather than matching on its copy.
 */
export type IdentityLabelKind = 'membership-state' | 'guest' | 'former-player';

/** One rendered label: its kind, and the words it carries. */
interface IdentityLabel {
  readonly kind: IdentityLabelKind;
  readonly text: string;
}

/**
 * The label for each Membership_State name.
 *
 * A total record rather than a conditional, so a member added to the backend
 * enum — which `lib/wireEnums.ts` already pins the vocabulary of — fails
 * `tsc -b` here instead of rendering nothing for the new state.
 */
const MEMBERSHIP_STATE_LABELS: Record<MembershipState, string> = {
  Active: ACTIVE_STATE_LABEL,
  Inactive: INACTIVE_STATE_LABEL,
};

export interface PlayerIdentityHeaderProps {
  /**
   * The Player_Display_Name exactly as the Response_Parser read it
   * (Requirement 5.1).
   *
   * Also the input to the Anonymised_Placeholder recognition, which is what
   * decides the Former_Player label (Requirement 5.5).
   */
  readonly displayName: string;

  /**
   * The Membership_State the Player_Profile carries, or `null` where it carries
   * none (Requirements 5.2, 5.3).
   */
  readonly state: MembershipState | null;

  /** Whether the membership is a guest — the Guest_Flag (Requirement 5.4). */
  readonly isGuest: boolean;
}

/**
 * The labels this profile renders, in their fixed order.
 *
 * Separated from the markup so the ordering and the either/or of the state label
 * are one readable expression rather than three nested conditionals in JSX.
 */
function identityLabels(
  displayName: string,
  state: MembershipState | null,
  isGuest: boolean,
): readonly IdentityLabel[] {
  const labels: IdentityLabel[] = [
    {
      kind: 'membership-state',
      // 5.2, 5.3: the state's own label, or the statement that none was
      // recorded — never both, and never a state name in the absent case.
      text:
        state === null
          ? NO_MEMBERSHIP_STATE_RECORDED_LABEL
          : MEMBERSHIP_STATE_LABELS[state],
    },
  ];

  if (isGuest) {
    // 5.4: a fact about the membership, not a lesser status.
    labels.push({ kind: 'guest', text: GUEST_LABEL });
  }

  if (isAnonymisedPlaceholder(displayName)) {
    // 5.5: the subject is presented as a Former_Player, and every statistic
    // below stays rendered.
    labels.push({ kind: 'former-player', text: FORMER_PLAYER_LABEL });
  }

  return labels;
}

/**
 * Render the identity header: the screen's single level-one heading, the
 * membership labels, and the squad-scope statement.
 *
 * A `div` rather than a `header` element on purpose. A `header` outside an
 * article, aside, main, nav, or section maps to the `banner` landmark, and this
 * component is rendered inside the App_Shell's frame — which already has one —
 * as well as in isolation by its own tests. A second banner would be a landmark
 * defect that only the assembled screen would reveal, and the header needs no
 * landmark of its own: the heading is what a person navigates to.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
export function PlayerIdentityHeader({
  displayName,
  state,
  isGuest,
}: PlayerIdentityHeaderProps): ReactElement {
  const labels = identityLabels(displayName, state, isGuest);

  return (
    <div className="player-stats-identity" data-player-stats-identity="true">
      {/* 5.1, 16.1: the screen's one level-one heading, carrying the name as
          parsed. No control sits on it or beside it (5.5). */}
      <h1 className="player-stats-identity__name">{displayName}</h1>

      {/* 5.2, 5.3, 5.4, 5.5: the membership labels, in a fixed order, each one
          text so none depends on colour being perceived. */}
      <p className="player-stats-identity__labels">
        {labels.map((label) => (
          <span
            key={label.kind}
            className={`player-stats-identity__label player-stats-identity__label--${label.kind}`}
            data-player-stats-identity-label={label.kind}
          >
            {label.text}
          </span>
        ))}
      </p>

      {/* 5.6: stated before a reader reaches a figure, so the numbers below
          cannot be read as a cross-squad total. */}
      <p className="player-stats-identity__scope">{SQUAD_SCOPE_STATEMENT}</p>
    </div>
  );
}

export default PlayerIdentityHeader;
