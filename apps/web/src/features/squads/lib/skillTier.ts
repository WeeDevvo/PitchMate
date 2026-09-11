/**
 * The Skill_Tier option model: what the Guest_Form offers, and what each choice
 * puts into a `CreateGuest` or `EditGuest` command.
 *
 * Two requirements meet here, and they ask for *different* sentinels because they
 * mean different things:
 *
 * | Mode     | Sentinel option    | Meaning                                        | Command effect (12.5, 12.9) |
 * | -------- | ------------------ | ---------------------------------------------- | --------------------------- |
 * | `create` | `'do-not-seed'`    | seed no tier; the backend applies the default μ | `skillTier` **omitted**     |
 * | `edit`   | `'leave-unchanged'`| whatever tier the guest has now, keep it        | `updateSkillTier: false`, no `skillTier` |
 *
 * Requirement 12.5 wants "exactly three Skill_Tier options together with an
 * option to seed no tier", defaulted to seeding no tier. Requirement 12.9 wants
 * an edit to convey *whether* the tier changes and, only when it does, the tier —
 * so that leaving it alone does not overwrite a tier an admin seeded earlier. A
 * single option union could not express both: `'do-not-seed'` on an edit would
 * read as "clear the tier", which is not an operation the backend offers and not
 * what the option means. So there are two unions over one shared set of tiers,
 * and the tiers themselves are the named values of `./enumCodes` rather than a
 * second list of tier names.
 *
 * **The omission is the mechanism.** While the create default is selected the
 * mapping returns an object with no `skillTier` property at all — not the property
 * set to `undefined`. `JSON.stringify` drops an `undefined` property too, so both
 * would happen to work today; returning the absence makes Requirement 12.5
 * checkable by `'skillTier' in fields` rather than by trusting a serialiser, and
 * keeps the value assignable under `exactOptionalPropertyTypes` if it is ever
 * switched on.
 *
 * **This module names no numeric enum literal.** The 0-based `SkillTier` codes —
 * `0 → beginner`, unlike the four 1-based enums beside it — live in
 * `./enumCodes` and are read from there through `codeFromSkillTier`, which is
 * what keeps Requirement 16.12 true by construction: when the pending
 * `api-response-contracts` chore lands named enum serialisation, that table
 * changes and this module does not.
 *
 * **The mapping returns plain field values, not a generated request type.**
 * Requirement 16.11 has command bodies typed from `@pitchmate/api-client`, and
 * Requirement 18.2 forbids anything under `lib/` from importing that client. The
 * two are reconciled by splitting the responsibility rather than by choosing
 * between them: this module decides *which fields carry what*, as the plain
 * fragments {@link CreateGuestSkillTierFields} and
 * {@link EditGuestSkillTierFields}, and `api/squadsApi.ts` spreads a fragment
 * into the generated `CreateGuestRequest` / `EditGuestRequest` alongside the
 * display name and the acknowledgement. The generated types still type the wire;
 * `lib/` still imports nothing.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the tier names and the code reader it delegates to
 * (Requirement 18.2). Nothing here is a user-facing string: the option *labels*
 * belong to `lib/messages.ts` and the controls that render them, because these
 * identifiers are values, not copy.
 *
 * Requirements: 12.5, 12.9, 16.11, 16.12, 18.2
 */

import {
  codeFromSkillTier,
  SKILL_TIER_CODES,
  type SkillTierValue,
} from './enumCodes';

/**
 * The create-mode sentinel: seed no Skill_Tier at all (Requirement 12.5).
 *
 * A cold-start tier is an *input* to the initial μ and nothing more, so declining
 * to seed one is a legitimate and, for most guests, the ordinary choice — which is
 * why it is the default rather than an afterthought at the end of the list.
 */
export const DO_NOT_SEED_TIER = 'do-not-seed';

/**
 * The edit-mode sentinel: leave the guest's Skill_Tier exactly as it is
 * (Requirement 12.9).
 *
 * Distinct from {@link DO_NOT_SEED_TIER} because an edit that says nothing about
 * the tier must not overwrite one — the Guest_Form is never told what tier a guest
 * currently has (`SquadData.Members` does not carry it), so "unchanged" is the
 * only truthful default it can offer.
 */
