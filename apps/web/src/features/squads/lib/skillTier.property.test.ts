import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEFAULT_SKILL_TIER_CREATE_OPTION,
  DEFAULT_SKILL_TIER_EDIT_OPTION,
  DO_NOT_SEED_TIER,
  LEAVE_TIER_UNCHANGED,
  SKILL_TIERS,
  SKILL_TIER_CREATE_OPTIONS,
  SKILL_TIER_EDIT_OPTIONS,
  createOptionForTier,
  editOptionForTier,
  isSkillTierCreateOption,
  isSkillTierEditOption,
  skillTierFieldsForCreate,
  skillTierFieldsForEdit,
  tierOfCreateOption,
  tierOfEditOption,
  type SkillTierCreateOption,
  type SkillTierEditOption,
} from './skillTier';
import { SKILL_TIER_NAMES, isSkillTier, type SkillTier } from './wireEnums';

/**
 * Property tests for the Skill_Tier option model and its request mapping, beside the
 * module they cover as the design's Testing Strategy asks, and running well above the
 * 100-iteration floor (Requirement 20.1).
 *
 * Three claims are made here:
 *
 * - **A selection maps to command fields exactly as Requirements 12.5 and 12.9
 *   state.** A create selection contributes a `skillTier` property **exactly** when a
 *   tier is selected — asserted with `in` rather than by reading the value, because
 *   "omit the tier" and "send the tier as `undefined`" are different objects that
 *   happen to serialise alike, and only the former is what 12.5 asks for. An edit
 *   selection always contributes `updateSkillTier`, and contributes a tier exactly
 *   when that flag is `true`.
 * - **The option ⇄ wire value mapping round-trips, and admits only the generated
 *   vocabulary.** The tier now travels as its **member name** — `Beginner`,
 *   `Average`, `Strong` — so the off-by-one a 0-based code table could suffer has
 *   no representation left to go wrong in. What remains to state is that the
 *   value a command carries is a member of the Generated_Enum_Union and reads
 *   back as the tier that was selected, and that a near-miss in case or spacing
 *   is not a member.
 * - **The option set is derived, not restated.** "Exactly three Skill_Tier options
 *   together with an option to seed no tier" (12.5) is checked against the tier enum
 *   itself, so a fourth tier landing in the Generated_Enum_Union cannot leave the
 *   Guest_Form offering three.
 *
 * The rendered clauses — that the Guest_Form *offers* these options, defaults to the
 * sentinel, and issues the command — are claimed by **Property 30** at the rendering
 * site. What is stated here is the pure mapping the form submits through.
 */

// --- generators --------------------------------------------------------------

/** Every Skill_Tier, read from the module's derived list rather than restated. */
const tierArb: fc.Arbitrary<SkillTier> = fc.constantFrom(...SKILL_TIERS);

/** Every create-mode option, sentinel included. */
const createOptionArb: fc.Arbitrary<SkillTierCreateOption> = fc.constantFrom(
  ...SKILL_TIER_CREATE_OPTIONS,
);

/** Every edit-mode option, sentinel included. */
const editOptionArb: fc.Arbitrary<SkillTierEditOption> = fc.constantFrom(
  ...SKILL_TIER_EDIT_OPTIONS,
);

/**
 * Candidate wire values worth generating: the three names the enum declares, plus
 * near-misses in case, spacing, and vocabulary that must name no tier — including
 * the numbers the retired code table used, which are no longer a tier in any
 * reading.
 */
const WIRE_VALUES_TO_EXERCISE: readonly unknown[] = [
  ...SKILL_TIER_NAMES,
  'beginner',
  'BEGINNER',
  ' Beginner',
  'Beginner ',
  'Elite',
  0,
  1,
  2,
  3,
];

/**
 * Values a form control could report that are **not** options: the other mode's
 * sentinel above all, plus near-misses in case and spacing, the retired wire
 * codes as numbers and as strings, and the absences.
 */
const NON_OPTION_VALUES: readonly unknown[] = [
  '',
  ' ',
  'beginner',
  'BEGINNER',
  ' Beginner',
  'Beginner ',
  'Elite',
  'do_not_seed',
  'donotseed',
  'leave_unchanged',
  0,
  1,
  2,
  3,
  '0',
  '1',
  true,
  false,
  null,
  undefined,
  [],
  {},
  ['Beginner'],
];

