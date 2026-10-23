/**
 * Response_Parsers for squad deletion: the purge instant `DeleteSquad` answers
 * with, and the owner's list of squads pending deletion that
 * `ListMyPendingDeletionSquads` answers with.
 *
 * A pending-deletion squad is the one squad read that can see a deleted squad,
 * so these bodies carry only what a restore needs: the squad's identity, its name
 * and when it will be purged. Instants are read as epoch milliseconds through the
 * shared `readInstantMs`, so a purge date with no UTC designator fails the body
 * rather than being read in some local zone.
 *
 * Total and exception-free like every parser here: the first bad member fails the
 * whole body, and a list with one bad entry is rejected rather than shown short.
 */

import {
  ok,
  printInstant,
  readArray,
  readInstantMs,
  readObject,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
} from './primitives';

/** What a deletion settled to: when the squad will be purged. */
export interface SquadDeletion {
  readonly purgeAtMs: number;
}

/** One squad the caller owns that is deleted but still restorable. */
export interface PendingDeletionSquad {
  readonly squadId: string;
  readonly name: string;
  readonly purgeAtMs: number;
}

/** Parse a `DeleteSquadResult` body. */
export function parseSquadDeletion(body: unknown): ParseResult<SquadDeletion> {
  const source = readObject(body, 'squad deletion');

  if (!source.ok) {
    return source;
  }

  const purgeAtMs = readInstantMs(
    readProperty(source.value, 'purgeAt'),
    'squad deletion purgeAt',
  );

  if (!purgeAtMs.ok) {
    return purgeAtMs;
  }

  return ok({ purgeAtMs: purgeAtMs.value });
}

/** The wire body a parsed deletion came from. */
export function printSquadDeletion(deletion: SquadDeletion): unknown {
  return { purgeAt: printInstant(deletion.purgeAtMs) };
}

/** Parse one `PendingDeletionSquad` entry. */
export function parsePendingDeletionSquad(
  body: unknown,
): ParseResult<PendingDeletionSquad> {
  const source = readObject(body, 'pending deletion squad');

  if (!source.ok) {
    return source;
  }

  const squadId = readUuid(
    readProperty(source.value, 'squadId'),
    'pending deletion squad squadId',
  );

  if (!squadId.ok) {
    return squadId;
  }

  const name = readString(
    readProperty(source.value, 'name'),
    'pending deletion squad name',
  );

  if (!name.ok) {
    return name;
  }

  const purgeAtMs = readInstantMs(
    readProperty(source.value, 'purgeAt'),
    'pending deletion squad purgeAt',
  );

  if (!purgeAtMs.ok) {
    return purgeAtMs;
  }

  return ok({
    squadId: squadId.value,
    name: name.value,
    purgeAtMs: purgeAtMs.value,
  });
}

/** Parse the whole `ListMyPendingDeletionSquads` body, keeping its order. */
export function parsePendingDeletionSquadList(
  body: unknown,
): ParseResult<readonly PendingDeletionSquad[]> {
  const elements = readArray(body, 'pending deletion squads');

  if (!elements.ok) {
    return elements;
  }

  const squads: PendingDeletionSquad[] = [];

  for (const element of elements.value) {
    const squad = parsePendingDeletionSquad(element);

    if (!squad.ok) {
      return squad;
    }

    squads.push(squad.value);
  }

  return ok(squads);
}

/** The wire body a parsed list came from. */
export function printPendingDeletionSquadList(
  squads: readonly PendingDeletionSquad[],
): unknown {
  return squads.map((squad) => ({
    squadId: squad.squadId,
    name: squad.name,
    purgeAt: printInstant(squad.purgeAtMs),
  }));
}
