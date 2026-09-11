/**
 * The Squads_Feature's route path patterns and the single construction function
 * for each of them.
 *
 * Three paths belong to this feature:
 *
 * | Pattern                                          | Screen                                     |
 * | ------------------------------------------------ | ------------------------------------------ |
 * | `/app/squads/:squadId`                           | the Squad_Screen, behind the Route_Guard   |
 * | `/app/squads/:squadId/players/:membershipId`     | *no screen* — the seam a later feature registers against (9.6) |
 * | `/join/:code`                                    | the Invite_Landing_Route, outside the shell |
 *
 * The pattern and the function that builds a path for it are declared side by
 * side deliberately. Requirement 9.2 asks for the Player_Stats_Route path to be
 * built by a *single* pure function so a later feature registers the same path
 * without duplicating the construction, and Requirement 9.3 has the feature
 * export both the pattern and that function from its public barrel (18.7). One
 * module holding both means the pattern a route table registers and the path a
 * navigation control targets can never drift apart, and the pairing is pinned by
 * a property that builds a path and recovers its segments through the pattern.
 *
 * Every segment value is percent-encoded with `encodeURIComponent`. Identities
 * are opaque to this feature — the backend owns their form — so a value carrying
 * a separator, a query or fragment introducer, or a non-ASCII character must not
 * be able to change the *shape* of the path it is placed in. Encoding is what
 * keeps a built path at exactly the segment count its pattern declares, and it
 * is what makes the round trip through `decodeURIComponent` exact.
 *
 * These functions are **constructors, not validators**: they neither reject nor
 * repair a value. Each is total over every well-formed string —
 * `encodeURIComponent` rejects a lone surrogate, which is not a well-formed
 * string and which neither a decoded path segment nor a typed input can carry.
 * Deciding whether a `squadId` is worth
 * a `GetSquad` call is `isSquadIdentifier`'s job in `./identifiers`
 * (Requirement 6.6), kept separate so a navigation control and a syntactic guard
 * cannot disagree about what a path looks like. A caller that hands over an
 * empty string gets a path with an empty segment, which no dynamic-segment
 * pattern matches — a route that does not resolve rather than one that resolves
 * to the wrong screen.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirement 18.2).
 *
 * Requirements: 6.6, 9.2, 9.3, 18.7
 */

/**
 * The Squad_Route pattern, registered behind the App_Shell's Route_Guard and
 * within the shell frame (Requirements 6.1, 18.5).
 *
 * The dynamic segment is named `squadId` on purpose: the App_Shell publishes a
 * Squad_Scope from a route parameter of exactly that name, so the Squad_Screen
 * inherits the shell's squad-scoped notification behaviour without wiring.
 */
export const SQUAD_ROUTE = '/app/squads/:squadId';

/**
 * The Player_Stats_Route pattern — the seam the later player-stats feature
 * registers its screen against (Requirements 9.3, 9.6).
 *
 * This feature registers **no** screen here. A request for this path while no
 * screen is registered falls to the App_Shell's not-found handling for paths
 * beneath `/app` (Requirement 9.7).
 */
export const PLAYER_STATS_ROUTE = '/app/squads/:squadId/players/:membershipId';

/**
 * The Invite_Landing_Route pattern, registered outside the Route_Guard and
 * outside the shell frame so a person without a session can reach it
 * (Requirement 18.5).
 */
export const INVITE_LANDING_ROUTE = '/join/:code';

/**
 * The path of the Squad_Screen for a squad identity.
 *
 * Total over every well-formed string and free of exceptions.
 *
 * @param squadId the squad identity, opaque to this feature and percent-encoded
 *   into its segment
 * @returns a path matching {@link SQUAD_ROUTE} for every non-empty `squadId`
 *
 * Requirements: 1.8, 6.1
 */
export function squadPath(squadId: string): string {
  return `/app/squads/${encodeURIComponent(squadId)}`;
}

/**
 * The path of the Player_Stats_Route for a squad identity and a membership
 * identity — the single construction Requirement 9.2 asks for, so that this
 * feature's Player_Row controls and the later player-stats feature's route
 * registration are built from the same place.
 *
 * Total over every pair of well-formed strings and free of exceptions.
 *
 * @param squadId the squad identity the stats are scoped to
 * @param membershipId the membership whose stats the path opens
 * @returns a path matching {@link PLAYER_STATS_ROUTE} for every non-empty pair
 *
 * Requirements: 9.1, 9.2, 9.4
 */
export function playerStatsPath(squadId: string, membershipId: string): string {
  return `/app/squads/${encodeURIComponent(squadId)}/players/${encodeURIComponent(
    membershipId,
  )}`;
}

/**
 * The path of the Invite_Landing_Route carrying an Invite_Secret.
 *
 * The secret is percent-encoded, which is what lets a secret containing the
 * reserved characters `/ ? # & = % +` survive a round trip through the path
 * unchanged (Requirements 5.11, 20.8). The matching extraction lives in
 * `lib/inviteSecret.ts`; this module only builds.
 *
 * Total over every well-formed string and free of exceptions. The secret is a
 * value, not a message: it is placed in a path and nowhere else — never in a
 * stored value and never in user-facing copy (Requirement 4.10).
 *
 * @param secret the Invite_Secret to carry in the `code` segment
 * @returns a path matching {@link INVITE_LANDING_ROUTE} for every non-empty
 *   `secret`
 *
 * Requirements: 5.11, 11.8
 */
export function inviteLandingPath(secret: string): string {
  return `/join/${encodeURIComponent(secret)}`;
}
