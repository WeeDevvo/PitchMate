/**
 * The Admin_Section — the region of the Squad_Screen that exists only for a
 * caller holding Admin_Authority, and the outline that holds its three surfaces
 * together.
 *
 * It composes and gates; it implements nothing. The Invite_Manager, the
 * Guest_Manager, and the Feature_Toggle set each own their calls, their outcomes,
 * and their copy, and each deliberately renders **no** section heading of its own
 * — Requirement 10.7 puts one `h2` naming administration here, with one `h3` for
 * each of the three, so a heading inside a child would be a duplicate rather than
 * an outline. The panels those children open sit at level four, one below their
 * `h3`, which is why each is handed `headingLevel={4}` explicitly rather than left
 * to a default this file cannot see (Requirements 19.1, 19.2).
 *
 * The Promotion_Control is *not* here. Requirement 10.2 puts it on each eligible
 * Player_Row, so `PlayerRow` composes it and this section holds no player control
 * at all.
 *
 * ### The gate is here, and it is absence rather than disablement
 *
 * {@link resolveAdminAuthority} is asked once, from the caller's Member_Role and
 * Membership_State, and a `false` answer renders **nothing** — no wrapper, no
 * heading, no child (Requirements 10.2, 10.3). That matters beyond tidiness: no
 * `ListInvites`, `GenerateInvite`, `RevokeInvite`, `CreateGuest`, `EditGuest`, or
 * `SetFeatureFlag` call can be issued from a session that never mounts the surface
 * that issues it, so Requirement 10.4 is a structural fact rather than a set of
 * disabled controls somebody could re-enable (Requirement 10.4).
 *
 * Asking here rather than at the Squad_Screen is deliberate. The screen decides
 * *whether it has a Squad_Detail to render at all* — a `loading`, `notFound`, or
 * `failed` detail renders no admin section because it renders no section of any
 * kind (Requirement 6.9). Who may administer the squad is a different question,
 * and keeping it in the component that would otherwise issue every admin call
 * means the gate cannot be forgotten by a future caller: there is no way to mount
 * this subtree without passing the role and state that decide it.
 *
 * The rendered value is still only a presentation decision. Requirement 10.5
 * keeps the backend authoritative for every admin call, and each child renders its
 * own outcome for a rejected one without applying any change to the detail this
 * section was handed.
 *
 * ### Why the props exceed the four the design named
 *
 * The design's `AdminSectionProps` names `squadId`, `api`, `flags`, and
 * `onSquadChanged`. Three further values are threaded, and each is state that
 * already exists on the Squad_Screen and would be *duplicated* by holding it here:
 *
 * | Prop | Why it cannot be derived here |
 * | --- | --- |
 * | `rows` | the composed Player_List, from which the Guest_Manager resolves an edit target's display name and guest flag (Requirement 12.8). Re-composing it here would give the section a second list that could disagree with the one on screen. |
 * | `editingMembershipId`, `onEditingFinished`, `editOpenerRef` | the edit affordance is a Player_Row control (Requirement 12.7), so the target and the control to return focus to are the screen's to hold. |
 * | `viewerRole`, `viewerState` | the two values the gate is a function of. The screen resolves them from the parsed Squad_Detail or the `ListMySquads` summary, and an unidentified caller resolves to a pair of absences that the gate rejects (Requirement 6.10). |
 *
 * No state is held here at all: this component is a pure composition of props over
 * three children plus one derived boolean.
 *
 * No colour value appears in this file or in `AdminSection.css`; both read the
 * feature token table (Requirement 18.9).
 *
 * Requirements: 10.2, 10.3, 10.4, 10.7
 */
import { useCallback, useId, type ReactElement, type RefObject } from 'react';

import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import type { MemberRole, MembershipStateValue } from '../lib/enumCodes';
import {
  ADMIN_SECTION_HEADING,
  FEATURES_SECTION_HEADING,
  GUESTS_SECTION_HEADING,
  INVITES_SECTION_HEADING,
} from '../lib/messages';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type { PlayerListRow } from '../lib/playerList';
import type { SquadRefreshOptions } from '../state/useSquadScreen';
import { FeatureToggles } from './FeatureToggles';
import { GuestManager } from './GuestManager';
import { InviteManager } from './InviteManager';
import '../styles/squadsTokens.css';
import './AdminSection.css';

/** The selector of the Admin_Section as a whole (Requirements 10.2, 10.3). */
export const ADMIN_SECTION_SELECTOR = '[data-squads-admin-section="true"]';

/**
 * The selector of one subsection. Its value names which of the three it is, so a
 * test can find a surface without depending on its heading copy.
 */
export const ADMIN_SUBSECTION_SELECTOR = '[data-squads-admin-subsection]';

/** The attribute naming which subsection a region is. */
export const ADMIN_SUBSECTION_ATTRIBUTE = 'data-squads-admin-subsection';

/**
 * The heading level every surface a child opens sits at: one below the `h3` that
 * introduces the child, so the outline skips nothing (Requirements 19.1, 19.2).
 */
const CHILD_SURFACE_HEADING_LEVEL = 4;

export interface AdminSectionProps {
  /** The squad being administered, from the parsed Squad_Detail. */
  readonly squadId: string;

  /** The Squads_Api facade — the feature's only transport seam. */
  readonly api: SquadsApi;

