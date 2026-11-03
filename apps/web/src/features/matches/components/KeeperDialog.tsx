/**
 * Who is in goal, for either team. Picking a player logs them in goal for
 * their own team from the current minute and closes the dialog; whoever is in
 * goal now is marked as such.
 */
import type { ReactElement } from 'react';

import { Avatar, Button, Dialog } from '../../../ui';

import {
  CLOSE_LABEL,
  IN_GOAL_LABEL,
  KEEPER_DIALOG_HINT,
  KEEPER_DIALOG_TITLE,
  keeperButtonLabel,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';

export interface KeeperDialogProps {
  readonly open: boolean;
  readonly sheet: TeamSheet;
  /** Who is in goal now, by team. */
  readonly keepers: ReadonlyMap<string, string>;
  readonly onPick: (teamId: string, keeperId: string) => void;
  readonly onClose: () => void;
}

export function KeeperDialog({ open, sheet, keepers, onPick, onClose }: KeeperDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      title={KEEPER_DIALOG_TITLE}
      icon="glove"
      onClose={onClose}
      actions={
        <Button variant="ghost" onClick={onClose}>
          {CLOSE_LABEL}
        </Button>
      }
    >
      <p className="pm-dialog__body">{KEEPER_DIALOG_HINT}</p>
      {sheet.teams.map((team) => (
        <section key={team.teamId} className="matches-keeper-team" aria-labelledby={`matches-keeper-${team.teamId}`}>
          <h3 id={`matches-keeper-${team.teamId}`} className="matches-keeper-team__name">
            {team.teamName}
          </h3>
          <ul className="matches-keeper-list">
            {team.roster.map((player) => {
              const inGoal = keepers.get(team.teamId) === player.membershipId;
              return (
                <li key={player.membershipId}>
                  <button
                    type="button"
                    className="matches-keeper-option"
                    aria-label={keeperButtonLabel(player.displayName, team.teamName)}
                    aria-pressed={inGoal}
                    onClick={() => onPick(team.teamId, player.membershipId)}
                  >
                    <Avatar name={player.displayName} size={32} />
                    <span className="matches-keeper-option__name">{player.displayName}</span>
                    {inGoal ? <span className="matches-keeper-option__meta">{IN_GOAL_LABEL}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Dialog>
  );
}

export default KeeperDialog;
