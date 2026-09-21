/**
 * Structural source scan: the Squads_Feature's enum boundary and its rating
 * boundary (task 17.4).
 *
 * Requirement 20.11 makes this file part of the product rather than a courtesy
 * check. Both rules it enforces are stated as prohibitions over a directory —
 * "no screen module depends on the numeric enum representation" (16.12), "no
 * value computed from a mean skill estimate, an uncertainty value, or any scaling
 * parameter" (8.9) — and a prohibition cannot be demonstrated by an example. So
 * the source tree is read and matched, following the mechanism
 * `pureLogic.structural.test.ts` and `transportSeam.structural.test.ts` already
 * established and `structural/sourceScan.ts` declares once: read each file's
 * text, strip comments (and, where the rule is about identifiers, string
 * contents) through the same small state machine, and fail naming the offending
 * file and the offending literal.
 *
 * ### What each rule buys
 *
 * 1. **No numeric enum literal outside `lib/enumCodes.ts`** (Requirement 16.12).
 *    The squads responses are not schematised yet, so six enums arrive as the
 *    numbers `System.Text.Json` emits. The design's claim is that the pending
 *    `api-response-contracts` chore is a change confined to the Response_Parser,
 *    the Response_Printer, and the Enum_Code_Map. That claim is only verifiable
 *    if the wire codes exist in exactly one module — so a code appearing in a
 *    screen, a component, a hook, or the transport facade is a finding.
 * 2. **No rating internals anywhere in the feature** (Requirement 8.9). The
 *    mapping from the model (μ, σ) to a friendly number is the backend's. This
 *    feature renders the leaderboard entry's own `value`, rounded, and computes
 *    nothing from a mean skill estimate, an uncertainty value, or a scaling
 *    parameter — so no `mu`, no `sigma`, no `μ`, no `σ`, no `K`, no `C`, and no
 *    `μ − 3σ` arithmetic.
 *
 * ### Scoping the enum rule: enum *positions*, not "any numeric literal"
 *
 * "No numeric enum literal" cannot be read as "no numeric literal". The feature
 * legitimately contains numbers that are not enum codes, and `lib/callOutcome.ts`
 * is the proof: it declares `400: 'validation'`, `409: 'conflict'`, and
 * `status === 401`. Those are HTTP statuses — a different wire vocabulary, owned
 * by this feature by design (Requirement 17.2 has it name its own rejection
 * reasons rather than echo the backend's). A scan that flagged every integer
 * would flag them, and the only way to keep it green would be to weaken it until
 * it asserted nothing.
 *
 * So the rule is stated over the **positions** an enum code can occupy, as an
 * explicit pattern table rather than a general numeric search:
 *
 * - **{@link ENUM_FIELD_LITERAL}** — a numeric literal written to, or compared
 *   against, one of the six wire field names the Enum_Code_Map covers: `role`,
 *   `state`, `feature`, `skillTier`, `outcome`, `statistic`. That covers the
 *   object-literal form (`{ feature: 1, enabled: true }`), the assignment form,
 *   the JSX-prop form (`state={1}`), the comparison form (`role === 2`), and a
 *   numeric-literal type annotation. These are the field names every squads
 *   request body and response body actually uses, read off `api/squadsApi.ts` and
 *   the parsers.
 * - **{@link ENUM_CODE_CALL}** — a numeric literal handed to any `…FromCode` or
 *   `codeFrom…` function. Those are the Enum_Code_Map's own readers and writers,
 *   so a caller passing a literal instead of a named value is naming a code.
 * - **{@link ENUM_NAME_TABLE}** — a numeric-keyed table whose values are the
 *   Enum_Code_Map's own named values (`1: 'owner'`, `0: 'beginner'`, …). This is
 *   what a second, drifting copy of a code table looks like. It is keyed on the
 *   *names* precisely so that `callOutcome.ts`'s status table is not caught: its
 *   values are rejection reasons, not enum names.
 *
 * **Deliberately not matched, and why:**
 *
 * - Any numeric literal in a non-enum position — HTTP statuses, timeouts, array
 *   indices, heading levels, `length` comparisons. Matching them would be the
 *   over-reach described above.
 * - A code reaching a field through a variable (`{ feature: code }` where `code`
 *   was computed elsewhere from a literal). Following that would need a type
 *   checker, not a text scan; what a scan can pin is that the literal itself
 *   appears nowhere, and a literal has to appear somewhere for a variable to
 *   carry one.
 * - `status` is **not** one of the six field names, for the reason above.
 *
 * The restriction is kept non-vacuous from both ends. {@link ENUM_NAME_TABLE}
 * fires on `lib/enumCodes.ts` — the one module exempted — which shows the scan
 * can see an enum table where one exists; the documented mappings of all six
 * tables are then spot-checked positively, so the codes are asserted to live
 * there rather than merely to be absent everywhere else; and each pattern is
 * exercised against a synthetic offender and a synthetic near-miss, so a pattern
 * that could never fire would itself fail.
 *
 * ### Scoping the rating rule: an identifier scan, plus one closed function
 *
 * Requirement 8.9's forbidden quantities have names, so a word scan over
 * comment-and-string-stripped code states the rule directly: `\bmu\b`,
 * `\bsigma\b`, `\buncertainty\b`, `μ`, `σ`. Word boundaries matter here — the
 * feature contains `mutate`, `must`, `Kind`, and `Component`, none of which is a
 * rating internal.
 *
 * The scaling constants `K` and `C` are single letters, which a bare word scan
 * cannot ask about without flagging every generic type parameter `<K, V>`. The
 * defensible narrower rule is that a scaling parameter is a **value binding**: a
 * `const`/`let`/`var` named exactly `K` or `C`, or an `K = <number>` assignment,
 * or an identifier spelled `RATING_K`/`ratingK`/`RATING_C`/`ratingC`. A generic
 * type parameter named `K` is not matched, and is not a scaling parameter.
 * The `μ − 3σ` arithmetic is caught by its multiplier: since `sigma` and `σ`
 * are already forbidden outright, any conservative-estimate computation would
 * have to spell the uncertainty differently, but it still has to multiply by
 * three — so a literal `3` used as a multiplicand is a finding.
 *
 * The negative rules are joined by one positive, closed statement: every numeric
 * literal in `lib/ratingPresentation.ts` — the one module that turns a
 * leaderboard value into a displayable integer — is `0`. There is no room in a
 * function whose only literals are zero for a `K`, a `C`, or a `3`, whatever they
 * are named.
 *
 * Requirements: 8.9, 16.12, 20.11
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isTestFile,
  norm,
  readCodeOnly,
  readWithoutComments,
  relTo,
  squadsModules,
  squadsRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The feature's production modules: the set both rules bind. */
