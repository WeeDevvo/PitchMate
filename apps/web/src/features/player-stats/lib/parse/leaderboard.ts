/**
 * The Response_Parser for `GET /squads/{squadId}/leaderboard`: one squad-scoped
 * ranking by one statistic.
 *
 * The backend ranks the entries (value descending, then a stable identity
 * tie-break) and leaves provisional players off the Display_Rating board, so
 * this module keeps the order it was given and decides nothing about rank. It
 * reads no rating-model member, because the wire carries none: a Display_Rating
 * value arrives already computed.
 *
 * Each value is read by the rule its statistic implies, so a body that claims a
 * count of `1.5` appearances or a win percentage of `130` fails as a whole
 * rather than being rounded or clamped into something that looks earned:
 *
 * | Statistic | Reader |
 * | --- | --- |
 * | `WinPercentage` | `readPercentage`: a number from 0 to 100 |
 * | `DisplayRating` | `readNumber`: any finite figure, read as the profile reads it, with no repair |
 * | every other statistic | `readCount`: a non-negative whole number |
 *
 * The board's `statistic` must be the one requested. A body ranking by another
 * statistic would put one board's figures under another board's heading, so it
 * fails too.
 *
 * Pure and total like every module under `lib/`: no React, no DOM, no throw.
 */

import {
  isLeaderboardStatistic,
  type LeaderboardStatistic,
} from '../wireEnums';
import {
  fail,
  ok,
  readArray,
  readCount,
  readNumber,
  readObject,
  readPercentage,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from './primitives';

/** One ranked membership on a leaderboard. */
export interface LeaderboardEntry {
  readonly membershipId: string;
  readonly displayName: string;
  /** The statistic's value for this membership, already validated for it. */
  readonly value: number;
}

/** A squad leaderboard: the statistic it ranks by and its entries, in rank order. */
export interface Leaderboard {
  readonly statistic: LeaderboardStatistic;
  readonly entries: readonly LeaderboardEntry[];
}

/** The reader a statistic's values are held to. */
function valueReaderFor(
  statistic: LeaderboardStatistic,
): (value: unknown, label: string) => ParseResult<number> {
  switch (statistic) {
    case 'WinPercentage':
      return readPercentage;
    case 'DisplayRating':
      return readNumber;
    case 'Appearances':
    case 'WinStreak':
    case 'UnbeatenStreak':
    case 'BibAppearances':
      return readCount;
  }
}

/** One entry, its value read by the board's own statistic. */
export function parseLeaderboardEntry(
  body: unknown,
  statistic: LeaderboardStatistic,
): ParseResult<LeaderboardEntry> {
  const entry = readObject(body, 'leaderboard entry');

  if (!entry.ok) {
    return entry;
  }

  const membershipId = readUuid(
    readProperty(entry.value, 'membershipId'),
    'membership identifier',
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  const displayName = readString(
    readProperty(entry.value, 'displayName'),
    'display name',
  );

  if (!displayName.ok) {
    return displayName;
  }

  const value = valueReaderFor(statistic)(
    readProperty(entry.value, 'value'),
    'leaderboard value',
  );

  if (!value.ok) {
    return value;
  }

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    value: value.value,
  });
}

/**
 * A whole leaderboard body, which must rank by `requested`.
 *
 * The first entry that fails fails the body: a board with a row missing would
 * show every player below it one place too high.
 */
export function parseLeaderboard(
  body: unknown,
  requested: LeaderboardStatistic,
): ParseResult<Leaderboard> {
  const board = readObject(body, 'leaderboard');

  if (!board.ok) {
    return board;
  }

  const statistic = readWireEnumName(
    readProperty(board.value, 'statistic'),
    'leaderboard statistic',
    isLeaderboardStatistic,
  );

  if (!statistic.ok) {
    return statistic;
  }

  if (statistic.value !== requested) {
    return fail('leaderboard ranks by a statistic other than the one requested');
  }

  const elements = readArray(readProperty(board.value, 'entries'), 'leaderboard entries');

  if (!elements.ok) {
    return elements;
  }

  const entries: LeaderboardEntry[] = [];

  for (const element of elements.value) {
    const entry = parseLeaderboardEntry(element, statistic.value);

    if (!entry.ok) {
      return entry;
    }

    entries.push(entry.value);
  }

  return ok({ statistic: statistic.value, entries });
}

/**
 * The wire body a parsed leaderboard came from, so a round-trip property can
 * state that parsing a printed board gives the same board back.
 */
export function printLeaderboard(board: Leaderboard): unknown {
  return {
    statistic: board.statistic,
    entries: board.entries.map((entry) => ({
      membershipId: entry.membershipId,
      displayName: entry.displayName,
      value: entry.value,
    })),
  };
}
