/**
 * The Player_Stats_Feature's fixed user-facing strings — one string per
 * user-facing outcome, label, and absence, declared exactly once.
 *
 * Three rules shape this module, and all three are structural rather than
 * editorial:
 *
 *  - **No message takes an interpolation parameter.** Every export is a plain
 *    constant string, so there is no seam through which a squad identity, a
 *    membership identity, a Player_Display_Name, a status code, or any part of a
 *    rejected response body could reach a message. The absence of the parameter
 *    is the mechanism; an intention not to interpolate would not be testable
 *    (Requirements 3.7, 4.2). Where a requirement asks for a player's name
 *    inside an accessible name, the surface composes that name as a value beside
 *    a label from here — the way the squads feature's `RatingBadge` does.
 *  - **Non-disclosure is a property of the copy, not of the caller.** There is
 *    exactly one {@link GENERIC_PROFILE_FAILURE} for every transport failure,
 *    lapsed Profile_Call_Timeout, and parse failure, and exactly one
 *    Not_Found_Treatment whose content does not vary with cause — a non-existent
 *    squad, a non-existent membership, a membership in another squad, a caller
 *    who is not an active member, and a missing, malformed, or expired token read
 *    identically, as does a locally rejected malformed path for which no call is
 *    issued at all (Requirements 3.2, 3.5, 4.2). A component reaching for a
 *    cause-specific sentence would find none here.
 *  - **An absence is stated, never implied.** Every "no data" condition on this
 *    screen has a sentence of its own, because the alternative — a blank space, a
 *    dash, or a zero — either says nothing or asserts something false. A zero
 *    rating is not an absent rating, and "no matches played" is not "rating still
 *    settling" (Requirements 6.4, 7.4, 7.5, 7.6, 11.4).
 *
 * Two distinctness obligations are carried by the wording here and asserted at
 * the render sites:
 *
 *  - The four Rating_Condition presentations must be mutually distinguishable
 *    (Requirement 7.6), so {@link RATING_PROVISIONAL},
 *    {@link RATING_NEVER_PLAYED}, and {@link RATING_ABSENT} are pairwise
 *    distinct and none is a substring of another. The fourth condition,
 *    Established_Rating, presents the Display_Rating itself. This is the
 *    conflation the shipped squads player list currently carries, and separating
 *    the copy is half of the fix (Property 18).
 *  - {@link TRACKING_DISABLED} and {@link TRACKING_EMPTY} must be distinct, and
 *    neither may contain the other, so a squad that does not record live detail
 *    is never presented as a squad that records it and has none (Requirements
 *    11.1, 11.2, 11.6; Property 26).
 *
 * Every component and screen of the feature reads its copy from here, so no
 * surface invents wording that a non-disclosure or distinctness property would
 * then have to chase.
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirement 14.3): it declares constants and touches nothing.
 *
 * Requirements: 3.5, 4.2, 5.2, 5.3, 5.4, 5.5, 5.6, 6.4, 6.6, 7.3, 7.4, 7.5,
 * 7.9, 8.6, 9.1, 9.3, 9.4, 10.1, 10.7, 11.1, 11.2, 11.3, 11.4
 */

/* -------------------------------------------------------------------------- */
/* Boundary states: failure, not-found, loading, and the way back             */
/* -------------------------------------------------------------------------- */

/**
 * The one message shown for every `GetPlayerProfile` call that fails at the
 * transport layer, reaches the Profile_Call_Timeout, or returns a body the
 * Response_Parser rejects (Requirements 4.1, 4.2).
 *
 * It names no squad, no membership, and no player, and carries no digit — so no
 * status code, no count, and no identity can have been folded into it. That is
 * what makes a server that failed indistinguishable from a network that dropped
 * and from a body that would not parse, which is the whole of Requirement 4.2.
 */
export const GENERIC_PROFILE_FAILURE =
  'Something went wrong just now. Please try again.';

/**
 * The visible label of the retry control rendered beside
 * {@link GENERIC_PROFILE_FAILURE} (Requirements 4.1, 4.4).
 *
 * The plainest wording available, because the sentence immediately before it
 * already states what happened — so the control names only the act. It is the
 * sole retry control on the screen, so nothing further is needed to tell it
 * apart.
 */
export const RETRY_LABEL = 'Try again';

/**
 * The level-one heading of the Not_Found_Treatment (Requirements 3.5, 3.6).
 *
 * Requirement 3.6 fixes that this heading names neither the squad identity, nor
 * the membership identity, nor any Player_Display_Name — so it is a fixed phrase
 * about the screen's subject rather than about a particular person, and the
 * screen still renders exactly one `h1` in this condition (Requirement 16.1).
 */
