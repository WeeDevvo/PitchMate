/**
 * Structural source scan: the Squads_Feature's theming, the auth constants it
 * borrows, and the membership actions it deliberately does not offer (task 17.5).
 *
 * Requirement 20.11 makes this file part of the product rather than a courtesy
 * check. Every rule it enforces is stated as a prohibition or as a universal over
 * a directory — "hard-code no colour value in a component" (18.9), "define no
 * appearance storage key, no pre-paint bootstrap, and no theme resolution
 * function of its own" (18.8), "use the route paths and the Redirect_Capture
 * query parameter name exported by the Auth_Feature rather than feature-local
 * copies of either" (5.5), "render no control that demotes an admin, transfers
 * ownership, or removes a membership" (13.8) — and neither a prohibition nor a
 * universal can be demonstrated by an example. So the source tree is read and
 * matched, following the mechanism `pureLogic.structural.test.ts`,
 * `transportSeam.structural.test.ts`, and `enumAndRatingBoundaries.structural.test.ts`
 * already established and `structural/sourceScan.ts` declares once: read each
 * file's text, strip comments (and, where the rule is about identifiers, string
 * contents) through the same small state machine, and fail naming the offending
 * file and the offending literal.
 *
 * ### The four rule groups
 *
 * 1. **One place writes a colour** (Requirements 18.9, 20.11). No production
 *    module of the feature contains a hex literal or a colour function, no
 *    stylesheet but `styles/squadsTokens.css` does either, every colour-carrying
 *    declaration reads its colour from a `var(--token)` (or inherits it), and
 *    every custom property those stylesheets name is declared in that one table.
 *    So a Theme change is a change of one attribute on the document element, and
 *    the contrast figures the token table records are the figures the screens
 *    actually render.
 * 2. **One place owns appearance** (Requirement 18.8). The feature reads no
 *    browser storage and no cookie, evaluates no colour-scheme media query,
 *    injects no pre-paint script, writes no theme-attribute name of its own, and
 *    declares no appearance store, bootstrap, or resolution function. Where it
 *    names one of those things it imports the name from `src/theme`, which is
 *    where Requirement 18.8 puts all three.
 * 3. **One place spells the auth contract** (Requirement 5.5). The two handover
 *    route paths and the Redirect_Capture parameter name are read out of the
 *    Auth_Feature's own source, and no string literal of this feature carries
 *    any of the three. `screens/InviteLandingScreen.tsx` imports them from the
 *    Auth_Feature barrel instead, so the handover cannot drift from where the
 *    auth routes are registered.
 * 4. **The deferred membership actions are absent** (Requirement 13.8). The
 *    backend offers demotion, ownership transfer, leaving, and member removal;
 *    the feature names none of the four — not their endpoint paths, and not an
 *    identifier for any of them. Promotion is the one membership-changing action
 *    in the feature, and it *is* named, which is what makes the other four an
 *    omission rather than a gap in the scan.
 *
 * ### Why the colour rule is stated over declarations rather than over text
 *
 * "No hex literal anywhere" is the easy half and it is not the whole rule: a
 * component could write `color: white` or `border-color: rgb(20 20 20)` and carry
 * no `#`. Nor can the rule be "every value must contain `var(`", because
 * `background: none`, `border: 0`, and `color: inherit` are colour-carrying
 * declarations that name no colour at all and must stay legal.
 *
 * So each declaration of a colour-carrying property is read, its `var(…)`
 * references are removed, and **every token left over** must be a length, a
 * number, or one of the colourless keywords in {@link COLOURLESS_KEYWORDS}. A
 * named colour, a hex triplet, or a colour function survives that filter and is
 * reported. Stating it as an allow-list rather than as a list of the 148 CSS
 * named colours is what makes it hold for the colour someone reaches for next.
 *
 * The token table is the one file exempted, because it is the file whose job is to
 * write those values. Its own exemption is kept honest from the other side: the
 * scan asserts the table *does* hold a hex value per token in both Theme blocks,
 * so a pattern that could not see a colour would fail there rather than passing
 * everywhere.
 *
 * ### Why the appearance rule is not "no declaration named `*Theme*`"
 *
 * `testing/squadsScreenStates.tsx` declares `applyTheme`, `resetTheme`, and
 * `themeAppliedByBootstrap`. None of them is an appearance store, a bootstrap, or
 * a resolution function: each is a two-line delegation to `applyThemeAttribute`,
 * `THEME_ATTRIBUTE`, and `THEME_BOOTSTRAP_SOURCE` imported from `src/theme`. A
 * rule keyed on names would flag exactly the code that proves compliance.
 *
 * The rule is therefore keyed on the *capabilities* the three concerns need — a
 * storage read or write, a colour-scheme query, a script injection, a
 * theme-attribute name, a restated shared constant, a resolution-shaped
 * declaration — joined by the positive requirement that every theme name the
 * feature uses arrives by import from `src/theme`. A delegation passes; a second
 * implementation cannot.
 *
 * ### Scoping notes
 *
 * - The identifier rules read comment-*and*-string-stripped source, because these
 *   modules' docblocks discuss at length the very things they must not do
 *   (`usePromotion.ts` promises in prose that the feature "offers no demotion, no
 *   ownership transfer, and no removal"), and a scan that matched prose would flag
 *   the documentation promising compliance.
 * - The literal rules read comment-stripped source that **keeps** strings, because
 *   a route path, an endpoint path, and a storage key are string literals.
 * - `lib/skillTier.ts` declares `LEAVE_TIER_UNCHANGED` and the sentinel
 *   `'leave-unchanged'` — a Guest_Form tier selection, not a membership leaving a
 *   squad. The leaving rule is scoped to a squad-or-membership object for exactly
 *   that reason, and the near-miss is asserted below so the scoping cannot be
 *   loosened by accident.
 * - `usePromotion.ts` and `useFeatureToggles.ts` call `Map.delete(membershipId)`
 *   on their in-flight controller maps. The removal rule matches a *member-delete
 *   identifier*, not a `delete` call whose argument happens to be a membership
 *   identity, and that near-miss is asserted too.
 *
 * Requirements: 5.5, 13.8, 18.8, 18.9, 20.11
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  authRoot,
  collectProductionSources,
  isScanSupportModule,
  isTestFile,
  isWithin,
  norm,
  reExports,
  readCodeOnly,
  readWithoutComments,
  relTo,
  resolveWithinSrc,
  squadsModules,
  squadsRoot,
  squadsSources,
  squadsStyles,
  stripCssComments,
  targetsBarrelOf,
  themeRoot,
  webRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The feature's production modules: the set every prohibition below binds. */
