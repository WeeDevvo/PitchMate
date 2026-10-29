/**
 * Every fixed piece of text the Matches_Feature renders. Nothing here is built
 * from a response, so no backend message or identity can reach the screen.
 */
import { CANDIDATE_DAY_MAX_COUNT, LOCATION_MAX_LENGTH, type DraftProblem } from './matchDays';
import type { RejectionReason } from './callOutcome';
import {
  ROLL_MAX_PARTICIPANTS,
  ROLL_MIN_PARTICIPANTS,
  TEAM_MAX_SIZE,
  TEAM_MIN_SIZE,
  type LockProblem,
  type RollGap,
} from './teams';

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

export const CREATE_MATCH_HEADING = 'New match';

/** The create-match flow's six steps, shown to admins as a progress bar. */
export const MATCH_FLOW_STEPS: readonly string[] = [
  'Where & when',
  'Availability',
  'Confirm day',
  'Players',
  'Roll teams',
  'Names & bibs',
];
export const MATCH_FLOW_STEPS_LABEL = 'Create match steps';
export const STEP_DONE_LABEL = 'Done';

export const LOCATION_LABEL = 'Location';
export const LOCATION_HINT = 'The pitch or venue, as the squad knows it.';
export const CANDIDATE_DAYS_LEGEND = 'Candidate days: pick a few';
export const CANDIDATE_DAYS_HINT = `Pick the days the pitch is free. Up to ${CANDIDATE_DAY_MAX_COUNT} kick-off times in all; members say which they can make.`;
export const KICK_OFF_LEGEND = 'When does it kick off?';
export const KICK_OFF_EMPTY_HINT = 'Pick a day above, then set its kick-off time.';
export const SUBMIT_DRAFT_LABEL = 'Send to squad';
export const SUBMITTING_DRAFT_LABEL = 'Sending to squad…';
export const CANCEL_LABEL = 'Cancel';
export const NOT_AN_ORGANISER_STATEMENT = 'Only squad admins can create matches.';

/** A kick-off field's visible label; its accessible name adds the day. */
export function kickOffText(index: number): string {
  return index === 0 ? 'Kick-off' : 'Second kick-off';
}

/** The choice a kick-off field shows until a time is picked. */
export const PICK_A_TIME_LABEL = 'Pick a time';

/** Under a picked day's empty time, once the admin has tried to send. */
export const KICK_OFF_MISSING = 'Set a time.';

/** Names a kick-off time field: "Kick-off, Wed 5 Nov", then "Second kick-off, Wed 5 Nov". */
export function kickOffLabel(dayLabel: string, index: number): string {
  return `${kickOffText(index)}, ${dayLabel}`;
}

/** Visible as "Add another time"; the day keeps each button's name distinct. */
export const ADD_TIME_TEXT = 'Add another time';

export function addTimeLabel(dayLabel: string): string {
  return `${ADD_TIME_TEXT} on ${dayLabel}`;
}

export function removeTimeLabel(dayLabel: string, index: number): string {
  return index === 0 ? `Remove kick-off, ${dayLabel}` : `Remove second kick-off, ${dayLabel}`;
}

/** Under the times: how many options the squad will see. */
export function slotCountStatement(count: number): string {
  const options = count === 1 ? '1 option' : `${count} options`;
  return `${options}. Members see each day with its time and mark which they can make.`;
}