export const LEAVE_TIER_UNCHANGED = 'leave-unchanged';

/**
 * The Skill_Tiers in the order they are offered, weakest first.
 *
 * **Read out of the Enum_Code_Map rather than written out again**, so "exactly
 * three options" (Requirement 12.5) is a fact about the tier enum instead of a
 * count this module could fall behind: a fourth tier arriving in
 * `SKILL_TIER_CODES` appears in the Guest_Form without an edit here, and a tier
 * this module invented could not appear at all.
 *
 * The order is `Object.values` over integer-like keys, which the language
 * specifies as ascending numeric key order — so `beginner`, `average`, `strong`,
 * weakest first, deterministically. That the presentation order coincides with the
 * code order is a convenience, not something any caller depends on.
 */
export const SKILL_TIERS: readonly SkillTierValue[] =
  Object.values(SKILL_TIER_CODES);

/**
 * What the Guest_Form's tier selection can hold while creating a guest: the three
 * tiers, plus the option to seed none (Requirement 12.5).
 */
export type SkillTierCreateOption = SkillTierValue | typeof DO_NOT_SEED_TIER;

/**
 * What the Guest_Form's tier selection can hold while editing a guest: the three
 * tiers, plus the option to leave the tier unchanged (Requirement 12.9).
 */
export type SkillTierEditOption = SkillTierValue | typeof LEAVE_TIER_UNCHANGED;

/**
 * The create-mode options in the order they are offered, sentinel first.
 *
 * Sentinel first because it is the default, and a default that is also the first
 * option is what a keyboard user reaches without moving — the alternative invites
 * an accidental tier on a guest nobody has assessed (Requirement 12.5).
 */
export const SKILL_TIER_CREATE_OPTIONS: readonly SkillTierCreateOption[] = [
  DO_NOT_SEED_TIER,
  ...SKILL_TIERS,
];

/**
 * The edit-mode options in the order they are offered, sentinel first
 * (Requirement 12.9).
 */
export const SKILL_TIER_EDIT_OPTIONS: readonly SkillTierEditOption[] = [
  LEAVE_TIER_UNCHANGED,
  ...SKILL_TIERS,
];

/**
 * The selection the Guest_Form opens with for creation: seed no tier
 * (Requirement 12.5).
 */
export const DEFAULT_SKILL_TIER_CREATE_OPTION: SkillTierCreateOption =
  DO_NOT_SEED_TIER;

/**
 * The selection the Guest_Form opens with for an edit: leave the tier unchanged
 * (Requirements 12.8, 12.9).
 */
export const DEFAULT_SKILL_TIER_EDIT_OPTION: SkillTierEditOption =
  LEAVE_TIER_UNCHANGED;

/**
 * The `CreateGuest` fields a tier selection contributes: the tier's code, or
 * nothing at all.
 *
 * A fragment rather than a command: `api/squadsApi.ts` spreads it into the
 * generated `CreateGuestRequest` beside the trimmed display name and the
 * Lawful_Basis_Acknowledgement, which is how the generated type still types the
 * body while `lib/` imports no client (Requirements 16.11, 18.2).
 */
export interface CreateGuestSkillTierFields {
  readonly skillTier?: number;
}

/**
 * The `EditGuest` fields a tier selection contributes: always the change flag,
 * and the tier's code only when the flag is set (Requirement 12.9).
 */
export interface EditGuestSkillTierFields {
  readonly updateSkillTier: boolean;
  readonly skillTier?: number;
}

/**
 * The Skill_Tier a create selection names, or `null` for the sentinel.
 *
 * The narrowing every other function here is built from: the option union is the
 * tier union plus one string, so excluding that string *is* the tier.
 *
 * @param option the current selection
 * @returns the named tier, or `null` while no tier is to be seeded
 *
 * Requirements: 12.5
 */
export function tierOfCreateOption(
  option: SkillTierCreateOption,
): SkillTierValue | null {
  return option === DO_NOT_SEED_TIER ? null : option;
}

/**
 * The Skill_Tier an edit selection names, or `null` while the tier is to be left
 * unchanged.
 *
 * @param option the current selection
 * @returns the named tier, or `null` while the tier is not to be changed
 *
 * Requirements: 12.9
 */
