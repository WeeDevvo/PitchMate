/**
 * The caller's own way out of a squad, rendered in the Squad_Detail region.
 *
 * Which of three things it renders is `leaveEligibility`'s answer, never a
 * condition of its own:
 *
 * - `can-leave`: a "Leave squad" control behind {@link ConfirmDialog}. The
 *   confirmation says the rating, stats and history are kept and come back on
 *   re-joining. On success the machine's `onSucceeded` navigates to the
 *   Squads_Home, so this component announces only a refusal or a failure.
 * - `owner-must-transfer`: a statement telling the owner to transfer ownership
 *   first, because the product rule forbids the owner leaving.
 * - `none`: nothing, for a caller whose standing is unknown or inactive.
 *
 * The backend stays authoritative: an `OwnerConstraint` refusal arrives as a
 * `conflict` outcome and reads {@link LEAVE_CONFLICT}.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';

import { ConfirmDialog } from './ConfirmDialog';
import { leaveEligibility } from '../lib/membershipActions';
import {
  GENERIC_SQUADS_FAILURE,
  LEAVE_CONFIRM_HEADING,
  LEAVE_CONFIRM_STATEMENT,
  LEAVE_CONFLICT,
  LEAVE_SQUAD_LABEL,
  OWNER_MUST_TRANSFER_BEFORE_LEAVING,
} from '../lib/messages';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import type { MembershipActionMachine } from '../state/useMembershipAction';

import '../styles/squadsTokens.css';
import './PlayerRow.css';

/** The selector of the leave trigger. */
export const LEAVE_SQUAD_TRIGGER_SELECTOR = '[data-squads-leave="true"]';

/** The selector of the owner's "transfer first" statement. */
export const OWNER_MUST_TRANSFER_SELECTOR = '[data-squads-owner-must-transfer="true"]';

export interface LeaveSquadControlProps {
  /** The squad being left; the machine's target key. */
  readonly squadId: string;
  /** The caller's Member_Role, or `null` when not identified. */
  readonly callerRole: SquadRole | null;
  /** The caller's Membership_State, or `null` when not identified. */
  readonly callerState: MembershipState | null;
  /** The leave machine, whose success navigates to the Squads_Home. */
  readonly machine: MembershipActionMachine;
}

/** Render the caller's leave control, the owner's statement, or nothing. */
export function LeaveSquadControl({
  squadId,
  callerRole,
  callerState,
  machine,
}: LeaveSquadControlProps): ReactElement | null {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const eligibility = leaveEligibility(callerRole, callerState);
  const pending = machine.isPending(squadId);
  const outcome =
    machine.outcome !== null && machine.outcome.targetId === squadId
      ? machine.outcome.kind
      : null;

  const openConfirmation = useCallback((): void => {
    if (pending) {
      return;
    }
    setConfirming(true);
  }, [pending]);

  const confirm = useCallback((): void => {
    machine.run(squadId);
    setConfirming(false);
  }, [machine, squadId]);

  const close = useCallback((): void => {
    setConfirming(false);
  }, []);

  if (eligibility === 'none') {
    return null;
  }

  if (eligibility === 'owner-must-transfer') {
    return (
      <p className="squad-screen__leave-note" data-squads-owner-must-transfer="true">
        {OWNER_MUST_TRANSFER_BEFORE_LEAVING}
      </p>
    );
  }

  return (
    <div className="squad-screen__leave">
      <button
        type="button"
        ref={triggerRef}
        className="squads-player-row__action"
        data-squads-leave="true"
        aria-disabled={pending ? true : undefined}
        aria-busy={pending ? true : undefined}
        data-pending={pending ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-expanded={confirming}
        onClick={openConfirmation}
      >
        {LEAVE_SQUAD_LABEL}
      </button>

      <ConfirmDialog
        open={confirming}
        openerRef={triggerRef}
        heading={LEAVE_CONFIRM_HEADING}
        headingLevel={3}
        confirmLabel={LEAVE_SQUAD_LABEL}
        pending={pending}
        onConfirm={confirm}
        onClose={close}
      >
        <p>{LEAVE_CONFIRM_STATEMENT}</p>
      </ConfirmDialog>

      <p
        className="squad-screen__leave-outcome"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-squads-leave-outcome="true"
      >
        {outcome === 'conflict'
          ? LEAVE_CONFLICT
          : outcome === 'failed'
            ? GENERIC_SQUADS_FAILURE
            : ''}
      </p>
    </div>
  );
}

export default LeaveSquadControl;
