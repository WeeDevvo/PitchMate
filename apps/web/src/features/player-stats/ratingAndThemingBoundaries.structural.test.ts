/**
 * Structural source scan: the Player_Stats_Feature's rating boundary, its enum
 * boundary, and its theming boundary (task 15.4).
 *
 * Requirement 14.6 makes this file part of the product rather than a courtesy
 * check. Every rule it enforces is stated as a prohibition or as a universal
 * over a directory — "SHALL NOT name, read, plot, store, or derive any
 * Rating_Internal" (7.7), "SHALL NOT perform arithmetic on a Display_Rating
 * beyond selecting it for presentation" (7.8), "SHALL contain no numeric
 * enumeration literal and no mapping from a numeric code to an enumeration
 * value" (13.4), "SHALL write every colour value in exactly one token table
 * module … and SHALL contain no colour literal in any other module, any other
 * stylesheet, or any inline style" (15.2), "SHALL resolve no appearance
 * preference of its own, SHALL read no storage, SHALL evaluate no colour-scheme
 * media query" (15.1) — and neither a prohibition nor a universal can be
 * demonstrated by an example. So the source tree is read and matched, following
 * the mechanism `features/app-shell/pureLogic.structural.test.ts` established,
 * `features/squads/enumAndRatingBoundaries.structural.test.ts` and
 * `features/squads/themingAuthAndDeferredActions.structural.test.ts` proved out,
 * and `structural/sourceScan.ts` declares once for this feature: read each file's
 * text, strip comments (and, where the rule is about identifiers, string
 * contents) through the same small state machine, and fail naming the offending
 * file and the offending text.
 *
 * ### The five rule groups
 *
 * 1. **No Rating_Internal is named** (Requirement 7.7). The mapping from the
 *    model (μ, σ) to a friendly number is the backend's. The wire `rating` block
 *    and every wire progression point carry `mu` and `sigma`; no reader of this
 *    feature names either, so the parsed type graph has no field one could sit in
 *    and nothing downstream has one available to plot or to recompute a display
 *    number from. The scan holds that over the sources — no `mu`, no `sigma`, no
 *    `uncertainty`, no `μ`, no `σ`, no `K`, no `C`, and no `× 3` arithmetic —
 *    which is the half `lib/parse/noRatingInternal.property.test.ts` cannot
 *    state: that property walks a *parsed value* and would stay green if a
 *    component started computing a conservative estimate of its own.
 * 2. **The one display rating is selected, never computed** (Requirement 7.8).
 *    `lib/ratingCondition.ts` is the module that decides whether there is a
 *    number to show and carries it through; the rule is stated positively over
 *    that module — every numeric literal in it is zero and it contains no
 *    arithmetic operator at all — because a function with no operators and no
 *    literal but zero has nowhere for a scale, an offset, or a factor of three
 *    to hide under another name.
 * 3. **No numeric enum literal anywhere** (Requirement 13.4). The backend
 *    serialises `MembershipState` and `RatingState` **by name**, and
 *    `lib/wireEnums.ts` aliases both unions straight out of the generated types
 *    and pins each member list to the contract in both directions. What the
 *    compile-time pinning cannot state is the other half: a module that stops
 *    asking for a name and starts writing a code again would type-check
 *    perfectly well against a hand-written literal. This rule is what makes that
 *    visible.
 * 4. **One place writes a colour** (Requirements 15.2, 15.3). No module of the
 *    feature carries a hex literal or a colour function, no module sets a colour
 *    through a JSX style prop, no stylesheet but `styles/playerStatsTokens.css`
 *    names a colour, every colour-carrying declaration reads its colour from a
 *    `var(--token)` (or inherits it), every custom property the feature paints is
 *    declared in that one table and nowhere else, and every token either belongs
 *    to the Theme-invariant scale or carries a value in **both** Theme tables.
 * 5. **One place owns appearance** (Requirement 15.1). The feature reads no
 *    browser storage and no cookie, evaluates no colour-scheme media query,
 *    injects no script, restates none of the shared theme constants, and declares
 *    no appearance store, bootstrap, or resolution of its own. Where it names one
 *    of those things it imports the name from `src/theme`, which is where
 *    Requirement 15.1 puts all three.
 *
 * ### The printer is the one place `mu` and `sigma` are written, and that is
 * exactly what is asserted
 *
 * Requirement 13.7 asks for a Response_Printer emitting the wire shape the
 * parser accepts, and the wire shape carries `mu` and `sigma`. So
 * `lib/parse/playerProfile.ts` writes those two names — four times in total, two
 * per printer — each bound to `RATING_MODEL_PLACEHOLDER`, a module-local
 * constant that is zero. Nothing is read from either name and no rating quantity
 * is carried, which is why the printer's output is a body the parser accepts
 * without the feature holding a Rating_Internal anywhere.
 *
 * A scan cannot simply exempt that file, or the strongest guarantee in the
 * feature would rest on a hole. Instead the **admitted form** is stripped — the
 * exact text `mu: RATING_MODEL_PLACEHOLDER` and `sigma: RATING_MODEL_PLACEHOLDER`
 * and nothing else — and the rules then run over what is left. Three further
 * assertions keep the exemption honest: the admitted emissions are counted and
 * must be exactly those four, the placeholder must be bound to zero, and the
 * stripper is run over a synthetic offender to show it removes the printer's
 * emission without removing a read.
 *
 * `testing/playerProfileFixtures.ts` is the second and last place either name is
 * written, for the same kind of reason: a fixture that did not *send* `mu` and
 * `sigma` could never demonstrate that the parser leaves them unread. It spells
 * them as string data (`RATING_MODEL_WIRE_MEMBERS`) and writes them onto a body
 * through a computed key, so the identifier scan sees nothing there at all.
 *
 * Those two sites are pinned by a **closed statement** rather than by an
 * exemption list: the set of production modules mentioning either name in *any*
 * form — identifier, string, or Greek symbol — must be exactly those two, and in
 * each the mentions must take the admitted shape. A third writing site is a
 * finding. And because a name can be read through a string as readily as through
 * an identifier, {@link RATING_READ_RULES} asks the complementary question over
 * source that keeps strings: nothing anywhere in the feature *reads* one.
 *
 * ### Scoping the enum rule: enum *positions*, not "any numeric literal"
 *
 * "No numeric enum literal" cannot be read as "no numeric literal". The feature
 * legitimately contains numbers that are not enum codes, and `lib/callOutcome.ts`
 * is the proof: it declares `CONCEALED_STATUSES = [401, 403, 404]` and compares a
 * status against `200` and `299`. Those are HTTP statuses — a different wire
 * vocabulary, and Requirement 12.8 makes that module the one place in the feature
 * allowed to hold one. A scan that flagged every integer would flag them, and the
 * only way to keep it green would be to weaken it until it asserted nothing.
 *
 * So the rule is stated over the **positions** an enum code can occupy, as an
 * explicit pattern table:
 *
 * - {@link ENUM_FIELD_LITERAL} — a numeric literal written to, compared against,
 *   or annotating one of the wire field names that carry an enum: `state` (the
 *   Membership_State and the rating block's Rating_State) and `ratingState`. That
 *   covers the object-literal form, the assignment form, the JSX-prop form
 *   (`state={1}`), the comparison form, and a numeric-literal type annotation.
 *   `status` is **not** in the list, for the reason above.
 * - {@link ENUM_CODE_CALL} — a numeric literal handed to any `…FromCode` or
 *   `codeFrom…` function. No such function exists in the feature, which is the
 *   point: that naming shape is what a reader or writer of a numeric code table
 *   is called, so the pattern stands guard over a reintroduction.
 * - {@link ENUM_NAME_TABLE} — a numeric-keyed table whose values are wire enum
 *   names (`0: 'Active'`, `1: 'Provisional'`, …). This is what a hand-built code
 *   table looks like. Keyed on the *names* precisely so that
 *   `lib/callOutcome.ts`'s status reasoning is not caught.
 *
 * A code reaching a field through a variable is deliberately not matched:
 * following that would need a type checker rather than a text scan, and a literal
 * has to appear somewhere for a variable to carry one.
 *
 * ### Why the colour rule is stated over declarations rather than over text
 *
 * "No hex literal anywhere" is the easy half and not the whole rule: a component
 * sheet could write `color: white` or `border-color: rgb(20 20 20)` and carry no
 * `#`. Nor can the rule be "every value must contain `var(`", because
 * `background: none`, `border: 0`, and `text-decoration: underline` are
 * colour-carrying declarations that name no colour at all and must stay legal.
 *
 * So each declaration of a colour-carrying property is read, its `var(…)`
 * references are removed, and **every token left over** must be a length, a
 * number, or one of the colourless keywords in {@link COLOURLESS_KEYWORDS}. A
 * named colour, a hex triplet, or a colour function survives that filter and is
 * reported. Stating it as an allow-list rather than as a list of the 148 CSS
 * named colours is what makes it hold for the colour someone reaches for next.
 *
 * The token table is the one file exempted, because writing those values is its
 * job. Its exemption is kept honest from the other side: the scan asserts the
 * table *does* write a colour per token in both Theme tables, so a pattern that
 * could not see a colour would fail there rather than passing everywhere.
 *
 * ### Why the appearance rule is not "no declaration named `*Theme*`"
 *
 * `testing/playerStatsScreenStates.tsx` declares `applyTheme`, `resetTheme`, and
 * `themeAppliedByBootstrap`. None of them is an appearance store, a bootstrap, or
 * a resolution: each is a two-line delegation to `applyThemeAttribute`,
 * `THEME_ATTRIBUTE`, and `THEME_BOOTSTRAP_SOURCE` imported from `src/theme` — the
 * last of them *runs* the shared bootstrap source so that "dark renders with
 * nothing stored" is asserted from the real decision rather than from a
 * restatement. A rule keyed on names would flag exactly the code that proves
 * compliance.
 *
 * The rule is therefore keyed on the *capabilities* the three concerns need — a
 * storage read or write, a cookie, a colour-scheme query, a script injection, a
 * restatement of a shared constant, a resolution-shaped declaration, a literal
 * copy of the shared storage key, attribute name, or media query — joined by the
 * positive requirement that every theme name the feature uses arrives by import
 * from `src/theme`. A delegation passes; a second implementation cannot.
 *
 * The three literal values are **read out of `src/theme`'s own source** rather
 * than restated here, so renaming the shared storage key changes what this rule
 * forbids without anyone editing this file — and no exemption list is needed for
 * the wire field `appearances`, the label `Appearances`, or the Pairwise_Section
 * variant `co-appearance`, none of which is the shared key. All three are
 * asserted as near-misses below.
 *
 * ### What is scanned
 *
 * Every prohibition binds {@link playerStatsModules} — the feature's production
 * modules, test files and the scan-support directory excluded. The test files are
 * excluded for a reason this scan has to state plainly: two of them *deliberately
 * plant* the very things forbidden here.
 * `lib/parse/noRatingInternal.property.test.ts` plants a `mu`-bearing member on a
 * test-only type to prove its walker detects one, and
 * `lib/parse/tolerance.property.test.ts` extends valid bodies with properties
 * named `mu`, `sigma`, `k`, and `c` to prove the parser ignores them. Scanning
 * them would flag the tests that establish the guarantee. The positive half of
 * the appearance rule reads a wider set, because the Appearance_Preference key is
 * named by `screens/playerStatsAccessibility.a11y.test.tsx` and the bootstrap by
 * `testing/playerStatsScreenStates.tsx`, so "all three concerns arrive from
 * `src/theme`" is only checkable across both.
 *
 * ### Non-vacuity
 *
 * Requirement 14.6 asks for more than a green scan: each scan is "accompanied by
 * a control demonstrating that it detects a deliberate violation". A rule that
 * passes because its detector matches nothing is indistinguishable from a rule
 * that passes because the code complies. So the final section exercises **every**
 * pattern twice — once against a synthetic offender and once against a synthetic
 * near-miss — which matters especially here, where `mu`, `K`, and `C` as bare
 * identifiers would otherwise match inside `must`, `menu`, `Key`, `Count`, and
 * `Component`. Invariant 0 does the other half: it shows there is source to read
 * and names the modules the scoping decisions are argued over, so the empty
 * finding lists mean the feature complies rather than that the walk broke.
 *
 * Requirements: 7.7, 7.8, 13.4, 14.6, 15.1, 15.2, 15.3
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectProductionSources,
  isScanSupportModule,
  isTestFile,
  isWithin,
  norm,
  playerStatsModules,
  playerStatsRoot,
  playerStatsSources,
  playerStatsStyles,
  readCodeOnly,
  readWithoutComments,
  reExports,
  relTo,
  resolveWithinSrc,
  stripCssComments,
  designTokensPath,
  themeRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The feature's production modules: the set every prohibition below binds. */
