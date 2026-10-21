/**
 * Every fixed piece of text the Matches_Feature renders. Nothing here is built
 * from a response, so no backend message or identity can reach the screen.
 */
import { CANDIDATE_DAY_MAX_COUNT, LOCATION_MAX_LENGTH, type DraftProblem } from './matchDays';
import type { RejectionReason } from './callOutcome';
import { ROLL_MAX_PARTICIPANTS, ROLL_MIN_PARTICIPANTS, TEAM_MAX_SIZE, TEAM_MIN_SIZE, type LockProblem } from './teams';

/* Boundary states ---------------------------------------------------------- */

export const GENERIC_MATCHES_FAILURE = 'Something went wrong just now. Please try again.';
export const RETRY_LABEL = 'Try again';
export const BACK_TO_SQUAD_LABEL = 'Back to the squad';
export const MATCH_NOT_FOUND_HEADING = 'Match not found';
export const MATCH_NOT_FOUND_STATEMENT =
  'This match was not found, or it is not available to you.';

/* The squad screen's matches section --------------------------------------- */

export const MATCHES_LOADING_LABEL = 'Loading matches';
export const NO_MATCHES_STATEMENT = 'No matches yet.';
export const CREATE_MATCH_LABEL = 'Create a match';
export const MATCHES_TRUNCATED_STATEMENT = 'Showing the most recent matches only.';

export function participantCountLabel(count: number): string {
  return count === 1 ? '1 player' : `${count} players`;
}

/* The create-match screen --------------------------------------------------- */

export const CREATE_MATCH_HEADING = 'Create a match';
export const LOCATION_LABEL = 'Location';
export const CANDIDATE_DAYS_LEGEND = 'Candidate days';
export const CANDIDATE_DAYS_HINT = `Add up to ${CANDIDATE_DAY_MAX_COUNT} days and kick-off times. Members say which they can make.`;
export const ADD_DAY_LABEL = 'Add another day';
export const SUBMIT_DRAFT_LABEL = 'Create match';
export const SUBMITTING_DRAFT_LABEL = 'Creating match…';
export const CANCEL_LABEL = 'Cancel';
export const NOT_AN_ORGANISER_STATEMENT = 'Only squad admins can create matches.';

export function candidateDayLabel(index: number): string {
  return `Candidate day ${index + 1}`;
}

export function removeDayLabel(index: number): string {
  return `Remove candidate day ${index + 1}`;
}

export const DRAFT_PROBLEM_MESSAGES: Readonly<Record<DraftProblem, string>> = {
  'location-required': 'Enter where the match is played.',
  'location-too-long': `Keep the location to ${LOCATION_MAX_LENGTH} characters or fewer.`,
  'day-required': 'Add at least one candidate day.',
  'too-many-days': `Add no more than ${CANDIDATE_DAY_MAX_COUNT} candidate days.`,
  'day-invalid': 'Enter each candidate day as a full date and time.',
  'day-in-past': 'Candidate days must be in the future.',
  'day-duplicated': 'Each candidate day must be different.',
};

/* The match screen ---------------------------------------------------------- */

export const MATCH_LOADING_LABEL = 'Loading match';
export const MATCH_SCREEN_FALLBACK_HEADING = 'Match';
export const STATE_LABEL = 'Status';
export const CONFIRMED_DAY_LABEL = 'Confirmed for';
export const AVAILABILITY_HEADING = 'Your availability';
export const AVAILABILITY_DAYS_LEGEND = 'Days you can play';
export const AVAILABILITY_HINT = 'Tick every day you can play. You can change this until the match is confirmed.';
export const AVAILABILITY_NOT_RESPONDED = 'You have not responded yet.';
export const SAVE_AVAILABILITY_LABEL = 'Save availability';
export const SAVING_AVAILABILITY_LABEL = 'Saving…';
export const CLEAR_AVAILABILITY_LABEL = 'Clear my response';
export const AVAILABILITY_SAVED_STATEMENT = 'Your availability is saved.';
export const AVAILABILITY_CLEARED_STATEMENT = 'Your response is cleared.';
export const AVAILABILITY_CLOSED_STATEMENT = 'Availability is closed for this match.';
export const TALLY_HEADING = 'Who can play';
export const TALLY_LOADING_LABEL = 'Loading availability';
export const AT_THRESHOLD_LABEL = 'Enough to play';
export const BELOW_THRESHOLD_LABEL = 'Not enough yet';

export function tallyCountLabel(count: number, threshold: number): string {
  return `${count} can play, ${threshold} needed`;
}

