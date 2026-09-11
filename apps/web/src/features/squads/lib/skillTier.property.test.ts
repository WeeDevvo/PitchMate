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
import {
  codeFromSkillTier,
  skillTierFromCode,
  type SkillTierValue,
} from './enumCodes';

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
 * - **The option ⇄ code mapping round-trips, and rejects code 3.** `SkillTier` is one
 *   of the two **0-based** wire enums, so `beginner` is `0` and `3` names nothing.
 *   Every emitted code is generated and read back through the Enum_Code_Map, and code
 *   `3` is exercised by name: a 1-based misreading would shift every tier by one, and
 *   the option set would silently offer a tier the backend does not have.
 * - **The option set is derived, not restated.** "Exactly three Skill_Tier options
 *   together with an option to seed no tier" (12.5) is checked against the tier enum
 *   itself, so a fourth tier landing in the Enum_Code_Map cannot leave the Guest_Form
 *   offering three.
 *
 * The rendered clauses — that the Guest_Form *offers* these options, defaults to the
 * sentinel, and issues the command — are claimed by **Property 30** at the rendering
 * site. What is stated here is the pure mapping the form submits through.
 */

// --- generators --------------------------------------------------------------

/** Every Skill_Tier, read from the module's derived list rather than restated. */
const tierArb: fc.Arbitrary<SkillTierValue> = fc.constantFrom(...SKILL_TIERS);

/** Every create-mode option, sentinel included. */
const createOptionArb: fc.Arbitrary<SkillTierCreateOption> = fc.constantFrom(
  ...SKILL_TIER_CREATE_OPTIONS,
);

/** Every edit-mode option, sentinel included. */
const editOptionArb: fc.Arbitrary<SkillTierEditOption> = fc.constantFrom(
  ...SKILL_TIER_EDIT_OPTIONS,
);

/**
 * The wire codes worth generating: the three the enum names, **`3` which it does
 * not**, and the neighbours a 1-based or off-by-one reading would reach for.
 */
const CODES_TO_EXERCISE: readonly number[] = [-1, 0, 1, 2, 3, 4];

/**
 * Values a form control could report that are **not** options: the other mode's
 * sentinel above all, plus near-misses in case and spacing, the wire codes as
 * numbers and as strings, and the absences.
 */
const NON_OPTION_VALUES: readonly unknown[] = [
  '',
  ' ',
  'Beginner',
  'BEGINNER',
  ' beginner',
  'beginner ',
  'elite',
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
  ['beginner'],
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

  it('carries exactly the selected tier code for every other selection', () => {
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

        // 16.12: the code comes from the Enum_Code_Map, and this module states no
        // numeric literal of its own.
        expect(fields.skillTier).toBe(codeFromSkillTier(tier));
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

  it('reports a change with exactly the selected tier code for every other selection', () => {
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

        expect(fields.skillTier).toBe(codeFromSkillTier(tier));
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

// Feature: web-squads-screens, Property 30 (pure half): the option ⇄ code mapping
// round-trips, and no option names SkillTier code 3
// Validates: Requirements 12.5, 12.9, 16.7, 16.12, 20.1
describe('the Skill_Tier option model — option and code map to each other', () => {
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

  it('round-trips an emitted code back to the option that emitted it', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const createdCode = skillTierFieldsForCreate(
          createOptionForTier(tier),
        ).skillTier;
        const editedCode = skillTierFieldsForEdit(
          editOptionForTier(tier),
        ).skillTier;

        expect(createdCode).toBe(codeFromSkillTier(tier));
        expect(editedCode).toBe(createdCode);

        // 16.7: the code the command carries reads back as the tier that was
        // selected, so nothing between the selection and the wire shifts it.
        const readBack = skillTierFromCode(createdCode);
        expect(readBack).toBe(tier);
        expect(createOptionForTier(readBack as SkillTierValue)).toBe(
          createOptionForTier(tier),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('names codes 0, 1, and 2 and never code 3', () => {
    const emittedCodes = SKILL_TIERS.map(
      (tier) => skillTierFieldsForCreate(createOptionForTier(tier)).skillTier,
    );

    // The 0-based reading, stated as a fact rather than left implicit: a 1-based
    // table would emit 1, 2, 3 here and this would fail.
    expect(emittedCodes).toEqual([0, 1, 2]);
    expect(emittedCodes).not.toContain(3);
    expect(skillTierFromCode(3)).toBeUndefined();
  });

  it('emits, for every generated code, a tier exactly when the enum names that code', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          { weight: 4, arbitrary: fc.constantFrom(...CODES_TO_EXERCISE) },
          { weight: 1, arbitrary: fc.integer({ min: -20, max: 20 }) },
        ),
        (code) => {
          const tier = skillTierFromCode(code);
          const emittedCodes = SKILL_TIERS.map((named) =>
            codeFromSkillTier(named),
          );

          if (tier === undefined) {
            // Code 3 lands here, which is the whole point: no option offers it, so
            // no `CreateGuest` or `EditGuest` command can carry it.
            expect(emittedCodes).not.toContain(code);
            return;
          }

          // Every named code is emitted by exactly one option, in each mode.
          expect(emittedCodes.filter((emitted) => emitted === code)).toHaveLength(
            1,
          );
          expect(
            skillTierFieldsForCreate(createOptionForTier(tier)).skillTier,
          ).toBe(code);
          expect(skillTierFieldsForEdit(editOptionForTier(tier)).skillTier).toBe(
            code,
          );
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
    // Enum_Code_Map cannot leave this at three.
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
