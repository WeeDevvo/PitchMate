/**
 * The Response_Parser for `ExportSquad`: the owner's copy of everything the squad
 * holds, offered before the squad is deleted.
 *
 * The export is handed to the owner as a file, not rendered, so this parser does
 * not re-read every membership and invite. It checks the two members a file is
 * named and described by (the squad's identity and its name) and that the three
 * collections are arrays, then keeps the body exactly as it arrived, so the file
 * the owner saves is the backend's document and nothing this client rebuilt.
 */

import {
  fail,
  ok,
  readArray,
  readObject,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
} from './primitives';

/** A squad export, ready to save. */
export interface SquadExportFile {
  readonly squadId: string;
  readonly name: string;
  /** The body as the backend sent it, to be written to the file unchanged. */
  readonly body: unknown;
}

/** The collections every export carries. */
const EXPORT_COLLECTIONS = ['memberships', 'invites', 'features'] as const;

/** Parse an `ExportSquad` body. */
export function parseSquadExport(body: unknown): ParseResult<SquadExportFile> {
  const source = readObject(body, 'squad export');

  if (!source.ok) {
    return source;
  }

  const squadId = readUuid(readProperty(source.value, 'squadId'), 'squad export squadId');

  if (!squadId.ok) {
    return squadId;
  }

  const name = readString(readProperty(source.value, 'name'), 'squad export name');

  if (!name.ok) {
    return name;
  }

  for (const collection of EXPORT_COLLECTIONS) {
    if (!readArray(readProperty(source.value, collection), `squad export ${collection}`).ok) {
      return fail(`squad export ${collection} is not an array`);
    }
  }

  return ok({ squadId: squadId.value, name: name.value, body });
}
