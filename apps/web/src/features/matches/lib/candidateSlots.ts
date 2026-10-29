/**
 * Candidate days as the create-match screen collects them, after the design
 * system's day tiles and time picker: an admin picks days from the next four
 * weeks, then sets a kick-off time for each, with an optional second time on the
 * same day. Each day-and-time is one candidate day for the backend.
 *
 * The rules a draft must meet stay `validateDraft`'s: this module only checks
 * what the tiles add — that every picked day has a time — and turns the picks
 * into the `datetime-local` values that function reads.
 *
 * React-free and DOM-free like every module under `lib/`.
 */

import { validateDraft, type DraftProblem, type DraftValidation } from './matchDays';

/** How many days ahead the tiles offer, today included. */
export const CANDIDATE_WINDOW_DAYS = 28;

/** A day can have two kick-off times: the pitch is free at either. */
export const MAX_TIMES_PER_DAY = 2;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** The earliest and latest kick-off a day offers, in whole hours. */
export const FIRST_KICK_OFF_HOUR = 7;
export const LAST_KICK_OFF_HOUR = 22;

/**
 * The kick-off times an admin picks from: on the hour and the half hour, from
 * 07:00 to 22:00, since pitches are booked in those slots. Each is `HH:MM`.
 */
export const KICK_OFF_TIMES: readonly string[] = Array.from(
  { length: (LAST_KICK_OFF_HOUR - FIRST_KICK_OFF_HOUR) * 2 + 1 },
  (_, index) => {
    const minutes = FIRST_KICK_OFF_HOUR * 60 + index * 30;
    return `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
  },
);

/** One date a tile offers. */
export interface DateTile {
  /** The local date, as a `date` input writes it: `YYYY-MM-DD`. */
  readonly date: string;
  readonly dow: string;
  readonly num: string;
  readonly mon: string;
  /** The date in words, which names the tile: "Wed 5 Nov". */
  readonly label: string;
}

/** One candidate kick-off: a picked date and its time. */
export interface CandidateSlot {
  /** Stable across edits, for a React key and a field id. */
  readonly id: number;
  readonly date: string;
  /** `HH:MM`, or empty until the admin sets it. */
  readonly time: string;
}

const TILE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** The local date of `date` as `YYYY-MM-DD`. */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

/**
 * The dates the tiles offer: today and the days after it, `count` in all, in
 * the viewer's own time zone. Built from the local calendar date rather than by
 * adding hours, so a daylight-saving change never skips or repeats a day.
 */
export function upcomingDates(
  nowMs: number,
  count: number = CANDIDATE_WINDOW_DAYS,
  format: Intl.DateTimeFormat = TILE_FORMAT,
): readonly DateTile[] {
  const today = new Date(nowMs);
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const parts = format.formatToParts(day);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? '';
    return {
      date: localDate(day),
      dow: part('weekday'),
      num: part('day'),
      mon: part('month'),
      label: `${part('weekday')} ${part('day')} ${part('month')}`,
    };
  });
}

/** The picked dates, once each, in date order. */
export function pickedDates(slots: readonly CandidateSlot[]): readonly string[] {
  return [...new Set(slots.map((slot) => slot.date))].sort();
}

/** The slots in date order, then by time; a slot without a time comes last on its day. */
export function orderedSlots(slots: readonly CandidateSlot[]): readonly CandidateSlot[] {
  return [...slots].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      (left.time === '' ? 1 : 0) - (right.time === '' ? 1 : 0) ||
      left.time.localeCompare(right.time) ||
      left.id - right.id,
  );
}

/** The slots on one date, by time; a slot without a time comes last. */
export function slotsOn(slots: readonly CandidateSlot[], date: string): readonly CandidateSlot[] {
  return orderedSlots(slots.filter((slot) => slot.date === date));
}

/** The earliest time set on a date, which its tile shows, or `undefined` when none is. */
export function earliestTime(slots: readonly CandidateSlot[], date: string): string | undefined {
  const first = slotsOn(slots, date)[0];
  return first === undefined || first.time === '' ? undefined : first.time;
}

/** The problem, if any, with the times alone: a picked day with no time set. */
export type SlotProblem = Extract<DraftProblem, 'time-required'> | null;

/**
 * Check a draft collected through the tiles: every picked day needs a time, and
 * then the draft as a whole meets `validateDraft`'s rules.
 */
export function validateSlots(
  location: string,
  slots: readonly CandidateSlot[],
  nowMs: number,
): DraftValidation {
  const drafted = validateDraft(
    {
      location,
      days: slots.filter((slot) => slot.time !== '').map((slot) => `${slot.date}T${slot.time}`),
    },
    nowMs,
  );

  if (!slots.some((slot) => slot.time === '')) {
    return drafted;
  }

  return {
    ok: false,
    locationProblem: drafted.ok ? null : drafted.locationProblem,
    daysProblem: 'time-required',
  };
}
