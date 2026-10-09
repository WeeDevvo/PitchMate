/**
 * The membership facts of one Player_Row, stated as words: the Member_Role or the
 * Guest_Flag, the Membership_State, and — for an erased membership — the
 * Former_Player label.
 *
 * ### Every fact is a word first
 *
 * Requirement 19.3 fixes that every Member_Role, Membership_State, Guest_Flag, and
 * Former_Player entry is conveyed **in text in addition to** any colour or icon.
 * So this component renders text chips and nothing else: the muted surface of an
 * inactive row and the blue of a guest label are emphasis over statements that
 * survive a greyscale rendering intact. Every string comes from `lib/messages.ts`,
 * which is also what keeps a role named on a Squad_Card and the same role named on
 * a Player_Row reading identically.
 *
 * ### The guest label replaces the role label rather than joining it
 *
 * A guest membership carries no Member_Role — the backend projects `null`, and the
 * parser keeps that absence rather than defaulting it (Requirement 16.8). So for a
 * guest the role slot renders {@link GUEST_LABEL} and **no** label naming owner,
 * admin, or member appears on that row at all, which is Requirement 7.6 exactly.
 *
 * The three cases of the role slot are total, and each is reached by a positive
 * test rather than by falling through:
 *
 * | Membership                        | Role slot renders                    |
 * | --------------------------------- | ------------------------------------ |
 * | guest, no role (the backend's shape) | `Guest`                           |
 * | any membership carrying a role    | `Owner` / `Admin` / `Member`          |
 * | no role and not a guest           | `No role recorded`                    |
 *
 * The third row is not a shape the backend produces today; it is here because the
 * parser is deliberately tolerant of an absent role on any membership, and a blank
 * space would state nothing. The fourth combination — a guest that *does* carry a
 * role — renders that role **and** a separate guest chip, so the Guest_Flag is
 * stated exactly once on every guest row however the two fields arrive
 * (Requirement 7.5).
 *
 * ### An inactive row is told apart three ways
 *
 * Requirement 7.7 asks for a text label **and** a non-colour visual cue. An
 * inactive membership therefore gets the `Inactive` word, a leading dash glyph,
 * and the muted row surface the row's own stylesheet paints — the same
 * word-plus-glyph-plus-surface arrangement the brand's win/loss/draw cues use, so
 * the state is perceivable with every hue removed. The glyph is `aria-hidden`
 * because the word beside it already says everything the glyph signals, and a
 * screen reader announcing a bare en dash would add noise rather than meaning.
 *
 * A Membership_State is always present on a parsed Squad_Member, so unlike the
 * Squad_Card there is no "no membership state recorded" case to render here.
 *
 * Requirements: 7.5, 7.6, 7.7, 7.8, 19.3
 */
import { type ReactElement } from 'react';

import type { MembershipState, SquadRole } from '../lib/wireEnums';
import {
  ACTIVE_STATE_LABEL,
  ADMIN_ROLE_LABEL,
  FORMER_PLAYER_LABEL,
  GUEST_LABEL,
  INACTIVE_STATE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
} from '../lib/messages';

// The feature token table, so labels rendered outside the App_Shell frame still
// resolve every custom property `MembershipLabels.css` reads. No colour value is
// written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './MembershipLabels.css';

/**
 * The selector of one membership label, so a test can read a row's stated facts
 * without depending on the wording of any single label.
 */
export const MEMBERSHIP_LABEL_SELECTOR = '[data-squads-membership-label]';

/**
 * The attribute naming which fact a label states — `role`, `guest`, `state`, or
 * `former-player` — so a test can assert "the guest label is rendered in place of
 * a role label" structurally rather than by matching copy.
 */
export const MEMBERSHIP_LABEL_KIND_ATTRIBUTE = 'data-squads-membership-label';

/**
 * The selector of the leading dash glyph an inactive row carries — the non-colour
 * visual cue of Requirement 7.7.
 */