const modules = squadsModules();

/**
 * True for one of the feature's structural scans — this file and its four
 * siblings.
 *
 * A scan has to name the things it forbids: the rule table below spells
 * `THEME_ATTRIBUTE` and `APPEARANCE_STORAGE_KEY` in live code precisely so it can
 * reject a feature-local one, exactly as `enumAndRatingBoundaries.structural.test.ts`
 * spells `mu` and `sigma`. That is why `structural/sourceScan.ts` is already held
 * out of every scanned set as scan support rather than shipped feature code
 * (Requirement 18.7 gives the reason: nothing under `screens/`, `components/`,
 * `state/`, `lib/`, or `api/` imports it and the barrel does not name it), and the
 * scans that read it are held out here on the same ground.
 *
 * Only the rule that reads *test* files needs this. Every prohibition below binds
 * {@link modules}, the production set, which excludes test files outright.
 */
function isStructuralScan(file: string): boolean {
  return /\.structural\.test\.tsx?$/.test(norm(file));
}

/**
 * Every source file of the feature bar the scan layer — tests included.
 *
 * The appearance rule's positive half reads this wider set: the Appearance_Preference
 * key is named by `screens/squadsAccessibility.a11y.test.tsx` and the bootstrap by
 * `testing/squadsScreenStates.tsx`, so "all three concerns arrive from `src/theme`"
 * is only checkable across both.
 */
const featureSources = squadsSources().filter(
  (file) => !isScanSupportModule(file) && !isStructuralScan(file),
);

/** The one stylesheet allowed to write a colour value (Requirement 18.9). */
const tokenTablePath = join(squadsRoot, 'styles', 'squadsTokens.css');

/** Every stylesheet of the feature, the token table included. */
const stylesheets = squadsStyles();

/** Every stylesheet but the token table — the set the colour rule binds. */
const componentStylesheets = stylesheets.filter(
  (file) => norm(file) !== norm(tokenTablePath),
);

/** The transport facade: the one module that names an endpoint path. */
const facadePath = join(squadsRoot, 'api', 'squadsApi.ts');

/** The screen Requirement 5.5 governs. */
const inviteLandingPath = join(squadsRoot, 'screens', 'InviteLandingScreen.tsx');

/** The shared Theme module's public barrel (Requirement 18.8). */
const themeBarrelPath = join(themeRoot, 'index.ts');

/** The generated client's schema, for what the backend actually offers. */
const generatedSchemaPath = resolve(
  webRoot,
  '..',
  '..',
  'packages',
  'api-client',
  'src',
  'schema.d.ts',
);

/** Path relative to the feature root, for a failure message. */
function featureRel(path: string): string {
  return relTo(squadsRoot, path);
}

