/**
 * Pure rules over the working teams: whether they can be locked, and how the
 * engine's prediction reads. The backend's own rules are mirrored so the
 * organiser hears what is in the way before pressing Lock; the backend still
 * decides.
 */
import type { MatchState } from './wireEnums';
import type { SplitPrediction, WorkingTeam } from './parse/teams';

/** The backend's team-size bounds at lock (`Match.TeamMinSize` and `TeamMaxSize`). */
export const TEAM_MIN_SIZE = 5;
export const TEAM_MAX_SIZE = 8;

/** The backend's participant bounds for rolling teams. */
export const ROLL_MIN_PARTICIPANTS = 10;
export const ROLL_MAX_PARTICIPANTS = 16;

/** The longest team name the backend accepts. */
export const TEAM_NAME_MAX_LENGTH = 50;

export type LockProblem =
  | { readonly kind: 'too-few-teams' }
  | { readonly kind: 'team-size'; readonly teamName: string; readonly size: number }
  | { readonly kind: 'bib-count'; readonly count: number }
  | { readonly kind: 'unassigned'; readonly count: number };

/** Everything that would stop, or ought to give pause before, a lock. */
export function lockProblems(
  teams: readonly WorkingTeam[],
  unassignedCount: number,
): readonly LockProblem[] {
  const problems: LockProblem[] = [];

  if (teams.length < 2) {
    problems.push({ kind: 'too-few-teams' });
  }

  for (const team of teams) {
    const size = team.roster.length;
    if (size < TEAM_MIN_SIZE || size > TEAM_MAX_SIZE) {
      problems.push({ kind: 'team-size', teamName: team.teamName, size });
    }
  }

  const bibCount = teams.filter((team) => team.bibFlag).length;
  if (teams.length >= 2 && bibCount !== 1) {
    problems.push({ kind: 'bib-count', count: bibCount });
  }

  if (unassignedCount > 0) {
    problems.push({ kind: 'unassigned', count: unassignedCount });
  }

  return problems;
}

/** True while an organiser can still change who plays and on which team. */
export function teamsEditable(state: MatchState): boolean {
  return state === 'Confirmed' || state === 'TeamsRolled';
}

/** True while guests can be added or participants removed. */
export function participantsEditable(state: MatchState): boolean {
  return state === 'Confirmed';
}

/** A probability as a whole percentage, for example `0.456` → `46%`. */
export function formatProbability(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

/** One line per outcome, in team order, then the draw under `drawLabel`. */
export function predictionLines(
  teams: readonly WorkingTeam[],
  prediction: SplitPrediction,
  drawLabel: string,
): ReadonlyArray<{ readonly label: string; readonly value: string; readonly share: number }> {
  return [
    ...teams.map((team, index) => ({
      label: team.teamName,
      value: formatProbability(prediction.winProbabilities[index] ?? 0),
      share: prediction.winProbabilities[index] ?? 0,
    })),
    {
      label: drawLabel,
      value: formatProbability(prediction.drawProbability),
      share: prediction.drawProbability,
    },
  ];
}
