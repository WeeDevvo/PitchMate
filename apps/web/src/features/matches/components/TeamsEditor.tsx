/**
 * The organiser's teams editor: roll balanced teams, move players between them,
 * rename them, choose who wears bibs, and lock.
 *
 * Every change is sent at once and the working teams are re-read, so the
 * predicted result beside them is always the engine's view of the split on
 * screen. Moving is a button per destination team rather than a drag, so it
 * works from the keyboard and with a screen reader.
 */
import { useCallback, useId, useState, type FormEvent, type ReactElement } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, MatchesApi } from '../api/matchesApi';
import { formatProbability, lockProblems, predictionLines, TEAM_NAME_MAX_LENGTH } from '../lib/teams';
import {
  DRAW_LABEL,
  GENERIC_MATCHES_FAILURE,
  LOCK_HINT,
  LOCK_TEAMS_LABEL,
  LOCKING_LABEL,
  NO_PREDICTION_STATEMENT,
  NO_TEAMS_STATEMENT,
  PREDICTION_HEADING,
  REJECTION_MESSAGES,
  RELOCK_TEAMS_LABEL,
  REROLL_TEAMS_LABEL,
  ROLL_HINT,
  ROLL_TEAMS_LABEL,
  ROLLING_LABEL,
  SAVE_TEAM_NAME_LABEL,
  TEAM_NAME_HINT,
  TEAMS_HEADING,
  TEAMS_LOADING_LABEL,
  TEAMS_LOCKED_STATEMENT,
  UNASSIGNED_HEADING,
  lockProblemMessage,
  moveToLabel,
  teamHeading,
  teamNameLabel,
  wearsBibsLabel,
} from '../lib/messages';
import type { Participant } from '../lib/parse/matchDetail';
import type { WorkingTeam, WorkingTeams } from '../lib/parse/teams';
import { useAction, type ActionOutcome } from '../state/useAction';
import { useRemote } from '../state/useRemote';
import { FailureNotice, LoadingNotice } from './StatusNotices';

export interface TeamsEditorProps {
  readonly api: MatchesApi;
  readonly matchId: string;
  readonly participants: readonly Participant[];
  /** True once the match is locked (`TeamsRolled`), for the wording of Lock. */
  readonly locked: boolean;
  readonly authState: AuthState;
  /** Called after a lock settles, so the screen can re-read the match. */
  readonly onLocked: () => void;
}

type Write = 'roll' | 'lock' | 'edit';

function failureMessage(outcome: ActionOutcome<void> | null): string | null {
  if (outcome === null || outcome.kind === 'success') return null;
  return outcome.kind === 'rejected' ? REJECTION_MESSAGES[outcome.reason] : GENERIC_MATCHES_FAILURE;
}

function TeamNameForm({
  team,
  busy,
  rename,
}: {
  readonly team: WorkingTeam;
  readonly busy: boolean;
  readonly rename: (name: string | null) => void;
}): ReactElement {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const [name, setName] = useState(team.teamName);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    rename(trimmed.length === 0 ? null : trimmed);
  };

  return (
    <form className="matches-inline-form" noValidate onSubmit={handleSubmit}>
      <label htmlFor={fieldId}>{teamNameLabel(team.teamName)}</label>
      <input
        id={fieldId}
        className="matches-input"
        type="text"
        autoComplete="off"
        maxLength={TEAM_NAME_MAX_LENGTH}
        value={name}
        aria-describedby={hintId}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" className="matches-button" aria-disabled={busy ? true : undefined}>
        {SAVE_TEAM_NAME_LABEL}
      </button>
      <p id={hintId} className="matches-hint">
        {TEAM_NAME_HINT}
      </p>
    </form>
  );
}

