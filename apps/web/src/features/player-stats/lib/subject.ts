/**
 * The Player_Stats_Screen's subject: the `(squadId, membershipId)` pair the
 * screen presents one Player_Profile for.
 *
 * This module owns two decisions and the rest of the feature re-decides
 * neither:
 *
 * 1. **What a valid subject is.** Requirement 1.4 has the screen take both
 *    identities from the route's own parameters and from no other source, and
 *    Requirement 3.3 has an invalid one issue no call and render the
 *    Not_Found_Treatment. `readSubject` is the single place that turns two
 *    unasserted route parameters into either a subject worth calling for or
 *    `null`.
 * 2. **How two subjects compare.** A Pairwise_Link navigates from one profile to
 *    another *on the same route pattern*, so `react-router` keeps the screen
 *    mounted and only the parameters change. The load machine's issue guard is
 *    therefore keyed on the subject rather than on the mount (Requirement 2.4),
 *    and `subjectKey` is the comparable value that guard holds: equal for two
 *    subjects exactly when both identities match.
 *
 * A `Subject` is deliberately not a validated-at-the-type-level brand. It is a
 * plain pair whose only *supported* construction is `readSubject`, which is
 * enough for the guarantees the feature needs while keeping the type printable
 * in a test fixture without ceremony.
 *
 * Both functions are **total** and free of exceptions, and neither trims,
 * case-folds, nor otherwise repairs a value — the identities are opaque to this
 * feature and are forwarded to the backend exactly as the route carried them.
 *
 * React-free and DOM-free like every module under `lib/`, and importing nothing
 * but the sibling identity check (Requirement 14.3).
 *
 * Requirements: 1.4, 2.4, 3.3
 */

import { isPlayerStatsIdentifier } from './identifiers';

/**
 * The subject of one rendering of the Player_Stats_Screen: a membership within
 * a squad.
 *
 * Both members are well-formed identities when the value came from
 * {@link readSubject}, which is the only supported construction.
 */
export interface Subject {
  /** The squad the statistics are scoped to, exactly as the route carried it. */
  readonly squadId: string;
  /** The membership whose profile the screen presents. */
  readonly membershipId: string;
}

/**
 * Separates the two identities in a {@link subjectKey}. A character no
 * well-formed identity can contain, so the key of a valid subject reads as the
 * pair it encodes.
 */
const SUBJECT_KEY_SEPARATOR = '/';

/**
 * Terminates the length prefix of a {@link subjectKey}. A character no decimal
 * digit can be, so the prefix is unambiguously delimited.
 */
const SUBJECT_KEY_LENGTH_TERMINATOR = ':';

/**
 * Reads a subject from the Player_Stats_Route's own two parameters.
 *
 * Returns `null` unless **both** identities are syntactically well formed, which
 * is the signal the load machine turns into `unidentifiable`: no call is issued
 * and the screen renders the same Not_Found_Treatment it renders for every cause
 * the backend conceals (Requirement 3.3). One valid identity beside one
 * malformed one is not a partial subject — there is nothing to call for — so it
 * yields `null` like any other invalid pair.
 *
 * Total over every input and free of exceptions. The declared parameter types
 * describe what `react-router` hands over; the implementation asserts nothing
 * and so is safe for any value that reaches it at runtime.
 *
 * @param squadId the `squadId` path segment, `undefined` when absent
 * @param membershipId the `membershipId` path segment, `undefined` when absent
 * @returns the subject carrying both identities unchanged, or `null`
 *
 * Requirements: 1.4, 2.4, 3.3
 */
export function readSubject(
  squadId: string | undefined,
  membershipId: string | undefined,
): Subject | null {
  // 3.3: both identities must be well formed before a call is worth issuing.
  // Nothing is trimmed or repaired, so the value sent to the backend is the
  // value the route carried.
  if (!isPlayerStatsIdentifier(squadId) || !isPlayerStatsIdentifier(membershipId)) {
    return null;
  }

  return { squadId, membershipId };
}

/**
 * The comparable key of a subject — the value the load machine's issue guard
 * holds and compares, and the value `PlayerStatsState` records the held
 * profile's subject as.
 *
 * Two subjects yield the same key **exactly when** both identities match: the
 * encoding is injective, so a key collision cannot make the machine treat a
 * navigation to a sibling profile as a re-render of the current one, and a key
 * difference cannot make an unchanged subject re-issue a call (Requirement 2.4).
 * Injectivity does not rest on the identities being well formed — the squad
 * identity's length is written ahead of it, so the decomposition of a key back
 * into its pair is unique for *any* pair of strings. Case is significant,
 * because identity equality is string equality and this feature never folds an
 * identity's case.
 *
 * Total over every subject and free of exceptions. The key is an internal
 * comparison value, never user-facing copy and never part of a request.
 *
 * @param subject the subject to key
 * @returns a stable, injective encoding of the pair
 *
 * Requirements: 2.4
 */
export function subjectKey(subject: Subject): string {
  const { squadId, membershipId } = subject;

  return `${String(squadId.length)}${SUBJECT_KEY_LENGTH_TERMINATOR}${squadId}${SUBJECT_KEY_SEPARATOR}${membershipId}`;
}
