/**
 * Pure rules over an availability tally.
 */
import { chronological } from './matchDays';
import type { DayTally } from './parse/responses';

export interface DayCount {
  readonly dayMs: number;
  readonly count: number;
}

/**
 * The count for each candidate day in chronological order, with a day nobody
 * marked counted as zero and a tallied day that is not a candidate ignored.
 */
export function countsByDay(
  candidateDaysMs: readonly number[],
  tally: readonly DayTally[],
): readonly DayCount[] {
  const counts = new Map(tally.map((day) => [day.dayMs, day.count]));
  return chronological(candidateDaysMs).map((dayMs) => ({
    dayMs,
    count: counts.get(dayMs) ?? 0,
  }));
}

/**
 * The best-attended days: every day sharing the highest count, or none when
 * nobody has marked any day. A guide only; any day can be confirmed.
 */
export function mostAvailableDays(counts: readonly DayCount[]): ReadonlySet<number> {
  const highest = counts.reduce((best, { count }) => Math.max(best, count), 0);
  return new Set(highest === 0 ? [] : counts.filter(({ count }) => count === highest).map(({ dayMs }) => dayMs));
}

/** What a person said about one candidate day; `unknown` before they answer at all. */
export type DayAnswer = 'yes' | 'no' | 'unknown';

/**
 * Each candidate day's answer, in the order given: a marked day is a yes; once
 * someone has answered, every day they left unmarked is a no; before then, it is
 * unknown.
 */
export function answersFor(
  daysMs: readonly number[],
  marked: ReadonlySet<number>,
  answered: boolean,
): readonly DayAnswer[] {
  return daysMs.map((dayMs) => (marked.has(dayMs) ? 'yes' : answered ? 'no' : 'unknown'));
}

/** True when the marked days are exactly the stored ones. */
export function sameDays(marked: ReadonlySet<number>, stored: readonly number[]): boolean {
  return marked.size === new Set(stored).size && stored.every((dayMs) => marked.has(dayMs));
}
