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

/** True when at least one candidate day has reached the threshold. */
export function anyDayAtThreshold(counts: readonly DayCount[], threshold: number): boolean {
  return counts.some(({ count }) => count >= threshold);
}
