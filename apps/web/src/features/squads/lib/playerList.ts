/**
 * Player_List composition: the row set, the Player_Order, and the
 * Anonymised_Placeholder predicate.
 *
 * Three rules live here, and they are together because they are the three
 * statements the Squad_Screen must be able to make about its player list without
 * rendering anything (Requirements 7.3, 7.4, 7.9).
 *
 * **The row set is `detail.members` alone.** `GetSquad` is the authority on
 * membership and the Display_Rating leaderboard only *decorates* it, so
 * {@link composePlayerList} maps over the memberships and never over the
 * leaderboard: exactly one Player_Row per Squad_Member, and a leaderboard entry
 * whose membership identity matches no member contributes nothing — no row, no
 * name, no rating (Requirement 7.2). That direction matters more than it looks.
 * The leaderboard is ranked by the backend and may legitimately carry identities
 * this squad's detail does not (a stale read, a membership removed between the two
 * concurrent calls), and Requirement 7.11 is explicit that no player identity is
 * ever rendered from the leaderboard alone.
 *
 * **The order is decided by one comparator.** {@link comparePlayerRows} is total
 * over every pair of rows, so the rendered sequence is a function of the composed
 * input and of nothing else — not of the order `members` happened to arrive in
 * (Requirement 7.4). See the comparator's own note for why the identity key is
 * what makes that true.
 *
 * **The placeholder is a value comparison, not a heuristic.** See
 * {@link isAnonymisedPlaceholder}.
 *
 * ### Why the row carries the raw leaderboard entry
 *
 * The row records *what rating data was available for this membership* —
 * {@link PlayerListRow.leaderboardObtained} and
 * {@link PlayerListRow.ratingEntry} — and stops there. Choosing between a
 * Display_Rating, a Provisional_Band, and a Rating_Unavailable label is
 * Requirement 8's business and lives in `lib/ratingPresentation.ts`, which is a
 * pure function of a Squad_Member and the optional leaderboard (Requirement 8.6).
 * Keeping the *decision* out of this module means the two never disagree about
 * what a missing entry means, and it keeps composition testable against
 * Requirements 7.2–7.4 without dragging the rating rules in. A `PlayerListRow` is
 * structurally a Squad_Member, so a call site can hand a row straight to that
 * selector — or read the two fields below — without a second identity match.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the parsed value types it reads plus the comparison result type it
 * shares with the Squad_Card order (Requirement 18.2).
 *
 * Requirements: 7.2, 7.3, 7.4, 7.9
 */

import type { MemberRole, MembershipStateValue } from './enumCodes';
import type {
  DisplayRatingEntry,
  DisplayRatingLeaderboard,
} from './parse/leaderboard';
import type { SquadDetail, SquadMember } from './parse/squadDetail';
import type { Comparison } from './squadOrder';

/**
 * The display name the backend writes over a membership's own name when the
 * person behind it is erased — `SquadMembership.DisplayNamePlaceholder`.
 *
 * Erasure is anonymisation rather than deletion: the membership, its ratings, and
 * its match history stay intact so completed matches remain immutable and rating
 * replay stays valid, and only the identifying data is stripped. This constant is
 * the one copy of that name in the feature, so the Former_Player presentation
 * (Requirement 7.8) and the promotion exclusion (Requirement 13.2) recognise the
 * same set of rows.
 */
export const ANONYMISED_PLACEHOLDER = 'Former player';

/**
 * Whether a Player_Display_Name is the Anonymised_Placeholder — the pure predicate
 * Requirement 7.9 asks for, so the recognition is testable without a browser.
 *
 * The comparison is **exact after trimming**, against the backend constant and
 * nothing else. It is deliberately not a heuristic: not case-insensitive, not a
 * prefix test, not a match on "former". A squad member who genuinely calls
 * themselves `former player` in another case is out of scope for the MVP, and the
 * cost of guessing runs the wrong way — a name wrongly read as the placeholder
 * would strip a real player's promotion control and label them as erased, which is
 * worse than an erased row that keeps a control the backend will refuse anyway
 * (Requirement 10.5).
 *
 * Trimming is `String.prototype.trim`, so leading and trailing whitespace —
 * including a non-breaking space, which a name pasted from elsewhere can easily
 * carry — does not hide the placeholder. Interior whitespace is untouched, so
 * `Former  player` is not the placeholder.
 *
 * Pure, total, and free of exceptions: one string trim and one string comparison,
 * with no coercion and no structure to recurse into. Nothing here formats a name
 * for display; a name reaches the screen exactly as parsed.
 *
 * @param displayName the Player_Display_Name exactly as parsed
 * @returns `true` only when the trimmed name equals {@link ANONYMISED_PLACEHOLDER}
 *
 * Requirements: 7.9
 */
