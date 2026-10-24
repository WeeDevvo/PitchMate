/**
 * The typed-name gate on deleting a squad: the owner must type the squad's name
 * before the delete control works, so a squad is never deleted by a stray click
 * on the wrong screen.
 *
 * The match is exact apart from surrounding whitespace, which a paste often
 * carries. Case counts, because a squad named "Tuesday Five" and one named
 * "tuesday five" can both exist and the point is to name this one.
 *
 * Pure, total and exception-free like every module under `lib/`.
 */

/** Whether `typed` names the squad called `squadName`. */
export function confirmsSquadName(typed: string, squadName: string): boolean {
  const candidate = typed.trim();
  return candidate.length > 0 && candidate === squadName.trim();
}
