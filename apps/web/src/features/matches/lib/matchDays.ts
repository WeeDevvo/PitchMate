/**
 * Candidate days: how a person enters them, how they are checked before a draft
 * is sent, and how they are shown.
 *
 * The backend's rules for a draft are mirrored here so a person hears about a
 * mistake before submitting: a location of 1 to 200 characters after trimming,
 * and 1 to 14 candidate days that are distinct and strictly in the future. The
 * backend still enforces all of them.
 */

export const LOCATION_MAX_LENGTH = 200;
export const CANDIDATE_DAY_MAX_COUNT = 14;

/**
 * A `datetime-local` input value: `YYYY-MM-DDTHH:MM`, optionally with seconds.
 * Anchored, and neither global nor sticky.
 */
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The instant a `datetime-local` value names in the browser's own time zone, or
 * `null` when the value is empty, malformed, or names no real time (such as
 * 30 February, or a wall-clock time skipped by a daylight-saving change).
 */
export function localInputToInstantMs(value: string): number | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second || 0, 0);

  // The constructor rolls invalid fields over (day 31 of a 30-day month becomes
  // the 1st); a value that did not survive unchanged named no real time.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.getTime();
}

/** The draft as the form holds it. */
export interface DraftInput {
  readonly location: string;
  /** One `datetime-local` value per candidate-day field, blanks included. */
  readonly days: readonly string[];
}

export type DraftProblem =
  | 'location-required'
  | 'location-too-long'
  | 'day-required'
  | 'too-many-days'
  | 'day-invalid'
  | 'day-in-past'
  | 'day-duplicated';

export type DraftValidation =
  | {
      readonly ok: true;
      readonly location: string;
      /** The candidate days as ISO-8601 instants, in the order entered. */
      readonly candidateDays: readonly string[];
    }
  | {
      readonly ok: false;
      readonly locationProblem: DraftProblem | null;
      readonly daysProblem: DraftProblem | null;
    };

/**
 * Check a draft against the backend's rules. Blank day fields are ignored, so an
 * unused extra row is not an error.
 */
export function validateDraft(input: DraftInput, nowMs: number): DraftValidation {
  const location = input.location.trim();

  let locationProblem: DraftProblem | null = null;
  if (location.length === 0) {
    locationProblem = 'location-required';
  } else if (location.length > LOCATION_MAX_LENGTH) {
    locationProblem = 'location-too-long';
  }

  const entered = input.days.filter((day) => day.trim().length > 0);
  const instants = entered.map(localInputToInstantMs);

  let daysProblem: DraftProblem | null = null;
  if (entered.length === 0) {
    daysProblem = 'day-required';
  } else if (entered.length > CANDIDATE_DAY_MAX_COUNT) {
    daysProblem = 'too-many-days';
  } else if (instants.some((instant) => instant === null)) {
    daysProblem = 'day-invalid';
  } else if (instants.some((instant) => (instant as number) <= nowMs)) {
    daysProblem = 'day-in-past';
  } else if (new Set(instants).size !== instants.length) {
    daysProblem = 'day-duplicated';
  }

  if (locationProblem !== null || daysProblem !== null) {
    return { ok: false, locationProblem, daysProblem };
  }

  return {
    ok: true,
    location,
    candidateDays: instants.map((instant) => new Date(instant as number).toISOString()),
  };
}

/** The candidate days in chronological order, without changing the input. */
export function chronological(daysMs: readonly number[]): readonly number[] {
  return [...daysMs].sort((a, b) => a - b);
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** A candidate day as a person reads it, for example `Sat 25 Oct, 19:00`. */
export function formatDay(instantMs: number, format: Intl.DateTimeFormat = DAY_FORMAT): string {
  return format.format(new Date(instantMs));
}

/**
 * The day a list entry is filed under: the confirmed day once there is one,
 * otherwise the earliest candidate day, or `null` for a match with neither.
 */
export function headlineDayMs(
  confirmedDayMs: number | null,
  candidateDaysMs: readonly number[],
): number | null {
  if (confirmedDayMs !== null) {
    return confirmedDayMs;
  }

  return candidateDaysMs.length === 0 ? null : Math.min(...candidateDaysMs);
}
