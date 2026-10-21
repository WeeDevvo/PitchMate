/**
 * The owner's transfer-of-ownership control, rendered as a subsection of the
 * Admin_Section.
 *
 * A labelled `<select>` of the members `isOwnershipTarget` accepts, and a
 * "Transfer ownership" control that opens a {@link ConfirmDialog} naming the
 * chosen player and saying the owner becomes an admin. On success the machine
 * re-reads the squad, after which the caller is no longer the owner.
 *
 * The subsection is shown only to the owner — `resolveOwnerAuthority` decides,
 * not a condition written here — and stays rendered while a settled outcome is
 * being announced, because a successful transfer is exactly the moment the
 * caller stops being the owner. The machine lives in this component so the
 * announcement survives that re-read.
 */
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';

import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { ConfirmDialog } from './ConfirmDialog';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import { isOwnershipTarget, resolveOwnerAuthority } from '../lib/membershipActions';
import {
  GENERIC_SQUADS_FAILURE,
  OWNERSHIP_SECTION_HEADING,
  TRANSFER_OWNERSHIP_CONFIRM_HEADING,
  TRANSFER_OWNERSHIP_CONFIRM_STATEMENT,
  TRANSFER_OWNERSHIP_CONFLICT,
  TRANSFER_OWNERSHIP_LABEL,
  TRANSFER_OWNERSHIP_NO_CANDIDATES,
  TRANSFER_OWNERSHIP_PLACEHOLDER,
  TRANSFER_OWNERSHIP_SUCCEEDED,
  TRANSFER_OWNERSHIP_TARGET_LABEL,
} from '../lib/messages';
import type { PlayerListRow } from '../lib/playerList';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { TRANSFER_CALL, useMembershipAction } from '../state/useMembershipAction';

import '../styles/squadsTokens.css';
import './PlayerRow.css';
import './OwnershipTransfer.css';

/** The selector of the transfer target select. */
export const OWNERSHIP_TARGET_SELECTOR = '[data-squads-ownership-target="true"]';

/** The selector of the transfer trigger. */
export const OWNERSHIP_TRANSFER_TRIGGER_SELECTOR =
  '[data-squads-ownership-transfer="true"]';

export interface OwnershipTransferProps {
  /** The squad whose ownership is transferred. */
  readonly squadId: string;
  /** The Squads_Api facade — the feature's only transport seam. */
  readonly api: SquadsApi;
  /** The composed Player_List, from which the candidates are chosen. */
  readonly rows: readonly PlayerListRow[];
  /** The caller's Member_Role, or `null`. */
  readonly viewerRole: SquadRole | null;
  /** The caller's Membership_State, or `null`. */
  readonly viewerState: MembershipState | null;
  /** The post-transfer re-read. */
  readonly onSquadChanged: () => void;
  /** The confirmation's heading level. */
  readonly confirmHeadingLevel?: SurfaceHeadingLevel;
  /** The Auth_State, so an ended session discards a call in flight. */
  readonly authState?: AuthState;
}

/** Render the ownership subsection, or nothing for a caller who is not the owner. */
export function OwnershipTransfer({
  squadId,
  api,
  rows,
  viewerRole,
  viewerState,
  onSquadChanged,
  confirmHeadingLevel = 4,
  authState,
}: OwnershipTransferProps): ReactElement | null {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const selectId = `${idPrefix}-target`;

  const [targetId, setTargetId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const onSucceeded = useCallback((): void => {
    setTargetId('');
    onSquadChanged();
  }, [onSquadChanged]);

  const machine = useMembershipAction({
    api,
    squadId,
    perform: TRANSFER_CALL,
    onSucceeded,
    ...(authState === undefined ? {} : { authState }),
  });

  const isOwner = resolveOwnerAuthority(viewerRole, viewerState);
  const candidates = useMemo(
    () =>
      rows
        .filter((row) => isOwnershipTarget(row, null, isOwner))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [isOwner, rows],
  );
  const target = candidates.find((row) => row.membershipId === targetId) ?? null;
  const pending = machine.pending.length > 0;
  const outcome = machine.outcome?.kind ?? null;

  const handleSelect = useCallback((event: ChangeEvent<HTMLSelectElement>): void => {
    setTargetId(event.target.value);
  }, []);

  const openConfirmation = useCallback((): void => {
    if (pending || target === null) {
      return;
    }
    setConfirming(true);
  }, [pending, target]);

  const confirm = useCallback((): void => {
    if (target !== null) {
      machine.run(target.membershipId);
    }
    setConfirming(false);
  }, [machine, target]);

  const close = useCallback((): void => {
    setConfirming(false);
  }, []);

  if (!isOwner && outcome === null) {
    return null;
  }

  return (
    <section
      className="squads-admin__subsection"
      data-squads-admin-subsection="ownership"
      aria-labelledby={headingId}
    >
      <h3 className="squads-admin__subheading" id={headingId}>
        {OWNERSHIP_SECTION_HEADING}
      </h3>

      {isOwner && candidates.length === 0 && (
        <p data-squads-ownership-empty="true">{TRANSFER_OWNERSHIP_NO_CANDIDATES}</p>
      )}

      {isOwner && candidates.length > 0 && (
        <div className="squads-ownership__field">
          <div className="squads-ownership__control">
            <label htmlFor={selectId}>{TRANSFER_OWNERSHIP_TARGET_LABEL}</label>
            <select
            id={selectId}
            className="squads-ownership__select"
            value={target === null ? '' : target.membershipId}
            data-squads-ownership-target="true"
            onChange={handleSelect}
          >
            <option value="">{TRANSFER_OWNERSHIP_PLACEHOLDER}</option>
            {candidates.map((row) => (
              <option key={row.membershipId} value={row.membershipId}>
                {row.displayName}
              </option>
            ))}
          </select>
          </div>
          <button
            type="button"
            ref={triggerRef}
            className="squads-player-row__action"
            data-squads-ownership-transfer="true"
            aria-disabled={pending || target === null ? true : undefined}
            aria-busy={pending ? true : undefined}
            data-pending={pending ? 'true' : 'false'}
            aria-haspopup="dialog"
            aria-expanded={confirming}
            onClick={openConfirmation}
          >
            {TRANSFER_OWNERSHIP_LABEL}
          </button>
        </div>
      )}

      {target !== null && (
        <ConfirmDialog
          open={confirming}
          openerRef={triggerRef}
          heading={TRANSFER_OWNERSHIP_CONFIRM_HEADING}
          headingLevel={confirmHeadingLevel}
          confirmLabel={TRANSFER_OWNERSHIP_LABEL}
          pending={pending}
          onConfirm={confirm}
          onClose={close}
        >
          <p>{target.displayName}</p>
          <p>{TRANSFER_OWNERSHIP_CONFIRM_STATEMENT}</p>
        </ConfirmDialog>
      )}

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-squads-ownership-outcome="true"
      >
        {outcome === null
          ? ''
          : outcome === 'succeeded'
            ? TRANSFER_OWNERSHIP_SUCCEEDED
            : outcome === 'conflict'
              ? TRANSFER_OWNERSHIP_CONFLICT
              : GENERIC_SQUADS_FAILURE}
      </p>
    </section>
  );
}

export default OwnershipTransfer;