export function isAnonymisedPlaceholder(displayName: string): boolean {
  return displayName.trim() === ANONYMISED_PLACEHOLDER;
}

/**
 * One row of the Player_List: a Squad_Member, the two facts derived from it, and
 * the rating data that was available for it.
 *
 * Structurally a superset of `SquadMember`, so a row can be passed wherever a
 * member is read — the rating selector and the promotion predicate both take a
 * `SquadMember` — without unpacking it first.
 */
export interface PlayerListRow {
  /** The membership identity, opaque to this feature and the final ordering key. */
  readonly membershipId: string;
  /** The Player_Display_Name exactly as parsed; never reformatted. */
  readonly displayName: string;
  /** The Member_Role, or `null` for a guest membership (Requirement 16.8). */
  readonly role: MemberRole | null;
  /** The Membership_State; always present, and the primary ordering key. */
  readonly state: MembershipStateValue;
  /** Whether this membership is a guest — no account, no `AuthIdentity`. */
  readonly isGuest: boolean;
  /**
   * Whether this row is a Former_Player, i.e. whether its display name is the
   * Anonymised_Placeholder (Requirement 7.8). Derived once here so the row's
   * labels and its controls cannot disagree about it.
   */
  readonly isFormerPlayer: boolean;
  /**
   * Whether a Display_Rating_Leaderboard was obtained at all. `false` when the
   * leaderboard call failed, timed out, or returned a body the parser rejected —
   * the case in which every row shows Rating_Unavailable (Requirement 7.10).
   */
  readonly leaderboardObtained: boolean;
  /**
   * This membership's leaderboard entry, exactly as parsed, or `null` when the
   * leaderboard carried no entry for it (or was not obtained). The raw value is
   * carried rather than a formatted one: rounding and the choice of presentation
   * belong to `lib/ratingPresentation.ts` (Requirements 8.2, 8.6).
   */
  readonly ratingEntry: DisplayRatingEntry | null;
}

const sign = (value: number): Comparison => (value < 0 ? -1 : value > 0 ? 1 : 0);

/**
 * The Membership_State sort rank: active rows come first.
 *
 * A positive test on `active` rather than a test against `inactive`, so the rank
 * stays correct — inactive rows last — if a further state is ever named.
 */
const stateRank = (state: MembershipStateValue): 0 | 1 =>
  state === 'active' ? 0 : 1;

/**
 * Compares two membership identities by code unit.
 *
 * Deliberately neither case-insensitive nor locale-aware, for the same reason as
 * the Squad_Card tie-break: this is the key that separates everything the name
 * comparison leaves equal, so it must be as fine-grained and as
 * runtime-independent as possible. An identity is opaque to this feature —
 * comparing one is only ever a tie-break, never a statement about what it means.
 */
const compareIdentity = (left: string, right: string): Comparison =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * The Player_Order comparator: active before inactive, then display name
 * ascending case-insensitively, then membership identity ascending
 * (Requirement 7.4).
 *
 * Total over every pair of rows and free of exceptions. It returns `0` only for
 * two rows carrying the same membership identity, which the backend guarantees is
 * unique within a squad — so over a real Player_List no two distinct rows compare
 * equal and the induced order is fully determined by the composed input rather
 * than partly inherited from the arrival order of `members`. `GetSquad` promises
 * no ordering, so a person must not see the list rearrange between two loads of
 * the same squad.
 *
 * The name key is *case-insensitive*, which is a weaker relation than string
 * equality: under `sensitivity: 'base'` the names `dave`, `Dave`, and `dāve` all
 * compare equal, and the identity key then separates them deterministically. That
 * fall-through is the whole reason the tie-break exists. The collation is the
 * runtime's own — `localeCompare` with no locale argument, as the design
 * specifies — so the relation is a function of the input alone within a given
 * runtime.
 *
 * Nothing else is an ordering key. In particular the guest flag, the role, the
 * Former_Player flag, and the rating are all *not* keys: no criterion asks for
 * guests last or for the highest rating first, and sorting by rating would make
 * the order depend on whether the leaderboard call happened to land.
 *
 * @returns `-1` when `left` sorts before `right`, `1` when after, `0` when the two
 *   are the same membership
 *
 * Requirements: 7.4
 */
