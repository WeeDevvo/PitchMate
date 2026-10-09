/**
 * The Player_Stats_Feature's named Wire_Enum_Names, as aliases over the string
 * unions the Api_Client generates.
 *
 * The backend serialises every wire enum **by name** (`JsonStringEnumConverter`
 * with `allowIntegerValues: false`), so each enumeration is published in the
 * OpenAPI document as a named string schema and arrives in `schema.d.ts` as a
 * string union — `MembershipState: "Active" | "Inactive" | null`. This module is
 * where the feature names the two unions its Response_Parser reads, and it is
 * their **only** declaration: each alias is an index into
 * `components['schemas']`, so the vocabulary is read from the generated types
 * rather than restated here. Nothing in this feature maps a numeric code to an
 * enumeration value, because there is no code table to map from
 * (Requirement 13.4).
 *
 * ### Two compile-time checks per union, because one direction is not enough
 *
 * A runtime membership test needs the names as *values*, and a type alone cannot
 * be enumerated at runtime. So each union has a readonly tuple of its names, and
 * that tuple is pinned to the generated union from both sides:
 *
 * | Direction | Mechanism | What it catches |
 * | --- | --- | --- |
 * | No name the contract does not carry | `as const satisfies WireEnumNames<T>` on the tuple | a renamed, removed, or invented member |
 * | No name the contract carries omitted | an entry in {@link WIRE_ENUM_COVERAGE} | a member added to the backend enum |
 *
 * Only together are they a check. The `satisfies` on the tuple would accept a
 * tuple listing one of two members; {@link WIRE_ENUM_COVERAGE} would accept a
 * tuple listing a third name that does not exist. Both are `satisfies`
 * expressions, both fail `tsc -b`, and neither is a second hand-maintained copy
 * of the vocabulary: the tuple is the only list of names in the feature, and the
 * coverage check is derived from the generated union by `Exclude`.
 *
 * ### Why each alias excludes `null`
 *
 * The document exporter folds reference-site nullability into the one shared
 * schema, so both of these unions arrive carrying `null` —
 * `RatingState: "Provisional" | "Established" | null` — even though "no rating
 * state" is a property of a *membership that has not established one*, not a
 * member of the backend enum. Absence is the Response_Parser's concern, and both
 * of these members are declared optional there (Requirement 13.6): a `null` or
 * absent `state` and `rating.state` is a valid absence the profile parser
 * admits. Excluding `null` here keeps each union to the vocabulary the backend
 * enum actually declares and leaves the absence rule where it is decided.
 *
 * ### Scope: the enums this feature reads
 *
 * Two unions, which are the two the `GetPlayerProfile` body carries as names.
 * Deliberate omissions:
 *
 * - `SquadRole`, `SkillTier`, `InviteState`, `RedeemOutcome`, and `SquadFeature`
 *   are the Squads_Feature's, and `NotificationType` and `ReadState` are the
 *   App_Shell's. Each is named in its own feature's wire module; this feature
 *   reads none of them.
 * - `LeaderboardStatistic` is a *request* enum of the squads leaderboard call,
 *   which this feature does not make.
 *
 * ### The one import a module under `lib/` may make
 *
 * Every other module under `lib/` imports nothing outside `lib/`
 * (Requirement 14.3). This one takes a **type-only** import of
 * `@pitchmate/api-client`, which is erased at compile time: the emitted module
 * has no import at all, so `lib/` keeps the property the rule exists to protect
 * — no runtime dependency, nothing to construct, testable with no transport
 * present. The `pureLogic` structural scan admits this module by name and
 * asserts the import stays type-only.
 *
 * React-free and DOM-free like every module under `lib/`.
 *
 * Requirements: 13.4, 14.3
 */

import type { components } from '@pitchmate/api-client';

// --- The shared machinery ----------------------------------------------------

/**
 * The names of one wire enum, in the order the backend declares them.
 *
 * Non-empty by construction, because an empty tuple would satisfy every
 * membership test vacuously.
 */
type WireEnumNames<TName extends string> = readonly [TName, ...TName[]];

