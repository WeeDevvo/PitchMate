/**
 * Every fixed piece of text the Matches_Feature renders. Nothing here is built
 * from a response, so no backend message or identity can reach the screen.
 */
import { CANDIDATE_DAY_MAX_COUNT, LOCATION_MAX_LENGTH, type DraftProblem } from './matchDays';
import type { RejectionReason } from './callOutcome';

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
  return `${count} of ${threshold} needed`;
}

export function thresholdStatement(threshold: number): string {
  return `A day needs ${threshold} players before an admin can confirm it.`;
}

export const ORGANISER_READY_STATEMENT =
  'At least one day has enough players. Confirming a day arrives in the next update.';

export const PARTICIPANTS_HEADING = 'Players';
export const GUEST_LABEL = 'Guest';

/* Rejections ---------------------------------------------------------------- */

export const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  validation: 'That was not accepted. Check the details and try again.',
  'invalid-state': 'This match has moved on, so that is no longer possible. The page has been refreshed.',
  'threshold-not-met': 'That day does not have enough players yet.',
  conflict: 'Someone else changed this match at the same time. The page has been refreshed.',
};