  /**
   * The parsed Squad_Detail's Feature_Flag collection, which is what every
   * Feature_Toggle renders from (Requirements 14.2, 14.7).
   */
  readonly flags: readonly FeatureFlag[];

  /**
   * The post-mutation re-read — `useSquadScreen`'s `refresh`. A guest creation
   * asks for the leaderboard too; every other change wants the `GetSquad` alone,
   * and which is which is the child's statement rather than this section's
   * (Requirements 12.6, 12.10, 14.2).
   */
  readonly onSquadChanged: (options?: SquadRefreshOptions) => void;

  /**
   * The composed Player_List the screen is rendering, from which the
   * Guest_Manager reads an edit target's name and guest flag (Requirement 12.8).
   */
  readonly rows: readonly PlayerListRow[];

  /**
   * The caller's Member_Role within this squad, or `null` where the membership
   * carries none or was not identified (Requirement 6.10).
   */
  readonly viewerRole: MemberRole | null;

  /** The caller's Membership_State within this squad, or `null`. */
  readonly viewerState: MembershipStateValue | null;

  /**
   * The membership whose Player_Row edit control was activated, or `null`. Owned
   * by the screen, because the control lives on a row (Requirement 12.7).
   */
  readonly editingMembershipId?: string | null;

  /** Called when the edit form closes, so the screen clears its target. */
  readonly onEditingFinished?: () => void;

  /** The row control that opened the edit, which regains focus (Req 19.7). */
  readonly editOpenerRef?: RefObject<HTMLElement | null>;

  /**
   * The Auth_State, so an ended session discards every call in flight and no
   * surface keeps holding an outcome (Requirement 17.5).
   */
  readonly authState?: AuthState;
}

/**
 * Render the Admin_Section for a caller holding Admin_Authority, or nothing at
 * all for a caller who does not.
 *
 * Requirements: 10.2, 10.3, 10.4, 10.7
 */
export function AdminSection({
  squadId,
  api,
  flags,
  onSquadChanged,
  rows,
  viewerRole,
  viewerState,
  editingMembershipId = null,
  onEditingFinished,
  editOpenerRef,
  authState,
}: AdminSectionProps): ReactElement | null {
  const idPrefix = useId();

  /**
   * The Feature_Toggle set's re-read seam, which takes no options: a changed flag
   * arrives with the refreshed `GetSquad` body and no leaderboard is involved
   * (Requirement 14.2). Stable, so supplying it does not restart the machine.
   */
  const refreshDetail = useCallback((): void => {
    onSquadChanged();
  }, [onSquadChanged]);

  // 10.2, 10.3, 10.4: one question, asked in the one place, and a `false` answer
  // renders no subtree — so there is nothing here from which an admin call could
  // be issued.
  if (!resolveAdminAuthority(viewerRole, viewerState)) {
    return null;
  }

  const headingId = `${idPrefix}-admin`;
  const invitesHeadingId = `${idPrefix}-invites`;
  const guestsHeadingId = `${idPrefix}-guests`;
  const featuresHeadingId = `${idPrefix}-features`;

  // The Auth_State is forwarded only when the caller stated one, so each child
  // keeps its own default rather than being told `undefined` explicitly.
  const authStateProp = authState === undefined ? {} : { authState };

  return (
    <section
      className="squads-admin"
      data-squads-admin-section="true"
      aria-labelledby={headingId}
    >
      {/* 10.7: the one level-two heading naming administration, which is also the
          region's accessible name — the same words on screen and in the
          announcement. */}
      <h2 className="squads-admin__heading" id={headingId}>
        {ADMIN_SECTION_HEADING}
      </h2>

      {/* 10.7: invites, guests, and features — one `h3` each, in the order the
          requirement names them. */}
      <section
        className="squads-admin__subsection"
        data-squads-admin-subsection="invites"
        aria-labelledby={invitesHeadingId}
      >
        <h3 className="squads-admin__subheading" id={invitesHeadingId}>
          {INVITES_SECTION_HEADING}
        </h3>
        <InviteManager
          api={api}
          squadId={squadId}
          headingLevel={CHILD_SURFACE_HEADING_LEVEL}
          {...authStateProp}
        />
      </section>

      <section
        className="squads-admin__subsection"
        data-squads-admin-subsection="guests"
        aria-labelledby={guestsHeadingId}
      >
        <h3 className="squads-admin__subheading" id={guestsHeadingId}>
          {GUESTS_SECTION_HEADING}
        </h3>
        <GuestManager
          squadId={squadId}
          api={api}
          rows={rows}
          editingMembershipId={editingMembershipId}
          onSquadChanged={onSquadChanged}
          headingLevel={CHILD_SURFACE_HEADING_LEVEL}
          {...(onEditingFinished === undefined ? {} : { onEditingFinished })}
          {...(editOpenerRef === undefined ? {} : { editOpenerRef })}
          {...authStateProp}
        />
      </section>

      <section
        className="squads-admin__subsection"
        data-squads-admin-subsection="features"
        aria-labelledby={featuresHeadingId}
      >
        <h3 className="squads-admin__subheading" id={featuresHeadingId}>
          {FEATURES_SECTION_HEADING}
        </h3>
        <FeatureToggles
          squadId={squadId}
          api={api}
          flags={flags}
          onSquadChanged={refreshDetail}
          {...authStateProp}
        />
      </section>
    </section>
  );
}

export default AdminSection;
