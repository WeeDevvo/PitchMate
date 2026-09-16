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
 * Requirements: 1.9, 2.4, 4.8, 4.9, 5.10, 6.4, 7.12, 8.4, 8.13, 11.6, 12.4,
 * 14.8, 15.2, 17.1, 17.2
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
 * The three Member_Role labels, and the two Membership_State labels, as rendered
 * on a Squad_Card and on a Player_Row (Requirements 1.5, 19.3).
 *
 * They live here rather than beside the components that render them for the same
 * reason every other string does: a role named on a card and the same role named
 * on a Player_Row must read identically, and a shared constant is the only
 * arrangement in which they cannot drift apart.
 *
 * Each is a **word**, not a colour. Requirement 19.3 asks for every Member_Role
 * and Membership_State to be conveyed in text *in addition to* any colour or
 * icon, so these labels carry the value on their own and any hue a stylesheet
 * adds is decoration over them.
 */
export const OWNER_ROLE_LABEL = 'Owner';

/** The `admin` Member_Role label. See {@link OWNER_ROLE_LABEL}. */
export const ADMIN_ROLE_LABEL = 'Admin';

/** The `member` Member_Role label. See {@link OWNER_ROLE_LABEL}. */
export const MEMBER_ROLE_LABEL = 'Member';

/** The `active` Membership_State label. See {@link OWNER_ROLE_LABEL}. */
export const ACTIVE_STATE_LABEL = 'Active';

/**
 * The `inactive` Membership_State label. See {@link OWNER_ROLE_LABEL}.
 *
 * An inactive membership has left or been removed and keeps its ratings, stats,
 * and history, so the label states the state rather than an absence.
 */
export const INACTIVE_STATE_LABEL = 'Inactive';

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
 * The Player_Row label naming a membership as a guest (Requirements 7.5, 7.6).
 *
 * A guest is a player who lives inside one squad with no account behind them, so
 * the label states a fact about the membership rather than a lesser status. It is
 * rendered **in place of** a Member_Role label when the membership carries no
 * role, which is the case the backend produces for every guest — so no Player_Row
 * ever names owner, admin, or member for a guest (Requirement 7.6).
 *
 * A word, not a hue: Requirement 19.3 fixes that the Guest_Flag is conveyed in
 * text in addition to the `--squads-guest-text` colour the token table declares.
 */
export const GUEST_LABEL = 'Guest';

/**
 * The Player_Row label naming an entry as a Former_Player — a membership whose
 * Player_Display_Name is the Anonymised_Placeholder (Requirement 7.8).
 *
 * Erasure is anonymisation rather than deletion: the membership keeps its ratings,
 * stats, and match history so completed matches stay immutable and rating replay
 * stays valid, and only the identifying data is stripped. The label says exactly
 * that much. It states no reason for the erasure, names nobody, and adds the
 * "details removed" clause so a reader understands why the row's name reads as a
 * placeholder rather than as a person — which the placeholder alone does not
 * convey.
 *
 * The row keeps its navigation to the Player_Stats_Route, so the retained stats
 * remain reachable (Requirement 9.8); what it loses is the Promotion_Control and
 * the guest edit action (Requirement 7.8).
 */
export const FORMER_PLAYER_LABEL = 'Former player, details removed';

/**
 * The visible label of the Promotion_Control on an eligible Player_Row
 * (Requirement 13.1).
 *
 * It names the act and nothing else. The control's accessible name is built by
 * the row from this label and that player's display name, the way
 * `RatingBadge` builds its own — no message here takes an interpolation
 * parameter, so a name is composed at the call site rather than folded into copy.
 *
 * Promotion is the only membership-changing action in the feature: no control
 * demotes an admin, transfers a squad, or removes a membership
 * (Requirement 13.8), so there is no sibling label here.
 */
export const PROMOTE_TO_ADMIN_LABEL = 'Make admin';

/**
 * The visible label of the guest edit control on an editable guest Player_Row
 * (Requirement 12.7).
 *
 * Rendered only while the caller holds Admin_Authority, only on a row whose
 * Guest_Flag is set, and never on a Former_Player row. Like the promotion label,
 * the row composes the player's name into the control's accessible name rather
 * than this string carrying a parameter.
 */
export const EDIT_GUEST_LABEL = 'Edit guest';

/**
 * The Invite_Summary label shown in place of an expiry instant for an invite
 * with no expiry (Requirement 11.2).
 *
 * A non-expiring invite is a deliberate choice at generation time, so the
 * listing states it rather than leaving the expiry column blank.
 */
export const INVITE_NEVER_EXPIRES_LABEL = 'Does not expire';
/**
 * The label of the control that closes an open form or confirmation surface
 * without submitting it (Requirements 19.7, 19.8).
 *
 * One label for both surfaces, because both do the same thing: the Form_Panel's
 * cancel control and the Confirm_Dialog's dismiss control take the same path as
 * the Escape key, so wording them differently would suggest a difference that
 * does not exist. It names the act rather than the surface — "Cancel" reads
 * correctly whether the surface is the create-squad form or the confirmation
 * before revoking an invite — so no surface needs a label of its own.
 */
export const CANCEL_LABEL = 'Cancel';

/**
 * The heading of the Create_Squad_Form's panel, which is also what the
 * Create_Squad entry point's control is named after (Requirement 3.1).
 */
export const CREATE_SQUAD_HEADING = 'Create a squad';

/** The visible label of the Create_Squad_Form's submit control (Requirement 3.1). */
export const CREATE_SQUAD_SUBMIT_LABEL = 'Create squad';

