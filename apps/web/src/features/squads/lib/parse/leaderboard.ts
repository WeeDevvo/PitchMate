/**
 * The `GetSquadLeaderboard` body shape for the Display_Rating statistic:
 * `{ statistic: int, entries: [{ membershipId, displayName, value }] }`.
 *
 * The leaderboard **decorates** the Player_List rather than defining it. Its rows
 * are matched to `GetSquad`'s memberships by identity, a membership with no entry
 * renders the Provisional_Band, and a leaderboard failure degrades every row to
 * Rating_Unavailable (Requirements 7.2, 8.3). Two consequences shape this module.
 *
 * **A duplicated membership identity fails the body** (Requirement 8.11). Two
 * entries for one membership make that person's rating ambiguous, and there is no
 * defensible way to pick between them — taking the first would render a number
 * chosen by array order, and ignoring both would show a Provisional_Band that
 * claims the player has no settled rating when the backend says they have two.
 * Failing routes the ambiguity through the normal path: a `parse-failure` outcome,
 * no leaderboard, and Rating_Unavailable on **every** row, so no player gets a
 * rating derived from an ambiguous body. Identities compare exactly, as
 * Requirement 8.1's matching does — the identity is opaque to this feature, so it
 * is neither trimmed nor case-folded before comparison.
 *
 * **`statistic` is not read.** The caller already knows which statistic it asked
 * for — it is in the query string — so the echoed code tells the feature nothing,
 * and its enum is not one the Enum_Code_Map carries. Reading it would mean either
 * a numeric enum literal outside `lib/enumCodes.ts`, which Requirement 16.12
 * forbids, or a seventh table with no user. It is disregarded exactly as any
 * unrecognised property is (16.9), which is also why the printer does not emit it.
 *
 * `value` is read as a finite number and nothing else. The rounding to a displayed
 * integer belongs to `lib/ratingPresentation.ts`, and no μ, σ, or scaling constant
 * appears anywhere in this feature: the mapping from the model to a friendly
 * number is the backend's (Requirement 8.9).
 *
 * Requirements: 8.9, 8.11, 16.4, 16.5, 16.9, 16.10, 16.12
 */

import {
  fail,
  ok,
  readArray,
  readNumber,
  readObject,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
} from './primitives';

/** One membership's Display_Rating row, as the backend ranked it. */
export interface DisplayRatingEntry {
  readonly membershipId: string;
  readonly displayName: string;
  readonly value: number;
}

/**
 * The Display_Rating leaderboard. It carries only its entries: the statistic it
 * was ranked by is the one the caller requested.
 */
export interface DisplayRatingLeaderboard {
  readonly entries: readonly DisplayRatingEntry[];
}

/**
 * One Display_Rating entry parsed from an element of `entries`.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * three validated readings (Requirement 16.4).
 *
 * Requirements: 16.4, 16.9
 */
export function parseDisplayRatingEntry(
  body: unknown,
): ParseResult<DisplayRatingEntry> {
  const source = readObject(body, 'leaderboard entry');

  if (!source.ok) {
    return source;
  }

  const membershipId = readUuid(
    readProperty(source.value, 'membershipId'),
    'leaderboard entry membershipId',
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  const displayName = readString(
    readProperty(source.value, 'displayName'),
    'leaderboard entry displayName',
  );

  if (!displayName.ok) {
    return displayName;
  }

  const value = readNumber(
    readProperty(source.value, 'value'),
    'leaderboard entry value',
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
 * The whole `GetSquadLeaderboard` body, failing when two entries share a
 * membership identity (Requirement 8.11).
 *
 * Total over every input and free of exceptions. The duplicate check is one pass
 * over the entries against a set of the identities already read, so a leaderboard
 * of any length costs no more than the parse itself.
 *
 * Requirements: 8.11, 16.4, 16.9
 */
export function parseDisplayRatingLeaderboard(
  body: unknown,
): ParseResult<DisplayRatingLeaderboard> {
  const source = readObject(body, 'leaderboard');

  if (!source.ok) {
    return source;
  }

  const elements = readArray(
    readProperty(source.value, 'entries'),
    'leaderboard entries',
  );

  if (!elements.ok) {
    return elements;
  }

  const entries: DisplayRatingEntry[] = [];
  const seenIdentities = new Set<string>();

  for (const element of elements.value) {
    const entry = parseDisplayRatingEntry(element);

    if (!entry.ok) {
      return entry;
    }

    // 8.11: an ambiguous leaderboard yields no Display_Rating for anybody. The
    // reason names the field, never the identity that repeated.
    if (seenIdentities.has(entry.value.membershipId)) {
      return fail('leaderboard entries carry a repeated membership identity');
    }

    seenIdentities.add(entry.value.membershipId);
    entries.push(entry.value);
  }

  return ok({ entries });
}

/**
 * A Display_Rating entry rendered back into the wire shape
 * {@link parseDisplayRatingEntry} accepts.
 *
 * Requirements: 16.5
 */
export function printDisplayRatingEntry(entry: DisplayRatingEntry): unknown {
  return {
    membershipId: entry.membershipId,
    displayName: entry.displayName,
    value: entry.value,
  };
}

/**
 * A Display_Rating leaderboard rendered back into the wire shape
 * {@link parseDisplayRatingLeaderboard} accepts: the entries alone, in order, and
 * no `statistic` — see the module note.
 *
 * Requirements: 16.5
 */
export function printDisplayRatingLeaderboard(
  leaderboard: DisplayRatingLeaderboard,
): unknown {
  return { entries: leaderboard.entries.map(printDisplayRatingEntry) };
}