const modules = playerStatsModules();

/** True for one of this feature's structural scans — this file and its siblings. */
function isStructuralScan(file: string): boolean {
  return /\.structural\.test\.tsx?$/.test(norm(file));
}

/**
 * Every source file of the feature bar the scan layer — tests included.
 *
 * Only the appearance rule's positive half reads this wider set. A scan has to
 * name the things it forbids: the tables below spell `THEME_ATTRIBUTE`,
 * `APPEARANCE_STORAGE_KEY`, `mu`, and `sigma` in live code precisely so they can
 * be rejected elsewhere, which is why `structural/sourceScan.ts` is already held
 * out of every scanned set as scan support and the scans that read it are held
 * out here on the same ground.
 */
const featureSources = playerStatsSources().filter(
  (file) => !isScanSupportModule(file) && !isStructuralScan(file),
);

/** The one stylesheet allowed to write a colour value (Requirement 15.2). */
const tokenTablePath = join(playerStatsRoot, 'styles', 'playerStatsTokens.css');

/** Every stylesheet of the feature, the token table included. */
const stylesheets = playerStatsStyles();

/** Every stylesheet but the token table — the set the colour rule binds. */
const componentStylesheets = stylesheets.filter(
  (file) => norm(file) !== norm(tokenTablePath),
);

/** The one module that decides whether there is a Display_Rating to render. */
const ratingConditionModule = join(playerStatsRoot, 'lib', 'ratingCondition.ts');

/** The one module that writes the wire's rating-model member names. */
const profileParserModule = join(
  playerStatsRoot,
  'lib',
  'parse',
  'playerProfile.ts',
);

/** The shared Theme module's public barrel (Requirement 15.1). */
const themeBarrelPath = join(themeRoot, 'index.ts');

/** Path relative to the feature root, for a failure message. */
function featureRel(path: string): string {
  return relTo(playerStatsRoot, path);
}

// --- Matching ----------------------------------------------------------------

/** One finding: the file, the rule it broke, and the text that broke it. */
interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly offender: string;
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

/** Every string and template literal of a module, comments already dropped. */
function stringLiteralsOf(source: string): string[] {
  const pattern = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push(match[2]);
  }
  return found;
}

/** Every string and template literal of the file at `file`. */
function stringLiterals(file: string): string[] {
  return stringLiteralsOf(readWithoutComments(file));
}

// --- Rule group 1: the rating internals (Requirement 7.7) --------------------