export const INACTIVE_GLYPH_SELECTOR = '[data-squads-inactive-glyph="true"]';

/**
 * The glyph an inactive row leads with: an en dash, the same "–" the brand's draw
 * cue uses for a neutral, unresolved state.
 *
 * It is a decorative fragment rather than a statement, so it lives here rather
 * than in `lib/messages.ts` — and it is `aria-hidden` wherever it is rendered,
 * because the `Inactive` word carries the fact.
 */
const INACTIVE_GLYPH = '\u2013';

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

/** Which fact a rendered label states. */
type LabelKind = 'role' | 'guest' | 'state' | 'former-player';

/** One rendered label: the fact it states and the words it states it in. */
interface MembershipLabel {
  readonly kind: LabelKind;
  readonly text: string;
}

/**
 * The role slot of a row: the guest label for the backend's guest shape, the
 * role's own word where a role was carried, or the recorded absence of one
 * (Requirements 7.5, 7.6).
 */
function roleSlotLabelOf(role: SquadRole | null, isGuest: boolean): MembershipLabel {
  // 7.6: a guest carries no role, and the guest label takes the role slot — so no
  // label naming owner, admin, or member is rendered for it.
  if (role === null && isGuest) {
    return { kind: 'guest', text: GUEST_LABEL };
  }

  if (role === null) {
    return { kind: 'role', text: NO_ROLE_RECORDED_LABEL };
  }

  return { kind: 'role', text: ROLE_LABELS[role] };
}

export interface MembershipLabelsProps {
  /** The Member_Role, or `null` for a guest membership (Requirement 16.8). */
  readonly role: SquadRole | null;

  /** The Membership_State; always carried by a parsed Squad_Member. */
  readonly state: MembershipState;

  /** Whether this membership is a guest — no account, no `AuthIdentity`. */
  readonly isGuest: boolean;

  /**
   * Whether this row is a Former_Player, as derived once during Player_List
   * composition (Requirement 7.8).
   */
  readonly isFormerPlayer: boolean;
}

/**
 * Render one Player_Row's membership facts: the role or guest label, the state
 * label, the guest label where a role was also carried, and the Former_Player
 * label for an erased membership — plus the leading dash glyph of an inactive row.
 *
 * Requirements: 7.5, 7.6, 7.7, 7.8, 19.3
 */
export function MembershipLabels({
  role,
  state,
  isGuest,
  isFormerPlayer,
}: MembershipLabelsProps): ReactElement {
  const roleSlot = roleSlotLabelOf(role, isGuest);

  const labels: readonly MembershipLabel[] = [
    roleSlot,
    // 7.5: the Membership_State, always in words.
    { kind: 'state', text: STATE_LABELS[state] },
    // 7.5: a guest whose row also carried a role still states the Guest_Flag —
    // exactly once, because the role slot did not take it.
    ...(isGuest && roleSlot.kind !== 'guest'
      ? [{ kind: 'guest' as const, text: GUEST_LABEL }]
      : []),
    // 7.8: an erased membership names itself as a former player.
    ...(isFormerPlayer
      ? [{ kind: 'former-player' as const, text: FORMER_PLAYER_LABEL }]
      : []),
  ];

  return (
    <span className="squads-membership-labels" data-squads-membership-labels="true">
      {/* 7.7, 19.3: the non-colour cue of an inactive row, decorative to
          assistive technology because the `Inactive` label states the fact. */}
      {state === 'Inactive' && (
        <span
          className="squads-membership-labels__glyph"
          data-squads-inactive-glyph="true"
          aria-hidden="true"
        >
          {INACTIVE_GLYPH}
        </span>
      )}
      {labels.map((label) => (
        <span
          key={label.kind}
          className="squads-membership-labels__label"
          data-squads-membership-label={label.kind}
        >
          {label.text}
        </span>
      ))}
    </span>
  );
}

export default MembershipLabels;
