/**
 * The Enum_Code_Map: the Squads_Feature's only knowledge of how the backend
 * serialises an enum.
 *
 * The squads responses are not schematised in the OpenAPI document yet, so their
 * enums arrive as the numbers `System.Text.Json` emits for a CLR enum. Every one
 * of those numbers is named here and nowhere else. **This module is the only
 * place in the feature that contains a numeric enum literal** — which is what
 * makes Requirement 16.12 true by construction rather than by discipline: when
 * the pending `api-response-contracts` chore lands named enum serialisation, the
 * tables below become name tables (or this module disappears and the parsers read
 * names directly) and no screen, component, or hook has to change. A source scan
 * pins that claim (task 17.4).
 *
 * The codes were **read from the backend enums, not inferred from position**, and
 * two of them contradict the obvious guess:
 *
 * | Wire enum       | Codes                                                | Source                                    |
 * | --------------- | ---------------------------------------------------- | ----------------------------------------- |
 * | `SquadRole`     | `1 → owner`, `2 → admin`, `3 → member`               | `Domain/Squads/SquadRole.cs`, explicit    |
 * | `MembershipState` | `1 → active`, `2 → inactive`                       | `Domain/Squads/MembershipState.cs`, explicit |
 * | `SquadFeature`  | `1 → live-match-tracking`                            | `Domain/Squads/SquadFeature.cs`, explicit |
 * | `InviteState`   | `1 → active`, `2 → revoked`, `3 → expired`           | `Domain/Squads/InviteState.cs`, explicit  |
 * | `SkillTier`     | **`0 → beginner`**, `1 → average`, `2 → strong`      | `Domain/Rating/SkillTier.cs`, **no explicit values** |
 * | `RedeemOutcome` | **`0 → joined`**, `1 → reactivated`, `2 → already-member` | `Application/Squads/UseCases/RedeemInviteResult.cs`, **no explicit values** |
 *
 * `SkillTier` and `RedeemOutcome` declare no values, so they start at `0` and are
 * *not* 1-based like the other four. A 1-based reading of `SkillTier` would
 * silently shift every tier by one — `beginner` read as nothing, `average` read
 * as `beginner` — which is why the round-trip property (Property 37) generates
 * `SkillTier` code `3` explicitly: a 1-based table would name it, and the
 * correct table must not.
 *
 * The map is **bidirectional by construction**. Each `codeFrom…` is derived from
 * the same table its `…FromCode` reads, through {@link reverseCodeTable}, so the
 * round trip Requirement 16.7 asks for is over one table rather than two
 * hand-kept lists that could drift. Each named union is derived from its table's
 * values for the same reason — there is no second declaration of the names.
 *
 * Every reader is **total**: a code absent from a table, a non-integer, a value
 * of any other type, `null`, and `undefined` all yield `undefined`, and nothing
 * throws (Requirement 16.6). Turning that absence into an outcome is the *field*
 * parser's job in `lib/parse/`, not this module's: for most fields a missing name
 * fails the body carrying it (16.6), while a `null` or absent `role` and `state`
 * on a squad summary are valid absences (16.8). Keeping the decision out of here
 * is what lets one reader serve both rules.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirements 16.10, 18.2).
 *
 * Requirements: 16.6, 16.7, 16.10, 16.12
 */

/**
 * A wire enum's code table: a mapping from numeric wire code to named value.
 *
 * Declared as an index signature so one reader and one reverser serve every
 * table, and so a table's own named union can be recovered from its values.
 */
type CodeTable<TNamed extends string> = Readonly<Record<number, TNamed>>;

/**
 * The named value of a wire code, or `undefined` when the table names no such
 * code — the one reader every `…FromCode` in this module delegates to
 * (Requirement 16.6).
 *
 * Total over every input and free of exceptions. Totality is structural: a
 * `typeof`/`Number.isInteger` test on the candidate and one property read on a
 * table this module declares. The candidate is never coerced, so a hostile
 * `toString` or `valueOf` never runs, and there is no unknown structure to
 * recurse into.
 *
 * Only an integer-valued `number` can name anything. A string of digits does not
 * — `'1'` is not the wire representation of an enum here, and accepting it would
 * make a mistyped field parse successfully. A non-integer, `NaN`, and either
 * infinity name nothing, because no enum code is one. Negative zero reads as `0`,
 * since a property read converts it to the same key as `0` and the two are the
 * same number.
 *
 * @param table the code table to read; one of this module's exported tables
 * @param code the wire value exactly as the response body carried it, unasserted
 * @returns the named value, or `undefined` when the table names no such code
 *
 * Requirements: 16.6
 */