// --- Reading imports, literals, and declarations ------------------------------

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
 * `structural/sourceScan.ts` shares {@link importSpecifiers} and {@link reExports}
 * because every other scan needs only *which module* an import reaches. This rule
 * needs *which name* an import carries — "the feature names `THEME_ATTRIBUTE`, so
 * it must import `THEME_ATTRIBUTE` from `src/theme`" — so the clause parser lives
 * here, with the shared strippers still doing the reading.
 *
 * `type` modifiers are dropped: a type arriving from the shared module is as much
 * an import of it as a value is.
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

/** Every string and template literal of a module, comments already dropped. */
function stringLiterals(file: string): string[] {
  const code = readWithoutComments(file);
  const pattern = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    found.push(match[2]);
  }
  return found;
}

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
 * `app-shell/styles/shell.declaredStyles.test.ts` performs. Selector fragments
 * that happen to hold a colon (`a:focus-visible`) yield a property name no colour
 * rule recognises and are filtered out by the property table below.
 */
function cssDeclarations(file: string): CssDeclaration[] {
  const css = stripCssComments(readFileSync(file, 'utf8'));
  const pattern = /([-a-zA-Z][-a-zA-Z0-9]*)\s*:\s*([^;{}]+)/g;
  const found: CssDeclaration[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    found.push({
      property: match[1].toLowerCase(),
      value: match[2].trim(),
    });
  }
  return found;
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

/** One finding: the file, the rule it broke, and the text that broke it. */
interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly offender: string;
}

// --- Colour patterns and the colour-carrying properties -----------------------

/** A hex colour literal, in any of the CSS lengths. */
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/g;

/** A colour function, in any of its spellings. */
const COLOUR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/gi;

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
 * `text-decoration: none` all name no colour and must stay legal, so the residual
 * tokens of a declaration are checked against this list rather than against a list
 * of colour names. `currentcolor` is here because it takes its value from the
 * element's own `color`, which is itself held to the rule.
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
const NUMERIC_TOKEN = /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|ex|ch|%|vw|vh|vmin|vmax|fr|deg|s|ms)?$/;

/** A `var(--token)` reference, with any fallback. */
const VAR_REFERENCE = /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g;

/**
 * The tokens of a colour-carrying value that are neither a custom property
 * reference, a number, nor a colourless keyword — that is, the colours it writes
 * for itself.
 */
function selfWrittenColours(value: string): string[] {
  const withoutVars = value.replace(VAR_REFERENCE, ' ');

  return withoutVars
    .split(/[\s,/()]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !NUMERIC_TOKEN.test(token))
    .filter((token) => !COLOURLESS_KEYWORDS.has(token.toLowerCase()));
}

/** Every custom property a stylesheet declares. */
function declaredCustomProperties(file: string): string[] {
  const css = stripCssComments(readFileSync(file, 'utf8'));
  return matchesOf(css, /(--[\w-]+)\s*:/g).map((match) =>
    match.replace(/\s*:$/, ''),
  );
}

