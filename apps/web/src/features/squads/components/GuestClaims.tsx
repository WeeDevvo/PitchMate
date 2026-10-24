/**
 * The admins' "Link a guest to a player" list, inside Administration's Guests
 * subsection: each guest with where its claim stands and the one thing to do
 * next (ADR 0003).
 *
 * - **Create a link**, or a new one replacing the old: the link is revealed once
 *   under the list, to copy and send to the player.
 * - **Complete** a claim a player has accepted, behind a confirmation naming who
 *   accepted, so a forwarded link can't bind the wrong account unnoticed.
 * - **Undo** a completed claim, behind a confirmation.
 *
 * What each row shows is decided by `guestClaimViewFor` in `lib/`; this file
 * renders it. The claim list is read here, from the admins-only endpoint, and
 * re-read after every change; completing or undoing also refreshes the squad,
 * because the claimed membership's identity changes.
 */

import { useCallback, useId, useRef, useState, type MouseEvent, type ReactElement } from 'react';

import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import { ClaimLinkReveal } from './ClaimLinkReveal';
import { ConfirmDialog } from './ConfirmDialog';
import { FailureNotice } from './FailureNotice';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import { guestClaimEntries, type GuestClaimView } from '../lib/guestClaimView';
import { formatInviteInstant, inviteInstantAttribute } from '../lib/inviteInstant';
import {
  CLAIM_ACCEPTED_BY_LABEL,
  CLAIM_CLAIMED,
  CLAIM_LINK_EXPIRED,
  CLAIM_LINK_SENT_LABEL,
  CLAIMS_HEADING,
  CLAIMS_NO_GUESTS,
  CLAIMS_STATEMENT,
  COMPLETE_CLAIM_CONFIRM_HEADING,
  COMPLETE_CLAIM_CONFIRM_STATEMENT,
  COMPLETE_CLAIM_LABEL,
  COMPLETE_CLAIM_SUCCEEDED,
  CREATE_CLAIM_LINK_LABEL,
  GENERIC_SQUADS_FAILURE,
  NEW_CLAIM_LINK_LABEL,
  SQUADS_RETRY_LABEL,
  UNDO_CLAIM_CONFIRM_HEADING,
  UNDO_CLAIM_CONFIRM_STATEMENT,
  UNDO_CLAIM_LABEL,
  UNDO_CLAIM_SUCCEEDED,
} from '../lib/messages';
import type { PlayerListRow } from '../lib/playerList';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { useGuestClaims } from '../state/useGuestClaims';
import {
  COMPLETE_CLAIM_CALL,
  REVERSE_CLAIM_CALL,
  useMembershipAction,
} from '../state/useMembershipAction';

import '../styles/squadsTokens.css';
import './PlayerRow.css';
import './GuestClaims.css';

export const GUEST_CLAIMS_SELECTOR = '[data-squads-guest-claims="true"]';

export interface GuestClaimsProps {
  readonly squadId: string;
  readonly api: SquadsApi;
  readonly rows: readonly PlayerListRow[];
  readonly viewerRole: SquadRole | null;
  readonly viewerState: MembershipState | null;
  /** Re-read the squad, after a claim completes or is undone. */
  readonly onSquadChanged: () => void;
  readonly authState?: AuthState;
}

/** The list sits under Administration's Guests `h3`; its reveal and confirmations sit one below. */
const LIST_HEADING_LEVEL = 4;
const CHILD_HEADING_LEVEL: SurfaceHeadingLevel = 5;

/** A confirmation in progress: which action, for which membership. */
interface Confirming {
  readonly action: 'complete' | 'undo';
  readonly membershipId: string;
  readonly playerName: string;
}

