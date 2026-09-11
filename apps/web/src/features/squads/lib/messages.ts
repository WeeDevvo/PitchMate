/**
 * The Squads_Feature's fixed user-facing strings — one string per user-facing
 * outcome, declared once.
 *
 * Two rules shape this module, and both are structural rather than editorial:
 *
 *  - **Non-disclosure is a property of the copy, not of the caller.** There is
 *    exactly one {@link GENERIC_SQUADS_FAILURE} for every transport failure,
 *    lapsed Squad_Call_Timeout, and parse failure; exactly one
 *    Not_Found_Treatment whose content does not vary with cause; and exactly one
 *    {@link INVITE_UNUSABLE} covering an invite that matches nothing, is
 *    revoked, and is expired alike. A screen that reached for a
 *    cause-specific sentence would find none here (Requirements 4.8, 5.10, 6.4,
 *    17.1, 17.2).
 *  - **No message takes an interpolation parameter.** Every export is a plain
 *    constant string, so there is no seam through which an Invite_Secret, a
 *    squad name, a status code, a request path, or a response body value could
 *    reach a message. The absence of the parameter is the mechanism; the
 *    intention alone would not be testable (Requirements 4.10, 17.2).
 *
 * Every component and screen of the feature reads its copy from here, so no
 * surface invents wording that a non-disclosure property would then have to
 * chase.
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirement 18.2): it declares constants and touches nothing.
 *
 * Requirements: 2.4, 4.8, 5.10, 6.4, 7.12, 8.4, 8.13, 11.6, 12.4, 14.8, 15.2,
 * 17.1, 17.2
 */

/**
 * The one message shown for every Squads_Api call that fails at the transport
 * layer, reaches the Squad_Call_Timeout, or returns a body the Response_Parser
 * rejects (Requirements 17.1, 17.2).
 *
 * It names no squad, no membership, and no invite, and carries no digit — so no
 * status code, no count, and no identity can have been folded into it. That is
 * what makes a squad the caller cannot see indistinguishable from a network that
 * dropped, which is the whole point of Requirement 17.1.
 */
export const GENERIC_SQUADS_FAILURE =
  'Something went wrong just now. Please try again.';

/**
 * The heading of the Not_Found_Treatment (Requirements 6.4, 6.5).
 *
 * The Squad_Screen renders this in place of the squad name when `GetSquad`
 * reports not-found — including the backend's `403`, folded deliberately, and
 * the locally detected malformed `squadId`, for which no call is issued at all.
 * The content is identical for every cause.
 */
export const NOT_FOUND_TREATMENT_HEADING = 'Squad not found';

/**
 * The body of the Not_Found_Treatment (Requirements 6.4, 6.5, 17.7).
 *
 * It states the outcome and asserts nothing beyond it: not that the squad
 * exists, not that it does not exist, and not which of the two reasons applies.
 * Naming both possibilities in one sentence is what keeps the two causes
 * indistinguishable — a person who is not a member reads exactly what a person
 * who mistyped an identifier reads.
 */
export const NOT_FOUND_TREATMENT_BODY =
  'This squad was not found, or it is not available to you.';

/**
 * The visible label of the Not_Found_Treatment control that navigates to the
 * Squads_Home (Requirement 6.4).
 *
 * It names the destination it reaches rather than saying "go back", because the
 * requested path is not somewhere the person can usefully return to.
 */
export const NOT_FOUND_TREATMENT_HOME_LABEL = 'Go to your squads';

/**
 * The one outcome message shown when a presented Invite_Secret matches no
 * invite, is revoked, or is expired (Requirements 4.8, 5.10).
 *
 * Identical for all three outcomes, so the response reveals nothing about which
 * invites exist. It takes no parameter, so the secret that was presented cannot
 * be echoed back into it (Requirement 4.10).
 */
export const INVITE_UNUSABLE =
  'This invite cannot be used. Ask a squad admin for a new one.';

/**
 * Shown on the Invite_Landing_Route when the Invite_Secret cannot be extracted
 * from the requested path — an absent, empty, whitespace-only, or undecodable
 * `code` segment (Requirement 5.9).
 *
 * Distinct from {@link INVITE_UNUSABLE} because nothing was presented to the
 * backend: no `PreviewInvite` and no `RedeemInvite` call is issued, so this
 * states a problem with the address rather than an outcome of a redemption.
 */
export const INVITE_LINK_INCOMPLETE =
  'This invite link is incomplete. Ask for the full link, or for the short code.';

/**
 * The Provisional_Band label, shown for a Squad_Member with no
 * Display_Rating_Leaderboard entry (Requirements 8.3, 8.4, 8.12).
 *
 * The leaderboard excludes a membership whose display rating is not yet
 * established, which conflates "provisional" with "no completed matches" — so
 * the label asserts only the absence it is evidence of. It therefore carries no
 * digit, no approximation or range indicator, no count of matches played, and no
 * reason, and it is identical on every row that presents a band, whatever that
 * member's role, state, or guest flag.
 */
