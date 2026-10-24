/**
 * Rules for the match lifecycle after the teams are locked: which organiser
 * step a state offers, how a typed score is read, and how a recorded result is
 * set beside the locked teams.
 *
 * Every rule mirrors one the backend enforces; these only decide what the
 * screen offers. A result is scored against the locked teams the team sheet
 * presents, by the identity each sheet team carries.
 */
import type { RecordedResult } from './parse/matchDetail';
import type { TeamSheet } from './parse/teamSheet';
import type { WorkingTeams } from './parse/teams';
import type { MatchState } from './wireEnums';

/** The highest score a team can be given. */
export const MAX_SCORE = 99;

/** True once the teams are locked and the match has not started. */
export function canStart(state: MatchState): boolean {
  return state === 'TeamsRolled';
}

/** True while the match has not started, which is when it can be cancelled. */
export function canCancel(state: MatchState): boolean {
  return state === 'GatheringAvailability' || state === 'Confirmed' || state === 'TeamsRolled';
}

/** True while the match is being played, which is when its score can be recorded. */
export function canRecordResult(state: MatchState): boolean {
  return state === 'InProgress';
}

/** True when a match in progress has a recorded result, so it can be completed. */
export function canComplete(state: MatchState, result: RecordedResult | null): boolean {
  return state === 'InProgress' && result !== null;
}

export type ScoreInput =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false };

/** Read a typed score: a whole number from 0 to {@link MAX_SCORE}, nothing else. */
export function parseScoreInput(text: string): ScoreInput {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) {
    return { ok: false };
  }

  const value = Number(trimmed);
  return value <= MAX_SCORE ? { ok: true, value } : { ok: false };
}

export type TeamOutcome = 'win' | 'draw' | 'loss';

/** One locked team beside its recorded score. */
export interface ScoreLine {
  readonly teamId: string;
  readonly teamName: string;
  readonly bibFlag: boolean;
  readonly score: number;
  readonly outcome: TeamOutcome;
}

/**
 * Each locked team with its recorded score, in team-sheet order, or `null` when
 * the result does not score exactly the sheet's teams. A team shares the top
 * score with another for a draw, holds it alone for a win, and otherwise lost.
 */
export function scoreLines(sheet: TeamSheet, result: RecordedResult): readonly ScoreLine[] | null {
  const scores = new Map(result.teamScores.map(({ teamId, score }) => [teamId, score]));
  if (scores.size !== result.teamScores.length || scores.size !== sheet.teams.length) {
    return null;
  }

  const lines: { teamId: string; teamName: string; bibFlag: boolean; score: number }[] = [];
  for (const team of sheet.teams) {
    const score = scores.get(team.teamId);
    if (score === undefined) {
      return null;
    }
    lines.push({ teamId: team.teamId, teamName: team.teamName, bibFlag: team.bibFlag, score });
  }

  const top = Math.max(...lines.map(({ score }) => score));
  const leaders = lines.filter(({ score }) => score === top).length;

  return lines.map((line) => ({
    ...line,
    outcome: line.score < top ? 'loss' : leaders > 1 ? 'draw' : 'win',
  }));
}

/**
 * True when the working teams are exactly the locked ones: the same teams, each
 * with the same name, bib flag and players in the same order. When they are
 * not, the organiser changed the teams after locking and has not locked again,
 * so the change would not be the line-up that plays.
 */
export function workingTeamsAreLocked(sheet: TeamSheet, working: WorkingTeams): boolean {
  if (working.unassigned.length > 0 || working.teams.length !== sheet.teams.length) {
    return false;
  }

  return sheet.teams.every((locked) => {
    const team = working.teams.find(({ teamId }) => teamId === locked.teamId);
    return (
      team !== undefined &&
      team.teamName === locked.teamName &&
      team.bibFlag === locked.bibFlag &&
      team.roster.length === locked.roster.length &&
      team.roster.every(({ membershipId }, index) => membershipId === locked.roster[index].membershipId)
    );
  });
}