/** One rating-internal rule: a name or an arithmetic shape 7.7 and 7.8 forbid. */
interface RatingRule {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * The quantities Requirement 7.7 forbids, as a name scan over
 * comment-*and*-string-stripped code.
 *
 * Word boundaries matter: the feature contains `must`, `menu`, `mutation`,
 * `Kind`, `Key`, `Count`, and `Component`, none of which is a rating internal,
 * and the near-miss controls below pin that.
 *
 * The scaling constants `K` and `C` are single letters, which a bare word scan
 * cannot ask about without flagging every generic type parameter `<K, V>`. The
 * defensible narrower rule is that a scaling parameter is a **value binding**: a
 * `const`/`let`/`var` named exactly `K` or `C`, an `K = <number>` assignment, or
 * an identifier spelled `RATING_K`/`ratingK`/`RATING_C`/`ratingC`.
 *
 * The `μ − 3σ` arithmetic is caught by its multiplier. Since `sigma` and `σ` are
 * forbidden outright, a conservative-estimate computation would have to spell the
 * uncertainty differently — but it still has to multiply by three, so a literal
 * `3` used as a multiplicand is a finding.
 */
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

/**
 * A mention of a rating-model member in **any** form — identifier, string, or
 * Greek symbol.
 *
 * Used for the closed statement about where the two wire member names may be
 * written at all, so it reads comment-stripped source that *keeps* strings.
 */
const RATING_MENTION = /\b(?:mu|sigma|uncertainty)\b|μ|σ/g;

/**
 * The positions a *read* of a rating-model member occupies.
 *
 * Requirement 7.7 forbids naming **and reading** one, and the two writing sites
 * admitted below mean a pure identifier scan is not enough on its own: a module
 * could pull a member out through a string key without writing the identifier.
 * These are the shapes a read takes — a member access, an index access, a
 * destructuring, and a reading primitive handed the name as a label or a key.
 *
 * Read against source that keeps strings, which is why the member-access arm
 * carries no string alternative: `profile.mu` is code either way.
 */
const RATING_READ_RULES: readonly RatingRule[] = [
  {
    label: 'a member access reading a rating internal',
    pattern: /\.\s*(?:mu|sigma|uncertainty)\b/g,
  },
  {
    label: 'an index access reading a rating internal',
    pattern: /\[\s*(['"`])(?:mu|sigma|uncertainty)\1\s*\]/g,
  },
  {
    label: 'a destructuring of a rating internal',
    pattern: /\b(?:const|let|var)\s*\{[^}]*\b(?:mu|sigma|uncertainty)\b/g,
  },
  {
    label: 'a reading primitive handed a rating-internal member name',
    pattern: /\bread[A-Za-z]*\s*\([^)]*(['"`])(?:mu|sigma|uncertainty)\1/g,
  },
];

/** The module-local constant the printers emit in place of a rating quantity. */
const RATING_MODEL_PLACEHOLDER = 'RATING_MODEL_PLACEHOLDER';

/**
 * The one form in which a rating-model member name may be *written*: as an object
 * key of a Response_Printer, bound to the placeholder constant.
 *
 * Nothing wider is admitted — not a read, not a destructuring, not a key bound to
 * a value. Stripping this exact shape and then applying {@link RATING_RULES} to
 * what remains is what lets the printer satisfy Requirement 13.7 without the
 * prohibition acquiring a file-shaped hole.
 */
const ADMITTED_PLACEHOLDER_EMISSION = new RegExp(
  `\\b(?:mu|sigma)\\s*:\\s*${RATING_MODEL_PLACEHOLDER}\\b`,
  'g',
);

/** `source` with the printers' admitted placeholder emissions removed. */
function withoutAdmittedEmissions(source: string): string {
  return source.replace(ADMITTED_PLACEHOLDER_EMISSION, ' ');
}

/** Every rating-internal finding in `modules`, the admitted emissions removed. */
function ratingFindings(
  scanned: readonly { readonly file: string; readonly code: string }[],
): Finding[] {
  const findings: Finding[] = [];

  for (const { file, code } of scanned) {
    const live = withoutAdmittedEmissions(code);
    for (const { label, pattern } of RATING_RULES) {
      for (const offender of matchesOf(live, pattern)) {
        findings.push({ file, rule: label, offender });
      }
    }
  }

  return findings;
}

// --- Rule group 3: the enum positions (Requirement 13.4) ---------------------

/**
 * The wire field names that carry an enum, as a response body and a component
 * prop spell them.
 *
 * One per union `lib/wireEnums.ts` declares: `state` is both the
 * Membership_State on the profile and the Rating_State inside the rating block,
 * and `ratingState` is listed separately because the scan matches on a word
 * boundary and the lower-case `state` never occurs inside it.
 *
 * `status` is absent on purpose: an HTTP status is a different wire vocabulary,
 * and Requirement 12.8 makes `lib/callOutcome.ts` the one module of the feature
 * allowed to hold one.
 */
const ENUM_FIELD_NAMES = ['state', 'ratingState'] as const;

/**
 * The names a numeric-keyed table would map to in order to be a code table —
 * the two unions' members, exactly as the contract spells them.
 *
 * None collides with `lib/callOutcome.ts`: its outcome names are this feature's
 * own five kinds (`'not-found'`, `'transport-failure'`, …) and its concealed
 * statuses are an array rather than a numerically keyed table.
 */
const ENUM_NAMED_VALUES = [
  'Active',
  'Inactive',
  'Provisional',
  'Established',
] as const;

/**
 * A numeric literal written to, compared against, or annotating one of the enum
 * field names.
 *
 * The connector alternation admits `:`, `=`, `={`, `==`, `===`, `!=`, and `!==`,
 * and refuses `=>` and `>=`/`<=`, so an arrow function whose parameter is named
 * `state` and a numeric ordering comparison are not mistaken for a code.
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
 * A numeric-keyed table entry whose value is a wire enum name — a hand-built code
 * table, which Requirement 13.4 forbids in the same breath as the literals.
 *
 * Read against comment-stripped source with string literals **kept**, because the
 * names are string literals.
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

// --- Rule group 4: colours and the token table ------------------------------

/** A hex colour literal, in any of the CSS lengths. */
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/g;

/** A colour function, in any of its spellings. */
const COLOUR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/gi;

/** A colour set through a JSX style prop — the one colour a component could write. */
const STYLE_PROP_COLOUR =
  /style\s*=\s*\{\{[^}]*\b(?:color|background|backgroundColor|border|borderColor|outline|outlineColor|fill|stroke|boxShadow|caretColor|accentColor|stopColor|floodColor)\s*:/g;

/**
 * The CSS properties that can carry a colour.
 *
 * Broader than what the feature declares today, on purpose: the rule has to hold
 * for the declaration someone adds next, and a property absent from this table is
 * a property the rule would not see.
 */
const COLOUR_PROPERTIES: ReadonlySet<string> = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block',
  'border-block-color',
  'border-block-start',
  'border-block-end',
  'border-inline',
  'border-inline-color',
  'border-inline-start',
  'border-inline-end',
  'border-image',
  'outline',
  'outline-color',
  'box-shadow',
  'text-shadow',
  'text-decoration',
  'text-decoration-color',
  'text-emphasis-color',
  '-webkit-text-fill-color',
  'caret-color',
  'accent-color',
  'column-rule',
  'column-rule-color',
  'scrollbar-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
]);

/**
 * The keywords a colour-carrying declaration may hold that are not colours.
 *
 * `background: none`, `border: 0`, `border: … solid …`, `color: inherit`, and
 * `text-decoration: underline` all name no colour and must stay legal, so the
 * residual tokens of a declaration are checked against this list rather than
 * against a list of colour names. `currentcolor` is here because it takes its
 * value from the element's own `color`, which is itself held to the rule.
 */
const COLOURLESS_KEYWORDS: ReadonlySet<string> = new Set([
  'none',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'currentcolor',
  'transparent',
  'auto',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
  'hidden',
  'wavy',
  'thin',
  'medium',
  'thick',
  'underline',
  'overline',
  'line-through',
  'blink',
  'from-font',
  '!important',
]);

/** A number, with or without a unit — never a colour. */
const NUMERIC_TOKEN =
  /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|ex|ch|%|vw|vh|vmin|vmax|fr|deg|s|ms)?$/;

/** A `var(--token)` reference, with any fallback. */
const VAR_REFERENCE = /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g;

/** One CSS declaration, read out of a stylesheet's source. */
interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * Every `property: value` pair of a stylesheet.
 *
 * Coarse on purpose: the colour rules do not care which selector or which media
 * block a declaration sits in — a colour written anywhere is a colour written —
 * so there is no need for the specificity resolution
 * `screens/declaredStyles.property.test.ts` performs. Selector fragments that
 * happen to hold a colon (`a:focus-visible`) yield a property name no colour rule
 * recognises and are filtered out by the property table.
 */
function cssDeclarations(file: string): CssDeclaration[] {
  const css = stripCssComments(readFileSync(file, 'utf8'));
  const pattern = /([-a-zA-Z][-a-zA-Z0-9]*)\s*:\s*([^;{}]+)/g;
  const found: CssDeclaration[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    found.push({ property: match[1].toLowerCase(), value: match[2].trim() });
  }
  return found;
}

/**
 * The tokens of a colour-carrying value that are neither a custom property
 * reference, a number, nor a colourless keyword — that is, the colours it writes
 * for itself.
 */
function selfWrittenColours(value: string): string[] {
  return value
    .replace(VAR_REFERENCE, ' ')
    .split(/[\s,/()]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !NUMERIC_TOKEN.test(token))
    .filter((token) => !COLOURLESS_KEYWORDS.has(token.toLowerCase()));
}

/** Every custom property declared in `css`. */
function declaredPropertiesIn(css: string): string[] {
  return matchesOf(css, /(--[\w-]+)\s*:/g).map((match) =>
    match.replace(/\s*:$/, ''),
  );
}

/** Every custom property a stylesheet declares. */
function declaredCustomProperties(file: string): string[] {
  return declaredPropertiesIn(stripCssComments(readFileSync(file, 'utf8')));
}

/** Every custom property referenced in `source`. */
function referencedPropertiesIn(source: string): string[] {
  const found: string[] = [];
  const pattern = /var\(\s*(--[\w-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push(match[1]);
  }
  return found;
}

/**
 * The feature's token table, which holds the Theme-invariant scale only, and the
 * design-system tokens, which hold every colour in a dark and a light block.
 */
const tokenTableCss = stripCssComments(readFileSync(tokenTablePath, 'utf8'));
const designTokensCss = stripCssComments(readFileSync(designTokensPath, 'utf8'));

/** `:root { … }` alone — the Theme-invariant scale, which carries no colour. */
const SCALE_BLOCK = /:root\s*\{([^}]*)\}/;

/** `:root, [data-theme='dark'] { … }` — the dark table, the default. */
const DARK_BLOCK = /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/;

/** `[data-theme='light'] { … }` — the opt-in light table. */
const LIGHT_BLOCK = /\[data-theme='light'\]\s*\{([^}]*)\}/;

/** The body of one block of a stylesheet, or `''` when it is not declared. */
function blockOf(css: string, pattern: RegExp): string {
  return pattern.exec(css)?.[1] ?? '';
}

const scaleBlock = blockOf(tokenTableCss, SCALE_BLOCK);
const darkBlock = blockOf(designTokensCss, DARK_BLOCK);
const lightBlock = blockOf(designTokensCss, LIGHT_BLOCK);

/** Every design-system token: the colours and shadows of both Themes, and the type, space and size scale. */
const designTokens = new Set(
  declaredCustomProperties(designTokensPath).filter((token) => token.startsWith('--pm-')),
);

// --- Rule group 5: appearance (Requirement 15.1) -----------------------------

/** One capability an appearance store, a bootstrap, or a resolution would need. */
interface AppearanceRule {
  readonly label: string;
  readonly pattern: RegExp;
  /** `true` to read comment-stripped source that keeps string literals. */
  readonly keepsStrings: boolean;
}

const APPEARANCE_RULES: readonly AppearanceRule[] = [
  {
    label: 'browser storage, where an appearance key would be read or written',
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/g,
    keepsStrings: false,
  },
  { label: 'cookie access', pattern: /\bcookie\b/gi, keepsStrings: false },
  {
    label: 'a colour-scheme media query, which is the shared resolution',
    pattern: /\bmatchMedia\b/g,
    keepsStrings: false,
  },
  {
    label: 'a colour-scheme query string',
    pattern: /prefers-color-scheme/gi,
    keepsStrings: true,
  },
  {
    label: 'a script injection',
    pattern: /\bdangerouslySetInnerHTML\b|\bcreateElement\s*\(\s*['"]script/g,
    keepsStrings: true,
  },
  {
    label: 'a feature-local restatement of a shared theme constant',
    pattern:
      /\b(?:const|let|var)\s+(?:THEME_ATTRIBUTE|THEME_BOOTSTRAP_SOURCE|APPEARANCE_STORAGE_KEY|LIGHT_APPEARANCE_QUERY)\b/g,
    keepsStrings: false,
  },
  {
    label: 'a feature-local appearance store, bootstrap, or resolution declaration',
    // `readAppearance`/`writeAppearance` carry a negative lookahead for `Count`:
    // the profile carries an Appearance_Count per membership — the number of
    // completed matches the player appeared in — and a reader of that tally
    // shares a word with the theme's appearance preference and nothing else.
    pattern:
      /\b(?:function|const|let|var|class)\s+\w*(?:resolveTheme|themeFromPreference|themeBootstrap|appearancePreference|appearanceStorage|readAppearance(?!Count)|writeAppearance(?!Count))\w*/gi,
    keepsStrings: false,
  },
];

/**
 * The value `src/theme` binds to `name`, read out of its own source.
 *
 * Read rather than restated, so the literals this rule forbids track the shared
 * module: renaming the Appearance_Preference storage key changes what is
 * forbidden here without anyone editing this file.
 */
function themeConstantValue(name: string): string {
  const pattern = new RegExp(
    `\\bexport\\s+const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`,
  );

  for (const file of collectProductionSources(themeRoot)) {
    const match = pattern.exec(readWithoutComments(file));
    if (match !== null) return match[1];
  }

  throw new Error(`src/theme declares no ${name}`);
}

const APPEARANCE_STORAGE_KEY_VALUE = themeConstantValue('APPEARANCE_STORAGE_KEY');
const THEME_ATTRIBUTE_VALUE = themeConstantValue('THEME_ATTRIBUTE');
const LIGHT_APPEARANCE_QUERY_VALUE = themeConstantValue('LIGHT_APPEARANCE_QUERY');

/** The three shared values, paired with the name each one is published under. */
const SHARED_THEME_LITERALS: readonly (readonly [string, string])[] = [
  ['APPEARANCE_STORAGE_KEY', APPEARANCE_STORAGE_KEY_VALUE],
  ['THEME_ATTRIBUTE', THEME_ATTRIBUTE_VALUE],
  ['LIGHT_APPEARANCE_QUERY', LIGHT_APPEARANCE_QUERY_VALUE],
];

/**
 * Is `literal` a feature-local copy of one of the shared theme values?
 *
 * Containment rather than equality, so `'[data-theme="light"]'` and
 * `'pitchmate.appearance.v2'` are both copies, while `'appearances'`,
 * `'Appearances'`, `'bibAppearances'`, and `'co-appearance'` — a wire field, a
 * label, another wire field, and a Pairwise_Section variant — are not.
 */
function copiesSharedThemeValue(literal: string): string | null {
  for (const [name, value] of SHARED_THEME_LITERALS) {
    if (literal.includes(value)) return name;
  }
  return null;
}

/** The names `src/theme` owns, which the feature may use only by importing them. */
const THEME_OWNED_NAMES = [
  'APPEARANCE_STORAGE_KEY',
  'APPEARANCE_PREFERENCES',
  'createInMemoryAppearanceStorage',
  'readAppearancePreference',
  'writeAppearancePreference',
  'interpretStoredPreference',
  'isAppearancePreference',
  'LIGHT_APPEARANCE_QUERY',
  'THEME_ATTRIBUTE',
  'THEME_BOOTSTRAP_SOURCE',
  'applyThemeAttribute',
  'resolveTheme',
  'greenTokenForSurface',
  'greenTextToken',
  'PITCH_GREEN',
  'GREEN_DARK',
  'GREEN_TOKEN_LUMINANCE_THRESHOLD',
  'Theme',
] as const;

/** One `import … from '…'` statement, as this scan reads it. */
interface ImportClause {
  /** The specifier the names come from. */
  readonly specifier: string;
  /** The names as bound locally — the alias, where one is written. */
  readonly names: readonly string[];
}

/**
 * Every `import … from '…'` of a module, with the names each one binds.
 *
 * `structural/sourceScan.ts` shares the import *analysis* every other scan needs,
 * which answers "which module does this reach". This rule needs "which name does
 * this carry" — "the feature names `THEME_ATTRIBUTE`, so it must import
 * `THEME_ATTRIBUTE` from `src/theme`" — so the clause parser lives here, with the
 * shared strippers still doing the reading. `type` modifiers are dropped: a type
 * arriving from the shared module is as much an import of it as a value is.
 */
function importClauses(file: string): ImportClause[] {
  const code = readWithoutComments(file);
  const pattern = /\bimport\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  const found: ImportClause[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const clause = match[1].replace(/^type\s+/, '');
    const names: string[] = [];

    const braced = /\{([^}]*)\}/.exec(clause);
    for (const entry of (braced?.[1] ?? '').split(',')) {
      const trimmed = entry.trim().replace(/^type\s+/, '');
      if (trimmed.length === 0) continue;
      const aliased = /\bas\s+([\w$]+)\s*$/.exec(trimmed);
      names.push(aliased === null ? trimmed : aliased[1]);
    }

    // A default or namespace binding sits outside the braces.
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ');
    for (const token of outside.split(/\s+/)) {
      const name = token.replace(/^\*\s*as\s*/, '').trim();
      if (name.length > 0 && name !== '*' && name !== 'as') names.push(name);
    }

    found.push({ specifier: match[2], names });
  }

  return found;
}

// --- Invariant 0: the scan sees the feature ----------------------------------

describe('the rating, enum, and theming scan sees the Player_Stats_Feature', () => {
  it('is rooted at apps/web/src/features/player-stats', () => {
    expect(
      norm(playerStatsRoot).endsWith('apps/web/src/features/player-stats'),
    ).toBe(true);
  });

  it('collects the production modules, the wider source set, and no test module', () => {
    // A vacuous scan would pass every prohibition below. This feature is a
    // screen, fifteen components, the whole of `lib/`, a load machine, and a
    // transport facade, and it carries a test beside almost all of it.
    expect(modules.length).toBeGreaterThan(30);
    expect(featureSources.length).toBeGreaterThan(modules.length);
    expect(modules.map(featureRel).filter(isTestFile)).toEqual([]);
  });

  it('reaches the screen, the components, the load machine, and the parsers', () => {
    // A walker that stopped at the top level would leave exactly the modules
    // these rules are about unscanned while still looking non-vacuous.
    const paths = modules.map(featureRel);

    expect(
      paths.filter((path) => path.startsWith('screens/')).length,
    ).toBeGreaterThan(0);
    expect(
      paths.filter((path) => path.startsWith('components/')).length,
    ).toBeGreaterThan(10);
    expect(
      paths.filter((path) => path.startsWith('state/')).length,
    ).toBeGreaterThan(0);
    expect(
      paths.filter((path) => path.startsWith('lib/parse/')).length,
    ).toBeGreaterThan(1);
    expect(paths).toContain('api/playerStatsApi.ts');
    expect(paths).toContain('testing/playerStatsScreenStates.tsx');
  });

  it('includes the four modules the rules are argued over by name', () => {
    // Each of these carries one of the scoping decisions above, and each decision
    // is only a real claim if the module it is about is in the scanned set:
    // `ratingCondition.ts` is the module Requirement 7.8 binds, `playerProfile.ts`
    // is the one file that writes `mu` and `sigma` at all, `wireEnums.ts` is where
    // the enum vocabulary lives, and `callOutcome.ts` is the module whose
    // legitimate HTTP statuses the enum patterns are scoped to permit.
    const paths = modules.map(featureRel);

    expect(paths).toContain('lib/ratingCondition.ts');
    expect(paths).toContain('lib/parse/playerProfile.ts');
    expect(paths).toContain('lib/wireEnums.ts');
    expect(paths).toContain('lib/callOutcome.ts');
  });

  it('collects the token table and the per-component stylesheets beside it', () => {
    expect(stylesheets.map(featureRel)).toContain('styles/playerStatsTokens.css');
    expect(componentStylesheets.length).toBeGreaterThan(5);
    expect(componentStylesheets.map(featureRel)).not.toContain(
      'styles/playerStatsTokens.css',
    );
  });

  it('holds out the scan layer, and holds in the tests that use the Theme', () => {
    // The exclusion is narrow: the structural scans and the machinery they share,
    // all of which name what they forbid. The suites that actually render a Theme
    // stay in, which is what makes the appearance rule's positive half real.
    const wider = featureSources.map(featureRel);

    expect(wider.filter(isStructuralScan)).toEqual([]);
    expect(wider).toContain('testing/playerStatsScreenStates.tsx');
    expect(wider).toContain('screens/playerStatsAccessibility.a11y.test.tsx');
    expect(wider).toContain('screens/declaredStyles.property.test.ts');

    // The held-out set exists, so the exclusion is hiding something known rather
    // than nothing: this scan and its siblings.
    const scans = playerStatsSources().map(featureRel).filter(isStructuralScan);
    expect(scans.length).toBeGreaterThan(1);
    expect(scans).toContain('ratingAndThemingBoundaries.structural.test.ts');
  });

  it('holds out the test that deliberately plants a rating internal', () => {
    // Stated rather than implied, and a witness from inside the repository that
    // the patterns below match real source rather than only the synthetic
    // controls at the end of this file.
    //
    // `lib/parse/tolerance.property.test.ts` extends valid bodies with live
    // members named `mu`, `sigma`, `k`, and `c` to prove the parser ignores
    // whatever it does not recognise, so it reads as a finding — correctly, and
    // it is a test file, so it is outside the scanned set.
    //
    // The sibling plants are quieter on purpose: `noRatingInternal.property.test.ts`
    // and `absence.property.test.ts` hold their forbidden spellings as *string
    // data* and reach a member through a computed key, which is what keeps them
    // clean under an identifier scan while still planting a member at runtime.
    const planted = 'lib/parse/tolerance.property.test.ts';

    expect(playerStatsSources().map(featureRel)).toContain(planted);
    expect(modules.map(featureRel)).not.toContain(planted);

    const findings = ratingFindings([
      {
        file: planted,
        code: readCodeOnly(join(playerStatsRoot, ...planted.split('/'))),
      },
    ]);
    expect(findings.length).toBeGreaterThan(0);
  });
});

// --- Invariant 1: no Rating_Internal is named (Requirement 7.7) --------------

describe('no Rating_Internal is named anywhere in the Player_Stats_Feature', () => {
  it('names no mu, sigma, uncertainty, K, C, or ×3 arithmetic (Requirement 7.7)', () => {
    // Comments *and* strings stripped: several of these modules promise in prose
    // that they name no `mu` and no `sigma`, and a scan that matched prose would
    // flag the documentation promising compliance.
    const findings = ratingFindings(
      modules.map((file) => ({
        file: featureRel(file),
        code: readCodeOnly(file),
      })),
    );

    expect(findings).toEqual([]);
  });

  it('reads a rating-model member nowhere, in any spelling (Requirement 7.7)', () => {
    // The identifier scan reads strings away, so the read path is asked
    // separately and over source that keeps them: a module could name a member as
    // a literal — `readProperty(body, 'mu')`, `body['sigma']` — without writing
    // the identifier at all. Requirement 7.7 forbids *reading* one, so the rule is
    // stated over the positions a read occupies.
    const findings: Finding[] = [];

    for (const file of modules) {
      const source = readWithoutComments(file);
      for (const { label, pattern } of RATING_READ_RULES) {
        for (const offender of matchesOf(source, pattern)) {
          findings.push({ file: featureRel(file), rule: label, offender });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('mentions a rating-model member in two modules, each in its admitted form', () => {
    // The closed statement that keeps the two writing sites from becoming a hole.
    // A wire body *carries* `mu` and `sigma`, so two modules have to be able to
    // write those names: the Response_Printer, because its contract is to emit a
    // body the parser accepts (Requirement 13.7), and the wire fixtures, because
    // a parse that proves the members go unread has to send them. Every other
    // module of the feature mentions neither in any form — identifier, string, or
    // symbol — so a third writing site is a finding rather than a precedent.
    const mentioning = modules
      .filter(
        (file) => matchesOf(readWithoutComments(file), RATING_MENTION).length > 0,
      )
      .map(featureRel)
      .sort();

    expect(mentioning).toEqual([
      'lib/parse/playerProfile.ts',
      'testing/playerProfileFixtures.ts',
    ]);

    // The fixtures' admitted form: one declaration binding the two names as
    // string data, written onto a body through a computed key. The names appear
    // once each and nowhere else in the module, so nothing reads them back.
    const fixtures = readWithoutComments(
      join(playerStatsRoot, 'testing', 'playerProfileFixtures.ts'),
    );
    expect(matchesOf(fixtures, RATING_MENTION)).toEqual(['mu', 'sigma']);
    expect(
      matchesOf(fixtures, /\bRATING_MODEL_WIRE_MEMBERS\s*=\s*\[\s*'mu',\s*'sigma'\s*\]/g),
    ).toHaveLength(1);
    // Written as string data, so the identifier scan above sees nothing there.
    expect(
      matchesOf(
        readCodeOnly(join(playerStatsRoot, 'testing', 'playerProfileFixtures.ts')),
        RATING_MENTION,
      ),
    ).toEqual([]);
  });

  it('writes the two wire names only as the printers placeholder emission (13.7)', () => {
    // The admitted form, counted and pinned. The printer's contract is "emit a
    // body this parser accepts", so the names appear — twice each, once per
    // printer — and each is bound to a constant rather than to a quantity.
    const code = readCodeOnly(profileParserModule);
    const emissions = matchesOf(code, ADMITTED_PLACEHOLDER_EMISSION);

    expect(emissions).toHaveLength(4);
    expect(emissions.filter((text) => text.startsWith('mu'))).toHaveLength(2);
    expect(emissions.filter((text) => text.startsWith('sigma'))).toHaveLength(2);

    // The placeholder is zero, so the printer carries no rating quantity at all.
    expect(
      matchesOf(code, new RegExp(`${RATING_MODEL_PLACEHOLDER}\\s*=\\s*([\\d.]+)`, 'g')),
    ).toEqual([`${RATING_MODEL_PLACEHOLDER} = 0`]);

    // And every occurrence of either name in that module *is* one of the four:
    // nothing is read from them, destructured out of them, or bound to them.
    const residue = withoutAdmittedEmissions(code);
    expect(matchesOf(residue, /\bmu\b/g)).toEqual([]);
    expect(matchesOf(residue, /\bsigma\b/g)).toEqual([]);
  });

  it('names the two wire names in that module and in no other (7.7)', () => {
    // Non-vacuity of the admitted form: it is confined to the Response_Printer.
    // Every other module of the feature names neither even before the stripping.
    const elsewhere = modules
      .filter((file) => norm(file) !== norm(profileParserModule))
      .flatMap((file) => {
        const code = readCodeOnly(file);
        return [
          ...matchesOf(code, /\bmu\b/g),
          ...matchesOf(code, /\bsigma\b/g),
        ].map((offender) => ({
          file: featureRel(file),
          rule: 'names a rating-model member outside the Response_Printer',
          offender,
        }));
      });

    expect(elsewhere).toEqual([]);
  });
});

// --- Invariant 2: the display rating is selected, never computed (7.8) ------

describe('lib/ratingCondition.ts performs no arithmetic on a Display_Rating', () => {
  const code = readCodeOnly(ratingConditionModule);

  it('writes every numeric literal in that module as zero (Requirement 7.8)', () => {
    // The one module that decides whether there is a number to show. Its only
    // literal is the Appearance_Count at which nothing has been played, so there
    // is nowhere for a scale, an offset, or a factor of three to hide under
    // another name.
    const literals = matchesOf(code, /(?<![\w.$])\d+(?:\.\d+)?/g);

    expect(literals.length).toBeGreaterThan(0);
    expect([...new Set(literals)]).toEqual(['0']);
  });

  it('contains no arithmetic operator at all (Requirement 7.8)', () => {
    // Stronger than "none applied to the Display_Rating", and checkable without a
    // type checker: the module compares and selects, and the `established` arm
    // carries the parsed integer through unchanged.
    expect(matchesOf(code, /[*/%]|\+|(?<![-\w])-(?!-)/g)).toEqual([]);
    expect(matchesOf(code, /\bMath\s*\./g)).toEqual([]);
  });

  it('does select the Display_Rating, so the module is not merely empty (7.2)', () => {
    // The positive half: the condition the arithmetic rule is about exists, and
    // the name the rule protects is really in this module.
    expect(matchesOf(code, /\bdisplayRating\b/g).length).toBeGreaterThan(1);
    expect(matchesOf(code, /\bresolveRatingCondition\b/g).length).toBeGreaterThan(
      0,
    );
  });
});

// --- Invariant 3: no numeric enum literal anywhere (Requirement 13.4) -------

describe('no numeric enum literal appears anywhere in the Player_Stats_Feature', () => {
  it('finds none in any module of the feature (Requirement 13.4)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      const withStrings = readWithoutComments(file);
      const codeOnly = readCodeOnly(file);

      for (const { label, pattern, keepsStrings } of ENUM_RULES) {
        for (const offender of matchesOf(
          keepsStrings ? withStrings : codeOnly,
          pattern,
        )) {
          findings.push({ file: featureRel(file), rule: label, offender });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('holds no module out of the rule (Requirement 13.4)', () => {
    // The set the enum rule iterates, compared against an independent
    // re-collection of the feature's production modules. Any filter — an
    // exemption list, a held-out path, a stray `!==` — would show up here as a
    // missing entry rather than as a quietly narrower rule.
    expect(modules.map(featureRel)).toEqual(playerStatsModules().map(featureRel));
  });

  it('reads both wire enums by name, so the absence is a choice (13.4)', () => {
    // Non-vacuity from inside the feature: the vocabulary the codes would replace
    // is present, pinned to the generated unions, and spelled as names.
    const wireEnums = readWithoutComments(
      join(playerStatsRoot, 'lib', 'wireEnums.ts'),
    );

    for (const name of ENUM_NAMED_VALUES) {
      expect(stringLiteralsOf(wireEnums), `${name} must be read by name`).toContain(
        name,
      );
    }
  });
});

// --- Invariant 4: one place writes a colour (Requirements 15.2, 15.3) -------

describe('no colour value is written outside the feature token table', () => {
  it('holds no hex literal and no colour function in any module (15.2)', () => {
    // Strings are kept: an inline style or a data attribute would carry a colour
    // as a literal, and that is exactly the form this rule exists to reject.
    const findings: Finding[] = [];

    for (const file of modules) {
      const source = readWithoutComments(file);
      for (const offender of matchesOf(source, HEX_COLOUR)) {
        findings.push({
          file: featureRel(file),
          rule: 'hex colour literal',
          offender,
        });
      }
      for (const offender of matchesOf(source, COLOUR_FUNCTION)) {
        findings.push({
          file: featureRel(file),
          rule: 'colour function',
          offender,
        });
      }
    }

    expect(findings).toEqual([]);
  });

  it('sets no colour through a JSX style prop (Requirement 15.2)', () => {
    // The one place in a component where a colour could be written without a hex
    // literal — `style={{ color: theRowColour }}`. The feature presents state
    // through class names and data attributes, so the cascade in the stylesheets
    // is the whole of its colour story and this rule keeps it that way.
    const findings: Finding[] = [];

    for (const file of modules) {
      for (const offender of matchesOf(
        readWithoutComments(file),
        STYLE_PROP_COLOUR,
      )) {
        findings.push({
          file: featureRel(file),
          rule: 'colour set through a style prop',
          offender,
        });
      }
    }

    expect(findings).toEqual([]);
  });

  it('holds no hex literal and no colour function in any other stylesheet (15.2)', () => {
    const findings: Finding[] = [];

    for (const file of componentStylesheets) {
      const css = stripCssComments(readFileSync(file, 'utf8'));
      for (const offender of matchesOf(css, HEX_COLOUR)) {
        findings.push({
          file: featureRel(file),
          rule: 'hex colour literal',
          offender,
        });
      }
      for (const offender of matchesOf(css, COLOUR_FUNCTION)) {
        findings.push({
          file: featureRel(file),
          rule: 'colour function',
          offender,
        });
      }
    }

    expect(findings).toEqual([]);
  });

  it('reads every colour it paints from a declared custom property (15.2)', () => {
    const findings: Finding[] = [];
    let inspected = 0;

    for (const file of componentStylesheets) {
      for (const { property, value } of cssDeclarations(file)) {
        if (!COLOUR_PROPERTIES.has(property)) continue;
        inspected += 1;

        for (const offender of selfWrittenColours(value)) {
          findings.push({
            file: featureRel(file),
            rule: `${property} names a colour of its own`,
            offender,
          });
        }
      }
    }

    expect(findings).toEqual([]);
    // Non-vacuity: the rule means nothing if no colour-carrying declaration was
    // read. Every panel, every chip, and every control paints at least two.
    expect(inspected).toBeGreaterThan(20);
  });

  it('reads only custom properties the token table or the design tokens declare (15.2)', () => {
    // Colours come from the design system's `--pm-*` tokens; the feature's own
    // table holds its scale.
    const declared = new Set([...declaredCustomProperties(tokenTablePath), ...designTokens]);
    const findings: Finding[] = [];
    const used = new Set<string>();

    // Stylesheets and modules both: a component could reach a token through an
    // inline custom property as readily as through a rule.
    const readers: readonly (readonly [string, string])[] = [
      ...stylesheets.map(
        (file) =>
          [featureRel(file), stripCssComments(readFileSync(file, 'utf8'))] as const,
      ),
      ...modules.map(
        (file) => [featureRel(file), readWithoutComments(file)] as const,
      ),
    ];

    for (const [file, source] of readers) {
      for (const token of referencedPropertiesIn(source)) {
        used.add(token);
        if (!declared.has(token)) {
          findings.push({
            file,
            rule: 'reads a custom property the token table does not declare',
            offender: token,
          });
        }
      }
    }

    expect(findings).toEqual([]);
    // Non-vacuity from both ends: the tables declare a full scale and the design
    // colours, and the stylesheets really do read from them.
    expect(declared.size).toBeGreaterThan(30);
    expect(used.size).toBeGreaterThan(20);
  });

  it('declares its custom properties in the token table and nowhere else (15.2)', () => {
    // A per-component sheet declaring its own token would put a second table in
    // the feature, and the contrast figures recorded beside the first would stop
    // describing what renders. A module declaring one through a style prop would
    // do the same from the other side.
    const inStylesheets = componentStylesheets.flatMap((file) =>
      declaredCustomProperties(file).map((token) => ({
        file: featureRel(file),
        rule: 'declares a custom property outside the token table',
        offender: token,
      })),
    );

    const inModules = modules.flatMap((file) =>
      matchesOf(readWithoutComments(file), /['"]--[\w-]+['"]\s*:/g).map(
        (offender) => ({
          file: featureRel(file),
          rule: 'declares a custom property in a module',
          offender,
        }),
      ),
    );

    expect([...inStylesheets, ...inModules]).toEqual([]);
  });

  it('writes the colours in both design Theme tables, so the rule can fire (15.3)', () => {
    // The design tokens are where colours *are* written. If the patterns above
    // cannot see them there, they could not see a stray colour anywhere else
    // either, and every prohibition above would be empty.
    expect(DARK_BLOCK.test(designTokensCss), 'the dark Theme table').toBe(true);
    expect(LIGHT_BLOCK.test(designTokensCss), 'the light Theme table').toBe(true);

    for (const [name, table] of [
      ['dark', darkBlock],
      ['light', lightBlock],
    ] as const) {
      const colours = matchesOf(table, HEX_COLOUR);
      const tokens = declaredPropertiesIn(table);

      expect(colours.length, `the ${name} table writes no colour`).toBeGreaterThan(
        15,
      );
      // Aliases (`var(--pm-...)`) and shadows are the entries without a hex.
      expect(colours.length).toBeGreaterThan(tokens.length / 2);
    }
  });

  it('declares every colour token in both design Theme tables (Requirement 15.3)', () => {
    // The two tables are the same token set, so a Theme can never be missing a
    // value the other one has — the failure that renders an unstyled colour.
    const dark = [...new Set(declaredPropertiesIn(darkBlock))].sort();
    const light = [...new Set(declaredPropertiesIn(lightBlock))].sort();

    expect(light).toEqual(dark);
    expect(dark.length).toBeGreaterThan(15);
  });

  it('declares only its scale, once, on the Theme-invariant block (15.3)', () => {
    // Every token the feature paints is either a design colour, with a value in
    // both Theme tables, or Theme-invariant and declared once on `:root` in the
    // feature's table. The table writes no colour and restates no design token.
    const scale = new Set(declaredPropertiesIn(scaleBlock));
    const declared = new Set(declaredCustomProperties(tokenTablePath));

    expect(scale.size).toBeGreaterThan(20);
    expect([...declared].filter((token) => !scale.has(token))).toEqual([]);
    expect([...scale].filter((token) => designTokens.has(token))).toEqual([]);
    expect(matchesOf(tokenTableCss, HEX_COLOUR)).toEqual([]);
  });
});

// --- Invariant 5: appearance is resolved by src/theme (Requirement 15.1) ----

describe('appearance is resolved by src/theme and by nothing in this feature', () => {
  it('reads no storage, evaluates no colour-scheme query, and injects no script (15.1)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      const withStrings = readWithoutComments(file);
      const codeOnly = readCodeOnly(file);

      for (const { label, pattern, keepsStrings } of APPEARANCE_RULES) {
        for (const offender of matchesOf(
          keepsStrings ? withStrings : codeOnly,
          pattern,
        )) {
          findings.push({ file: featureRel(file), rule: label, offender });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('reads the three shared values out of src/theme source (15.1)', () => {
    // Pinned, so a rename on the shared side surfaces here rather than silently
    // widening or narrowing what the rule below forbids.
    expect(APPEARANCE_STORAGE_KEY_VALUE).toBe('pitchmate.appearance');
    expect(THEME_ATTRIBUTE_VALUE).toBe('data-theme');
    expect(LIGHT_APPEARANCE_QUERY_VALUE).toBe('(prefers-color-scheme: light)');
  });

  it('copies none of the three into a literal of this feature (15.1)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      for (const literal of stringLiterals(file)) {
        const copied = copiesSharedThemeValue(literal);
        if (copied !== null) {
          findings.push({
            file: featureRel(file),
            rule: `restates the shared ${copied}`,
            offender: literal,
          });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('imports every theme name it uses from src/theme (Requirement 15.1)', () => {
    const findings: Finding[] = [];
    const importedSomewhere = new Set<string>();

    for (const file of featureSources) {
      const code = readCodeOnly(file);
      const fromTheme = new Set(
        importClauses(file)
          .filter(({ specifier }) => {
            const target = resolveWithinSrc(specifier, file);
            return target !== null && isWithin(themeRoot, target);
          })
          .flatMap(({ names }) => names),
      );

      for (const name of fromTheme) importedSomewhere.add(name);

      for (const name of THEME_OWNED_NAMES) {
        const used = new RegExp(`\\b${name}\\b`).test(code);
        if (used && !fromTheme.has(name)) {
          findings.push({
            file: featureRel(file),
            rule: 'names a theme value it does not import from src/theme',
            offender: name,
          });
        }
      }
    }

    expect(findings).toEqual([]);

    // The positive half: the appearance store's key, the pre-paint bootstrap, and
    // the applied Theme all reach this feature from the shared module. The
    // resolution itself is reached *through* the bootstrap source rather than
    // called here, which is why `resolveTheme` is not in this list — the screen
    // renders whatever Theme the frame around it resolved.
    expect([...importedSomewhere]).toEqual(
      expect.arrayContaining([
        'APPEARANCE_STORAGE_KEY',
        'THEME_ATTRIBUTE',
        'THEME_BOOTSTRAP_SOURCE',
        'Theme',
        'applyThemeAttribute',
      ]),
    );
  });

  it('finds all three concerns declared by src/theme rather than here (15.1)', () => {
    // The other side of the rule: the shared module really does own an appearance
    // store, a bootstrap, and a resolution, so "the feature declares none of them"
    // is a division of labour rather than a gap.
    const themeExports = new Set(
      reExports(readFileSync(themeBarrelPath, 'utf8')).flatMap(
        ({ names }) => names,
      ),
    );

    for (const name of [
      'APPEARANCE_STORAGE_KEY',
      'readAppearancePreference',
      'writeAppearancePreference',
      'THEME_BOOTSTRAP_SOURCE',
      'applyThemeAttribute',
      'resolveTheme',
    ]) {
      expect(themeExports, `src/theme must export ${name}`).toContain(name);
    }
  });
});

// --- The patterns fire, and hold off the near-misses (Requirement 14.6) -----

describe('the scan patterns fire on an offender and hold off a near-miss', () => {
  it('catches each rating internal it claims to catch', () => {
    const offender =
      'const mu = 25; const sigma = 8.333; const K = 40; const C = 1000;';
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

    // Each remaining pattern, against the shape it alone is for.
    expect(matchesOf('const u = rating.uncertainty;', RATING_RULES[2].pattern))
      .not.toEqual([]);
    expect(matchesOf('display = μ - 3 * σ;', RATING_RULES[3].pattern)).not.toEqual(
      [],
    );
    expect(matchesOf('display = μ - 3 * σ;', RATING_RULES[4].pattern)).not.toEqual(
      [],
    );
    expect(matchesOf('const RATING_K = 40;', RATING_RULES[6].pattern)).not.toEqual(
      [],
    );
    expect(matchesOf('const ratingC = 1000;', RATING_RULES[6].pattern)).not.toEqual(
      [],
    );
  });

  it('holds off the words that merely contain those letters', () => {
    // The reason the rules are word-boundary precise. Every one of these appears
    // in the feature, and none of them is a rating internal.
    const innocent =
      'function mutate(kind: Kind, Component: FC) { const menu = must(kind); ' +
      'const Count = summary.length; const Key = row.membershipId; return menu; }';

    for (const { label, pattern } of RATING_RULES) {
      expect(matchesOf(innocent, pattern), label).toEqual([]);
    }

    // A generic type parameter named `K` is not a scaling parameter.
    expect(
      matchesOf('type Table<K, V> = Record<K, V>;', RATING_RULES[5].pattern),
    ).toEqual([]);
    // Nor is a lower-case local, which is what `structural/sourceScan.ts` writes.
    expect(matchesOf('const c = source[i];', RATING_RULES[5].pattern)).toEqual([]);
    // Arithmetic that is not a factor of three.
    expect(matchesOf('Math.round(Math.abs(value))', RATING_RULES[7].pattern)).toEqual(
      [],
    );
    expect(matchesOf('const width = 360;', RATING_RULES[7].pattern)).toEqual([]);
    expect(matchesOf('const x = padding * 2;', RATING_RULES[7].pattern)).toEqual([]);
    // A member named `mu` on another word is not `mu`.
    expect(matchesOf('const value = summary.mutations;', RATING_RULES[0].pattern))
      .toEqual([]);
  });

  it('strips the printers emission and nothing wider', () => {
    // The admitted form is a *write* of a constant. A read, a destructuring, and
    // a binding to anything else all survive the stripping and are findings.
    expect(
      withoutAdmittedEmissions(`{ mu: ${RATING_MODEL_PLACEHOLDER}, state: s }`),
    ).not.toMatch(/\bmu\b/);

    for (const offender of [
      'const estimate = rating.mu;',
      'const { mu, sigma } = rating;',
      'return { mu: rating.displayRating };',
      'const sigma = readProperty(body, label);',
    ]) {
      expect(
        ratingFindings([{ file: 'control.ts', code: offender }]).length,
        offender,
      ).toBeGreaterThan(0);
    }
  });

  it('catches a read of a rating internal through a string key', () => {
    // The complement of the identifier scan: each shape a read takes when the
    // member name is written as a literal rather than as an identifier.
    const offenders = [
      'const estimate = profile.mu;',
      "const spread = body['sigma'];",
      'const { uncertainty } = rating;',
      "const value = readNumber(readProperty(source.value, 'mu'), label);",
      "const u = readOptional(readProperty(source.value, 'uncertainty'), label);",
    ];

    for (const offender of offenders) {
      const fired = RATING_READ_RULES.filter(
        ({ pattern }) => matchesOf(offender, pattern).length > 0,
      );
      expect(fired.length, offender).toBeGreaterThan(0);
    }
  });

  it('holds off a write of the two wire member names, and the near-miss words', () => {
    // The two admitted writing sites, in the exact shapes they use: the
    // printer's placeholder emission and the fixtures' computed key. Neither is
    // a read, so neither fires.
    const writes = [
      `{ mu: ${RATING_MODEL_PLACEHOLDER}, sigma: ${RATING_MODEL_PLACEHOLDER} }`,
      "const RATING_MODEL_WIRE_MEMBERS = ['mu', 'sigma'] as const;",
      '{ [RATING_MODEL_WIRE_MEMBERS[0]]: first }',
    ];

    for (const write of writes) {
      for (const { label, pattern } of RATING_READ_RULES) {
        expect(matchesOf(write, pattern), `${label}: ${write}`).toEqual([]);
      }
    }

    // And the words that merely contain those letters, in a read position.
    for (const innocent of [
      'const items = summary.mutations;',
      'const label = row.municipality;',
      'const { must } = guards;',
      "const name = readString(readProperty(source.value, 'membershipId'), label);",
      "const text = readString(readProperty(source.value, 'displayName'), label);",
    ]) {
      for (const { label, pattern } of RATING_READ_RULES) {
        expect(matchesOf(innocent, pattern), `${label}: ${innocent}`).toEqual([]);
      }
    }
  });

  it('catches each enum position it claims to catch', () => {
    // ENUM_FIELD_LITERAL: the object-literal, comparison, JSX-prop, assignment,
    // and type-annotation forms, on both field names.
    expect(matchesOf('{ state: 1, displayRating: 1200 }', ENUM_FIELD_LITERAL))
      .not.toEqual([]);
    expect(matchesOf('if (row.state === 0) {', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('<RatingPanel state={1} />', ENUM_FIELD_LITERAL)).not.toEqual(
      [],
    );
    expect(matchesOf('body.ratingState = 0;', ENUM_FIELD_LITERAL)).not.toEqual([]);
    expect(matchesOf('let state: 1 = 1;', ENUM_FIELD_LITERAL)).not.toEqual([]);

    // ENUM_CODE_CALL: a reader and a writer, in both naming directions.
    expect(matchesOf('ratingStateFromCode(1)', ENUM_CODE_CALL)).not.toEqual([]);
    expect(matchesOf('codeFromMembershipState( 0 )', ENUM_CODE_CALL)).not.toEqual(
      [],
    );

    // ENUM_NAME_TABLE: a hand-built code table, in either union's vocabulary.
    expect(
      matchesOf("const T = { 0: 'Active', 1: 'Inactive' };", ENUM_NAME_TABLE),
    ).toHaveLength(2);
    expect(
      matchesOf("{ 0: 'Provisional', 1: 'Established' }", ENUM_NAME_TABLE),
    ).toHaveLength(2);
  });

  it('holds off the numbers this feature legitimately writes', () => {
    // The shapes that made a general numeric search untenable. `lib/callOutcome.ts`
    // is the module these are read off, and Invariant 0 asserts it is scanned — so
    // each is a number the rule genuinely sees and declines to flag.
    expect(matchesOf('if (status === 404) {', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(
      matchesOf('const CONCEALED_STATUSES = [401, 403, 404];', ENUM_FIELD_LITERAL),
    ).toEqual([]);
    expect(matchesOf('const SUCCESS_STATUS_MIN = 200;', ENUM_FIELD_LITERAL)).toEqual(
      [],
    );
    expect(matchesOf('if (appearances === 0) {', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf('entries.map((state) => 1)', ENUM_FIELD_LITERAL)).toEqual([]);
    expect(matchesOf('if (levels.length >= 2) {', ENUM_FIELD_LITERAL)).toEqual([]);
    // A named value in an enum position is what the contract asks for.
    expect(
      matchesOf("ratingSummary({ state: 'Provisional' })", ENUM_FIELD_LITERAL),
    ).toEqual([]);
    // A status-keyed table whose values are this feature's own outcome kinds is
    // not a code table: what makes a code table one is the enum name on the right.
    expect(
      matchesOf("{ 404: 'not-found', 503: 'transport-failure' }", ENUM_NAME_TABLE),
    ).toEqual([]);
    // A name-keyed table of names is a label map, not a code table.
    expect(
      matchesOf("{ Provisional: 'Provisional' }", ENUM_NAME_TABLE),
    ).toEqual([]);
    // ENUM_CODE_CALL's near-misses: a code reader handed a named value, and a
    // built-in whose name merely contains those letters.
    expect(matchesOf('ratingStateFromCode(wire.state)', ENUM_CODE_CALL)).toEqual([]);
    expect(matchesOf('String.fromCodePoint(65)', ENUM_CODE_CALL)).toEqual([]);
  });

  it('catches every colour a module or a stylesheet could write for itself', () => {
    expect(selfWrittenColours('#5bbf36')).toEqual(['#5bbf36']);
    expect(selfWrittenColours('white')).toEqual(['white']);
    expect(selfWrittenColours('rgb(20 20 20 / 50%)')).toEqual(['rgb']);
    expect(selfWrittenColours('1px solid red')).toEqual(['red']);
    expect(matchesOf('color: #FFF;', HEX_COLOUR)).toEqual(['#FFF']);
    expect(matchesOf('background: rgba(0,0,0,.5)', COLOUR_FUNCTION)).not.toEqual(
      [],
    );
    expect(
      matchesOf('<circle style={{ fill: mark }} />', STYLE_PROP_COLOUR),
    ).not.toEqual([]);
    expect(
      matchesOf("<p style={{ color: '#5bbf36' }}>x</p>", STYLE_PROP_COLOUR),
    ).not.toEqual([]);
  });

  it('holds off the colourless values this feature legitimately writes', () => {
    expect(selfWrittenColours('var(--player-stats-card-surface)')).toEqual([]);
    expect(
      selfWrittenColours(
        'var(--player-stats-border-width) solid var(--player-stats-card-border)',
      ),
    ).toEqual([]);
    expect(selfWrittenColours('inherit')).toEqual([]);
    expect(selfWrittenColours('none')).toEqual([]);
    expect(selfWrittenColours('0')).toEqual([]);
    expect(selfWrittenColours('underline')).toEqual([]);
    expect(selfWrittenColours('currentColor')).toEqual([]);
    expect(
      selfWrittenColours('clamp(0.75rem, 4vw, 2rem) solid var(--focus-ring)'),
    ).toEqual(['clamp']);
    // A fragment identifier, a CSS length, and a markdown heading are not colours.
    expect(matchesOf('const anchor = "#main";', HEX_COLOUR)).toEqual([]);
    expect(matchesOf('border-width: 2px;', HEX_COLOUR)).toEqual([]);
    expect(matchesOf('### It renders for every profile', HEX_COLOUR)).toEqual([]);
    // A layout-only style prop is not a colour.
    expect(
      matchesOf('<svg style={{ width: size }} />', STYLE_PROP_COLOUR),
    ).toEqual([]);
  });

  it('catches a token read from nowhere and a token missing from one Theme', () => {
    // The two token-table rules are comparisons rather than patterns, so their
    // controls are comparisons too: a sheet reading a property the table does not
    // declare, and a Theme table missing a value the other one has.
    const declared = new Set([...declaredCustomProperties(tokenTablePath), ...designTokens]);

    expect(
      referencedPropertiesIn(
        'color: var(--player-stats-nothing-declares-this);',
      ).filter((token) => !declared.has(token)),
    ).toEqual(['--player-stats-nothing-declares-this']);

    // The same comparison over the real sheets reports nothing, so the detector
    // is distinguishing a declared token from an undeclared one.
    expect(
      referencedPropertiesIn('color: var(--pm-text-primary); background: var(--pm-bg);').filter(
        (token) => !declared.has(token),
      ),
    ).toEqual([]);

    const dark = declaredPropertiesIn("--text: #f5f5f5;\n--accent-text: #5bbf36;");
    const light = declaredPropertiesIn('--text: #141414;');
    expect(dark.filter((token) => !light.includes(token))).toEqual([
      '--accent-text',
    ]);

    // A declaration without a colour is caught by the per-token count, which is
    // what pairs each token in a Theme table with a value.
    expect(matchesOf('--text: ;', HEX_COLOUR)).toHaveLength(0);
    expect(declaredPropertiesIn('--text: ;')).toHaveLength(1);
  });

  it('catches a feature-local appearance store, bootstrap, or resolution', () => {
    const offenders = [
      'const stored = localStorage.getItem(key);',
      'document.cookie = "theme=dark";',
      'const prefersLight = window.matchMedia(query);',
      'const QUERY = "(prefers-color-scheme: light)";',
      'root.innerHTML = "";',
      'function resolveThemeLocally(preference) { return "dark"; }',
      'const appearancePreferenceStore = createStore();',
      'const THEME_ATTRIBUTE = "data-theme";',
    ];

    for (const offender of offenders) {
      const fired = APPEARANCE_RULES.filter(
        ({ pattern }) => matchesOf(offender, pattern).length > 0,
      );
      // `root.innerHTML = ""` is the one shape above no capability rule claims —
      // it injects markup, not a script — so it is asserted separately below.
      if (offender.includes('innerHTML')) {
        expect(fired, offender).toEqual([]);
        continue;
      }
      expect(fired.length, offender).toBeGreaterThan(0);
    }

    expect(
      matchesOf(
        '<script dangerouslySetInnerHTML={{ __html: source }} />',
        APPEARANCE_RULES[4].pattern,
      ),
    ).not.toEqual([]);
    expect(
      matchesOf(
        'const tag = document.createElement("script");',
        APPEARANCE_RULES[4].pattern,
      ),
    ).not.toEqual([]);
  });

  it('holds off the appearance-shaped names this feature legitimately writes', () => {
    // The near-misses that make an exemption list unnecessary. `appearances` and
    // `bibAppearances` are wire field names, `Appearances` is a user-facing label,
    // and `co-appearance` is a Pairwise_Section variant — none is the shared
    // storage key, the attribute name, or the media query.
    for (const literal of [
      'appearances',
      'bibAppearances',
      'Appearances',
      'Bib appearances',
      'co-appearance',
      'profile record appearances',
      '../../../theme',
      'dark',
    ]) {
      expect(copiesSharedThemeValue(literal), literal).toBeNull();
    }

    // And the three real values still fire, including as part of a wider literal.
    expect(copiesSharedThemeValue('pitchmate.appearance')).toBe(
      'APPEARANCE_STORAGE_KEY',
    );
    expect(copiesSharedThemeValue('pitchmate.appearance.v2')).toBe(
      'APPEARANCE_STORAGE_KEY',
    );
    expect(copiesSharedThemeValue("[data-theme='light']")).toBe('THEME_ATTRIBUTE');
    expect(copiesSharedThemeValue('(prefers-color-scheme: light)')).toBe(
      'LIGHT_APPEARANCE_QUERY',
    );

    // A reader of the Appearance_Count is not a reader of the appearance
    // preference, which is the one lookahead in the declaration rule.
    const declarationRule = APPEARANCE_RULES[6].pattern;
    expect(matchesOf('function readAppearanceCount(record) {}', declarationRule))
      .toEqual([]);
    expect(matchesOf('function readAppearancePreference() {}', declarationRule))
      .not.toEqual([]);
    // A delegation to the shared module is not a declaration of a resolution.
    expect(matchesOf('export function applyTheme(theme) {}', declarationRule))
      .toEqual([]);
    expect(matchesOf('export function resetTheme() {}', declarationRule)).toEqual(
      [],
    );
    expect(
      matchesOf('export function themeAppliedByBootstrap() {}', declarationRule),
    ).toEqual([]);
  });
});
