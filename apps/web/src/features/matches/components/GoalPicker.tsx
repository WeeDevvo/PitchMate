/**
 * The two taps after GOAL: which team scored, then who. Each step fills the
 * tracker with big targets, so it works one-handed mid-game.
 *
 * The minute is fixed when GOAL is pressed, so a slow pick still logs the goal
 * when it went in. The scorer can be skipped, and an own goal lists the other
 * team's players, since it counts for the team it went past. Each step moves
 * focus to its heading, so a screen reader hears where it is.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Avatar, BibFlag, Button } from '../../../ui';

import { scorerChoices, sessionGoalsFor, type LoggedEvent } from '../lib/liveTracking';
import {
  BACK_LABEL,
  CANCEL_LABEL,
  NOT_OWN_GOAL_LABEL,
  OWN_GOAL_LABEL,
  SKIP_SCORER_LABEL,
  WHICH_TEAM_HINT,
  goalAtHeading,
  ownGoalHint,
  sessionGoalsMeta,
  teamGoalButtonLabel,
  teamGoalHeading,
  whoScoredHint,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';

export interface GoalPick {
  readonly teamId: string;
  readonly scorerId: string | null;
  readonly ownGoal: boolean;
}

export interface GoalPickerProps {
  readonly sheet: TeamSheet;
  readonly minute: number;
  readonly log: readonly LoggedEvent[];
  readonly onPick: (pick: GoalPick) => void;
  readonly onCancel: () => void;
}

export function GoalPicker({ sheet, minute, log, onPick, onCancel }: GoalPickerProps): ReactElement {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [ownGoal, setOwnGoal] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [teamId]);

  const team = sheet.teams.find((candidate) => candidate.teamId === teamId);

  if (team === undefined) {
    return (
      <section className="matches-tracker-step" aria-labelledby="matches-goal-step-heading">
        <div className="matches-tracker-step__bar">
          <h2 id="matches-goal-step-heading" ref={headingRef} tabIndex={-1} className="matches-subheading">
            {goalAtHeading(minute)}
          </h2>
          <Button variant="ghost" onClick={onCancel}>
            {CANCEL_LABEL}
          </Button>
        </div>
        <p className="matches-hint">{WHICH_TEAM_HINT}</p>
        <div className="matches-tracker-teams">
          {sheet.teams.map((candidate, index) => (
            <button
              key={candidate.teamId}
              type="button"
              className={`matches-tracker-team matches-tracker-team--${index === 0 ? 'a' : 'b'}`}
              aria-label={teamGoalButtonLabel(candidate.teamName, candidate.bibFlag)}
              onClick={() => setTeamId(candidate.teamId)}
            >
              <span className="matches-tracker-team__name">{candidate.teamName}</span>
              {candidate.bibFlag ? <BibFlag /> : null}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const choices = scorerChoices(sheet, team.teamId, ownGoal, log);

  return (
    <section className="matches-tracker-step" aria-labelledby="matches-goal-step-heading">
      <div className="matches-tracker-step__bar">
        <Button variant="ghost" icon="chevronLeft" onClick={() => { setTeamId(null); setOwnGoal(false); }}>
          {BACK_LABEL}
        </Button>
        <Button variant="ghost" onClick={() => onPick({ teamId: team.teamId, scorerId: null, ownGoal: false })}>
          {SKIP_SCORER_LABEL}
        </Button>
      </div>
      <h2 id="matches-goal-step-heading" ref={headingRef} tabIndex={-1} className="matches-subheading">
        {teamGoalHeading(team.teamName)}
      </h2>
      <p className="matches-hint">{ownGoal ? ownGoalHint(team.teamName) : whoScoredHint(minute)}</p>
      <ul className="matches-tracker-scorers">
        {choices.map((player) => {
          const goals = sessionGoalsFor(log, player.membershipId);
          return (
            <li key={player.membershipId}>
              <button
                type="button"
                className="matches-tracker-scorer"
                onClick={() => onPick({ teamId: team.teamId, scorerId: player.membershipId, ownGoal })}
              >
                <Avatar name={player.displayName} size={40} />
                <span className="matches-tracker-scorer__text">
                  <span className="matches-tracker-scorer__name">{player.displayName}</span>
                  {goals > 0 ? <span className="matches-tracker-scorer__meta">{sessionGoalsMeta(goals)}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="secondary"
        icon="ownGoal"
        aria-pressed={ownGoal}
        onClick={() => setOwnGoal((current) => !current)}
      >
        {ownGoal ? NOT_OWN_GOAL_LABEL : OWN_GOAL_LABEL}
      </Button>
    </section>
  );
}

export default GoalPicker;