/** Every custom property a stylesheet reads. */
function referencedCustomProperties(file: string): string[] {
  const css = stripCssComments(readFileSync(file, 'utf8'));
  const found: string[] = [];
  const pattern = /var\(\s*(--[\w-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    found.push(match[1]);
  }
  return found;
}

// --- Invariant 0: the scan sees something ------------------------------------

describe('the theming, auth-constant, and deferred-action scan sees the feature', () => {
  it('is rooted at features/squads', () => {
    expect(norm(squadsRoot).endsWith('apps/web/src/features/squads')).toBe(true);
  });

  it('collects the production modules, the wider source set, and no test module', () => {
    // A vacuous scan would pass every prohibition below. This feature is three
    // screens, a component set, seven hooks, a transport facade, and the whole of
    // `lib/`, and it carries a test beside almost all of it.
    expect(modules.length).toBeGreaterThan(40);
    expect(featureSources.length).toBeGreaterThan(modules.length);
    expect(modules.map(featureRel).filter(isTestFile)).toEqual([]);
  });

  it('collects the token table and the per-component stylesheets beside it', () => {
    expect(stylesheets.map(featureRel)).toContain('styles/squadsTokens.css');
    expect(componentStylesheets.length).toBeGreaterThan(10);
    expect(componentStylesheets.map(featureRel)).not.toContain(
      'styles/squadsTokens.css',
    );
  });

  it('reaches the three files the rules name by path', () => {
    const paths = modules.map(featureRel);

    expect(paths).toContain('api/squadsApi.ts');
    expect(paths).toContain('screens/InviteLandingScreen.tsx');
    expect(paths).toContain('testing/squadsScreenStates.tsx');
  });

  it('holds out the scan layer, and holds in the tests that use the Theme', () => {
    // The exclusion is narrow: the five structural scans and the machinery they
    // share, all of which name what they forbid. The suites that actually render a
    // Theme stay in, which is what makes the appearance rule's positive half real.
    const wider = featureSources.map(featureRel);

    expect(wider.filter(isStructuralScan)).toEqual([]);
    expect(wider).toContain('testing/squadsScreenStates.tsx');
    expect(wider).toContain('screens/squadsAccessibility.a11y.test.tsx');
    expect(wider).toContain('screens/keyboardAndContrast.property.test.tsx');

    // The held-out set exists, so the exclusion is hiding something known rather
    // than nothing: this scan and its four siblings.
    const scans = squadsSources().map(featureRel).filter(isStructuralScan);
    expect(scans.length).toBe(5);
    expect(scans).toContain('themingAuthAndDeferredActions.structural.test.ts');
  });
});

// --- Rule group 1: one place writes a colour (Requirements 18.9, 20.11) -------

describe('no colour value is written outside the feature token table', () => {
  it('holds no hex literal and no colour function in any module (Requirement 18.9)', () => {
    // Strings are kept: an inline style or a data attribute would carry a colour
    // as a literal, and that is exactly the form this rule exists to reject.
    const findings: Finding[] = [];

    for (const file of modules) {
      const source = readWithoutComments(file);
      for (const offender of matchesOf(source, HEX_COLOUR)) {
        findings.push({ file: featureRel(file), rule: 'hex colour literal', offender });
      }
      for (const offender of matchesOf(source, COLOUR_FUNCTION)) {
        findings.push({ file: featureRel(file), rule: 'colour function', offender });
      }
    }

    expect(findings).toEqual([]);
  });

  it('sets no colour through a JSX style prop (Requirement 18.9)', () => {
    // The one place in a component where a colour could be written without a hex
    // literal — `style={{ color: theRowColour }}`. The feature presents state
    // through class names and data attributes, so the cascade in the stylesheets
    // is the whole of its colour story and this rule keeps it that way.
    const findings: Finding[] = [];
    const stylePropWithColour =
      /style\s*=\s*\{\{[^}]*\b(?:color|background|backgroundColor|border|borderColor|outline|outlineColor|fill|stroke|boxShadow|caretColor|accentColor)\s*:/g;

    for (const file of modules) {
      for (const offender of matchesOf(readWithoutComments(file), stylePropWithColour)) {
        findings.push({
          file: featureRel(file),
          rule: 'colour set through a style prop',
          offender,
        });
      }
    }

    expect(findings).toEqual([]);
  });

  it('holds no hex literal and no colour function in any other stylesheet (18.9)', () => {
    const findings: Finding[] = [];

    for (const file of componentStylesheets) {
      const css = stripCssComments(readFileSync(file, 'utf8'));
      for (const offender of matchesOf(css, HEX_COLOUR)) {
        findings.push({ file: featureRel(file), rule: 'hex colour literal', offender });
      }
      for (const offender of matchesOf(css, COLOUR_FUNCTION)) {
        findings.push({ file: featureRel(file), rule: 'colour function', offender });
      }
    }

    expect(findings).toEqual([]);
  });

  it('reads every colour it paints from a declared custom property (18.9, 20.11)', () => {
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
    // read. Every surface, every chip, and every control paints at least two.
    expect(inspected).toBeGreaterThan(20);
  });

  it('declares every custom property it reads in styles/squadsTokens.css (18.9)', () => {
    const declared = new Set(declaredCustomProperties(tokenTablePath));
    const findings: Finding[] = [];
    const used = new Set<string>();

    for (const file of stylesheets) {
      for (const token of referencedCustomProperties(file)) {
        used.add(token);
        if (!declared.has(token)) {
          findings.push({
            file: featureRel(file),
            rule: 'reads a custom property the token table does not declare',
            offender: token,
          });
        }
      }
    }

    expect(findings).toEqual([]);
    // Non-vacuity from both ends: the table declares a full scale and two Theme
    // tables, and the stylesheets really do read from it.
    expect(declared.size).toBeGreaterThan(30);
    expect(used.size).toBeGreaterThan(20);
  });

  it('declares its custom properties in the token table and nowhere else (18.9)', () => {
    // A per-component sheet declaring its own token would put a second table in
    // the feature, and the contrast figures recorded beside the first would stop
    // describing what renders.
    const offenders = componentStylesheets
      .flatMap((file) =>
        declaredCustomProperties(file).map((token) => ({
          file: featureRel(file),
          token,
        })),
      )
      .filter(({ token }) => token.startsWith('--'));

    expect(offenders).toEqual([]);
  });

  it('writes a colour per token in both Theme tables, so the rule is not unfireable', () => {
    // The exempted file is the one file that *does* write colours. If the patterns
    // above cannot see them there, they could not see a stray colour anywhere else
    // either, and every prohibition above would be empty.
    const css = stripCssComments(readFileSync(tokenTablePath, 'utf8'));
    const dark = /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(css);
    const light = /\[data-theme='light'\]\s*\{([^}]*)\}/.exec(css);

    expect(dark, 'the dark Theme table is not declared').not.toBeNull();
    expect(light, 'the light Theme table is not declared').not.toBeNull();

    for (const [name, table] of [
      ['dark', dark?.[1] ?? ''],
      ['light', light?.[1] ?? ''],
    ] as const) {
      const colours = matchesOf(table, HEX_COLOUR);
      const tokens = matchesOf(table, /(--[\w-]+)\s*:/g);

      expect(colours.length, `the ${name} table writes no colour`).toBeGreaterThan(20);
      expect(colours).toHaveLength(tokens.length);
    }
  });
});

// --- Rule group 2: one place owns appearance (Requirement 18.8) ---------------

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
    label: 'a pre-paint script injection',
    pattern: /\bdangerouslySetInnerHTML\b|\bcreateElement\s*\(\s*['"]script/g,
    keepsStrings: true,
  },
  {
    label: 'a feature-local restatement of a shared theme constant',
    pattern:
      /\b(?:const|let|var)\s+(?:THEME_ATTRIBUTE|THEME_BOOTSTRAP_SOURCE|APPEARANCE_STORAGE_KEY)\b/g,
    keepsStrings: false,
  },
  {
    label: 'a feature-local appearance store, bootstrap, or resolution declaration',
    // `readAppearance`/`writeAppearance` carry a negative lookahead for `Count`:
    // the squad detail body now reports an **Appearance_Count** per membership —
    // the number of completed matches that player appeared in — and a reader of
    // that tally shares a word with the theme's appearance preference and nothing
    // else. A feature-local appearance *store* is still caught, by the
    // `appearancePreference` and `appearanceStorage` alternatives beside these.
    pattern:
      /\b(?:function|const|let|var|class)\s+\w*(?:resolveTheme|themeFromPreference|themeBootstrap|appearancePreference|appearanceStorage|readAppearance(?!Count)|writeAppearance(?!Count))\w*/gi,
    keepsStrings: false,
  },
  {
    label: 'a key-shaped literal naming appearance or a theme',
    // A storage key or an attribute name: a bare token, no path separator and no
    // whitespace, carrying `theme` or `appearance`. `'../../../theme'` is a module
    // specifier and holds separators, so it is not one; `'data-theme'` and
    // `'pitchmate.appearance'` are.
    pattern: /^[\w.:@-]*(?:theme|appearance)[\w.:@-]*$/i,
    keepsStrings: true,
  },
];

/**
 * The key-shaped literals this rule admits, and why each is not an appearance
 * key.
 *
 * `appearances` is a **wire field name**: the `SquadMemberView` property carrying
 * a membership's completed-match tally, read by `lib/parse/squadDetail.ts`. The
 * name is the contract's, not this feature's choice, and a parser must spell the
 * property it reads. Exempting it by exact token keeps the rule intact for every
 * key that is actually about appearance — `'pitchmate.appearance'` and
 * `'data-theme'` still fire.
 */
const APPEARANCE_LITERAL_EXEMPTIONS: readonly string[] = ['appearances'];

/** The names `src/theme` owns, which the feature may use only by importing them. */
const THEME_OWNED_NAMES = [
  'APPEARANCE_STORAGE_KEY',
  'readAppearancePreference',
  'writeAppearancePreference',
  'interpretStoredPreference',
  'THEME_ATTRIBUTE',
  'THEME_BOOTSTRAP_SOURCE',
  'applyThemeAttribute',
  'resolveTheme',
  'greenTokenForSurface',
  'greenTextToken',
  'Theme',
] as const;

describe('appearance is resolved by src/theme and by nothing in this feature', () => {
  it('reads no storage, evaluates no colour-scheme query, and injects no script (18.8)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      const withStrings = readWithoutComments(file);
      const codeOnly = readCodeOnly(file);

      for (const { label, pattern, keepsStrings } of APPEARANCE_RULES) {
        // The key-shaped literal rule is anchored, so it is applied per literal
        // rather than across a whole file.
        if (pattern.source.startsWith('^')) {
          for (const literal of stringLiterals(file)) {
            if (APPEARANCE_LITERAL_EXEMPTIONS.includes(literal)) {
              continue;
            }

            if (pattern.test(literal)) {
              findings.push({ file: featureRel(file), rule: label, offender: literal });
            }
          }
          continue;
        }

        for (const offender of matchesOf(keepsStrings ? withStrings : codeOnly, pattern)) {
          findings.push({ file: featureRel(file), rule: label, offender });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('imports every theme name it uses from src/theme (Requirement 18.8)', () => {
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

    // The positive half: the appearance store, the pre-paint bootstrap, and the
    // applied Theme all reach this feature from the shared module. The resolution
    // itself is reached *through* the bootstrap source rather than called here,
    // which is why `resolveTheme` is not in this list — the feature renders
    // whatever Theme the frame around it resolved.
    expect([...importedSomewhere].sort()).toEqual(
      expect.arrayContaining([
        'APPEARANCE_STORAGE_KEY',
        'THEME_ATTRIBUTE',
        'THEME_BOOTSTRAP_SOURCE',
        'Theme',
        'applyThemeAttribute',
      ]),
    );
  });

  it('finds all three concerns declared by src/theme rather than here (18.8)', () => {
    // The other side of the rule: the shared module really does own an appearance
    // store, a bootstrap, and a resolution, so "the feature declares none of them"
    // is a division of labour rather than a gap.
    const themeExports = new Set(
      reExports(readFileSync(themeBarrelPath, 'utf8')).flatMap(({ names }) => names),
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

// --- Rule group 3: one place spells the auth contract (Requirement 5.5) ------

/**
 * The value the Auth_Feature binds to `name`, read out of its own source.
 *
 * Read rather than restated, so the literals this scan searches for track the
 * Auth_Feature: renaming its log-in route changes what this rule forbids without
 * anyone editing this file.
 */
function authConstantValue(name: string): string {
  const pattern = new RegExp(`\\bexport\\s+const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`);

  for (const file of collectProductionSources(authRoot)) {
    const match = pattern.exec(readWithoutComments(file));
    if (match !== null) return match[1];
  }

  throw new Error(`the Auth_Feature declares no ${name}`);
}

const SIGN_UP_ROUTE_VALUE = authConstantValue('SIGN_UP_ROUTE');
const LOG_IN_ROUTE_VALUE = authConstantValue('LOG_IN_ROUTE');
const REDIRECT_PARAM_VALUE = authConstantValue('REDIRECT_PARAM_NAME');

/**
 * Is `literal` a feature-local copy of one of the Auth_Feature's three values?
 *
 * A route path counts when it appears as a path segment, so `'/join/:code'` is not
 * one and `'/login?next=x'` is. The parameter name counts when the literal *is*
 * that name or writes it as a query key, so ordinary prose containing the word is
 * not a finding while `'redirect'` and `'?redirect=…'` are.
 */
function copiesAuthConstant(literal: string): string | null {
  for (const route of [SIGN_UP_ROUTE_VALUE, LOG_IN_ROUTE_VALUE]) {
    const segment = new RegExp(`(?:^|[^\\w-])${route}(?![\\w-])`);
    if (segment.test(literal)) return route;
  }

  if (literal === REDIRECT_PARAM_VALUE) return REDIRECT_PARAM_VALUE;
  if (new RegExp(`(?:^|[?&])${REDIRECT_PARAM_VALUE}=`).test(literal)) {
    return REDIRECT_PARAM_VALUE;
  }

  return null;
}

describe('the auth route paths and the redirect parameter are the Auth_Feature s', () => {
  it('reads all three values out of the Auth_Feature source (Requirement 5.5)', () => {
    // Pinned, so a rename on the auth side surfaces here rather than silently
    // widening or narrowing what the rule below forbids.
    expect(SIGN_UP_ROUTE_VALUE).toBe('/signup');
    expect(LOG_IN_ROUTE_VALUE).toBe('/login');
    expect(REDIRECT_PARAM_VALUE).toBe('redirect');
  });

  it('copies none of the three into a literal of this feature (Requirement 5.5)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      for (const literal of stringLiterals(file)) {
        const copied = copiesAuthConstant(literal);
        if (copied !== null) {
          findings.push({
            file: featureRel(file),
            rule: `restates the Auth_Feature's ${copied}`,
            offender: literal,
          });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('imports all three from the Auth_Feature barrel instead (Requirement 5.5)', () => {
    // The positive half. Absence alone would be satisfied by a screen with no
    // handover at all, so the three names must arrive — and arrive at the barrel,
    // not by a deep path into the auth feature.
    const fromAuthBarrel = new Set(
      importClauses(inviteLandingPath)
        .filter(({ specifier }) => {
          const target = resolveWithinSrc(specifier, inviteLandingPath);
          return target !== null && targetsBarrelOf(authRoot, target);
        })
        .flatMap(({ names }) => names),
    );

    for (const name of ['SIGN_UP_ROUTE', 'LOG_IN_ROUTE', 'REDIRECT_PARAM_NAME']) {
      expect(
        fromAuthBarrel,
        `InviteLandingScreen must take ${name} from the Auth_Feature barrel`,
      ).toContain(name);
    }
  });
});

// --- Rule group 4: the deferred membership actions (Requirement 13.8) --------

/** The endpoint path of the one membership action this feature does offer. */
const PROMOTE_PATH = '/squads/{squadId}/members/{membershipId}/promote';

/** The endpoint paths of the four actions Requirement 13.8 defers. */
const DEFERRED_ENDPOINTS = {
  demote: '/squads/{squadId}/members/{membershipId}/demote',
  ownership: '/squads/{squadId}/ownership',
  leave: '/squads/{squadId}/leave',
  removeMember: '/squads/{squadId}/members/{membershipId}',
} as const;

/** One deferred action, as an identifier would spell it. */
interface DeferredActionRule {
  readonly label: string;
  readonly pattern: RegExp;
}

const DEFERRED_ACTION_RULES: readonly DeferredActionRule[] = [
  { label: 'demotion of an admin', pattern: /demot(?:e|es|ed|ing|ion)/gi },
  {
    label: 'transfer of squad ownership',
    pattern: /ownership|transfer[_-]?owner/gi,
  },
  {
    label: 'a membership leaving a squad',
    // Scoped to a squad-or-membership object, so `LEAVE_TIER_UNCHANGED` and the
    // `'leave-unchanged'` Skill_Tier sentinel are not mistaken for it.
    pattern:
      /leav(?:e|es|ing)[_-]?(?:squad|member|membership)|(?:squad|member|membership)[_-]?leav(?:e|es|ing)|\b(?:on|handle)Leave\b/gi,
  },
  {
    label: 'removal of a membership',
    // An identifier, not a call: `controllersRef.current.delete(membershipId)`
    // removes an abort controller from a map, not a person from a squad.
    pattern:
      /(?:remove|removal|delete|deletion|kick|eject)[_A-Za-z]*(?:member|membership)s?\b|\b(?:member|membership)s?[_A-Za-z]*(?:remove|removal|delete|deletion)\b/gi,
  },
];

describe('the feature names none of the deferred membership actions', () => {
  it('names no deferred endpoint path (Requirement 13.8)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      for (const literal of stringLiterals(file)) {
        for (const [action, path] of Object.entries(DEFERRED_ENDPOINTS)) {
          // The member path is the removal target, and it is a prefix of the
          // promotion path — so the promotion path is not a finding and a bare
          // member path is.
          const names =
            action === 'removeMember'
              ? literal === path
              : literal.includes(path);
          if (names) {
            findings.push({
              file: featureRel(file),
              rule: `names the ${action} endpoint`,
              offender: literal,
            });
          }
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('names no demote, ownership, leave, or member-removal identifier (13.8)', () => {
    const findings: Finding[] = [];

    for (const file of modules) {
      const code = readCodeOnly(file);
      for (const { label, pattern } of DEFERRED_ACTION_RULES) {
        for (const offender of matchesOf(code, pattern)) {
          findings.push({ file: featureRel(file), rule: label, offender });
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('does name the promotion endpoint, so the four absences are a choice (13.8)', () => {
    // Non-vacuity from inside the feature: the facade spells a membership action's
    // path as a literal, which is the form the rule above searches for. An empty
    // finding list therefore means the four are absent rather than that literals
    // went unread.
    expect(stringLiterals(facadePath)).toContain(PROMOTE_PATH);
  });

  it('defers four operations the backend actually offers (Requirement 13.8)', () => {
    // Non-vacuity from outside: all four are available on the generated contract,
    // so "the feature references none of them" is a scope decision rather than a
    // statement about endpoints that do not exist.
    const schema = readFileSync(generatedSchemaPath, 'utf8');

    for (const path of Object.values(DEFERRED_ENDPOINTS)) {
      expect(schema, `the backend must offer ${path}`).toContain(`"${path}"`);
    }
    expect(schema).toContain(`"${PROMOTE_PATH}"`);
  });
});

// --- The patterns fire, and hold off the near-misses -------------------------

describe('the scan patterns fire on an offender and hold off a near-miss', () => {
  it('catches every colour a stylesheet could write for itself', () => {
    expect(selfWrittenColours('#5bbf36')).toEqual(['#5bbf36']);
    expect(selfWrittenColours('white')).toEqual(['white']);
    expect(selfWrittenColours('rgb(20 20 20 / 50%)')).toEqual(['rgb']);
    expect(selfWrittenColours('1px solid red')).toEqual(['red']);
    expect(matchesOf('color: #FFF;', HEX_COLOUR)).toEqual(['#FFF']);
    expect(matchesOf('background: rgba(0,0,0,.5)', COLOUR_FUNCTION)).not.toEqual([]);
  });

  it('holds off the colourless values this feature legitimately writes', () => {
    expect(selfWrittenColours('var(--squads-card-surface)')).toEqual([]);
    expect(selfWrittenColours('var(--squads-border-width) solid var(--control-border)')).toEqual(
      [],
    );
    expect(selfWrittenColours('inherit')).toEqual([]);
    expect(selfWrittenColours('none')).toEqual([]);
    expect(selfWrittenColours('0')).toEqual([]);
    expect(selfWrittenColours('currentColor')).toEqual([]);
    // A fragment identifier and a CSS length are not colours.
    expect(matchesOf('const anchor = "#main";', HEX_COLOUR)).toEqual([]);
    expect(matchesOf('border-width: 2px;', HEX_COLOUR)).toEqual([]);
  });

  it('catches a feature-local appearance store, bootstrap, or resolution', () => {
    const offenders = [
      'const stored = localStorage.getItem(key);',
      'const prefersLight = window.matchMedia("(prefers-color-scheme: light)");',
      'function resolveThemeLocally(preference) { return "dark"; }',
      'const THEME_ATTRIBUTE = "data-theme";',
    ];

    for (const offender of offenders) {
      const fired = APPEARANCE_RULES.filter(
        ({ pattern }) => !pattern.source.startsWith('^') && matchesOf(offender, pattern).length > 0,
      );
      expect(fired.length, offender).toBeGreaterThan(0);
    }

    const literalRule = APPEARANCE_RULES.find(({ pattern }) =>
      pattern.source.startsWith('^'),
    );
    expect(literalRule).toBeDefined();
    expect(literalRule?.pattern.test('pitchmate.appearance')).toBe(true);
    expect(literalRule?.pattern.test('data-theme')).toBe(true);
    // A module specifier carries path separators, so it is not a key.
    expect(literalRule?.pattern.test('../../../theme')).toBe(false);
    // A Theme *value* is not an appearance key.
    expect(literalRule?.pattern.test('dark')).toBe(false);
  });

  it('catches a copied auth route path or redirect parameter', () => {
    expect(copiesAuthConstant('/login')).toBe('/login');
    expect(copiesAuthConstant('/signup?next=%2Fapp')).toBe('/signup');
    expect(copiesAuthConstant('redirect')).toBe('redirect');
    expect(copiesAuthConstant('?redirect=%2Fjoin%2Fabc')).toBe('redirect');
  });

  it('holds off the paths and the prose this feature legitimately writes', () => {
    expect(copiesAuthConstant('/join/:code')).toBeNull();
    expect(copiesAuthConstant('/app/squads/:squadId')).toBeNull();
    expect(copiesAuthConstant('/loginish')).toBeNull();
    // The word inside a sentence is not a copy of the parameter name.
    expect(
      copiesAuthConstant('Sign in or create an account before redirecting.'),
    ).toBeNull();
  });

  it('catches each deferred membership action it claims to catch', () => {
    const offenders = [
      'const onDemote = () => api.demoteAdmin(squadId, membershipId);',
      'await api.transferOwnership(squadId, membershipId);',
      'const leaveSquad = () => api.leaveSquad(squadId);',
      'const removeMember = () => api.removeMembership(squadId, membershipId);',
    ];

    for (const offender of offenders) {
      const fired = DEFERRED_ACTION_RULES.filter(
        ({ pattern }) => matchesOf(offender, pattern).length > 0,
      );
      expect(fired.length, offender).toBeGreaterThan(0);
    }
  });

  it('holds off the near-misses this feature really contains', () => {
    const nearMisses = [
      // `lib/skillTier.ts`: a Guest_Form tier sentinel, not a membership leaving.
      'export const LEAVE_TIER_UNCHANGED = "leave-unchanged";',
      // `lib/parse/createdSquad.ts`: the created squad's owner membership.
      'const ownerMembershipId = body.ownerMembershipId;',
      // `state/usePromotion.ts`: an abort controller leaving a map.
      'controllersRef.current.delete(membershipId);',
      // `api/squadsApi.ts`: the leaderboard, which shares no verb with leaving.
      'const LEADERBOARD_PATH = "/squads/{squadId}/leaderboard";',
      // `lib/promotionEligibility.ts`: the action that *is* offered.
      'export function isPromotable(member, caller) { return true; }',
    ];

    for (const nearMiss of nearMisses) {
      for (const { label, pattern } of DEFERRED_ACTION_RULES) {
        expect(matchesOf(nearMiss, pattern), `${label} on: ${nearMiss}`).toEqual([]);
      }
    }
  });
});