export const NOT_FOUND_TREATMENT_HEADING = 'Player not found';

/**
 * The body of the Not_Found_Treatment (Requirements 3.1, 3.2, 3.5).
 *
 * It states the outcome and asserts nothing beyond it: not that the player
 * exists, not that they do not, and not which of the five concealed causes
 * applies. Naming both possibilities in one sentence is what keeps those causes
 * indistinguishable — a person who is not a member of the squad reads exactly
 * what a person who mistyped an identifier reads, and a person whose session has
 * lapsed reads it too, because this endpoint conceals an absent session behind
 * the same response (Requirement 3.4).
 */
export const NOT_FOUND_TREATMENT_STATEMENT =
  'This player was not found, or they are not available to you.';

/**
 * The visible label of the control that navigates to the Squad_Path of the
 * route's squad identity (Requirements 1.6, 3.5).
 *
 * Rendered in every condition the screen can be in, including not-found and
 * failed, so there is always a way out that does not use the browser's history.
 * It names the destination it reaches rather than saying "go back", because the
 * requested path is not somewhere a person can usefully return to.
 */
export const BACK_TO_SQUAD_LABEL = 'Back to the squad';

/**
 * The loading label handed to the feature's `LoadingIndication` while a
 * `GetPlayerProfile` call awaits a response (Requirement 2.2).
 *
 * Names what is being awaited rather than being a bare "Loading", so a person
 * using a screen reader hears which part of the app is busy.
 */
export const PROFILE_LOADING_LABEL = 'Loading player stats';

/**
 * The level-one heading rendered while no Player_Profile is held and the screen
 * is loading or has failed (Requirements 4.1, 16.1).
 *
 * Once a profile is held the `h1` is that profile's Player_Display_Name
 * (Requirement 5.1); before then there is no name to render, and the screen
 * still owes exactly one level-one heading in every condition. It names the
 * screen's subject generically and no identity.
 */
export const PLAYER_STATS_HEADING = 'Player stats';

/* -------------------------------------------------------------------------- */
/* Identity: squad scope, membership state, guest, former player              */
/* -------------------------------------------------------------------------- */

/**
 * The statement that every statistic on the screen counts only this squad's
 * matches (Requirement 5.6).
 *
 * Ratings and stats are squad-scoped to the membership rather than to the
 * account, so a person who plays in three squads has three records. Without this
 * sentence the figures read as a career total, which they are not.
 */
export const SQUAD_SCOPE_STATEMENT =
  'Every statistic here counts only matches played in this squad.';

/**
 * The `active` Membership_State label (Requirement 5.2).
 *
 * A word, not a hue: Requirement 5.2 asks for the state to be conveyed in text
 * in addition to any colour or shape, so the label carries the value on its own
 * and any styling is decoration over it.
 */
export const ACTIVE_STATE_LABEL = 'Active';

/**
 * The `inactive` Membership_State label (Requirement 5.2).
 *
 * An inactive membership has left or been removed and keeps its ratings, stats,
 * and history — which is exactly why this screen still renders in full for one —
 * so the label states the state rather than an absence.
 */
export const INACTIVE_STATE_LABEL = 'Inactive';

/**
 * The label for a parsed Player_Profile that carries no Membership_State
 * (Requirement 5.3).
 *
 * Rendered *in place of* a state label rather than beside one, so the screen
 * never names active or inactive for a profile whose state the read model did
 * not carry. The absence is stated in text, not conveyed by an empty space.
 */
export const NO_MEMBERSHIP_STATE_RECORDED_LABEL = 'No membership state recorded';

/**
 * The label identifying the subject as a guest membership (Requirement 5.4).
 *
 * A guest is a player who lives inside one squad with no account behind them, so
 * the label states a fact about the membership rather than a lesser status. The
 * screen renders in full for a guest — Requirement 5.4 is explicit that a
 * guest's stats are not a reduced presentation.
 */
export const GUEST_LABEL = 'Guest';

/**
 * The label naming the subject as a Former_Player — a membership whose
 * Player_Display_Name is the Anonymised_Placeholder (Requirements 5.5, 10.8).
 *
 * Erasure is anonymisation rather than deletion: the membership keeps its
 * ratings, stats, and match history so completed matches stay immutable and
 * rating replay stays valid, and only the identifying data is stripped. The
 * label says exactly that much. It states no reason for the erasure, names
 * nobody, and adds the "details removed" clause so a reader understands why the
 * name reads as a placeholder rather than as a person.
 *
 * Worded identically to the squads feature's own Former_Player label, because a
 * row in the player list and the screen it opens must read alike.
 */