const modules = squadsModules();

/** The one module Requirement 16.12 exempts: the Enum_Code_Map. */
const enumCodesModule = join(squadsRoot, 'lib', 'enumCodes.ts');

/** The one module that turns a leaderboard value into a displayable integer. */
const ratingPresentationModule = join(squadsRoot, 'lib', 'ratingPresentation.ts');

/** Every module but the Enum_Code_Map — the set the enum rule binds. */
const modulesOutsideEnumCodes = modules.filter(
  (file) => norm(file) !== norm(enumCodesModule),
);

/** Path relative to the feature root, for a failure message. */
function featureRel(path: string): string {
  return relTo(squadsRoot, path);
}

// --- The enum-position patterns ----------------------------------------------

/**
 * The six wire field names the Enum_Code_Map covers (Requirement 16.6), as they
 * are spelled in a request body, a response body, and a component prop.
 *
 * `status` is absent on purpose: an HTTP status is a different wire vocabulary,
 * and `lib/callOutcome.ts` names statuses by number by design.
 */
const ENUM_FIELD_NAMES = [
  'role',
  'state',
  'feature',
  'skillTier',
  'outcome',
  'statistic',
] as const;

/** The Enum_Code_Map's named values, every table's, as the wire tables spell them. */
const ENUM_NAMED_VALUES = [
  'owner',
  'admin',
  'member',
  'active',
  'inactive',
  'revoked',
  'expired',
  'live-match-tracking',
  'beginner',
  'average',
  'strong',
  'joined',
  'reactivated',
  'already-member',
] as const;

/**
 * A numeric literal written to, compared against, or annotating one of the six
 * enum field names.
 *
 * The connector alternation admits `:`, `=`, `={`, `==`, `===`, `!=`, and `!==`,
 * and refuses `=>` and `>=`/`<=`, so an arrow function whose parameter is named
 * `role` and a numeric ordering comparison are not mistaken for a code.
 */
