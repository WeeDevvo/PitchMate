/**
 * The Squads_Home's "Scheduled for deletion" list: the squads the caller owns
 * that are deleted but still inside their grace period, each with the date it
 * will be removed for good and a Restore control.
 *
 * - **Only an owner ever sees it.** The read is owner-scoped on the backend, so
 *   for anyone else it is empty, and an empty list renders nothing at all, so a
 *   member never learns a squad they were in was deleted.
 * - **A failed read says so.** It shows the generic failure with a retry rather
 *   than vanishing, because a silent failure here would hide an owner's only
 *   way back to their squad.
 * - **Restoring returns the squad to the list above.** On success both lists are
 *   read again, so the squad leaves this list and reappears among the squads.
 */

import { useCallback, useId, type ReactElement } from 'react';

import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { FailureNotice } from './FailureNotice';
import { formatInviteInstant, inviteInstantAttribute } from '../lib/inviteInstant';
import {
  GENERIC_SQUADS_FAILURE,
  PENDING_DELETION_HEADING,
  PENDING_DELETION_PURGE_LABEL,
  RESTORE_SQUAD_LABEL,
  RESTORE_SQUAD_SUCCEEDED,
  SQUADS_RETRY_LABEL,
} from '../lib/messages';
import { RESTORE_CALL, useMembershipAction } from '../state/useMembershipAction';
import { usePendingDeletion } from '../state/usePendingDeletion';

import '../styles/squadsTokens.css';
import './PlayerRow.css';
import './PendingDeletionList.css';

export const PENDING_DELETION_SELECTOR = '[data-squads-pending-deletion="true"]';

export interface PendingDeletionListProps {
  readonly api: SquadsApi;
  readonly authState: AuthState;
  /** Called after a squad is restored, so the squads list can be read again. */
  readonly onRestored: () => void;
}

export function PendingDeletionList({
  api,
  authState,
  onRestored,
}: PendingDeletionListProps): ReactElement | null {
  const headingId = useId();
  const pending = usePendingDeletion(api, authState);
  const { reload } = pending;

  const onSucceeded = useCallback((): void => {
    reload();
    onRestored();
  }, [onRestored, reload]);

  // Restoring runs from the home screen, where there is no current squad; the
  // target is the squad being restored.
  const restore = useMembershipAction({
    api,
    squadId: '',
    perform: RESTORE_CALL,
    onSucceeded,
    authState,
  });

  const outcome = restore.outcome?.kind ?? null;
  const status = (
    <p role="status" aria-live="polite" aria-atomic="true" data-squads-restore-outcome="true">
      {outcome === 'succeeded'
        ? RESTORE_SQUAD_SUCCEEDED
        : outcome === null
          ? ''
          : GENERIC_SQUADS_FAILURE}
    </p>
  );

  if (pending.failed && pending.squads === null) {
    return (
      <section
        className="squads-pending-deletion"
        data-squads-pending-deletion="true"
        aria-labelledby={headingId}
      >
        <h2 className="squads-pending-deletion__heading" id={headingId}>
          {PENDING_DELETION_HEADING}
        </h2>
        <FailureNotice retryLabel={SQUADS_RETRY_LABEL} onRetry={reload} />
      </section>
    );
  }

  if (pending.squads === null || pending.squads.length === 0) {
    // Keep the outcome of a restore that just emptied the list announced.
    return outcome === 'succeeded' ? status : null;
  }

  return (
    <section
      className="squads-pending-deletion"
      data-squads-pending-deletion="true"
      aria-labelledby={headingId}
    >
      <h2 className="squads-pending-deletion__heading" id={headingId}>
        {PENDING_DELETION_HEADING}
      </h2>
      <ul className="squads-pending-deletion__list">
        {pending.squads.map((squad) => {
          const busy = restore.isPending(squad.squadId);
          return (
            <li key={squad.squadId} className="squads-pending-deletion__entry">
              <span className="squads-pending-deletion__name">{squad.name}</span>
              <span className="squads-pending-deletion__purge">
                {PENDING_DELETION_PURGE_LABEL}{' '}
                <time dateTime={inviteInstantAttribute(squad.purgeAtMs)}>
                  {formatInviteInstant(squad.purgeAtMs)}
                </time>
              </span>
              <button
                type="button"
                className="squads-player-row__action"
                data-squads-restore={squad.squadId}
                aria-label={`${RESTORE_SQUAD_LABEL} ${squad.name}`}
                aria-disabled={busy ? true : undefined}
                aria-busy={busy ? true : undefined}
                onClick={() => restore.run(squad.squadId)}
              >
                {RESTORE_SQUAD_LABEL}
              </button>
            </li>
          );
        })}
      </ul>
      {status}
    </section>
  );
}

export default PendingDeletionList;