export const FORMER_PLAYER_LABEL = 'Former player, details removed';

/* -------------------------------------------------------------------------- */
/* Record and win percentage (Requirement 6)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rendered in place of a win percentage when the Player_Profile carries none,
 * which is the case the backend produces for a zero Appearance_Count
 * (Requirement 6.4).
 *
 * The requirement is explicit that no numeric win percentage is rendered in this
 * condition, **including no zero** — nobody who has played nothing has won zero
 * per cent of anything. Hence a sentence rather than a figure.
 */
export const NO_WIN_PERCENTAGE = 'No win percentage yet';

/**
 * Rendered where the Appearance_Count is zero (Requirement 6.6).
 *
 * The remaining sections stay rendered in their own no-data presentations rather
 * than being omitted, so the screen's shape does not change with its contents;
 * this statement is what explains the emptiness.
 */
export const NO_MATCHES_PLAYED_STATEMENT =
  'This player has played no matches in this squad yet.';

/* -------------------------------------------------------------------------- */
/* The four Rating_Conditions (Requirement 7)                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Provisional_Rating label (Requirement 7.3).
 *
 * A provisional rating is one whose uncertainty is still high, so there is no
 * firm number to assert and this label asserts none: it carries no digit, no
 * approximation or range indicator, and no count of matches played. The surface
 * pairs it with a badge so the condition survives a greyscale rendering
 * (Requirements 7.3, 16.6).
 *
 * Distinct from {@link RATING_NEVER_PLAYED} and {@link RATING_ABSENT}, and a
 * substring of neither (Requirement 7.6).
 */
export const RATING_PROVISIONAL = 'Rating still settling';

/**
 * The Never_Played label (Requirement 7.4).
 *
 * A player with no appearances has no rating because there is nothing yet to
 * rate — a different statement from a rating that exists and has not settled,
 * and a different statement again from a rating the read model did not carry.
 * Conflating the first two is the bug this feature is partly here to fix, so the
 * wording states the reason rather than only the absence.
 */
export const RATING_NEVER_PLAYED = 'No rating yet, as no matches have been played';

/**
 * The Rating_Absent label (Requirement 7.5).
 *
 * The residual condition: the player has appearances, yet the Rating_Summary
 * carries neither a Rating_State nor a Display_Rating. It states the absence and
 * offers no reason, because the read model gave none.
 */
export const RATING_ABSENT = 'No rating recorded';

/**
 * The statement that the rating is squad-scoped and exists to balance teams
 * within this squad, rendered in every Rating_Condition (Requirement 7.9).
 *
 * The number on this screen is presentational: balancing works from the full
 * rating model, the display value is the backend's own derivation from it, and
 * neither is a cross-squad ranking. Saying what the rating is *for* is what stops
 * it being read as a league table of friends.
 */
export const RATING_SQUAD_SCOPE_STATEMENT =
  'This rating is scoped to this squad, and exists to balance teams within it.';

/* -------------------------------------------------------------------------- */
/* Rating progression (Requirement 8)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Rendered where the Progression_Series is empty (Requirement 8.6).
 *
 * Neither the Progression_Chart nor an empty set of axes is rendered in this
 * condition, so this sentence stands in for the whole section — an empty chart
 * frame would imply a history that happens to be flat.
 */
export const NO_RATING_HISTORY = 'No rating history yet.';

/* -------------------------------------------------------------------------- */
/* Streaks and bib appearances (Requirement 9)                                */
/* -------------------------------------------------------------------------- */

/**
 * The label naming the Win_Streak (Requirements 9.1, 9.2).
 *
 * The two streak labels are separately worded because Requirement 9.2 asks for
 * two separately labelled values such that neither can be mistaken for the
 * other — an unbeaten run includes draws and a winning run does not, so a shared
 * label would be wrong as well as ambiguous.
 */
export const WIN_STREAK_LABEL = 'Longest winning run';

/** The label naming the Unbeaten_Streak. See {@link WIN_STREAK_LABEL}. */
export const UNBEATEN_STREAK_LABEL = 'Longest unbeaten run';

/**
 * Rendered alongside a zero Win_Streak or a zero Unbeaten_Streak
 * (Requirement 9.3).
 *
 * The value stays rendered rather than being omitted — the requirement asks for
 * both — so this statement explains a zero rather than replacing it.
 */
export const NO_RUN_RECORDED_STATEMENT = 'No run recorded yet.';

/**
 * The label naming the Bib_Appearance_Count (Requirement 9.4).
 *
 * The fun one, and rendered for every profile including one with no appearances
 * (Requirement 9.5).
 */
