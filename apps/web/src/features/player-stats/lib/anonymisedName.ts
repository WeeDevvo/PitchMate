/**
 * The Player_Stats_Feature's one recognition of an erased membership.
 *
 * Erasure in PitchMate is anonymisation rather than deletion: a membership whose
 * person has been erased keeps its ratings, its stats, and its match history, so
 * completed matches stay immutable and rating replay stays valid, and only the
 * identifying data is stripped. The backend writes a fixed placeholder over the
 * membership's own name, and this module is where this feature reads that.
 *
 * Two surfaces consume the answer and neither re-decides it: the
 * Player_Identity_Header presents the subject as a Former_Player while still
 * rendering every statistic the Player_Profile carries and no control that would
 * act on the membership (Requirement 5.5), and a Pairwise_Section entry presents
 * as a Former_Player while keeping its Pairwise_Link, so an erased membership's
 * own stats stay reachable (Requirement 10.8). Requirement 5.7 asks for that
 * recognition to be a pure function of the name, depending on neither React nor
 * the DOM — which is what makes both presentations testable without rendering
 * anything.
 *
 * The comparison is **exact after trimming** and nothing is a heuristic: not case
 * insensitive, not a prefix test, not a match on "former". The cost of guessing
 * runs the wrong way. A person who genuinely calls themselves `former player` in
 * another case would otherwise be labelled as erased on their own stats screen,
 * which is worse than the opposite miss, and this feature renders no control that
 * the recognition could usefully withhold anyway.
 *
 * The placeholder is declared here as a literal rather than imported from the
 * Squads_Feature, because `lib/` resolves every relative import inside itself and
 * this feature imports no other feature's internals (Requirements 14.3, 14.4) —
 * the same reason `lib/identifiers.ts` declares its own identity pattern. The two
 * declarations answer identically by construction: each is pinned to the backend's
 * `SquadMembership.DisplayNamePlaceholder` value by its own property test, so a
 * row in a squad's player list and the screen that row opens agree on what a
 * Former_Player is.
 *
 * Requirements: 5.5, 5.7, 10.8
 */

/**
 * The display name the backend writes over a membership's own name when the
 * person behind it is erased — `SquadMembership.DisplayNamePlaceholder`.
 *
 * The one copy of that name in this feature, so the subject's Former_Player
 * presentation (Requirement 5.5) and a Pairwise_Section entry's (Requirement
 * 10.8) recognise the same set of names.
 */
export const ANONYMISED_PLACEHOLDER = 'Former player';

/**
 * Whether a Player_Display_Name is the Anonymised_Placeholder.
 *
 * Trimming is `String.prototype.trim`, so leading and trailing whitespace — a
 * non-breaking space or a BOM included, which a name pasted from elsewhere can
 * easily carry — does not hide the placeholder. Interior whitespace is untouched,
 * so `Former  player` is an ordinary name.
 *
 * Pure, total, and free of exceptions: one trim and one string comparison, with no
 * coercion and no structure to recurse into. Nothing here rewrites a name for
 * display; a name reaches the screen exactly as parsed, and this answers only
 * whether the screen presents it as a Former_Player.
 *
 * @param displayName the Player_Display_Name exactly as parsed, whether the
 *   subject's own or a Pairwise_Section entry's
 * @returns `true` only when the trimmed name equals {@link ANONYMISED_PLACEHOLDER}
 *
 * Requirements: 5.5, 5.7, 10.8
 */
export function isAnonymisedPlaceholder(displayName: string): boolean {
  return displayName.trim() === ANONYMISED_PLACEHOLDER;
}