export function namedFromCode<TNamed extends string>(
  table: CodeTable<TNamed>,
  code: unknown,
): TNamed | undefined {
  // 16.6: a value that is not a number — absent, `null`, a string of digits, a
  // boolean, an array, an object — names nothing. No coercion is attempted.
  if (typeof code !== 'number') {
    return undefined;
  }

  // 16.6: `NaN`, either infinity, and every fractional value name nothing, so a
  // fractional near-miss is a name absence rather than a truncated read.
  if (!Number.isInteger(code)) {
    return undefined;
  }

  // 16.6: an integer the table does not carry — `SkillTier` 3, `SquadRole` 0 or
  // 4, any arbitrary integer — names nothing. The annotation is what makes that
  // absence visible in the type: an index read alone is typed as though every
  // integer were a key. A numeric key cannot collide with an inherited property
  // name, so no own-property guard is needed to keep prototype members out.
  const named: TNamed | undefined = table[code];
  return named;
}

/**
 * The reverse of a code table, built from the table itself so that the two
 * directions cannot disagree (Requirement 16.7).
 *
 * Every named value is a key of the result, because the result's keys are exactly
 * the table's values — which is also exactly the named union the table derives.
 * A lookup therefore always finds a code, and needs no absent case.
 */
function reverseCodeTable<TNamed extends string>(
  table: CodeTable<TNamed>,
): Readonly<Record<TNamed, number>> {
  const reversed = {} as Record<TNamed, number>;

  for (const [code, named] of Object.entries(table) as readonly [
    string,
    TNamed,
  ][]) {
    reversed[named] = Number(code);
  }

  return reversed;
}

/* -------------------------------------------------------------------------- */
/* Member_Role — `SquadRole`, explicit values, 1-based                        */
/* -------------------------------------------------------------------------- */

/**
 * The `SquadRole` codes (Requirement 16.6). A guest membership carries no role at
 * all, which arrives as `null` or an absent property rather than a code, and is a
 * valid absence rather than a failure (Requirement 16.8).
 */
export const MEMBER_ROLE_CODES = {
  1: 'owner',
  2: 'admin',
  3: 'member',
} as const satisfies CodeTable<string>;

/** The role a registered membership holds within a squad. */
export type MemberRole = (typeof MEMBER_ROLE_CODES)[keyof typeof MEMBER_ROLE_CODES];

const CODES_BY_MEMBER_ROLE = reverseCodeTable<MemberRole>(MEMBER_ROLE_CODES);

/**
 * The named role of a wire code, or `undefined` when no role carries it.
 *
 * Requirements: 16.6
 */
export function memberRoleFromCode(code: unknown): MemberRole | undefined {
  return namedFromCode<MemberRole>(MEMBER_ROLE_CODES, code);
}

/**
 * The wire code of a named role, read back out of {@link MEMBER_ROLE_CODES}.
 *
 * Requirements: 16.7
 */
export function codeFromMemberRole(role: MemberRole): number {
  return CODES_BY_MEMBER_ROLE[role];
}

/* -------------------------------------------------------------------------- */
/* Membership_State — `MembershipState`, explicit values, 1-based             */
/* -------------------------------------------------------------------------- */

/**
 * The `MembershipState` codes (Requirement 16.6). A membership that has been left
 * or removed is `inactive` and keeps its ratings, stats, and history; re-joining
 * reactivates the same membership.
 */
export const MEMBERSHIP_STATE_CODES = {
  1: 'active',
  2: 'inactive',
} as const satisfies CodeTable<string>;

/** Whether a membership is eligible for player selection. */
export type MembershipStateValue =
  (typeof MEMBERSHIP_STATE_CODES)[keyof typeof MEMBERSHIP_STATE_CODES];

const CODES_BY_MEMBERSHIP_STATE = reverseCodeTable<MembershipStateValue>(
  MEMBERSHIP_STATE_CODES,
);

/**
 * The named membership state of a wire code, or `undefined` when no state carries
 * it.
 *
 * Requirements: 16.6
 */
export function membershipStateFromCode(
  code: unknown,
): MembershipStateValue | undefined {
  return namedFromCode<MembershipStateValue>(MEMBERSHIP_STATE_CODES, code);
}

/**
 * The wire code of a named membership state, read back out of
 * {@link MEMBERSHIP_STATE_CODES}.
 *
 * Requirements: 16.7
 */
export function codeFromMembershipState(state: MembershipStateValue): number {
  return CODES_BY_MEMBERSHIP_STATE[state];
}

/* -------------------------------------------------------------------------- */
/* Feature_Flag — `SquadFeature`, explicit values, 1-based                    */
/* -------------------------------------------------------------------------- */

/**
 * The `SquadFeature` codes (Requirement 16.6). Live match tracking is the only
 * feature the MVP defines, so this table has one entry — and a squad carrying a
 * feature this table does not name fails the body rather than rendering an
 * unnamed toggle.
 */
export const SQUAD_FEATURE_CODES = {
  1: 'live-match-tracking',
} as const satisfies CodeTable<string>;

/** An optional squad capability an admin can switch on or off. */
export type SquadFeatureValue =
  (typeof SQUAD_FEATURE_CODES)[keyof typeof SQUAD_FEATURE_CODES];

const CODES_BY_SQUAD_FEATURE =
  reverseCodeTable<SquadFeatureValue>(SQUAD_FEATURE_CODES);