function Prediction({ teams }: { readonly teams: WorkingTeams }): ReactElement {
  const headingId = useId();

  return (
    <section className="matches-prediction" aria-labelledby={headingId}>
      <h3 id={headingId} className="matches-minor-heading">
        {PREDICTION_HEADING}
      </h3>
      {teams.prediction === null ? (
        <p className="matches-hint">{NO_PREDICTION_STATEMENT}</p>
      ) : (
        <dl className="matches-prediction__lines">
          {predictionLines(teams.teams, teams.prediction, DRAW_LABEL).map((line) => (
            <div key={line.label} className="matches-prediction__line">
              <dt>{line.label}</dt>
              <dd>
                {line.value}
                <span
                  className="matches-prediction__bar"
                  aria-hidden="true"
                  style={{ inlineSize: formatProbability(line.share) }}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function TeamsEditor({
  api,
  matchId,
  participants,
  locked,
  authState,
  onLocked,
}: TeamsEditorProps): ReactElement {
  const headingId = useId();
  const bibName = useId();

  const teams = useRemote(
    matchId,
    useCallback((signal: AbortSignal) => api.getWorkingTeams(matchId, signal), [api, matchId]),
    authState,
  );
  const action = useAction<void>();
  const [lastWrite, setLastWrite] = useState<Write | null>(null);

  const write = async (
    kind: Write,
    invoke: (signal: AbortSignal) => Promise<CallResult<void>>,
  ): Promise<void> => {
    setLastWrite(kind);
    const outcome = await action.run(invoke);
    if (outcome === null) return;
    teams.reload();
    if (kind === 'lock' && outcome.kind === 'success') onLocked();
  };

  const names = new Map(participants.map((p) => [p.membershipId, p.displayName]));
  const failure = failureMessage(action.outcome);

  let body: ReactElement;

  if (teams.phase === 'failed') {
    body = <FailureNotice onRetry={teams.reload} />;
  } else if (teams.value === null) {
    body = <LoadingNotice label={TEAMS_LOADING_LABEL} />;
  } else if (teams.value.teams.length === 0) {
    body = (
      <>
        <p className="matches-notice">{NO_TEAMS_STATEMENT}</p>
        <p className="matches-hint">{ROLL_HINT}</p>
        <div className="matches-actions">
          <button
            type="button"
            className="matches-button matches-button--primary"
            aria-disabled={action.busy ? true : undefined}
            onClick={() => void write('roll', (signal) => api.rerollTeams(matchId, signal))}
          >
            {action.busy && lastWrite === 'roll' ? ROLLING_LABEL : ROLL_TEAMS_LABEL}
          </button>
        </div>
      </>
    );
  } else {
    const view = teams.value;
    const problems = lockProblems(view.teams, view.unassigned.length);

    body = (
      <>
        {locked ? <p className="matches-notice">{TEAMS_LOCKED_STATEMENT}</p> : null}

        <Prediction teams={view} />

        <div className="matches-teams">
            {view.teams.map((team) => {
              const others = view.teams.filter((other) => other.teamId !== team.teamId);
              const teamHeadingId = `${headingId}-${team.teamId}`;
              const bibId = `${bibName}-${team.teamId}`;

              return (
                <section key={team.teamId} className="matches-team" aria-labelledby={teamHeadingId}>
                  <h3 id={teamHeadingId} className="matches-minor-heading">
                    {teamHeading(team.teamName, team.roster.length)}
                  </h3>
                  <TeamNameForm
                    key={team.teamName}
                    team={team}
                    busy={action.busy}
                    rename={(name) =>
                      void write('edit', (signal) => api.setTeamName(matchId, team.teamId, name, signal))
                    }
                  />
                  <div className="matches-bib">
                    <input
                      id={bibId}
                      type="radio"
                      name={bibName}
                      className="matches-checkbox"
                      checked={team.bibFlag}
                      onChange={() =>
                        void write('edit', (signal) => api.setBibTeam(matchId, team.teamId, signal))
                      }
                    />
                    <label htmlFor={bibId}>{wearsBibsLabel(team.teamName)}</label>
                  </div>
                  <ul className="matches-people">
                    {team.roster.map((player) => (
                      <li key={player.membershipId} className="matches-person">
                        <span>{player.displayName}</span>
                        {others.map((other) => (
                          <button
                            key={other.teamId}
                            type="button"
                            className="matches-button"
                            aria-disabled={action.busy ? true : undefined}
                            onClick={() =>
                              void write('edit', (signal) =>
                                api.moveParticipant(matchId, player.membershipId, other.teamId, signal),
                              )
                            }
                          >
                            {moveToLabel(player.displayName, other.teamName)}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
        </div>

        {view.unassigned.length === 0 ? null : (
          <section className="matches-panel" aria-labelledby={`${headingId}-unassigned`}>
            <h3 id={`${headingId}-unassigned`} className="matches-minor-heading">
              {UNASSIGNED_HEADING}
            </h3>
            <ul className="matches-people">
              {view.unassigned.map((membershipId) => {
                const name = names.get(membershipId) ?? membershipId;
                return (
                  <li key={membershipId} className="matches-person">
                    <span>{name}</span>
                    {view.teams.map((team) => (
                      <button
                        key={team.teamId}
                        type="button"
                        className="matches-button"
                        aria-disabled={action.busy ? true : undefined}
                        onClick={() =>
                          void write('edit', (signal) =>
                            api.moveParticipant(matchId, membershipId, team.teamId, signal),
                          )
                        }
                      >
                        {moveToLabel(name, team.teamName)}
                      </button>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {problems.length === 0 ? null : (
          <ul className="matches-problems">
            {problems.map((problem) => (
              <li key={lockProblemMessage(problem)} className="matches-error">
                {lockProblemMessage(problem)}
              </li>
            ))}
          </ul>
        )}

        <p className="matches-hint">{LOCK_HINT}</p>
        <div className="matches-actions">
          <button
            type="button"
            className="matches-button"
            aria-disabled={action.busy ? true : undefined}
            onClick={() => void write('roll', (signal) => api.rerollTeams(matchId, signal))}
          >
            {action.busy && lastWrite === 'roll' ? ROLLING_LABEL : REROLL_TEAMS_LABEL}
          </button>
          <button
            type="button"
            className="matches-button matches-button--primary"
            aria-disabled={action.busy ? true : undefined}
            onClick={() => void write('lock', (signal) => api.lockTeams(matchId, signal))}
          >
            {action.busy && lastWrite === 'lock'
              ? LOCKING_LABEL
              : locked
                ? RELOCK_TEAMS_LABEL
                : LOCK_TEAMS_LABEL}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {TEAMS_HEADING}
      </h2>
      {body}
      {failure === null ? null : (
        <p className="matches-error" role="alert">
          {failure}
        </p>
      )}
      {teams.refreshing ? <LoadingNotice label={TEAMS_LOADING_LABEL} /> : null}
    </section>
  );
}

export default TeamsEditor;
