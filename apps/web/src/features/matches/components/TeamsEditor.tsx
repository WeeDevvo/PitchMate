/**
 * The organiser's teams editor: roll balanced teams, move players between them,
 * rename them, choose who wears bibs, and lock.
 *
 * Every change is sent at once and the working teams are re-read, so the
 * predicted result above them is always the engine's view of the split on
 * screen. Moving is a button per destination team rather than a drag, so it
 * works from the keyboard and with a screen reader.
 */
import { useCallback, useId, useState, type FormEvent, type ReactElement } from 'react';

import {
  Banner,
  BibToggle,
  Button,
  Card,
  FairnessMeter,
  GuestBadge,
  IconButton,
  PlayerRow,
  TeamColumn,
  TextField,
} from '../../../ui';
import type { AuthState } from '../../auth';
import type { CallResult, MatchesApi } from '../api/matchesApi';
import { formatProbability, lockProblems, predictionLines, rollGap, TEAM_NAME_MAX_LENGTH } from '../lib/teams';
import {
  DRAW_LABEL,
  GENERIC_MATCHES_FAILURE,
  LOCK_HINT,
  LOCK_TEAMS_LABEL,
  LOCKING_LABEL,
  NAMES_AND_BIBS_HEADING,
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
  UNLOCK_HINT,
  UNLOCK_TEAMS_LABEL,
  UNLOCKING_LABEL,
  WEAR_BIBS_LABEL,
  WEARING_BIBS_LABEL,
  bibToggleLabel,
  lockProblemMessage,
  moveToLabel,
  playerCountStatement,
  rollGapStatement,
  sillyNameLabel,
  teamNameLabel,
  teamSideLabel,
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
  /** Called after a lock or an unlock succeeds, so the screen can re-read the match. */
  readonly onLocked: () => void;
}

type Write = 'roll' | 'lock' | 'unlock' | 'edit';

function failureMessage(outcome: ActionOutcome<void> | null): string | null {
  if (outcome === null || outcome.kind === 'success') return null;
  return outcome.kind === 'rejected' ? REJECTION_MESSAGES[outcome.reason] : GENERIC_MATCHES_FAILURE;
}

/** One team's card under "Names & bibs": its name, the silly-name dice and the bibs toggle. */
function TeamIdentityCard({
  team,
  side,
  busy,
  rename,
  wearBibs,
}: {
  readonly team: WorkingTeam;
  readonly side: number;
  readonly busy: boolean;
  readonly rename: (name: string | null) => void;
  readonly wearBibs: () => void;
}): ReactElement {
  const [name, setName] = useState(team.teamName);
  const sideLabel = teamSideLabel(side);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    rename(trimmed.length === 0 ? null : trimmed);
  };

  return (
    <Card as="li" className="matches-identity">
      <span className="pm-team__side">
        <span className={`pm-team__swatch pm-team__swatch--${side % 2 === 0 ? 'a' : 'b'}`} aria-hidden="true" />
        {sideLabel}
      </span>
      <form className="matches-identity__name" noValidate onSubmit={handleSubmit}>
        <TextField
          label={teamNameLabel(sideLabel)}
          hint={TEAM_NAME_HINT}
          autoComplete="off"
          maxLength={TEAM_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="matches-identity__actions">
          <IconButton
            icon="dice"
            variant="filled"
            label={sillyNameLabel(sideLabel)}
            aria-disabled={busy ? true : undefined}
            onClick={() => {
              if (!busy) rename(null);
            }}
          />
          <Button type="submit" variant="secondary" aria-disabled={busy ? true : undefined}>
            {SAVE_TEAM_NAME_LABEL}
          </Button>
        </div>
      </form>
      <BibToggle
        pressed={team.bibFlag}
        label={WEAR_BIBS_LABEL}
        pressedLabel={WEARING_BIBS_LABEL}
        aria-label={bibToggleLabel(team.teamName, team.bibFlag)}
        aria-disabled={busy ? true : undefined}
        onClick={() => {
          if (!busy && !team.bibFlag) wearBibs();
        }}
      />
    </Card>
  );
}

