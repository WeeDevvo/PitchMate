/**
 * The owner's "Delete squad" area in Administration: download an export first,
 * then delete behind a confirmation that only works once the squad's name has
 * been typed.
 *
 * - **Owner only.** The component asks `resolveOwnerAuthority` itself and renders
 *   nothing for an admin, like the ownership transfer beside it.
 * - **Export is offered, not forced.** It's the first control and the statement
 *   says why, but deleting doesn't wait on it.
 * - **Deleting leaves the screen.** A deleted squad is hidden from every read,
 *   including this screen's own, so success goes to the Squads_Home, where the
 *   squad is listed under "Scheduled for deletion" with its purge date and a
 *   Restore control.
 * - **The grace period is the backend's default.** This client never sends one,
 *   so the statement and the backend can't disagree about how long there is.
 */

import { useCallback, useId, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { TextField } from '../../../ui';
import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { ConfirmDialog } from './ConfirmDialog';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import { confirmsSquadName } from '../lib/deletionConfirmation';
import { resolveOwnerAuthority } from '../lib/membershipActions';
import {
  DELETE_CONFIRM_HEADING,
  DELETE_CONFIRM_NAME_HINT,
  DELETE_CONFIRM_NAME_LABEL,
  DELETE_SECTION_HEADING,
  DELETE_SECTION_STATEMENT,
  DELETE_SQUAD_LABEL,
  EXPORT_SQUAD_LABEL,
  EXPORT_SQUAD_STATEMENT,
  EXPORT_SQUAD_SUCCEEDED,
  GENERIC_SQUADS_FAILURE,
} from '../lib/messages';
import type { SquadExportFile } from '../lib/parse/squadExport';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { DELETE_CALL, useMembershipAction } from '../state/useMembershipAction';
import { useSquadExport } from '../state/useSquadExport';

import '../styles/squadsTokens.css';
import './PlayerRow.css';
import './DeleteSquadSection.css';

export const EXPORT_SQUAD_TRIGGER_SELECTOR = '[data-squads-export="true"]';

export const DELETE_SQUAD_TRIGGER_SELECTOR = '[data-squads-delete="true"]';

export interface DeleteSquadSectionProps {
  readonly squadId: string;
  /** The squad's name, which the owner types to confirm. */
  readonly squadName: string;
  readonly api: SquadsApi;
  readonly viewerRole: SquadRole | null;
  readonly viewerState: MembershipState | null;
  readonly confirmHeadingLevel?: SurfaceHeadingLevel;
  readonly authState?: AuthState;
}

/**
 * Hand a squad export to the browser to save as a JSON file named after the
 * squad. The object URL is released straight after the click has been taken.
 */
function saveExport(exported: SquadExportFile): void {
  const blob = new Blob([JSON.stringify(exported.body, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = exported.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  link.href = url;
  link.download = `${safeName === '' ? 'squad' : safeName}-export.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DeleteSquadSection({
  squadId,
  squadName,
  api,
  viewerRole,
  viewerState,
  confirmHeadingLevel = 4,
  authState,
}: DeleteSquadSectionProps): ReactElement | null {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const navigate = useNavigate();

  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const authStateOption = authState === undefined ? {} : { authState };

  const exporter = useSquadExport({ api, squadId, onReady: saveExport, ...authStateOption });

  const onDeleted = useCallback((): void => {
    navigate(HOME_ROUTE);
  }, [navigate]);

  const deletion = useMembershipAction({
    api,
    squadId,
    perform: DELETE_CALL,
    onSucceeded: onDeleted,
    ...authStateOption,
  });

  const pending = deletion.isPending(squadId);
  const deletionFailed = deletion.outcome !== null && deletion.outcome.kind !== 'succeeded';
  const nameMatches = confirmsSquadName(typedName, squadName);

  const openConfirmation = useCallback((): void => {
    if (pending) {
      return;
    }
    setTypedName('');
    setConfirming(true);
  }, [pending]);

  const confirm = useCallback((): void => {
    if (!nameMatches) {
      return;
    }
    deletion.run(squadId);
    setConfirming(false);
  }, [deletion, nameMatches, squadId]);

  const close = useCallback((): void => {
    setConfirming(false);
  }, []);

  if (!resolveOwnerAuthority(viewerRole, viewerState)) {
    return null;
  }

  const exportPending = exporter.phase === 'pending';

  return (
    <section
      className="squads-admin__subsection squads-delete"
      data-squads-admin-subsection="delete"
      aria-labelledby={headingId}
    >
      <h3 className="squads-admin__subheading" id={headingId}>
        {DELETE_SECTION_HEADING}
      </h3>
      <p className="squads-delete__statement">{DELETE_SECTION_STATEMENT}</p>

      <div className="squads-delete__step">
        <p className="squads-delete__statement">{EXPORT_SQUAD_STATEMENT}</p>
        <button
          type="button"
          className="squads-player-row__action"
          data-squads-export="true"
          aria-disabled={exportPending ? true : undefined}
          aria-busy={exportPending ? true : undefined}
          onClick={exporter.run}
        >
          {EXPORT_SQUAD_LABEL}
        </button>
        <p role="status" aria-live="polite" aria-atomic="true" data-squads-export-outcome="true">
          {exporter.phase === 'saved'
            ? EXPORT_SQUAD_SUCCEEDED
            : exporter.phase === 'failed'
              ? GENERIC_SQUADS_FAILURE
              : ''}
        </p>
      </div>

      <div className="squads-delete__step">
        <button
          type="button"
          ref={triggerRef}
          className="squads-player-row__action"
          data-squads-delete="true"
          aria-disabled={pending ? true : undefined}
          aria-busy={pending ? true : undefined}
          aria-haspopup="dialog"
          aria-expanded={confirming}
          onClick={openConfirmation}
        >
          {DELETE_SQUAD_LABEL}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        openerRef={triggerRef}
        heading={DELETE_CONFIRM_HEADING}
        headingLevel={confirmHeadingLevel}
        confirmLabel={DELETE_SQUAD_LABEL}
        pending={pending}
        confirmBlocked={!nameMatches}
        onConfirm={confirm}
        onClose={close}
      >
        <p>{squadName}</p>
        <p>{DELETE_SECTION_STATEMENT}</p>
        <TextField
          label={DELETE_CONFIRM_NAME_LABEL}
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          name="confirmSquadName"
          autoComplete="off"
          data-squads-delete-name="true"
        />
        {nameMatches ? null : <p className="squads-delete__hint">{DELETE_CONFIRM_NAME_HINT}</p>}
      </ConfirmDialog>

      <p role="status" aria-live="polite" aria-atomic="true" data-squads-delete-outcome="true">
        {deletionFailed ? GENERIC_SQUADS_FAILURE : ''}
      </p>
    </section>
  );
}

export default DeleteSquadSection;
