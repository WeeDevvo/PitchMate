/**
 * The Squads_Feature's named wire enum unions, as aliases over the
 * Generated_Enum_Unions of the Committed_Types.
 *
 * The backend now serialises every wire enum **by name** (`JsonStringEnumConverter`
 * with `allowIntegerValues: false`), so each enum is published in the OpenAPI
 * document as a named string schema and arrives in `schema.d.ts` as a string
 * union — `SquadRole: "Owner" | "Admin" | "Member" | null`. This module is where
 * the feature names those unions, and it is the **only** declaration of them:
 * each alias is an index into `components['schemas']`, so the vocabulary is read
 * from the generated types rather than restated here (Requirement 12.2).
 *
 * ### Two compile-time checks per union, because one direction is not enough
 *
 * A runtime membership test needs the names as *values*, and a type alone cannot
 * be enumerated at runtime. So each union has a readonly tuple of its names, and
 * that tuple is pinned to the generated union from both sides (Requirement 12.3):
 *
 * | Direction | Mechanism | What it catches |
 * | --- | --- | --- |
 * | No name the contract does not carry | `as const satisfies WireEnumNames<T>` on the tuple | a renamed, removed, or invented member |
 * | No name the contract carries omitted | an entry in {@link WIRE_ENUM_COVERAGE} | a member added to the backend enum |
 *
 * Only together are they a check. The `satisfies` on the tuple would accept a
 * tuple that listed two of three members; {@link WIRE_ENUM_COVERAGE} would accept
 * a tuple that listed a fourth name that does not exist. Both are `satisfies`
 * expressions, both fail `tsc -b`, and neither is a second hand-maintained copy
 * of the vocabulary: the tuple is the only list of names in the feature, and the
 * coverage check is derived from the generated union by `Exclude`.
 *
 * ### Why each alias excludes `null`
 *
 * The document exporter folds reference-site nullability into the one shared
 * schema, so four of these unions arrive carrying `null` —
 * `SquadRole: … | null` — even though "no role" is a property of a *guest
 * membership*, not a member of the backend enum. Absence is the Response_Parser's
 * concern, and it is not uniform: a `null` or absent `role` and `state` on a squad
 * summary is a valid absence, while an absent feature on a feature flag fails the
 * body carrying it. Excluding `null` here keeps each union to the vocabulary the
 * backend enum actually declares and leaves the absence rule where it is decided.
 *
 * ### Scope: the enums this feature reads
 *
 * The seven unions below are the ones the squads Response_Parsers consume. Two
 * deliberate omissions:
 *
 * - `NotificationType` and `ReadState` are the App_Shell's, and the structural
 *   scans keep features from importing each other's `lib/`, so they are named in
 *   the App_Shell's own wire module rather than here.
 * - `LeaderboardStatistic` is a *request* enum. The transport facade types it
 *   from `operations['GetSquadLeaderboard']`, and the leaderboard parser
 *   disregards the echoed value because the caller already knows which statistic
 *   it asked for.
 *
 * ### The one import a module under `lib/` may make
 *
 * Every other module under `lib/` imports nothing outside `lib/`. This one takes
 * a **type-only** import of `@pitchmate/api-client`, which is erased at compile
 * time: the emitted module has no import at all, so `lib/` keeps the property the
 * rule exists to protect — no runtime dependency, nothing to construct, testable
 * with no transport present. `pureLogic.structural.test.ts` admits this module by
 * name and asserts the import stays type-only.
 *
 * React-free and DOM-free like every module under `lib/`.
 *
 * Requirements: 12.2, 12.3
 */

import type { components } from '@pitchmate/api-client';

// --- The shared machinery ----------------------------------------------------

/**
 * The names of one wire enum, in the order the backend declares them.
 *
 * Non-empty by construction, because an empty tuple would satisfy every
 * membership test vacuously — and one of these unions (`SquadFeature`) genuinely
 * has a single member, so "non-empty" is the only floor available.
 */
type WireEnumNames<TName extends string> = readonly [TName, ...TName[]];

/**
 * The generated members a tuple of names fails to list, as required properties.
 *
 * `Record<never, never>` is `{}` and accepts the `{}` beside it; a union member
 * missing from the tuple becomes a required property that `{}` cannot provide, so
 * the `satisfies` fails and names the missing member in the compiler error. This
 * is the half of Requirement 12.3 the tuple's own `satisfies` cannot state.
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
 * `valueOf` never runs. A non-string candidate — `null`, `undefined`, a number, an
 * array, an object — matches nothing and is simply not a member.
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
/* Invite_State — `InviteState`                                               */
/* -------------------------------------------------------------------------- */

/**
 * The state of a squad invite link or code.
 *
 * `Expired` is derived by the backend clock and never persisted, so it arrives
 * like any other state and this feature does no expiry arithmetic of its own.
 */
export type InviteState = Exclude<components['schemas']['InviteState'], null>;

/** The `InviteState` names, pinned to the generated union (Requirement 12.3). */
export const INVITE_STATE_NAMES = [
  'Active',
  'Revoked',
  'Expired',
] as const satisfies WireEnumNames<InviteState>;