/**
 * The persistently visible label of the Squad_Name field (Requirement 3.1).
 *
 * Rendered as label text rather than as placeholder text, so it survives the
 * field being filled in — which is what "persistently visible" asks for.
 */
export const SQUAD_NAME_LABEL = 'Squad name';

/**
 * The persistently visible label of the creator's Player_Display_Name field on
 * the Create_Squad_Form (Requirement 3.1).
 *
 * It says *in this squad* because a display name is squad-scoped and unique
 * within the squad, so it is not the same thing as the person's account name.
 */
export const CREATOR_DISPLAY_NAME_LABEL = 'Your display name in this squad';

/**
 * The validation message associated with the Squad_Name field when it is empty
 * after trimming (Requirement 3.3).
 *
 * A client-side rule the form can settle on its own, so it is a field message
 * rather than an outcome message — the distinction Requirement 3.9 turns on.
 */
export const SQUAD_NAME_REQUIRED_MESSAGE = 'Enter a name for the squad.';

/**
 * The validation message associated with the Squad_Name field when it exceeds
 * the backend's column after trimming (Requirement 3.3).
 *
 * The bound is written as a literal because no message here takes an
 * interpolation parameter; `nameValidation.NAME_MAX_LENGTH` is the authority and
 * the forms' tests assert this copy states that same number.
 */
export const SQUAD_NAME_TOO_LONG_MESSAGE =
  'Squad name must be 100 characters or fewer.';

/**
 * The validation message associated with a Player_Display_Name field that is
 * required and empty after trimming (Requirement 3.3).
 */
export const DISPLAY_NAME_REQUIRED_MESSAGE = 'Enter your display name.';

/**
 * The validation message associated with a Player_Display_Name field that
 * exceeds the backend's column after trimming (Requirement 3.3).
 *
 * See {@link SQUAD_NAME_TOO_LONG_MESSAGE} on why the bound is a literal.
 */
export const DISPLAY_NAME_TOO_LONG_MESSAGE =
  'Display name must be 100 characters or fewer.';

/**
 * The heading of the Join_Code_Form's panel, which is also what the Join_Squad
 * entry point's control is named after (Requirement 4.1).
 */
export const JOIN_SQUAD_HEADING = 'Join a squad';

/** The visible label of the Join_Code_Form's submit control (Requirement 4.1). */
export const JOIN_SQUAD_SUBMIT_LABEL = 'Join squad';

/**
 * The persistently visible label of the Invite_Secret field (Requirement 4.1).
 *
 * It names both shapes an invite arrives in, because the form accepts either and
 * `redeemableValueFrom` reduces both to the one value the backend matches
 * (Requirement 4.4). The label is the *only* place either word appears — no
 * message here carries the secret itself (Requirement 4.10).
 */
export const INVITE_SECRET_LABEL = 'Invite link or code';

/**
 * The persistently visible label of the optional Player_Display_Name field on
 * the Join_Code_Form (Requirement 4.1).
 *
 * The optionality is stated in the label rather than left to be discovered by
 * submitting: the field may be left empty, and the display name is then omitted
 * from `RedeemInvite` entirely (Requirement 4.2).
 */
export const JOIN_DISPLAY_NAME_LABEL =
  'Your display name in this squad (optional)';

/**
 * The validation message associated with the Invite_Secret field when it is
 * empty after trimming (Requirement 4.3).
 *
 * It names what to enter and nothing about what was entered, so the secret
 * cannot travel through it (Requirement 4.10).
 */
export const INVITE_SECRET_REQUIRED_MESSAGE = 'Enter the invite link or code.';

/**
 * The Squads_Home's level-one heading — the one `h1` of that screen, naming the
 * squads listing as its subject (Requirement 1.9).
 *
 * It says *your* squads because the listing is `ListMySquads`: every card on the
 * screen is a squad the signed-in person belongs to, and nothing else is
 * reachable from it.
 */
export const SQUADS_HOME_HEADING = 'Your squads';

/**
 * The Squads_Home's loading label, handed to the shared `LoadingIndication`
 * while a `ListMySquads` call awaits a response (Requirements 1.10, 1.15).
 *
 * The label is the surface's rather than the component's, because what is being
 * awaited differs per screen — this one names the listing it is waiting for, so
 * a person hears "Loading your squads" rather than a bare "Loading".
 */
export const SQUADS_LOADING_LABEL = 'Loading your squads';

/**
 * The visible label of the Squads_Home's retry control, rendered beside
 * {@link GENERIC_SQUADS_FAILURE} when the listing could not be loaded
 * (Requirements 2.5, 2.6).
 *
 * Deliberately the plainest wording available: the failure message immediately
 * before it already states what happened, so the control names only the act. It
 * is the sole retry control on this screen, so nothing further is needed to tell
 * it apart.
 */
export const SQUADS_RETRY_LABEL = 'Try again';

/**
 * The outcome message shown when the backend reports that a
 * Player_Display_Name cannot be used within the squad (Requirements 3.9, 4.9).
 *
 * It is an **outcome** message rather than a field validation message, because
 * the backend is the authority on whether a display name is available and no
 * client-side rule could have known: the form stays rendered with every entered
 * value retained and its submit control available for a further submission.
 *
 * Like every message here it takes no parameter, so the name that was rejected
 * is not echoed back — the field still holds it, which is where the person can
 * edit it.
 */
export const DISPLAY_NAME_UNAVAILABLE =
  'That display name cannot be used in this squad. Choose another one.';