const ENUM_FIELD_LITERAL = new RegExp(
  `\\b(?:${ENUM_FIELD_NAMES.join('|')})\\s*(?:===?|!==?|:|=\\s*\\{|=(?![>=]))\\s*-?\\d`,
  'g',
);

/** A numeric literal handed to an Enum_Code_Map reader or writer. */
const ENUM_CODE_CALL =
  /\b(?:[A-Za-z_$][\w$]*FromCode|codeFrom[A-Za-z_$][\w$]*)\s*\(\s*-?\d/g;

/**
 * A numeric-keyed table entry whose value is one of the Enum_Code_Map's named
 * values — a second copy of a code table.
 *
 * Read against comment-stripped source with string literals **kept**, because
 * the names are string literals. Keyed on the names rather than on "any numeric
 * key" so that `lib/callOutcome.ts`'s `400: 'validation'` status table is not a
 * finding.
 */
const ENUM_NAME_TABLE = new RegExp(
  `[{,]\\s*-?\\d+\\s*:\\s*(['"])(?:${ENUM_NAMED_VALUES.join('|')})\\1`,
  'g',
);

/** One enum-position rule, and which stripped form it reads. */
interface EnumRule {
  readonly label: string;
  readonly pattern: RegExp;
  /** `true` to read comment-stripped source that keeps string literals. */
  readonly keepsStrings: boolean;
}

const ENUM_RULES: readonly EnumRule[] = [
  {
    label: 'numeric literal in an enum field position',
    pattern: ENUM_FIELD_LITERAL,
    keepsStrings: false,
  },
  {
    label: 'numeric literal passed to an Enum_Code_Map function',
    pattern: ENUM_CODE_CALL,
    keepsStrings: false,
  },
  {
    label: 'numeric-keyed table of Enum_Code_Map names',
    pattern: ENUM_NAME_TABLE,
    keepsStrings: true,
  },
];

// --- The rating-internal patterns --------------------------------------------

/** One rating-internal rule: a name or an arithmetic shape Requirement 8.9 forbids. */
interface RatingRule {
  readonly label: string;
  readonly pattern: RegExp;
}

const RATING_RULES: readonly RatingRule[] = [
  { label: 'mean skill estimate `mu`', pattern: /\bmu\b/g },
  { label: 'uncertainty `sigma`', pattern: /\bsigma\b/g },
  { label: 'uncertainty value', pattern: /\buncertainty\b/g },
  { label: 'the symbol μ', pattern: /μ/g },
  { label: 'the symbol σ', pattern: /σ/g },
  {
    label: 'a scaling constant bound as `K` or `C`',
    pattern: /\b(?:const|let|var)\s+[KC]\b|\b[KC]\s*=\s*-?\d/g,
  },
  {
    label: 'a named rating-scaling constant',
    pattern: /\b(?:RATING_[KC]|rating[KC])\b/g,
  },
  {
    label: 'multiplication by three, as `μ − 3σ` needs',
    pattern: /(?<![\w.$])3\s*\*|\*\s*3(?![\w.$])/g,
  },
];

// --- Matching ----------------------------------------------------------------

/** One finding: the module, the rule it broke, and the text that broke it. */
interface Finding {
  readonly module: string;
  readonly rule: string;
  readonly literal: string;
}

/** Every match of `pattern` in `source`, whitespace collapsed for readability. */
function matchesOf(source: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push(match[0].replace(/\s+/g, ' ').trim());
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return found;
}

// --- Invariant 0: the scan sees something ------------------------------------

describe('the enum and rating scan sees the Squads_Feature', () => {
  it('is rooted at features/squads', () => {
    expect(norm(squadsRoot).endsWith('apps/web/src/features/squads')).toBe(true);
  });

  it('collects the feature production modules, and no test file among them', () => {
    // A vacuous scan would pass every prohibition below. This feature is three
    // screens, a component set, six hooks, a transport facade, and the whole of
    // `lib/`, so the production set is comfortably past forty modules.
    expect(modules.length).toBeGreaterThan(40);
    expect(modules.map(featureRel).filter(isTestFile)).toEqual([]);
  });

  it('reaches the screens, the components, the hooks, and the transport facade', () => {
    // A walker that stopped at the top level would leave exactly the modules the
    // enum rule is about unscanned while still looking non-vacuous.
    const paths = modules.map(featureRel);

    expect(paths.filter((path) => path.startsWith('screens/')).length).toBeGreaterThan(2);
    expect(paths.filter((path) => path.startsWith('components/')).length).toBeGreaterThan(
      10,
    );
    expect(paths.filter((path) => path.startsWith('state/')).length).toBeGreaterThan(5);
    expect(paths.filter((path) => path.startsWith('lib/parse/')).length).toBeGreaterThan(5);
    expect(paths).toContain('api/squadsApi.ts');
    expect(paths).toContain('lib/enumCodes.ts');
    expect(paths).toContain('lib/ratingPresentation.ts');
  });

  it('holds out exactly one module from the enum rule', () => {
    expect(modules.length - modulesOutsideEnumCodes.length).toBe(1);
    expect(modulesOutsideEnumCodes.map(featureRel)).not.toContain('lib/enumCodes.ts');
  });
});

// --- Invariant 1: no numeric enum literal outside lib/enumCodes.ts -----------

describe('no numeric enum literal lives outside the Enum_Code_Map', () => {
  it('finds none in any other module of the feature (Requirement 16.12)', () => {
    const findings: Finding[] = [];

    for (const file of modulesOutsideEnumCodes) {
      const withStrings = readWithoutComments(file);
      const codeOnly = readCodeOnly(file);

      for (const { label, pattern, keepsStrings } of ENUM_RULES) {
        for (const literal of matchesOf(keepsStrings ? withStrings : codeOnly, pattern)) {
          findings.push({ module: featureRel(file), rule: label, literal });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('fires on the Enum_Code_Map itself, so the rule is not unfireable', () => {
    // The exempted module is the one module that *does* hold code tables. If the
    // table pattern cannot see them there, it could not see a second copy of them
    // anywhere else either, and the invariant above would be empty.
    const tables = matchesOf(readWithoutComments(enumCodesModule), ENUM_NAME_TABLE);

    expect(tables.length).toBeGreaterThanOrEqual(14);
  });
});

describe('the Enum_Code_Map holds the documented wire codes', () => {
  /** The entries of one exported code table, read off the source. */
  function tableEntries(constantName: string): Array<[string, string]> {
    const source = readWithoutComments(enumCodesModule);
    const block = new RegExp(`\\b${constantName}\\s*=\\s*\\{([^}]*)\\}`).exec(source);

    expect(block, `${constantName} is not declared in lib/enumCodes.ts`).not.toBeNull();

    const entries: Array<[string, string]> = [];
    const entryPattern = /(-?\d+)\s*:\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = entryPattern.exec(block?.[1] ?? '')) !== null) {
      entries.push([match[1], match[2]]);
    }
    return entries;
  }

  it('names the four 1-based enums exactly as the backend declares them', () => {
    expect(tableEntries('MEMBER_ROLE_CODES')).toEqual([
      ['1', 'owner'],
      ['2', 'admin'],
      ['3', 'member'],
    ]);
    expect(tableEntries('MEMBERSHIP_STATE_CODES')).toEqual([
      ['1', 'active'],
      ['2', 'inactive'],
    ]);
    expect(tableEntries('SQUAD_FEATURE_CODES')).toEqual([['1', 'live-match-tracking']]);
    expect(tableEntries('INVITE_STATE_CODES')).toEqual([
      ['1', 'active'],
      ['2', 'revoked'],
      ['3', 'expired'],
    ]);
  });

  it('names the two 0-based enums from zero, so neither is read as 1-based', () => {
    // `SkillTier` and `RedeemOutcome` declare no explicit values on the backend,
    // so they start at `0`. A 1-based table would name code `3`, and these must
    // not — which is the mistake this spot check exists to catch.
    const tiers = tableEntries('SKILL_TIER_CODES');
    const outcomes = tableEntries('REDEEM_OUTCOME_CODES');

    expect(tiers).toEqual([
      ['0', 'beginner'],
      ['1', 'average'],
      ['2', 'strong'],
    ]);
    expect(outcomes).toEqual([
      ['0', 'joined'],
      ['1', 'reactivated'],
      ['2', 'already-member'],
    ]);
    expect(tiers.map(([code]) => code)).not.toContain('3');
    expect(outcomes.map(([code]) => code)).not.toContain('3');
  });
});

// --- Invariant 2: no rating internals anywhere in the feature ----------------

describe('no rating internal appears anywhere in the Squads_Feature', () => {
  it('names no mu, sigma, uncertainty, K, C, or ×3 arithmetic (Requirement 8.9)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      // Comments *and* strings stripped: several of these modules promise in
      // prose that they contain no μ, no σ, no K, and no C, and a scan that
      // matched prose would flag the documentation promising compliance.
      const code = readCodeOnly(file);

      for (const { label, pattern } of RATING_RULES) {
        for (const literal of matchesOf(code, pattern)) {
          findings.push({ module: featureRel(file), rule: label, literal });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('writes every numeric literal in lib/ratingPresentation.ts as zero', () => {
    // The positive half of the rule. The one module that turns a leaderboard
    // value into a displayable integer rounds a magnitude and reapplies a sign;
    // its only literals are zero, so there is nowhere for a scale, an offset, or
    // a factor of three to hide under another name.
    const code = readCodeOnly(ratingPresentationModule);
    const literals = matchesOf(code, /(?<![\w.$])\d+(?:\.\d+)?/g);

    expect(literals.length).toBeGreaterThan(0);
    expect([...new Set(literals)]).toEqual(['0']);
  });
});

// --- Invariant 3: the patterns can fire, and do not over-fire ----------------

describe('the scan patterns fire on an offender and hold off a near-miss', () => {
  it('catches each enum position it claims to catch', () => {
    expect(
      matchesOf('api.setFeatureFlag(id, { feature: 1, enabled: true });', ENUM_FIELD_LITERAL),
    ).not.toEqual([]);
    expect(matchesOf('if (row.role === 2) {', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('<Badge state={1} />', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('body.skillTier = 0;', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('memberRoleFromCode(2)', ENUM_CODE_CALL)).not.toEqual([]);
    expect(matchesOf('codeFromSkillTier( 1 )', ENUM_CODE_CALL)).not.toEqual([]);
    expect(matchesOf("const T = { 1: 'owner', 2: 'admin' };", ENUM_NAME_TABLE)).toHaveLength(
      2,
    );
  });

  it('holds off the numbers this feature legitimately writes', () => {
    // The four shapes that made a general numeric search untenable, and which the
    // scoping decisions in the docblock are chosen to permit.
    expect(matchesOf('if (status === 401) {', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf("{ 400: 'validation', 409: 'conflict' }", ENUM_NAME_TABLE)).toEqual([]);
    expect(matchesOf('rows.map((role) => 1)', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf('if (levels.length >= 2) {', ENUM_FIELD_LITERAL)).toEqual([]);
    // A named value in an enum position is the whole point of the Enum_Code_Map.
    expect(matchesOf("squadSummary({ role: 'owner', state: null })", ENUM_FIELD_LITERAL)).toEqual(
      [],
    );
  });

  it('catches each rating internal it claims to catch', () => {
    const offender = 'const mu = 25; const sigma = 8.333; const K = 40; const C = 1000;';
    const conservative = 'const display = (mean - 3 * spread) * K + C;';

    const fired = RATING_RULES.filter(
      ({ pattern }) =>
        matchesOf(offender, pattern).length > 0 ||
        matchesOf(conservative, pattern).length > 0,
    ).map(({ label }) => label);

    expect(fired).toContain('mean skill estimate `mu`');
    expect(fired).toContain('uncertainty `sigma`');
    expect(fired).toContain('a scaling constant bound as `K` or `C`');
    expect(fired).toContain('multiplication by three, as `μ − 3σ` needs');
    expect(matchesOf('const RATING_K = 40;', RATING_RULES[6].pattern)).not.toEqual([]);
    expect(matchesOf('display = μ - 3 * σ;', RATING_RULES[3].pattern)).not.toEqual([]);
    expect(matchesOf('display = μ - 3 * σ;', RATING_RULES[4].pattern)).not.toEqual([]);
  });

  it('holds off the words that merely contain those letters', () => {
    const innocent =
      'function mutate(kind: Kind, Component: FC) { return must(kind) && Component; }';

    for (const { label, pattern } of RATING_RULES) {
      expect(matchesOf(innocent, pattern), label).toEqual([]);
    }

    expect(matchesOf('type Table<K, V> = Record<K, V>;', RATING_RULES[5].pattern)).toEqual(
      [],
    );
    expect(matchesOf('Math.round(Math.abs(value))', RATING_RULES[7].pattern)).toEqual([]);
    expect(matchesOf('const width = 360;', RATING_RULES[7].pattern)).toEqual([]);
  });
});