export const BIB_APPEARANCES_LABEL = 'Bib appearances';

/* -------------------------------------------------------------------------- */
/* The four Pairwise_Sections (Requirement 10)                                */
/* -------------------------------------------------------------------------- */

/**
 * The heading of the most-played-with section (Requirement 10.1).
 *
 * Each of the four headings names what its section measures, because the four
 * are easily confused: two count appearances and two report win percentages, and
 * two are about team-mates while two are about opponents.
 */
export const MOST_PLAYED_WITH_HEADING = 'Most played with';

/** The heading of the most-played-against section. See {@link MOST_PLAYED_WITH_HEADING}. */
export const MOST_PLAYED_AGAINST_HEADING = 'Most played against';

/**
 * The heading of the best-partnerships section — the team-mates this player wins
 * most often alongside. See {@link MOST_PLAYED_WITH_HEADING}.
 */
export const BEST_PARTNERSHIPS_HEADING = 'Best partnerships';

/**
 * The heading of the bogey-opponents section — the opponents this player wins
 * least often against. See {@link MOST_PLAYED_WITH_HEADING}.
 */
export const BOGEY_OPPONENTS_HEADING = 'Bogey opponents';

/**
 * Rendered under a Pairwise_Section's heading when that section carries no entry
 * (Requirement 10.7).
 *
 * The heading stays rendered beside it, so the section's shape does not change
 * with its contents. One statement serves all four sections: an absence of
 * entries means the same thing in each, and four near-identical sentences would
 * only invite them to drift apart.
 */
export const PAIRWISE_NOTHING_YET_STATEMENT = 'Nothing to show here yet.';

/* -------------------------------------------------------------------------- */
/* Rich stats and the two tracking conditions (Requirement 11)                */
/* -------------------------------------------------------------------------- */

/**
 * The Tracking_Disabled_Condition statement: this squad does not record live
 * match detail (Requirement 11.1).
 *
 * The condition the backend reports by omitting the Rich_Stats block entirely,
 * which is what it does when the squad's live-match-tracking feature is off. No
 * goals, clean-sheets, goals-conceded, or Keeper_Time value is rendered in this
 * condition — not even a no-data statement per statistic, because the statistics
 * themselves are not part of this squad's experience.
 *
 * Distinct from {@link TRACKING_EMPTY}, and neither contains the other
 * (Requirements 11.2, 11.6).
 */
export const TRACKING_DISABLED = 'This squad does not record live match detail.';

/**
 * The Tracking_Empty_Condition statement: live match detail is recorded, but
 * none exists yet (Requirement 11.2).
 *
 * The condition the backend reports by sending a Rich_Stats block whose every
 * member is null. A squad that has switched tracking on and not yet tracked a
 * match is in a different position from one that has switched it off, and
 * presenting either as the other would misdescribe the squad's own settings.
 */
export const TRACKING_EMPTY = 'No live match detail has been recorded yet.';

/**
 * The label naming the goals statistic (Requirement 11.3).
 *
 * Goals are recorded as events carrying a scorer, so this count exists only for
 * a squad that tracks matches live.
 */
export const GOALS_LABEL = 'Goals';

/**
 * The label naming the clean-sheets statistic. See {@link GOALS_LABEL}.
 *
 * Earned as goalkeeper, which is a stint rather than a position held for a whole
 * match — keepers rotate.
 */
export const CLEAN_SHEETS_LABEL = 'Clean sheets';

/**
 * The label naming the goals-conceded-as-keeper statistic. See
 * {@link GOALS_LABEL}.
 *
 * Says *as keeper* because a goal is attributed to the keeper who was on at the
 * time, not to everyone on the pitch.
 */
export const GOALS_CONCEDED_AS_KEEPER_LABEL = 'Goals conceded as keeper';

/**
 * The label naming the Keeper_Time statistic. See {@link GOALS_LABEL}.
 *
 * The duration itself is formatted from the parsed value by the feature's own
 * duration formatter, so this label carries no unit — the unit belongs to the
 * value beside it.
 */
export const KEEPER_TIME_LABEL = 'Time as keeper';

/**
 * Rendered in place of a rich statistic whose member carries no value, while the
 * Rich_Stats block as a whole is present and at least one member is not
 * (Requirement 11.4).
 *
 * The requirement is explicit that no numeric value is rendered for such a
 * member, **including no zero**: a keeper who has conceded nothing and a keeper
 * whose minutes were never recorded are different facts, and only one of them is
 * a zero.
 */
export const STATISTIC_NO_DATA = 'No data';
