/**
 * The Players tab's filter: the chips (everyone, registered members, guests) and
 * the "Find a player" search, applied to the composed rows before the Player_List
 * orders them. Pure, total and exception-free, like every module under `lib/`.
 *
 * A row is kept when it is of the chosen kind and its display name contains the
 * search text, compared case- and accent-insensitively after trimming the text;
 * an empty search keeps every row of the kind. Filtering never reorders — the
 * Player_Order stays the Player_List's — and never invents a row.
 */

import type { PlayerListRow } from './playerList';

/** Which players a chip shows. */
export type PlayerKind = 'all' | 'members' | 'guests';

/** The chips in the order the Players tab shows them. */
export const PLAYER_KINDS: readonly PlayerKind[] = ['all', 'members', 'guests'];

/** A display name as the search compares it: lower-cased, accents removed. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function isOfKind(row: Pick<PlayerListRow, 'isGuest'>, kind: PlayerKind): boolean {
  return kind === 'all' || (kind === 'guests') === row.isGuest;
}

/** How many rows each chip would show, before the search. */
export function playerKindCounts(
  rows: readonly Pick<PlayerListRow, 'isGuest'>[],
): Readonly<Record<PlayerKind, number>> {
  const guests = rows.filter((row) => row.isGuest).length;
  return { all: rows.length, members: rows.length - guests, guests };
}

/** The rows of `kind` whose display name contains `query`. */
export function filterPlayerRows<TRow extends Pick<PlayerListRow, 'isGuest' | 'displayName'>>(
  rows: readonly TRow[],
  kind: PlayerKind,
  query: string,
): readonly TRow[] {
  const needle = folded(query.trim());
  return rows.filter((row) => isOfKind(row, kind) && folded(row.displayName).includes(needle));
}