// Feature: web-squads-screens, Property 30 (pure half): the created command omits
// the tier exactly when the no-tier option is selected
// Validates: Requirements 12.5, 16.12, 20.1
describe('skillTierFieldsForCreate — the tier is omitted exactly while no tier is seeded', () => {
  it('carries no skillTier property at all while the default is selected', () => {
    const fields = skillTierFieldsForCreate(DO_NOT_SEED_TIER);

    // 12.5: the property is *absent*, not present-and-undefined. Asserted with
    // `in` because `JSON.stringify` drops both, so a value check would pass for the
    // shape this requirement rules out.
    expect('skillTier' in fields).toBe(false);
    expect(Object.keys(fields)).toEqual([]);
    expect(DEFAULT_SKILL_TIER_CREATE_OPTION).toBe(DO_NOT_SEED_TIER);
  });

  it('carries exactly the selected tier name for every other selection', () => {
    fc.assert(
      fc.property(createOptionArb, (option) => {
        const fields = skillTierFieldsForCreate(option);
        const tier = tierOfCreateOption(option);

        // 12.5: presence of the field and selection of a tier are the same fact.
        expect('skillTier' in fields).toBe(tier !== null);

        if (tier === null) {
          expect(option).toBe(DO_NOT_SEED_TIER);
          return;
        }

        // 16.12: the value is the Wire_Enum_Name verbatim, so this module states
        // no numeric literal of its own and has nothing to get off by one.
        expect(fields.skillTier).toBe(tier);
        expect(isSkillTier(fields.skillTier)).toBe(true);
        expect(Object.keys(fields)).toEqual(['skillTier']);
      }),
      { numRuns: 200 },
    );
  });

  it('returns a fresh object each call, and the same fields for the same selection', () => {
    fc.assert(
      fc.property(createOptionArb, (option) => {
        const first = skillTierFieldsForCreate(option);
        const second = skillTierFieldsForCreate(option);

        expect(first).toEqual(second);
        // Distinct objects, so a caller spreading one into a command cannot reach a
        // shared value through it.
        expect(first).not.toBe(second);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 30 (pure half): the edit command reports the
// tier as changing exactly when a tier is selected
// Validates: Requirements 12.9, 16.12, 20.1
describe('skillTierFieldsForEdit — the change flag and the tier agree', () => {
  it('reports no change and carries no tier while the default is selected', () => {
    const fields = skillTierFieldsForEdit(LEAVE_TIER_UNCHANGED);

    // 12.9: leaving the tier alone must not overwrite it, so there is nothing for
    // the backend to write even if it read the field.
    expect(fields.updateSkillTier).toBe(false);
    expect('skillTier' in fields).toBe(false);
    expect(DEFAULT_SKILL_TIER_EDIT_OPTION).toBe(LEAVE_TIER_UNCHANGED);
  });

  it('reports a change with exactly the selected tier name for every other selection', () => {
    fc.assert(
      fc.property(editOptionArb, (option) => {
        const fields = skillTierFieldsForEdit(option);
        const tier = tierOfEditOption(option);

        // 12.9: the flag is always stated — never inferred from the tier's absence.
        expect(typeof fields.updateSkillTier).toBe('boolean');
        expect(fields.updateSkillTier).toBe(tier !== null);
        expect('skillTier' in fields).toBe(tier !== null);

        if (tier === null) {
          expect(option).toBe(LEAVE_TIER_UNCHANGED);
          expect(Object.keys(fields)).toEqual(['updateSkillTier']);
          return;
        }

        expect(fields.skillTier).toBe(tier);
        expect(isSkillTier(fields.skillTier)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('never carries a tier without the flag, nor the flag set without a tier', () => {
    fc.assert(
      fc.property(editOptionArb, (option) => {
        const fields = skillTierFieldsForEdit(option);

        // The two halves of 12.9 cannot come apart: a tier with the flag clear would
        // be ignored, and the flag set without a tier is a request to change the tier
        // to nothing, which is not an operation the backend offers.
        expect('skillTier' in fields).toBe(fields.updateSkillTier);
      }),
      { numRuns: 200 },
    );
  });

  it('returns a fresh object each call, and the same fields for the same selection', () => {
    fc.assert(
      fc.property(editOptionArb, (option) => {
        const first = skillTierFieldsForEdit(option);
        const second = skillTierFieldsForEdit(option);

        expect(first).toEqual(second);
        expect(first).not.toBe(second);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-squads-screens, Property 30 (pure half): the option ⇄ wire value
// mapping round-trips, and no option names a value outside the generated union
// Validates: Requirements 12.5, 12.9, 16.7, 16.12, 20.1
describe('the Skill_Tier option model — option and wire value map to each other', () => {
  it('round-trips a tier through both option unions', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        // Bidirectional by construction: the option that names a tier names that
        // tier back, in both modes, and neither direction can drift from the other.
        expect(tierOfCreateOption(createOptionForTier(tier))).toBe(tier);
        expect(tierOfEditOption(editOptionForTier(tier))).toBe(tier);
      }),
      { numRuns: 200 },
    );
  });

  it('round-trips an emitted wire value back to the option that emitted it', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const createdValue = skillTierFieldsForCreate(
          createOptionForTier(tier),
        ).skillTier;
        const editedValue = skillTierFieldsForEdit(
          editOptionForTier(tier),
        ).skillTier;

        expect(createdValue).toBe(tier);
        expect(editedValue).toBe(createdValue);

        // 16.7: the value the command carries reads back as the tier that was
        // selected, so nothing between the selection and the wire shifts it.
        expect(isSkillTier(createdValue)).toBe(true);
        expect(createOptionForTier(createdValue as SkillTier)).toBe(
          createOptionForTier(tier),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('emits exactly the generated member names, and no numeric code at all', () => {
    const emitted = SKILL_TIERS.map(
      (tier) => skillTierFieldsForCreate(createOptionForTier(tier)).skillTier,
    );

    // The names the backend declares, in the order `wireEnums.ts` reads them off
    // the Committed_Types — and nothing numeric, which is what the migration from
    // the 0-based code table set out to remove.
    expect(emitted).toEqual([...SKILL_TIER_NAMES]);
    expect(emitted.some((value) => typeof value === 'number')).toBe(false);
  });

  it('offers a tier for every generated wire value exactly when the union names it', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          { weight: 4, arbitrary: fc.constantFrom(...WIRE_VALUES_TO_EXERCISE) },
          { weight: 1, arbitrary: fc.anything() },
        ),
        (candidate) => {
          const emitted: readonly unknown[] = SKILL_TIERS.map(
            (named) =>
              skillTierFieldsForCreate(createOptionForTier(named)).skillTier,
          );

          if (!isSkillTier(candidate)) {
            // A near-miss in case or spacing, and the retired numeric codes, land
            // here: no option offers any of them, so no `CreateGuest` or
            // `EditGuest` command can carry one.
            expect(emitted).not.toContain(candidate);
            return;
          }

          // Every named value is emitted by exactly one option, in each mode.
          expect(
            emitted.filter((value) => value === candidate),
          ).toHaveLength(1);
          expect(
            skillTierFieldsForCreate(createOptionForTier(candidate)).skillTier,
          ).toBe(candidate);
          expect(
            skillTierFieldsForEdit(editOptionForTier(candidate)).skillTier,
          ).toBe(candidate);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 30 (pure half): the option set is exactly
// three tiers plus one sentinel, and the guards accept exactly those
// Validates: Requirements 12.5, 12.8, 12.9, 20.1
describe('the Skill_Tier option model — the offered set', () => {
  it('offers exactly three tiers plus one sentinel in each mode', () => {
    // 12.5: "exactly three Skill_Tier options together with an option to seed no
    // tier" — counted against the tier enum, so a fourth tier arriving in the
    // Generated_Enum_Union cannot leave this at three.
    expect(SKILL_TIERS).toHaveLength(3);
    expect(new Set(SKILL_TIERS).size).toBe(3);

    expect(SKILL_TIER_CREATE_OPTIONS).toHaveLength(SKILL_TIERS.length + 1);
    expect(SKILL_TIER_EDIT_OPTIONS).toHaveLength(SKILL_TIERS.length + 1);

    // The sentinels lead, because each is its mode's default and a default a
    // keyboard user reaches without moving is one they cannot set by accident.
    expect(SKILL_TIER_CREATE_OPTIONS[0]).toBe(DO_NOT_SEED_TIER);
    expect(SKILL_TIER_EDIT_OPTIONS[0]).toBe(LEAVE_TIER_UNCHANGED);

    // The two sentinels are distinct values: "seed nothing" on a create and "change
    // nothing" on an edit are different requests (12.5 against 12.9).
    expect(DO_NOT_SEED_TIER).not.toBe(LEAVE_TIER_UNCHANGED);
    expect(SKILL_TIER_CREATE_OPTIONS).not.toContain(LEAVE_TIER_UNCHANGED);
    expect(SKILL_TIER_EDIT_OPTIONS).not.toContain(DO_NOT_SEED_TIER);
  });

  it('accepts exactly its own options and rejects everything else', () => {
    fc.assert(
      fc.property(createOptionArb, (option) => {
        expect(isSkillTierCreateOption(option)).toBe(true);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(editOptionArb, (option) => {
        expect(isSkillTierEditOption(option)).toBe(true);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(fc.constantFrom(...NON_OPTION_VALUES), (value) => {
        // A control value that is not an option must not reach a command as a tier
        // nobody offered — including the *other* mode's sentinel, which is the
        // near-miss most likely to be copied between the two forms.
        expect(isSkillTierCreateOption(value)).toBe(false);
        expect(isSkillTierEditOption(value)).toBe(false);
      }),
      { numRuns: 300 },
    );

    expect(isSkillTierCreateOption(LEAVE_TIER_UNCHANGED)).toBe(false);
    expect(isSkillTierEditOption(DO_NOT_SEED_TIER)).toBe(false);
  });

  it('is total over arbitrary values and raises nothing', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        // Both guards answer for anything a control could report, including a value
        // no form should produce; neither throws and neither coerces.
        expect(typeof isSkillTierCreateOption(value)).toBe('boolean');
        expect(typeof isSkillTierEditOption(value)).toBe('boolean');

        if (isSkillTierCreateOption(value)) {
          expect(SKILL_TIER_CREATE_OPTIONS).toContain(value);
        }

        if (isSkillTierEditOption(value)) {
          expect(SKILL_TIER_EDIT_OPTIONS).toContain(value);
        }
      }),
      { numRuns: 500 },
    );
  });
});
