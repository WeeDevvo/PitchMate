/**
 * Presentation of a squad leaderboard: the text each value reads as, and the
 * position each entry is shown at.
 *
 * Both are pure functions of their arguments, with no React, DOM, clock or
 * locale, like every module under `lib/`.
 *
 * ## Values
 *
 * A Win_Percentage reads as the profile screen shows one (`'66.7%'`), through
 * the same `formatWinPercentage`, so the two screens can't disagree about a
 * figure. Every other statistic is a whole number and reads as its digits.
 *
 * ## Positions
 *
 * The backend sends the entries in rank order, breaking ties by a stable
 * identity order so the list never reshuffles between reads. That tie-break is
 * an ordering, not a verdict: two players on 12 appearances are level, so they
 * are shown at the same position, and the next player is shown at the position
 * their place in the list implies ("1, 2, 2, 4"). That is standard competition
 * ranking, and it is computed here from the values alone, never by re-sorting.
 */

import {
  APPEARANCES_LABEL,
  BIB_APPEARANCES_LABEL,
  LEADERBOARD_RATING_LABEL,
  UNBEATEN_STREAK_LABEL,
  WIN_PERCENTAGE_LABEL,
  WIN_STREAK_LABEL,
} from './messages';
import { formatCount, formatWinPercentage } from './numberFormat';
import type { LeaderboardStatistic } from './wireEnums';

/**
 * A leaderboard value as the text a person reads.
 *
 * Total over every number: a Win_Percentage outside 0 to 100 can't reach here
 * through the parser, but if one did it would read as its digits rather than as
 * a plausible percentage.
 */
export function formatLeaderboardValue(
  statistic: LeaderboardStatistic,
  value: number,
): string {
  if (statistic === 'WinPercentage') {
    return formatWinPercentage(value) ?? formatCount(value);
  }

  return formatCount(value);
}

/**
 * The 1-based position each entry is shown at, given the values in rank order.
 *
 * An entry level with the one above it shares that entry's position; any other
 * entry is shown at its own place in the list. The result has one position per
 * value, starts at 1 for a non-empty board, and never decreases.
 */
export function competitionPositions(values: readonly number[]): readonly number[] {
  const positions: number[] = [];

  values.forEach((value, index) => {
    const previous = positions[index - 1];
    const level = previous !== undefined && values[index - 1] === value;
    positions.push(level ? previous : index + 1);
  });

  return positions;
}

/**
 * The name each statistic's board goes by, in the switcher and on the list.
 * Keyed by every `LeaderboardStatistic`, so a new statistic fails to compile
 * here until it is named.
 */
export const LEADERBOARD_STATISTIC_LABELS: Readonly<Record<LeaderboardStatistic, string>> = {
  DisplayRating: LEADERBOARD_RATING_LABEL,
  Appearances: APPEARANCES_LABEL,
  WinPercentage: WIN_PERCENTAGE_LABEL,
  WinStreak: WIN_STREAK_LABEL,
  UnbeatenStreak: UNBEATEN_STREAK_LABEL,
  BibAppearances: BIB_APPEARANCES_LABEL,
};

/**
 * The order the switcher offers the boards in. The Display_Rating board comes
 * first and is the default; the rest follow the profile screen's order.
 */
export const LEADERBOARD_STATISTIC_ORDER: readonly LeaderboardStatistic[] = [
  'DisplayRating',
  'Appearances',
  'WinPercentage',
  'WinStreak',
  'UnbeatenStreak',
  'BibAppearances',
];
