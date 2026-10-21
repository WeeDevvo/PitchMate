/**
 * A Player_Row control for one membership action — remove or demote — from the
 * affordance through the confirmation to the announcement.
 *
 * It is the {@link PromotionControl} shape, parameterised by copy and by the
 * eligibility answer the row computed from `lib/membershipActions.ts`:
 *
 *  1. **It exists exactly where it may.** The trigger and its confirmation are
 *     rendered only while `eligible` holds; the component adds no condition of
 *     its own.
 *  2. **It confirms, naming the player,** through the shared
 *     {@link ConfirmDialog}, so focus entry, focus return to this row's trigger
 *     and Escape-without-confirming are the feature's one implementation.
 *  3. **It is disabled while its own call is in flight,** read per target from
 *     the machine.
 *  4. **It announces the outcome in a live region that outlives the
 *     affordance.** A successful removal or demotion is exactly when the row
 *     stops being eligible, so the region renders whenever this membership has
 *     a settled outcome.
 *
 * It issues no call: `run` and the pending set belong to
 * `state/useMembershipAction.ts`.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';

import { ConfirmDialog } from './ConfirmDialog';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import type { MembershipActionCopy } from '../lib/membershipActionCopy';
import { GENERIC_SQUADS_FAILURE } from '../lib/messages';
import type { SquadMember } from '../lib/parse/squadDetail';
import type { MembershipActionMachine } from '../state/useMembershipAction';

import '../styles/squadsTokens.css';
import './PlayerRow.css';

/** Which action a control performs, as a stable attribute value for tests. */
export type MembershipActionKind = 'remove' | 'demote';

/** The selector of the remove trigger on a Player_Row. */
export const REMOVE_TRIGGER_SELECTOR = '[data-squads-player-action="remove"]';

/** The selector of the demote trigger on a Player_Row. */
export const DEMOTE_TRIGGER_SELECTOR = '[data-squads-player-action="demote"]';

/** The selector of a membership-action control's live region. */
export const MEMBERSHIP_ACTION_OUTCOME_SELECTOR =
  '[data-squads-membership-action-outcome]';

export interface MembershipActionControlProps {
  /** The action this control performs. */
  readonly kind: MembershipActionKind;
  /** The Squad_Member whose row this control sits on. */
  readonly member: SquadMember;
  /** The answer of this action's predicate for this row. */
  readonly eligible: boolean;
  /** The action's machine, shared by every row of the screen. */
  readonly machine: MembershipActionMachine;
  /** The action's fixed copy. */
  readonly copy: MembershipActionCopy;
  /** The confirmation's heading level; the Player_List sits under an `h2`. */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/** Render one membership-action control for one row. */
export function MembershipActionControl({
  kind,
  member,
  eligible,
  machine,
  copy,
  headingLevel = 3,
}: MembershipActionControlProps): ReactElement | null {
  const { membershipId, displayName } = member;

  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const pending = machine.isPending(membershipId);
  const outcome =
    machine.outcome !== null && machine.outcome.targetId === membershipId
      ? machine.outcome.kind
      : null;

  const openConfirmation = useCallback((): void => {
    if (pending) {
      return;
    }
    setConfirming(true);
  }, [pending]);

  const confirm = useCallback((): void => {
    // One call per confirmation, issued by the machine. The dialog closes as the
    // call goes out, returning focus to the trigger where the outcome is
    // announced.
    machine.run(membershipId);
    setConfirming(false);
  }, [machine, membershipId]);

  const close = useCallback((): void => {
    setConfirming(false);
  }, []);

  if (!eligible && outcome === null) {
    return null;
  }

  return (
    <div className="squads-membership-action" data-membership-id={membershipId}>
      {eligible && (
        <button
          type="button"
          ref={triggerRef}
          className="squads-player-row__action"
          data-squads-player-action={kind}
          // The accessible name adds whose row it is and contains the visible
          // label, so the two agree.
          aria-label={`${copy.label}: ${displayName}`}
          aria-disabled={pending ? true : undefined}
          aria-busy={pending ? true : undefined}
          data-pending={pending ? 'true' : 'false'}
          aria-haspopup="dialog"
          aria-expanded={confirming}
          onClick={openConfirmation}
        >
          {copy.label}
        </button>
      )}

      {eligible && (
        <ConfirmDialog
          open={confirming}
          openerRef={triggerRef}
          heading={copy.heading}
          headingLevel={headingLevel}
          confirmLabel={copy.label}
          pending={pending}
          onConfirm={confirm}
          onClose={close}
        >
          <p className="squads-membership-action__player">{displayName}</p>
          <p className="squads-membership-action__statement">{copy.statement}</p>
        </ConfirmDialog>
      )}

      {/* Always the same element, so a settled outcome is a content change a
          polite live region announces. */}
      <p
        className="squads-membership-action__outcome"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-squads-membership-action-outcome={kind}
      >
        {outcome === null
          ? ''
          : outcome === 'succeeded'
            ? copy.succeeded
            : outcome === 'conflict'
              ? copy.conflict
              : GENERIC_SQUADS_FAILURE}
      </p>
    </div>
  );
}

export default MembershipActionControl;