export const PROVISIONAL_BAND_LABEL = 'No settled rating yet';

/**
 * The Rating_Unavailable label, shown on **every** Player_Row when the
 * Display_Rating_Leaderboard could not be obtained (Requirements 7.10, 8.13).
 *
 * Plural and impersonal by design: the leaderboard call failed for the squad, so
 * the label says nothing about any individual player's rating and carries no
 * digit. A leaderboard failure degrades the rating column and nothing else — the
 * player list still renders.
 */
export const RATING_UNAVAILABLE_LABEL = 'Ratings unavailable';

/**
 * The first Squads_Empty_State statement: the signed-in person belongs to no
 * squad yet (Requirement 2.4).
 *
 * An empty listing is an absence, not a failure, so it reads as a statement of
 * where the person stands and renders no error indication.
 */
export const SQUADS_EMPTY_STATE_NO_SQUADS = 'You do not belong to a squad yet.';

/**
 * The second Squads_Empty_State statement: a squad can be created or joined with
 * an invite (Requirement 2.4).
 *
 * It names both routes forward because both entry points stay rendered beside
 * it — the statement explains the options, the controls perform them.
 */
export const SQUADS_EMPTY_STATE_NEXT_STEP =
  'Create a squad, or join one with an invite.';

/**
 * Shown in place of the Player_List when the parsed Squad_Member collection is
 * empty (Requirement 7.12).
 *
 * An absence again, not a failure: no error indication accompanies it.
 */
export const NO_PLAYERS_STATEMENT = 'This squad has no players yet.';

/**
 * Shown in place of the Feature_Toggle set when the Squad_Detail carries no
 * Feature_Flag (Requirement 14.8).
 *
 * Squads opt in to optional capabilities, so having none is a coherent state
 * rather than a fault.
 */
export const NO_OPTIONAL_FEATURES_STATEMENT =
  'This squad has no optional features.';

/**
 * The matches Placeholder_Section statement, rendered while no matches content
 * is injected (Requirement 15.2).
 *
 * It names what the section will show and states that it is not available yet,
 * so the screen makes sense before the match-lifecycle feature supplies the
 * slot's content.
 */
export const MATCHES_PLACEHOLDER_STATEMENT =
  'Matches for this squad will appear here. Organising a match is not available yet.';

/**
 * The stats Placeholder_Section statement, rendered while no stats content is
 * injected (Requirement 15.2).
 *
 * The Squad_Screen does read the display-rating leaderboard for the Player_List,
 * but it renders no leaderboard content — hence a placeholder here rather than a
 * failure or an empty table.
 */
export const STATS_PLACEHOLDER_STATEMENT =
  'Squad stats and leaderboards will appear here. They are not available yet.';

/**
 * The Lawful_Basis_Acknowledgement wording an admin must accept before a guest
 * is created (Requirement 12.4).
 *
 * A guest is personal data about someone who has not signed up, so the
 * acknowledgement is a deliberate act per guest: the control is rendered
 * unselected on every opening of the Guest_Form for creation, and this wording
 * states in text what is being confirmed rather than burying it in terms.
 */
export const LAWFUL_BASIS_ACKNOWLEDGEMENT =
  'I confirm I have a lawful basis for recording this player, and that they are aware.';

/**
 * The Invite_Reveal statement that the generated Invite_Link and Invite_Code are
 * shown once (Requirement 11.6).
 *
 * True by construction rather than by policy: the values live only in the
 * reveal state, which is cleared on dismissal and on unmount, and neither is
 * written to browser storage (Requirement 11.7). The statement tells the admin
 * that before they navigate away.
 */
export const INVITE_SHOWN_ONCE =
  'This link and code are shown once. Copy them now, because they cannot be shown again.';

/**
 * The Squad_Card and Player_Row label for a parsed membership that carries no
 * Member_Role (Requirement 1.6).
 *
 * Rendered *in place of* a role label rather than beside one, so no card ever
 * names owner, admin, or member for a membership whose role the read model did
 * not carry. The absence is stated in text, not conveyed by an empty space.
 */
export const NO_ROLE_RECORDED_LABEL = 'No role recorded';

/**
 * The Squad_Card label for a parsed membership that carries no Membership_State
 * (Requirement 1.7).
 *
 * Same treatment as {@link NO_ROLE_RECORDED_LABEL}: stated in text, and never
 * accompanied by a label naming active or inactive.
 */
export const NO_MEMBERSHIP_STATE_RECORDED_LABEL = 'No membership state recorded';

/**
 * The Invite_Summary label shown in place of an expiry instant for an invite
 * with no expiry (Requirement 11.2).
 *
 * A non-expiring invite is a deliberate choice at generation time, so the
 * listing states it rather than leaving the expiry column blank.
 */
export const INVITE_NEVER_EXPIRES_LABEL = 'Does not expire';