export function thresholdStatement(threshold: number): string {
  return `A day needs ${threshold} players before an admin can confirm it.`;
}

/* Confirming ------------------------------------------------------------------ */

export const CONFIRM_HEADING = 'Confirm the match';
export const CONFIRM_DAY_LEGEND = 'Day to confirm';
export const CONFIRM_LABEL = 'Confirm match';
export const CONFIRMING_LABEL = 'Confirming…';
export const NO_DAY_READY_STATEMENT = 'No day has enough players yet. You can confirm once one does.';
export const CONFIRM_HINT =
  'Confirming closes availability. Everyone who can make that day becomes a player.';

export const PARTICIPANTS_HEADING = 'Players';
export const GUEST_LABEL = 'Guest';
export const ADD_GUEST_LABEL = 'Guest to add';
export const ADD_GUEST_SUBMIT_LABEL = 'Add guest';
export const NO_GUESTS_TO_ADD = 'Every guest in this squad is already playing, or the squad has none.';
export const GUESTS_LOADING_LABEL = 'Loading guests';

export function removeParticipantLabel(name: string): string {
  return `Remove ${name}`;
}

export function playerCountStatement(count: number): string {
  return count === 1 ? '1 player' : `${count} players`;
}

/* Teams ------------------------------------------------------------------------ */

export const TEAMS_HEADING = 'Teams';
export const TEAMS_LOADING_LABEL = 'Loading teams';
export const NO_TEAMS_STATEMENT = 'Teams have not been rolled yet.';
export const ROLL_TEAMS_LABEL = 'Roll teams';
export const REROLL_TEAMS_LABEL = 'Re-roll teams';
export const ROLLING_LABEL = 'Rolling…';
export const ROLL_HINT = `Rolling needs ${ROLL_MIN_PARTICIPANTS} to ${ROLL_MAX_PARTICIPANTS} players. The balancer splits them as fairly as it can; you can then move players, rename teams and choose who wears bibs.`;
export const PREDICTION_HEADING = 'Predicted result';
export const DRAW_LABEL = 'Draw';
export const NO_PREDICTION_STATEMENT = 'A prediction appears once two teams have players.';
export const SAVE_TEAM_NAME_LABEL = 'Save name';
export const TEAM_NAME_HINT = 'Leave it blank for a generated name.';
export const UNASSIGNED_HEADING = 'Not on a team';
export const LOCK_TEAMS_LABEL = 'Lock teams';
export const RELOCK_TEAMS_LABEL = 'Lock changes';
export const LOCKING_LABEL = 'Locking…';
export const LOCK_HINT = 'Locking fixes the kickoff line-up and shows the team sheet to everyone.';
export const TEAMS_LOCKED_STATEMENT = 'Teams are locked. You can still change them until the match starts.';

export function teamHeading(name: string, size: number): string {
  return `${name} (${playerCountStatement(size)})`;
}

export function teamNameLabel(teamName: string): string {
  return `Name of ${teamName}`;
}

export function wearsBibsLabel(teamName: string): string {
  return `${teamName} wears bibs`;
}

export function moveToLabel(playerName: string, teamName: string): string {
  return `Move ${playerName} to ${teamName}`;
}

export function lockProblemMessage(problem: LockProblem): string {
  switch (problem.kind) {
    case 'too-few-teams':
      return 'Roll teams before locking.';
    case 'team-size':
      return `${problem.teamName} has ${playerCountStatement(problem.size)}; each team needs ${TEAM_MIN_SIZE} to ${TEAM_MAX_SIZE}.`;
    case 'bib-count':
      return 'Choose exactly one team to wear bibs.';
    case 'unassigned':
      return problem.count === 1
        ? '1 player is not on a team and will not play.'
        : `${problem.count} players are not on a team and will not play.`;
  }
}

/* The team sheet --------------------------------------------------------------- */

export const TEAM_SHEET_HEADING = 'Team sheet';
export const TEAM_SHEET_LOADING_LABEL = 'Loading the team sheet';
export const KICKOFF_LABEL = 'Kick-off';
export const VENUE_LABEL = 'Where';
export const WEARS_BIBS_BADGE = 'Wears bibs';

export function lockedTeamsLabel(teamNames: readonly string[]): string {
  return teamNames.join(' v ');
}

/* Rejections ---------------------------------------------------------------- */

export const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  validation: 'That was not accepted. Check the details and try again.',
  'invalid-state': 'This match has moved on, so that is no longer possible. The page has been refreshed.',
  'threshold-not-met': 'That day does not have enough players yet.',
  conflict: 'Someone else changed this match at the same time. The page has been refreshed.',
};
