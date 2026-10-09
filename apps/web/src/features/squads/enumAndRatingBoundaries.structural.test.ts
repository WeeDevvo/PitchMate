/**
 * Structural source scan: the Squads_Feature's enum boundary and its rating
 * boundary (tasks 17.4, 18.2).
 *
 * Requirement 20.11 makes this file part of the product rather than a courtesy
 * check. Both rules it enforces are stated as prohibitions over a directory —
 * "no numeric enum literal appears anywhere in the Squads_Web_Module, holding out
 * no module from that rule" (12.13, tightening 16.12), "no value computed from a
 * mean skill estimate, an uncertainty value, or any scaling parameter" (8.9) —
 * and a prohibition cannot be demonstrated by an example. So the source tree is
 * read and matched, following the mechanism `pureLogic.structural.test.ts` and
 * `transportSeam.structural.test.ts` already established and
 * `structural/sourceScan.ts` declares once: read each file's text, strip comments
 * (and, where the rule is about identifiers, string contents) through the same
 * small state machine, and fail naming the offending file and the offending
 * literal.
 *
 * ### What each rule buys
 *
 * 1. **No numeric enum literal anywhere in the feature** (Requirements 12.13,
 *    16.12). The squads responses are schematised now. The backend serialises
 *    every wire enum **by name**, each enum is published as a named string schema,
 *    and `lib/wireEnums.ts` aliases those unions straight out of the generated
 *    types and pins each one to its Generated_Enum_Union at compile time. The
 *    numbers `System.Text.Json` used to emit are gone from the contract, and the
 *    Enum_Code_Map that was the one legitimate home for them is retired — so this
 *    rule holds **no module out**, and this file carries no exemption mechanism
 *    for one to be quietly added back to. A numeric enum literal is a finding
 *    wherever it appears: in a parser, a printer, the transport facade, a screen,
 *    a component, a hook, or a test harness.
 *
 *    What the rule buys after the migration is the half the compile-time checks
 *    cannot state. `wireEnums.ts` pins the *names* to the generated vocabulary,
 *    so a renamed or added member is a build failure; it says nothing about a
 *    module that stops asking for a name and starts writing a code again. A
 *    reintroduced numeric reading would type-check perfectly well against a
 *    hand-written literal, and the drift gates would stay green while the feature
 *    quietly re-acquired the coupling this chore removed. This scan is what makes
 *    that visible, and it is the reason the rule survived the module it used to
 *    exempt.
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
 *   against, one of the wire field names that carry an enum: `role`, `state`,
 *   `ratingState`, `feature`, `skillTier`, `outcome`, `statistic`. That covers the
 *   object-literal form (`{ feature: 1, enabled: true }`), the assignment form,
 *   the JSX-prop form (`state={1}`), the comparison form (`role === 2`), and a
 *   numeric-literal type annotation. These are the field names every squads
 *   request body and response body actually uses, read off `api/squadsApi.ts` and
 *   the parsers.
 * - **{@link ENUM_CODE_CALL}** — a numeric literal handed to any `…FromCode` or
 *   `codeFrom…` function. No such function exists in the feature any more, which
 *   is the point: that naming shape is what a reader or writer of a numeric code
 *   table is called, so the pattern stands guard over a reintroduction rather than
 *   over anything present. A caller passing a literal to one would be naming a
 *   code.
 * - **{@link ENUM_NAME_TABLE}** — a numeric-keyed table whose values are wire
 *   enum names (`1: 'Owner'`, `0: 'Beginner'`, …). This is what a second,
 *   drifting copy of a code table looks like — the artefact the retired module
 *   was, rebuilt by hand beside the schematised names. It is keyed on the *names*
 *   precisely so that `callOutcome.ts`'s status table is not caught: its values
 *   are this feature's own rejection reasons, not enum names.
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
 * - `status` is **not** one of the enum field names, for the reason above.
 *
 * ### Keeping the tightened rule non-vacuous
 *
 * Tightening the rule cost it its own best witness. While `lib/enumCodes.ts`
 * existed, {@link ENUM_NAME_TABLE} fired on it, and that single assertion showed
 * the scan could read the feature's sources and recognise a code table in them —
 * the codes were asserted to *live* somewhere, not merely to be absent
 * everywhere. A rule that holds nothing out has no such module left to point at,
 * and "no numeric enum literal anywhere" is precisely the shape of claim that a
 * broken walker, an unreadable file, or a pattern that can never match would
 * satisfy in silence. So the assurance is stated explicitly instead, in two
 * halves (Requirement 12.14):
 *
 * - **The scan sees the sources it claims to cover.** Invariant 0 pins the root,
 *   counts the production modules past forty, asserts the walk reaches
 *   `screens/`, `components/`, `state/` and `lib/parse/` rather than stopping at
 *   the top level, and names four modules the two rules are specifically about:
 *   the transport facade, the rating presenter, `lib/wireEnums.ts` (where the
 *   named unions now live), and `lib/callOutcome.ts` — the module whose
 *   legitimate HTTP statuses the scoping decisions above are chosen to permit,
 *   which is only a real claim if that module is in the scanned set.
 * - **Every pattern can fire, and holds off its near-miss.** Invariant 3
 *   exercises all three enum patterns, each against a synthetic offender *and*
 *   against a synthetic near-miss, so a pattern that could never match and a
 *   pattern that matched everything would both fail here rather than passing the
 *   prohibition for free.
 *
 * The two halves are only assurance together: the first shows there is source to
 * read, the second shows the patterns would speak if a code were in it.
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
 * Requirements: 8.9, 12.13, 12.14, 16.12, 20.11
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

/**
 * The set the enum rule scans — the whole of {@link modules}, with no module held
 * out (Requirement 12.13).
 *
 * Named separately only so the "holds nothing out" invariant has something to
 * assert about rather than a comment to make. While the Enum_Code_Map existed
 * this was `modules` minus that one file; the alias is what used to carry the
 * exemption, and it now carries its absence.
 */