function Prediction({ teams }: { readonly teams: WorkingTeams }): ReactElement {
  const headingId = useId();

  return (
    <Card as="section" className="matches-prediction" aria-labelledby={headingId}>
      <h3 id={headingId} className="pm-sr">
        {PREDICTION_HEADING}
      </h3>
      {teams.prediction === null ? (
        <p className="matches-hint">{NO_PREDICTION_STATEMENT}</p>
      ) : teams.teams.length === 2 ? (
        // Two sides: the design system's fairness meter, with each side's win
        // chance either side of the draw and a verdict on how even it is.
        <FairnessMeter
          teamA={teams.teams[0].teamName}
          teamB={teams.teams[1].teamName}
          winA={teams.prediction.winProbabilities[0] ?? 0}
          winB={teams.prediction.winProbabilities[1] ?? 0}
          draw={teams.prediction.drawProbability}
          drawLabel={DRAW_LABEL}
          sizes={[teams.teams[0].roster.length, teams.teams[1].roster.length]}
        />
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
    </Card>
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
    if (action.busy) return;
    setLastWrite(kind);
    const outcome = await action.run(invoke);
    if (outcome === null) return;
    teams.reload();
    if ((kind === 'lock' || kind === 'unlock') && outcome.kind === 'success') onLocked();
  };

  const people = new Map(participants.map((p) => [p.membershipId.toLowerCase(), p]));
  const personOf = (membershipId: string) => people.get(membershipId.toLowerCase());
  const failure = failureMessage(action.outcome);
  const busy = action.busy ? true : undefined;
  const move = (membershipId: string, teamId: string): void =>
    void write('edit', (signal) => api.moveParticipant(matchId, membershipId, teamId, signal));
  const reroll = (): void => void write('roll', (signal) => api.rerollTeams(matchId, signal));
  const rollLabel = (idle: string) => (action.busy && lastWrite === 'roll' ? ROLLING_LABEL : idle);

  let body: ReactElement;

  if (teams.phase === 'failed') {
    body = <FailureNotice onRetry={teams.reload} />;
  } else if (teams.value === null) {
    body = <LoadingNotice label={TEAMS_LOADING_LABEL} />;
  } else if (teams.value.teams.length === 0) {
    // The roll is only offered once the player count is in range; until then
    // the panel says how far off it is, so the admin adds or removes players.
    const gap = rollGap(participants.length);
    body = (
      <Card className="matches-roll">
        <p className="matches-roll__title">{NO_TEAMS_STATEMENT}</p>
        <p className="matches-hint">{ROLL_HINT}</p>
        {gap === null ? (
          <div className="matches-actions">
            <Button type="button" icon="shuffle" aria-disabled={busy} onClick={reroll}>
              {rollLabel(ROLL_TEAMS_LABEL)}
            </Button>
          </div>
        ) : (
          <div data-matches-roll-gap={gap.kind}>
            <Banner tone="info" announce={false}>
              {rollGapStatement(participants.length, gap)}
            </Banner>
          </div>
        )}
      </Card>
    );
  } else {
    const view = teams.value;
    const problems = lockProblems(view.teams, view.unassigned.length);

    body = (
      <>
        {locked ? (
          <Banner tone="success" announce={false}>
            {TEAMS_LOCKED_STATEMENT}
          </Banner>
        ) : null}

        <Prediction teams={view} />

        <div className="matches-teams">
          {view.teams.map((team, index) => {
            const others = view.teams.filter((other) => other.teamId !== team.teamId);
            const teamHeadingId = `${headingId}-${team.teamId}`;

            return (
              <TeamColumn
                key={team.teamId}
                className="matches-team"
                side={index % 2 === 0 ? 'a' : 'b'}
                sideLabel={teamSideLabel(index)}
                aria-labelledby={teamHeadingId}
                bibs={team.bibFlag}
                heading={
                  <h3 id={teamHeadingId} className="matches-team__heading">
                    {team.teamName}
                  </h3>
                }
                meta={playerCountStatement(team.roster.length)}
              >
                <ul className="matches-roster">
                  {team.roster.map((player) => {
                    const guest = personOf(player.membershipId)?.isGuest ?? false;
                    return (
                      <li key={player.membershipId}>
                        <PlayerRow
                          name={player.displayName}
                          guest={guest}
                          badges={guest ? <GuestBadge /> : undefined}
                          end={others.map((other) => (
                            <IconButton
                              key={other.teamId}
                              icon="swap"
                              label={moveToLabel(player.displayName, other.teamName)}
                              aria-disabled={busy}
                              onClick={() => move(player.membershipId, other.teamId)}
                            />
                          ))}
                        />
                      </li>
                    );
                  })}
                </ul>
              </TeamColumn>
            );
          })}
        </div>

        {view.unassigned.length === 0 ? null : (
          <Card as="section" className="matches-unassigned" aria-labelledby={`${headingId}-unassigned`}>
            <h3 id={`${headingId}-unassigned`} className="matches-minor-heading">
              {UNASSIGNED_HEADING}
            </h3>
            <ul className="matches-roster">
              {view.unassigned.map((membershipId) => {
                const person = personOf(membershipId);
                const name = person?.displayName ?? membershipId;
                return (
                  <li key={membershipId}>
                    <PlayerRow
                      name={name}
                      guest={person?.isGuest}
                      badges={person?.isGuest ? <GuestBadge /> : undefined}
                      end={view.teams.map((team) => (
                        <Button
                          key={team.teamId}
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-label={moveToLabel(name, team.teamName)}
                          aria-disabled={busy}
                          onClick={() => move(membershipId, team.teamId)}
                        >
                          {team.teamName}
                        </Button>
                      ))}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <section className="matches-identities" aria-labelledby={`${headingId}-identity`}>
          <h3 id={`${headingId}-identity`} className="matches-minor-heading">
            {NAMES_AND_BIBS_HEADING}
          </h3>
          <ul className="matches-identities__list">
            {view.teams.map((team, index) => (
              <TeamIdentityCard
                // A re-read name resets the field to it.
                key={`${team.teamId}-${team.teamName}`}
                team={team}
                side={index}
                busy={action.busy}
                rename={(name) =>
                  void write('edit', (signal) => api.setTeamName(matchId, team.teamId, name, signal))
                }
                wearBibs={() => void write('edit', (signal) => api.setBibTeam(matchId, team.teamId, signal))}
              />
            ))}
          </ul>
        </section>

        {problems.length === 0 ? null : (
          <Banner tone="warn" announce={false}>
            <ul className="matches-problems">
              {problems.map((problem) => (
                <li key={lockProblemMessage(problem)}>{lockProblemMessage(problem)}</li>
              ))}
            </ul>
          </Banner>
        )}

        <p className="matches-hint">{locked ? UNLOCK_HINT : LOCK_HINT}</p>
        <div className="matches-footer">
          <Button type="button" variant="secondary" icon="shuffle" aria-disabled={busy} onClick={reroll}>
            {rollLabel(REROLL_TEAMS_LABEL)}
          </Button>
          <div className="matches-footer__end">
            {locked ? (
              <Button
                type="button"
                variant="secondary"
                icon="unlock"
                aria-disabled={busy}
                onClick={() => void write('unlock', (signal) => api.unlockTeams(matchId, signal))}
              >
                {action.busy && lastWrite === 'unlock' ? UNLOCKING_LABEL : UNLOCK_TEAMS_LABEL}
              </Button>
            ) : null}
            <Button
              type="button"
              icon="lock"
              glow={!locked && problems.length === 0}
              aria-disabled={busy}
              onClick={() => void write('lock', (signal) => api.lockTeams(matchId, signal))}
            >
              {action.busy && lastWrite === 'lock'
                ? LOCKING_LABEL
                : locked
                  ? RELOCK_TEAMS_LABEL
                  : LOCK_TEAMS_LABEL}
            </Button>
          </div>
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
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
      {teams.refreshing ? <LoadingNotice label={TEAMS_LOADING_LABEL} /> : null}
    </section>
  );
}

export default TeamsEditor;