/**
 * The generated members a tuple of names fails to list, as required properties.
 *
 * `Record<never, never>` is `{}` and accepts the `{}` beside it; a union member
 * missing from the tuple becomes a required property that `{}` cannot provide,
 * so the `satisfies` fails and names the missing member in the compiler error.
 * This is the half of the pinning the tuple's own `satisfies` cannot state.
 */
type UncoveredNames<
  TUnion extends string,
  TNames extends readonly string[],
> = Record<Exclude<TUnion, TNames[number]>, never>;

/**
 * Whether a candidate is one of `names` — the single reader every exported
 * predicate delegates to.
 *
 * Total over every input and free of exceptions: a strict comparison against a
 * fixed list of strings, so nothing is coerced and a hostile `toString` or
 * `valueOf` never runs. A non-string candidate — `null`, `undefined`, a number
 * (the integer code a previous contract sent for the same field included), an
 * array, an object, a boxed string — matches nothing and is simply not a member.
 *
 * Compared with `===` rather than `includes`, so the candidate stays `unknown`
 * and no cast is needed to ask the question.
 */
function isWireEnumName<TName extends string>(
  names: readonly TName[],
  candidate: unknown,
): candidate is TName {
  return names.some((name) => name === candidate);
}

/* -------------------------------------------------------------------------- */
/* Membership_State — `MembershipState`                                       */
/* -------------------------------------------------------------------------- */

/**
 * A membership's lifecycle state — whether it is eligible for player selection.
 *
 * A membership that has been left or removed is `Inactive` and keeps its
 * ratings, stats, and history; re-joining reactivates the same membership. The
 * Player_Stats_Screen presents the state as recorded and derives nothing from
 * it: an inactive membership's statistics are rendered in full.
 */
export type MembershipState = Exclude<
  components['schemas']['MembershipState'],
  null
>;

/** The `MembershipState` names, pinned to the generated union. */
export const MEMBERSHIP_STATE_NAMES = [
  'Active',
  'Inactive',
] as const satisfies WireEnumNames<MembershipState>;

/** Whether a value is a `MembershipState` name. Total, and free of exceptions. */
export function isMembershipState(
  candidate: unknown,
): candidate is MembershipState {
  return isWireEnumName(MEMBERSHIP_STATE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* Rating_State — `RatingState`                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether a membership's rating has settled, as the backend classifies it.
 *
 * The classification is the Domain's (`IRatingEngine.GetState`) and arrives
 * already made — this feature compares no threshold, and is given neither the
 * mean nor the uncertainty to compare one against (Requirement 7.7). It is one
 * of the two inputs to the Rating_Condition the screen resolves; the other is
 * the Appearance_Count.
 */
export type RatingState = Exclude<components['schemas']['RatingState'], null>;

/** The `RatingState` names, pinned to the generated union. */
export const RATING_STATE_NAMES = [
  'Provisional',
  'Established',
] as const satisfies WireEnumNames<RatingState>;

/** Whether a value is a `RatingState` name. Total, and free of exceptions. */
export function isRatingState(candidate: unknown): candidate is RatingState {
  return isWireEnumName(RATING_STATE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* The other half of the compile-time check                                   */
/* -------------------------------------------------------------------------- */

/**
 * One `satisfies` per union, asserting that its tuple above omits **no** member
 * of the generated union it aliases (Requirement 13.4).
 *
 * Each value is `{}`, and each target is the set of generated members the tuple
 * beside it fails to list. While a tuple is complete that target is `{}` and the
 * entry type-checks; the moment the generated types gain a member the tuple does
 * not carry, the entry fails `tsc -b` with the missing member named — a build
 * failure rather than a runtime surprise in the Response_Parser.
 *
 * It is one exported value rather than two loose statements so that nothing here
 * is an unused binding, and so the set of unions this module declares can be
 * read at runtime: its keys are the vocabulary the Response_Parser may use, and
 * the property test beside this module asserts its own table covers exactly
 * them.
 */
export const WIRE_ENUM_COVERAGE = {
  MembershipState: {} satisfies UncoveredNames<
    MembershipState,
    typeof MEMBERSHIP_STATE_NAMES
  >,
  RatingState: {} satisfies UncoveredNames<
    RatingState,
    typeof RATING_STATE_NAMES
  >,
} as const;