const ENUM_SCANNED_MODULES: readonly string[] = modules;

/** The one module that turns a leaderboard value into a displayable integer. */
const ratingPresentationModule = join(squadsRoot, 'lib', 'ratingPresentation.ts');

/** Path relative to the feature root, for a failure message. */
function featureRel(path: string): string {
  return relTo(squadsRoot, path);
}

// --- The enum-position patterns ----------------------------------------------

/**
 * The wire field names that carry an enum, as they are spelled in a request body,
 * a response body, and a component prop.
 *
 * One per union `lib/wireEnums.ts` declares, plus the request-side `statistic`:
 * `role`, `state` and `ratingState` on a membership, `feature` on a flag,
 * `skillTier` on a guest, `outcome` on a redemption. `ratingState` is listed
 * separately from `state` because the scan matches on a word boundary, and the
 * lower-case `state` of this list never occurs inside `ratingState`.
 *
 * `status` is absent on purpose: an HTTP status is a different wire vocabulary,
 * and `lib/callOutcome.ts` names statuses by number by design.
 */
const ENUM_FIELD_NAMES = [
  'role',
  'state',
  'ratingState',
  'feature',
  'skillTier',
  'outcome',
  'statistic',
] as const;

/**
 * The named values a numeric-keyed table would have to map to in order to be a
 * code table — both vocabularies, on purpose.
 *
 * The first group is the contract's own, read off the tuples in
 * `lib/wireEnums.ts`: a freshly hand-built code table would map numbers onto
 * these, because these are the names the parsers now accept. The second group is
 * the lower-case vocabulary the retired Enum_Code_Map used; it names nothing in
 * the feature any more, and it is kept because the likeliest way a code table
 * comes back is a copy of the one that was taken away.
 *
 * Neither group collides with `lib/callOutcome.ts`'s tables: its status table maps
 * to rejection reasons (`'validation'`, `'conflict'`, `'invite-unusable'`) and its
 * problem-code table is not numerically keyed at all.
 */