/** The status text for a view, without its action. */
function StatusText({ view }: { readonly view: GuestClaimView }): ReactElement | null {
  switch (view.kind) {
    case 'link-issued':
      return (
        <span className="squads-guest-claims__status">
          {CLAIM_LINK_SENT_LABEL}{' '}
          {view.expiresAtMs === null ? null : (
            <time dateTime={inviteInstantAttribute(view.expiresAtMs)}>
              {formatInviteInstant(view.expiresAtMs)}
            </time>
          )}
        </span>
      );
    case 'link-expired':
      return <span className="squads-guest-claims__status">{CLAIM_LINK_EXPIRED}</span>;
    case 'accepted':
      return (
        <span className="squads-guest-claims__status">
          {CLAIM_ACCEPTED_BY_LABEL} <strong>{view.acceptedByName ?? ''}</strong>
        </span>
      );
    case 'claimed':
      return <span className="squads-guest-claims__status">{CLAIM_CLAIMED}</span>;
    default:
      return null;
  }
}

/**
 * The list, for a viewer the gate has already found to be an admin. Split out so
 * no hook runs, and so no claim list is read, for anyone else.
 */
function GuestClaimsBody({
  squadId,
  api,
  rows,
  onSquadChanged,
  authState = 'authenticated',
}: Omit<GuestClaimsProps, 'viewerRole' | 'viewerState'>): ReactElement {
  const headingId = useId();
  const Heading = `h${LIST_HEADING_LEVEL}` as const;
  const childLevel = CHILD_HEADING_LEVEL;

  const claims = useGuestClaims({ api, squadId, authState });
  const { reload } = claims;
  const openerRef = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  // Which confirmed action ran last, so the status line reports that one and not
  // an older outcome the other machine still holds.
  const [lastAction, setLastAction] = useState<Confirming['action'] | null>(null);

  const onChanged = useCallback((): void => {
    reload();
    onSquadChanged();
  }, [onSquadChanged, reload]);

  const completion = useMembershipAction({
    api,
    squadId,
    perform: COMPLETE_CLAIM_CALL,
    onSucceeded: onChanged,
    authState,
  });

  const undoing = useMembershipAction({
    api,
    squadId,
    perform: REVERSE_CLAIM_CALL,
    onSucceeded: onChanged,
    authState,
  });

  const rememberOpener = (event: MouseEvent<HTMLButtonElement>): void => {
    openerRef.current = event.currentTarget;
  };

  const confirm = (): void => {
    if (confirming === null) {
      return;
    }
    (confirming.action === 'complete' ? completion : undoing).run(confirming.membershipId);
    setLastAction(confirming.action);
    setConfirming(null);
  };

  const entries = guestClaimEntries(rows, claims.claims ?? [], true);
  const lastOutcome =
    lastAction === 'complete' ? completion.outcome : lastAction === 'undo' ? undoing.outcome : null;
  let outcomeText = '';
  if (claims.issueFailedFor !== null) {
    outcomeText = GENERIC_SQUADS_FAILURE;
  } else if (lastOutcome !== null) {
    outcomeText =
      lastOutcome.kind !== 'succeeded'
        ? GENERIC_SQUADS_FAILURE
        : lastAction === 'complete'
          ? COMPLETE_CLAIM_SUCCEEDED
          : UNDO_CLAIM_SUCCEEDED;
  }

  let body: ReactElement;
  if (claims.failed && claims.claims === null) {
    body = <FailureNotice retryLabel={SQUADS_RETRY_LABEL} onRetry={reload} />;
  } else if (entries.length === 0) {
    body = <p className="squads-guest-claims__statement">{CLAIMS_NO_GUESTS}</p>;
  } else {
    body = (
      <ul className="squads-guest-claims__list">
        {entries.map(({ row, view }) => {
          const id = row.membershipId;
          const busy =
            claims.issuingFor === id || completion.isPending(id) || undoing.isPending(id);
          let action: ReactElement | null = null;

          if (view.kind === 'unclaimed' || view.kind === 'link-issued' || view.kind === 'link-expired') {
            action = (
              <button
                type="button"
                className="squads-player-row__action"
                data-squads-claim-issue={id}
                aria-label={`${view.kind === 'unclaimed' ? CREATE_CLAIM_LINK_LABEL : NEW_CLAIM_LINK_LABEL}, ${row.displayName}`}
                aria-disabled={busy ? true : undefined}
                aria-busy={busy ? true : undefined}
                onClick={(event) => {
                  rememberOpener(event);
                  claims.issue(id);
                }}
              >
                {view.kind === 'unclaimed' ? CREATE_CLAIM_LINK_LABEL : NEW_CLAIM_LINK_LABEL}
              </button>
            );
          } else if (view.kind === 'accepted') {
            action = (
              <button
                type="button"
                className="squads-player-row__action"
                data-squads-claim-complete={id}
                aria-label={`${COMPLETE_CLAIM_LABEL}, ${row.displayName}`}
                aria-haspopup="dialog"
                aria-disabled={busy ? true : undefined}
                aria-busy={busy ? true : undefined}
                onClick={(event) => {
                  rememberOpener(event);
                  if (!busy) {
                    setConfirming({
                      action: 'complete',
                      membershipId: id,
                      playerName: view.acceptedByName ?? row.displayName,
                    });
                  }
                }}
              >
                {COMPLETE_CLAIM_LABEL}
              </button>
            );
          } else if (view.kind === 'claimed') {
            action = (
              <button
                type="button"
                className="squads-player-row__action"
                data-squads-claim-undo={id}
                aria-label={`${UNDO_CLAIM_LABEL}, ${row.displayName}`}
                aria-haspopup="dialog"
                aria-disabled={busy ? true : undefined}
                aria-busy={busy ? true : undefined}
                onClick={(event) => {
                  rememberOpener(event);
                  if (!busy) {
                    setConfirming({ action: 'undo', membershipId: id, playerName: row.displayName });
                  }
                }}
              >
                {UNDO_CLAIM_LABEL}
              </button>
            );
          }

          return (
            <li key={id} className="squads-guest-claims__entry" data-squads-claim-row={view.kind}>
              <span className="squads-guest-claims__name">{row.displayName}</span>
              <StatusText view={view} />
              {action}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="squads-guest-claims" data-squads-guest-claims="true">
      <Heading className="squads-guest-claims__heading" id={headingId}>
        {CLAIMS_HEADING}
      </Heading>
      <p className="squads-guest-claims__statement">{CLAIMS_STATEMENT}</p>
      {body}

      {claims.revealed === null ? null : (
        <ClaimLinkReveal
          link={claims.revealed.link}
          openerRef={openerRef}
          onDismiss={claims.dismissReveal}
          headingLevel={childLevel}
        />
      )}

      {confirming === null ? null : (
        <ConfirmDialog
          open
          openerRef={openerRef}
          heading={
            confirming.action === 'complete' ? COMPLETE_CLAIM_CONFIRM_HEADING : UNDO_CLAIM_CONFIRM_HEADING
          }
          headingLevel={childLevel}
          confirmLabel={confirming.action === 'complete' ? COMPLETE_CLAIM_LABEL : UNDO_CLAIM_LABEL}
          onConfirm={confirm}
          onClose={() => setConfirming(null)}
        >
          <p>{confirming.playerName}</p>
          <p>
            {confirming.action === 'complete'
              ? COMPLETE_CLAIM_CONFIRM_STATEMENT
              : UNDO_CLAIM_CONFIRM_STATEMENT}
          </p>
        </ConfirmDialog>
      )}

      <p role="status" aria-live="polite" aria-atomic="true" data-squads-claim-outcome="true">
        {outcomeText}
      </p>
    </div>
  );
}

/** Owner and admin only: anyone else gets nothing, and no claim list is read. */
export function GuestClaims({
  viewerRole,
  viewerState,
  ...rest
}: GuestClaimsProps): ReactElement | null {
  return resolveAdminAuthority(viewerRole, viewerState) ? <GuestClaimsBody {...rest} /> : null;
}

export default GuestClaims;