export const DRAFT_PROBLEM_MESSAGES: Readonly<Record<DraftProblem, string>> = {
  'location-required': 'Enter where the match is played.',
  'location-too-long': `Keep the location to ${LOCATION_MAX_LENGTH} characters or fewer.`,
  'day-required': 'Pick at least one candidate day.',
  'time-required': 'Set a kick-off time for each day you picked.',
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
export const AVAILABILITY_HINT =
  'Tick every day you can play. You can change it until the match is confirmed.';
export const ORGANISER_AVAILABILITY_HINT =
  'Tick every day you can play, and the days each guest can: guests have no account, so an admin answers for them.';
export const SAVE_AVAILABILITY_LABEL = 'Save availability';
export const SAVING_AVAILABILITY_LABEL = 'Saving…';
export const CLEAR_AVAILABILITY_LABEL = 'Clear my response';
export const AVAILABILITY_SAVED_STATEMENT = 'Availability saved.';
export const AVAILABILITY_CLEARED_STATEMENT = 'Your response is cleared.';
export const AVAILABILITY_UNCHANGED_STATEMENT = 'Nothing has changed since the last save.';
export const AVAILABILITY_CLOSED_STATEMENT = 'Availability is closed for this match.';

export const TALLY_HEADING = 'Who can play';
export const TALLY_LOADING_LABEL = 'Loading availability';
export const TALLY_HINT =
  'A guide to the best day, not a gate. An admin can confirm any day, and others can join afterwards.';
export const AVAILABILITY_GRID_CAPTION = 'Who can make each candidate day';
export const YOU_LABEL = 'You';
export const TOTALS_LABEL = 'Can play';
export const MOST_PLAYERS_LABEL = 'Most players';

/** The words each grid cell is read with, and the key beneath it. */
export const AVAILABILITY_ANSWER_LABELS = {
  yes: 'Can play',
  no: "Can't play",
  unknown: 'No reply yet',
} as const;

export const GUESTS_LOADING_LABEL = 'Loading guests';
export const GUEST_AVAILABILITY_NO_GUESTS =
  "This squad has no guests yet. Add them from the squad's Admin tab.";

/** A grid cell's name: "You, Fri 13 Nov, 15:00" or "John, Fri 13 Nov, 15:00". */
export function availabilityCellLabel(name: string, dayLabel: string): string {
  return `${name}, ${dayLabel}`;
}

export function clearGuestAvailabilityLabel(name: string): string {
  return `Clear the days marked for ${name}`;
}

export function tallyCountLabel(count: number): string {
  return `${count} can play`;
}

/** Above the grid: the day with most players, or that there is none yet. */
export function bestDayStatement(bestDayLabels: readonly string[]): string {
  if (bestDayLabels.length === 0) return 'Nobody has marked a day yet.';
  if (bestDayLabels.length === 1) return `${bestDayLabels[0]} is looking best so far.`;
  return `${bestDayLabels.length} days are level for most players.`;
}

/* Confirming ------------------------------------------------------------------ */

export const CONFIRM_HEADING = 'Confirm the match';
export const CONFIRM_DAY_LEGEND = 'Day to confirm';
export const CONFIRM_HINT =
  'Pick any day: the most popular is chosen to start with. Confirming closes availability, and everyone who marked that day becomes a player. Others can join or be added afterwards.';
export const CONFIRM_DAY_BUTTON_LABEL = 'Confirm this day';
export const CONFIRM_LABEL = 'Confirm match';
export const CONFIRMING_LABEL = 'Confirming…';

/** The confirmation dialog's title: "Confirm Wed 4 Nov, 18:00?". */
export function confirmDialogTitle(dayLabel: string): string {
  return `Confirm ${dayLabel}?`;
}

export function confirmDialogBody(count: number): string {
  const who = count === 0 ? 'Nobody has marked it yet' : count === 1 ? '1 can make it' : `${count} can make it`;
  return `${who}. We'll tell the squad and close the other days. Remember to book the pitch.`;
}

export const CONFIRM_FEW_PLAYERS_WARNING = `That's fewer than the ${ROLL_MIN_PARTICIPANTS} needed to roll teams. You can add players and guests next.`;

export const PARTICIPANTS_HEADING = 'Players';
export const GUEST_LABEL = 'Guest';
export const ADD_PLAYER_LABEL = 'Player to add';
export const ADD_PLAYER_SUBMIT_LABEL = 'Add player';
export const NO_PLAYERS_TO_ADD = 'Everyone in this squad is already playing.';
export const PLAYERS_LOADING_LABEL = 'Loading the squad';
export const JOIN_MATCH_LABEL = 'Join this match';
export const LEAVE_MATCH_LABEL = 'Leave this match';
export const NOT_PLAYING_STATEMENT = "You're not playing in this match yet.";
export const PLAYING_STATEMENT = "You're playing in this match.";

export function guestOptionLabel(name: string): string {
  return `${name} (guest)`;
}

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
/** What stands between the player list and a roll, said as the next thing to do. */
export function rollGapStatement(playerCount: number, gap: RollGap): string {
  const have = `You have ${playerCountStatement(playerCount)}.`;
  const players = gap.count === 1 ? 'player' : 'players';
  return gap.kind === 'add'
    ? `${have} Add ${gap.count} more ${players} to roll teams.`
    : `${have} Take off ${gap.count} ${players} to roll teams.`;
}
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
export const UNLOCK_TEAMS_LABEL = 'Unlock to change players';
export const UNLOCKING_LABEL = 'Unlocking…';
export const UNLOCK_HINT =
  'Need to add or remove someone? Unlock the teams, make the change, then lock them again before kickoff.';
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
        ? '1 player is not on a team yet. Put them on one before locking.'
        : `${problem.count} players are not on a team yet. Put them on one before locking.`;
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

/* Playing, the result and completion ---------------------------------------- */

export const MATCH_ACTIONS_HEADING = 'Match day';
export const START_MATCH_LABEL = 'Start match';
export const STARTING_LABEL = 'Starting…';
export const START_HINT = 'Starting fixes the teams. You record the score once the match is over.';
export const UNLOCKED_CHANGES_STATEMENT =
  'Your team changes are not locked yet. Lock them first, so the teams that play are the ones on the team sheet.';
export const CANCEL_MATCH_LABEL = 'Cancel match';
export const CANCEL_CONFIRM_STATEMENT = 'Cancel this match? This cannot be undone.';
export const CONFIRM_CANCEL_LABEL = 'Yes, cancel the match';
export const KEEP_MATCH_LABEL = 'Keep the match';
export const CANCELLING_LABEL = 'Cancelling…';
export const MATCH_CANCELLED_STATEMENT = 'This match was cancelled.';

export const RESULT_HEADING = 'Result';
export const RESULT_FORM_HEADING = 'Record the score';
export const RESULT_FORM_HINT = `Enter each team's goals, from 0 to 99. You can correct the score until the match is completed.`;
export const SAVE_RESULT_LABEL = 'Save score';
export const SAVING_RESULT_LABEL = 'Saving…';
export const RESULT_SAVED_STATEMENT = 'The score is saved.';
export const SCORE_INPUT_PROBLEM = 'Enter a whole number from 0 to 99 for every team.';
export const PROVISIONAL_RESULT_LABEL = 'Score so far, not yet final';
export const FINAL_RESULT_LABEL = 'Final score';
export const RESULT_UNREADABLE_STATEMENT = 'The score could not be shown.';

export const COMPLETE_HEADING = 'Complete the match';
export const COMPLETE_HINT = "Completing makes the score final and updates everyone's ratings. It cannot be undone.";
export const COMPLETE_NEEDS_RESULT_STATEMENT = 'Save the score before completing the match.';
export const COMPLETE_MATCH_LABEL = 'Complete match';
export const CONFIRM_COMPLETE_LABEL = 'Yes, complete the match';
export const COMPLETING_LABEL = 'Completing…';
export const NOT_YET_LABEL = 'Not yet';

export function scoreLabel(teamName: string, bibFlag: boolean): string {
  return bibFlag ? `${teamName} (wears bibs) goals` : `${teamName} goals`;
}

export const OUTCOME_LABELS = {
  win: 'Won',
  draw: 'Drew',
  loss: 'Lost',
} as const;

/** A non-colour cue beside each outcome word: ✓ for a win, – for a draw, ✗ for a loss. */
export const OUTCOME_ICONS = {
  win: '✓',
  draw: '–',
  loss: '✗',
} as const;

export const COMPLETED_LABEL = 'Completed';

/* Rejections ---------------------------------------------------------------- */

export const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  validation: 'That was not accepted. Check the details and try again.',
  'invalid-state': 'This match has moved on, so that is no longer possible. The page has been refreshed.',
  'result-required': 'Save the score before completing the match.',
  conflict: 'Someone else changed this match at the same time. The page has been refreshed.',
};