export function tierOfEditOption(
  option: SkillTierEditOption,
): SkillTierValue | null {
  return option === LEAVE_TIER_UNCHANGED ? null : option;
}

/**
 * The create-mode option that names a given Skill_Tier.
 *
 * The reverse of {@link tierOfCreateOption}, so the option model is bidirectional
 * by construction the way the Enum_Code_Map is: a tier read back off the wire has
 * exactly one option that names it, and there is no second list to keep in step.
 *
 * Requirements: 12.5
 */
export function createOptionForTier(
  tier: SkillTierValue,
): SkillTierCreateOption {
  return tier;
}

/**
 * The edit-mode option that names a given Skill_Tier — the reverse of
 * {@link tierOfEditOption}.
 *
 * Requirements: 12.9
 */
export function editOptionForTier(tier: SkillTierValue): SkillTierEditOption {
  return tier;
}

/**
 * Whether a value is one of the create-mode options.
 *
 * A form control reports its selection as a string, and this is the single place
 * that string becomes an option — so a control renaming an option value, or a
 * stale value surviving a re-render, is rejected here rather than reaching the
 * command as a tier nobody offered.
 *
 * Total over every input and free of exceptions.
 *
 * Requirements: 12.5
 */
export function isSkillTierCreateOption(
  value: unknown,
): value is SkillTierCreateOption {
  return SKILL_TIER_CREATE_OPTIONS.some((option) => option === value);
}

/**
 * Whether a value is one of the edit-mode options.
 *
 * Total over every input and free of exceptions.
 *
 * Requirements: 12.9
 */
export function isSkillTierEditOption(
  value: unknown,
): value is SkillTierEditOption {
  return SKILL_TIER_EDIT_OPTIONS.some((option) => option === value);
}

/**
 * The `CreateGuest` tier fields for a create selection (Requirement 12.5).
 *
 * While the default `'do-not-seed'` is selected the result carries **no**
 * `skillTier` property — the property is absent, not `undefined` — so the
 * submitted body omits the tier and the backend applies its default μ. For any
 * other selection the result carries that tier's 0-based code, read from the
 * Enum_Code_Map.
 *
 * Pure and total: three named options and one sentinel, no clock, no exception,
 * and the same fragment for the same selection. A fresh object each call, so no
 * caller can mutate a shared one.
 *
 * @param option the current tier selection
 * @returns `{}` while no tier is to be seeded, otherwise `{ skillTier: code }`
 *
 * Requirements: 12.5, 16.12
 */
export function skillTierFieldsForCreate(
  option: SkillTierCreateOption,
): CreateGuestSkillTierFields {
  const tier = tierOfCreateOption(option);

  // 12.5: the default omits the tier from the submission entirely. Returning an
  // object with no such property — rather than one set to `undefined` — is what
  // makes the omission checkable without inspecting serialised JSON.
  if (tier === null) {
    return {};
  }

  return { skillTier: codeFromSkillTier(tier) };
}

/**
 * The `EditGuest` tier fields for an edit selection (Requirement 12.9).
 *
 * While the default `'leave-unchanged'` is selected the result is
 * `{ updateSkillTier: false }` with no `skillTier`, so the call conveys that the
 * tier is not to be changed and carries no value that could overwrite it. For any
 * other selection the result is `{ updateSkillTier: true, skillTier: code }`.
 *
 * `updateSkillTier` is always present, because the backend reads the flag rather
 * than inferring intent from an absent tier — an omitted flag would be a
 * different request than the one Requirement 12.9 describes.
 *
 * Pure and total, and a fresh object each call.
 *
 * @param option the current tier selection
 * @returns the change flag, and the tier's code only when the flag is set
 *
 * Requirements: 12.9, 16.12
 */
export function skillTierFieldsForEdit(
  option: SkillTierEditOption,
): EditGuestSkillTierFields {
  const tier = tierOfEditOption(option);

  // 12.9: leaving the tier alone is stated by the flag and by carrying no tier —
  // both, so that neither the flag nor the absence has to be read as a hint.
  if (tier === null) {
    return { updateSkillTier: false };
  }

  return { updateSkillTier: true, skillTier: codeFromSkillTier(tier) };
}