/** Whether a value is an `InviteState` name. Total, and free of exceptions. */
export function isInviteState(candidate: unknown): candidate is InviteState {
  return isWireEnumName(INVITE_STATE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* Membership_State — `MembershipState`                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether a membership is eligible for player selection.
 *
 * A membership that has been left or removed is `Inactive` and keeps its ratings,
 * stats, and history; re-joining reactivates the same membership.
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
/* Rating_State_Signal — `RatingState`                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether a membership's rating has settled, as the backend classifies it.
 *
 * New to the squad detail body with this contract. The classification is the
 * Domain's (`IRatingEngine.GetState`) and arrives already made — this feature
 * compares no threshold, and is given neither the mean nor the uncertainty to
 * compare one against.
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
/* Redeem_Outcome — `RedeemOutcome`                                           */
/* -------------------------------------------------------------------------- */

/**
 * How a successful invite redemption resolved.
 *
 * `AlreadyMember` is a *success* here: redemption by someone who already holds an
 * active membership answers `200` with this outcome. The `409` of the same name
 * belongs to the guest-claim path and is a different thing entirely.
 */
export type RedeemOutcome = Exclude<
  components['schemas']['RedeemOutcome'],
  null
>;

/** The `RedeemOutcome` names, pinned to the generated union. */
export const REDEEM_OUTCOME_NAMES = [
  'Joined',
  'Reactivated',
  'AlreadyMember',
] as const satisfies WireEnumNames<RedeemOutcome>;

/** Whether a value is a `RedeemOutcome` name. Total, and free of exceptions. */
export function isRedeemOutcome(
  candidate: unknown,
): candidate is RedeemOutcome {
  return isWireEnumName(REDEEM_OUTCOME_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* Skill_Tier — `SkillTier`                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The optional cold-start tier that seeds a new player's initial rating.
 *
 * An input only: once matches are played the rating is driven by results. This is
 * the union whose numeric reading was the most dangerous — the backend enum
 * declares no explicit values, so a 1-based code table shifted every tier by one
 * silently. By name there is nothing to get off by one.
 */
export type SkillTier = Exclude<components['schemas']['SkillTier'], null>;

/** The `SkillTier` names, weakest first, pinned to the generated union. */
export const SKILL_TIER_NAMES = [
  'Beginner',
  'Average',
  'Strong',
] as const satisfies WireEnumNames<SkillTier>;

/** Whether a value is a `SkillTier` name. Total, and free of exceptions. */
export function isSkillTier(candidate: unknown): candidate is SkillTier {
  return isWireEnumName(SKILL_TIER_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* Feature_Flag — `SquadFeature`                                              */
/* -------------------------------------------------------------------------- */

/** An optional squad capability an admin can switch on or off. */
export type SquadFeature = Exclude<components['schemas']['SquadFeature'], null>;

/**
 * The `SquadFeature` names, pinned to the generated union.
 *
 * One member today. {@link WIRE_ENUM_COVERAGE} is what makes that a statement
 * about the contract rather than an assumption: a second feature arriving in the
 * generated union fails the build here instead of silently failing the body that
 * carries it.
 */
export const SQUAD_FEATURE_NAMES = [
  'LiveMatchTracking',
] as const satisfies WireEnumNames<SquadFeature>;

/** Whether a value is a `SquadFeature` name. Total, and free of exceptions. */
export function isSquadFeature(candidate: unknown): candidate is SquadFeature {
  return isWireEnumName(SQUAD_FEATURE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* Member_Role — `SquadRole`                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The role a registered membership holds within a squad.
 *
 * A guest membership carries no role at all, which arrives as `null` or an absent
 * property rather than a name — a valid absence the squad-summary parser admits,
 * not a member of this union.
 */
export type SquadRole = Exclude<components['schemas']['SquadRole'], null>;

/** The `SquadRole` names, pinned to the generated union. */
export const SQUAD_ROLE_NAMES = [
  'Owner',
  'Admin',
  'Member',
] as const satisfies WireEnumNames<SquadRole>;

/** Whether a value is a `SquadRole` name. Total, and free of exceptions. */
export function isSquadRole(candidate: unknown): candidate is SquadRole {
  return isWireEnumName(SQUAD_ROLE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* The other half of the compile-time check                                   */
/* -------------------------------------------------------------------------- */

/**
 * One `satisfies` per union, asserting that its tuple above omits **no** member
 * of its Generated_Enum_Union (Requirement 12.3).
 *
 * Each value is `{}`, and each target is the set of generated members the tuple
 * beside it fails to list. While a tuple is complete that target is `{}` and the
 * entry type-checks; the moment the Committed_Types gain a member the tuple does
 * not carry, the entry fails `tsc -b` with the missing member named — which is
 * exactly the "build failure rather than a runtime surprise" the requirement
 * asks for.
 *
 * It is one exported value rather than seven loose statements so that nothing
 * here is an unused binding, and so the set of unions this module declares can be
 * read at runtime: its keys are the vocabulary the Response_Parsers may use, and
 * the property test beside this module asserts its own table covers exactly them.
 */
export const WIRE_ENUM_COVERAGE = {
  InviteState: {} satisfies UncoveredNames<
    InviteState,
    typeof INVITE_STATE_NAMES
  >,
  MembershipState: {} satisfies UncoveredNames<
    MembershipState,
    typeof MEMBERSHIP_STATE_NAMES
  >,
  RatingState: {} satisfies UncoveredNames<
    RatingState,
    typeof RATING_STATE_NAMES
  >,
  RedeemOutcome: {} satisfies UncoveredNames<
    RedeemOutcome,
    typeof REDEEM_OUTCOME_NAMES
  >,
  SkillTier: {} satisfies UncoveredNames<SkillTier, typeof SKILL_TIER_NAMES>,
  SquadFeature: {} satisfies UncoveredNames<
    SquadFeature,
    typeof SQUAD_FEATURE_NAMES
  >,
  SquadRole: {} satisfies UncoveredNames<SquadRole, typeof SQUAD_ROLE_NAMES>,
} as const;