/**
 * The named feature of a wire code, or `undefined` when no feature carries it.
 *
 * Requirements: 16.6
 */
export function squadFeatureFromCode(
  code: unknown,
): SquadFeatureValue | undefined {
  return namedFromCode<SquadFeatureValue>(SQUAD_FEATURE_CODES, code);
}

/**
 * The wire code of a named feature, read back out of
 * {@link SQUAD_FEATURE_CODES}.
 *
 * Requirements: 16.7
 */
export function codeFromSquadFeature(feature: SquadFeatureValue): number {
  return CODES_BY_SQUAD_FEATURE[feature];
}

/* -------------------------------------------------------------------------- */
/* Invite_State — `InviteState`, explicit values, 1-based                     */
/* -------------------------------------------------------------------------- */

/**
 * The `InviteState` codes (Requirement 16.6). `expired` is derived by the backend
 * clock and never persisted, so it arrives like any other state and this feature
 * does no expiry arithmetic of its own.
 */
export const INVITE_STATE_CODES = {
  1: 'active',
  2: 'revoked',
  3: 'expired',
} as const satisfies CodeTable<string>;

/** The state of a squad invite link or code. */
export type InviteStateValue =
  (typeof INVITE_STATE_CODES)[keyof typeof INVITE_STATE_CODES];

const CODES_BY_INVITE_STATE =
  reverseCodeTable<InviteStateValue>(INVITE_STATE_CODES);

/**
 * The named invite state of a wire code, or `undefined` when no state carries it.
 *
 * Requirements: 16.6
 */
export function inviteStateFromCode(
  code: unknown,
): InviteStateValue | undefined {
  return namedFromCode<InviteStateValue>(INVITE_STATE_CODES, code);
}

/**
 * The wire code of a named invite state, read back out of
 * {@link INVITE_STATE_CODES}.
 *
 * Requirements: 16.7
 */
export function codeFromInviteState(state: InviteStateValue): number {
  return CODES_BY_INVITE_STATE[state];
}

/* -------------------------------------------------------------------------- */
/* Skill_Tier — `SkillTier`, no explicit values, **0-based**                  */
/* -------------------------------------------------------------------------- */

/**
 * The `SkillTier` codes (Requirement 16.6). The backend enum declares **no**
 * explicit values, so it starts at `0` and is *not* 1-based like the four enums
 * above: `3` names nothing.
 */
export const SKILL_TIER_CODES = {
  0: 'beginner',
  1: 'average',
  2: 'strong',
} as const satisfies CodeTable<string>;

/** The optional cold-start tier that seeds a new player's initial mean. */
export type SkillTierValue =
  (typeof SKILL_TIER_CODES)[keyof typeof SKILL_TIER_CODES];

const CODES_BY_SKILL_TIER = reverseCodeTable<SkillTierValue>(SKILL_TIER_CODES);

/**
 * The named skill tier of a wire code, or `undefined` when no tier carries it —
 * including `3`, which a 1-based misreading would have named.
 *
 * Requirements: 16.6
 */
export function skillTierFromCode(code: unknown): SkillTierValue | undefined {
  return namedFromCode<SkillTierValue>(SKILL_TIER_CODES, code);
}

/**
 * The wire code of a named skill tier, read back out of
 * {@link SKILL_TIER_CODES}.
 *
 * Requirements: 16.7
 */
export function codeFromSkillTier(tier: SkillTierValue): number {
  return CODES_BY_SKILL_TIER[tier];
}

/* -------------------------------------------------------------------------- */
/* Redeem_Outcome — `RedeemOutcome`, no explicit values, **0-based**          */
/* -------------------------------------------------------------------------- */

/**
 * The `RedeemOutcome` codes (Requirement 16.6). Like `SkillTier`, the backend
 * enum declares no explicit values, so `joined` is `0` and `3` names nothing.
 */
export const REDEEM_OUTCOME_CODES = {
  0: 'joined',
  1: 'reactivated',
  2: 'already-member',
} as const satisfies CodeTable<string>;

/** How a successful invite redemption resolved. */
export type RedeemOutcomeValue =
  (typeof REDEEM_OUTCOME_CODES)[keyof typeof REDEEM_OUTCOME_CODES];

const CODES_BY_REDEEM_OUTCOME =
  reverseCodeTable<RedeemOutcomeValue>(REDEEM_OUTCOME_CODES);

/**
 * The named redemption outcome of a wire code, or `undefined` when no outcome
 * carries it.
 *
 * Requirements: 16.6
 */
export function redeemOutcomeFromCode(
  code: unknown,
): RedeemOutcomeValue | undefined {
  return namedFromCode<RedeemOutcomeValue>(REDEEM_OUTCOME_CODES, code);
}

/**
 * The wire code of a named redemption outcome, read back out of
 * {@link REDEEM_OUTCOME_CODES}.
 *
 * Requirements: 16.7
 */
export function codeFromRedeemOutcome(outcome: RedeemOutcomeValue): number {
  return CODES_BY_REDEEM_OUTCOME[outcome];
}