export function comparePlayerRows(
  left: PlayerListRow,
  right: PlayerListRow,
): Comparison {
  // 7.4: every active membership before every inactive one.
  const byState = sign(stateRank(left.state) - stateRank(right.state));

  if (byState !== 0) {
    return byState;
  }

  const byName = sign(
    left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
    }),
  );

  if (byName !== 0) {
    return byName;
  }

  // Reached whenever the names are equal *under the collation* — which includes
  // names differing only in case or in accent, not just identical strings.
  return compareIdentity(left.membershipId, right.membershipId);
}

/**
 * Indexes a leaderboard's entries by membership identity.
 *
 * Identities are compared **exactly**, as Requirement 8.1's matching does: an
 * identity is opaque here, so it is neither trimmed nor case-folded first.
 *
 * A parsed leaderboard cannot carry two entries for one membership —
 * `parseDisplayRatingLeaderboard` fails such a body outright, so no player gets a
 * rating derived from an ambiguous one (Requirement 8.11). The first-wins guard is
 * therefore unreachable through the parser and exists only so that this function
 * is deterministic for *every* input, not just parser-produced ones.
 */
const indexEntriesByMembership = (
  leaderboard: DisplayRatingLeaderboard,
): ReadonlyMap<string, DisplayRatingEntry> => {
  const entries = new Map<string, DisplayRatingEntry>();

  for (const entry of leaderboard.entries) {
    if (!entries.has(entry.membershipId)) {
      entries.set(entry.membershipId, entry);
    }
  }

  return entries;
};

/** One Player_Row from one Squad_Member and the rating data available for it. */
const toPlayerListRow = (
  member: SquadMember,
  leaderboardObtained: boolean,
  ratingEntry: DisplayRatingEntry | null,
): PlayerListRow => ({
  membershipId: member.membershipId,
  displayName: member.displayName,
  role: member.role,
  state: member.state,
  isGuest: member.isGuest,
  isFormerPlayer: isAnonymisedPlaceholder(member.displayName),
  leaderboardObtained,
  ratingEntry,
});

/**
 * The Player_List for a parsed Squad_Detail, decorated by an optional parsed
 * Display_Rating_Leaderboard and returned in the Player_Order — the single pure
 * composition function Requirement 7.3 asks for.
 *
 * Exactly one row per Squad_Member of `detail`, in the same multiplicity: this
 * function selects nothing, adds nothing, and merges nothing. A leaderboard entry
 * matching no member contributes no row (Requirement 7.2), which is what makes the
 * list's membership a function of `GetSquad` alone.
 *
 * Pure and deterministic: `detail.members` is copied before sorting, so the
 * caller's collection is never reordered in place, and composing the same inputs
 * twice yields equal results (Requirement 20.5). Independent of the supplied order
 * and idempotent under re-ordering, because {@link comparePlayerRows} never falls
 * back to position.
 *
 * @param detail the parsed `GetSquad` result — the authority on membership
 * @param leaderboard the parsed `GetSquadLeaderboard` result, or `null` when it
 *   was not obtained: the call failed, timed out, or returned a body the parser
 *   rejected (Requirement 7.10)
 * @returns a new collection of rows, ordered by {@link comparePlayerRows}
 *
 * Requirements: 7.2, 7.3, 7.4
 */
export function composePlayerList(
  detail: SquadDetail,
  leaderboard: DisplayRatingLeaderboard | null,
): readonly PlayerListRow[] {
  const leaderboardObtained = leaderboard !== null;
  const entries =
    leaderboard === null ? null : indexEntriesByMembership(leaderboard);

  const rows = detail.members.map((member) =>
    toPlayerListRow(
      member,
      leaderboardObtained,
      entries?.get(member.membershipId) ?? null,
    ),
  );

  return rows.sort(comparePlayerRows);
}