const ENUM_NAMED_VALUES = [
  // The Generated_Enum_Union names, as the contract spells them.
  'Owner',
  'Admin',
  'Member',
  'Active',
  'Inactive',
  'Provisional',
  'Established',
  'Revoked',
  'Expired',
  'LiveMatchTracking',
  'Beginner',
  'Average',
  'Strong',
  'Joined',
  'Reactivated',
  'AlreadyMember',
  // The retired numeric map's names, kept so a revival of it is caught too.
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
 * A numeric literal written to, compared against, or annotating one of the enum
 * field names.
 *
 * The connector alternation admits `:`, `=`, `={`, `==`, `===`, `!=`, and `!==`,
 * and refuses `=>` and `>=`/`<=`, so an arrow function whose parameter is named
 * `role` and a numeric ordering comparison are not mistaken for a code.
 */
const ENUM_FIELD_LITERAL = new RegExp(
  `\\b(?:${ENUM_FIELD_NAMES.join('|')})\\s*(?:===?|!==?|:|=\\s*\\{|=(?![>=]))\\s*-?\\d`,
  'g',
);

/**
 * A numeric literal handed to a function named like a code reader or a code
 * writer.
 *
 * The name has to *end* in `FromCode` or *begin* with `codeFrom`, so this is not
 * a loose substring search: `String.fromCodePoint(65)` is not a code reader.
 */
const ENUM_CODE_CALL =
  /\b(?:[A-Za-z_$][\w$]*FromCode|codeFrom[A-Za-z_$][\w$]*)\s*\(\s*-?\d/g;

/**
 * A numeric-keyed table entry whose value is a wire enum name — a second copy of
 * a code table.
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
    label: 'numeric literal passed to an enum code reader or writer',
    pattern: ENUM_CODE_CALL,
    keepsStrings: false,
  },
  {
    label: 'numeric-keyed table of wire enum names',
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
    expect(paths).toContain('lib/ratingPresentation.ts');
  });

  it('includes the two modules the enum rule is argued over by name', () => {
    // Requirement 12.14, the explicit half. The rule now holds nothing out, so
    // these two are named rather than inferred: `lib/wireEnums.ts` is where the
    // enum vocabulary lives after the migration — the module a numeric reading
    // would most plausibly reappear beside — and `lib/callOutcome.ts` is the
    // module whose HTTP statuses the pattern scoping is chosen to permit. The
    // docblock's claim that those statuses are seen and deliberately not flagged
    // only means something if the file carrying them is in the scanned set.
    const paths = modules.map(featureRel);

    expect(paths).toContain('lib/wireEnums.ts');
    expect(paths).toContain('lib/callOutcome.ts');
  });

  it('holds no module out of the enum rule (Requirement 12.13)', () => {
    // The set the enum rule iterates, compared against an independent
    // re-collection of the feature's production modules. Any filter — an
    // exemption list, a held-out path, a stray `!==` — would show up here as a
    // missing entry rather than as a quietly narrower rule.
    expect(ENUM_SCANNED_MODULES.map(featureRel)).toEqual(
      squadsModules().map(featureRel),
    );
  });
});

// --- Invariant 1: no numeric enum literal anywhere in the feature ------------

describe('no numeric enum literal appears anywhere in the Squads_Feature', () => {
  it('finds none in any module of the feature (Requirements 12.13, 16.12)', () => {
    const findings: Finding[] = [];

    for (const file of ENUM_SCANNED_MODULES) {
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
    // ENUM_FIELD_LITERAL: the object-literal, comparison, JSX-prop, assignment
    // and type-annotation forms, across both the long-standing field names and
    // `ratingState`, which arrived with this contract.
    expect(
      matchesOf('api.setFeatureFlag(id, { feature: 1, enabled: true });', ENUM_FIELD_LITERAL),
    ).not.toEqual([]);
    expect(matchesOf('if (row.role === 2) {', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('<Badge state={1} />', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('body.skillTier = 0;', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('{ appearances: 3, ratingState: 1 }', ENUM_FIELD_LITERAL)).not.toEqual(
      [],
    );
    expect(matchesOf('let outcome: 2 = 2;', ENUM_FIELD_LITERAL)).not.toEqual([]);

    // ENUM_CODE_CALL: a reader and a writer, in both naming directions.
    expect(matchesOf('memberRoleFromCode(2)', ENUM_CODE_CALL)).not.toEqual([]);
    expect(matchesOf('codeFromSkillTier( 1 )', ENUM_CODE_CALL)).not.toEqual([]);

    // ENUM_NAME_TABLE: the retired map's vocabulary, and the contract's own —
    // the two shapes a rebuilt code table could take.
    expect(matchesOf("const T = { 1: 'owner', 2: 'admin' };", ENUM_NAME_TABLE)).toHaveLength(
      2,
    );
    expect(
      matchesOf("const T = { 1: 'Owner', 2: 'Admin', 3: 'Member' };", ENUM_NAME_TABLE),
    ).toHaveLength(3);
    expect(matchesOf("{ 0: 'Beginner', 1: 'LiveMatchTracking' }", ENUM_NAME_TABLE)).toHaveLength(
      2,
    );
  });

  it('holds off the numbers this feature legitimately writes', () => {
    // The shapes that made a general numeric search untenable, and which the
    // scoping decisions in the docblock are chosen to permit. `lib/callOutcome.ts`
    // is the module these are read off, and Invariant 0 asserts it is scanned —
    // so each of these is a number the rule genuinely sees and declines to flag.
    expect(matchesOf('if (status === 401) {', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf("{ 400: 'validation', 409: 'conflict' }", ENUM_NAME_TABLE)).toEqual([]);
    expect(matchesOf("{ 410: 'invite-unusable' }", ENUM_NAME_TABLE)).toEqual([]);
    // A name-keyed table whose *values* are enum names is a label map, not a code
    // table: what makes a code table one is the numeric key, and that is the half
    // of the pattern this exercises.
    expect(matchesOf("{ Owner: 'Owner', Admin: 'Admin' }", ENUM_NAME_TABLE)).toEqual([]);
    expect(matchesOf('rows.map((role) => 1)', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf('if (levels.length >= 2) {', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf('const SUCCESS_STATUS_MIN = 200;', ENUM_FIELD_LITERAL)).toEqual([]);
    // A named value in an enum position is what the contract asks for — in the
    // retired vocabulary's spelling and in the generated one.
    expect(matchesOf("squadSummary({ role: 'owner', state: null })", ENUM_FIELD_LITERAL)).toEqual(
      [],
    );
    expect(
      matchesOf("squadMember({ role: 'Owner', ratingState: 'Provisional' })", ENUM_FIELD_LITERAL),
    ).toEqual([]);
    // ENUM_CODE_CALL's near-misses: a code reader handed a named value rather
    // than a literal, and a built-in whose name merely contains those letters.
    expect(matchesOf('memberRoleFromCode(wire.role)', ENUM_CODE_CALL)).toEqual([]);
    expect(matchesOf('String.fromCodePoint(65)', ENUM_CODE_CALL)).toEqual([]);
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
