/**
 * Structural source scan: the App_Shell's pure logic isolation and its
 * property-test coverage (task 16.2).
 *
 * Requirement 15.8 makes this file part of the product, not a courtesy check.
 * The rules it enforces are stated as prohibitions and as universals — "import
 * neither React, nor a DOM global or a DOM type, nor `@pitchmate/api-client`",
 * "every pure function covered by property tests at no fewer than 100
 * iterations", "the single implementation the components call at run time,
 * rather than a copy declared within a test file" — and neither a prohibition
 * nor a universal over a directory can be demonstrated by an example. So the
 * source tree is read and classified, in the same form as the Auth_Feature's
 * `lib/frameworkFree.structural.test.ts`, and a violation fails the web test
 * suite rather than waiting for review (Requirements 14.16, 15.5, 15.8).
 *
 * ### The four invariants
 *
 * 1. **Nothing from React** (Requirements 14.16, 15.5). No module under
 *    `features/app-shell/lib/` imports `react`, `react-dom`, or any sub-path of
 *    either, by `import`, dynamic `import()`, or `require`.
 * 2. **Nothing from the DOM** (Requirements 14.16, 15.5). No such module
 *    references a DOM/BOM global (`window`, `document`, `localStorage`, …) or a
 *    DOM type (`HTMLElement`, `Event`, `Node`, …), so every one of them is
 *    testable without a browser.
 * 3. **Nothing from the transport** (Requirements 14.16, 15.5). No such module
 *    imports `@pitchmate/api-client` or any sub-path of it, so the pure logic is
 *    verifiable without a transport. This is the criterion `lib/destinations.ts`
 *    carries the *value* of `DEFAULT_AUTHENTICATED_ROUTE` for rather than
 *    importing it: the Auth_Feature barrel transitively carries the client.
 * 4. **A property test beside every module, at 100 iterations or more**
 *    (Requirements 14.1, 14.2). Every production module under `lib/` has an
 *    adjacent `<module>.property.test.ts`; every `fc.assert` in every one of
 *    those files states its own `numRuns` and states it at 100 or above; and
 *    each property test imports the module it sits beside rather than declaring
 *    its own copy of the logic. Alongside that directory-wide rule, the twelve
 *    pure functions Requirement 14.1 names are checked one by one: each is
 *    reachable from exactly one module under `lib/`, and exactly one module in
 *    the whole of `apps/web/src` declares it — so no second implementation and
 *    no test-local copy can exist.
 *
 * ### Why the scan reads text rather than following imports
 *
 * Invariants 1 to 3 are asserted against each module's own source, not against
 * its transitive closure, because that is what the criteria say — "have each of
 * those modules import neither React, nor a DOM global or a DOM type, nor
 * `@pitchmate/api-client`" — and because a transitive rule would contradict the
 * design. `lib/theme.ts` is a deliberate re-export of the one shared theme
 * module in `src/theme/`: Requirement 14.16 wants Theme resolution reachable
 * under `lib/`, Requirement 15.7 wants the single declaration to live *outside*
 * the feature, and the re-export satisfies both. That shared module also holds
 * the Appearance_Preference storage access and the pre-paint bootstrap source,
 * which necessarily touch the DOM — so following imports would fail a file the
 * design deliberately created. The pure functions re-exported *through*
 * `lib/theme.ts` (`resolveTheme`, `interpretStoredPreference`,
 * `greenTokenForSurface`) are themselves React-free and DOM-free, and their
 * property tests sit under `lib/` as Requirement 14.2 asks.
 *
 * Comments and string/template literals are stripped before matching — through
 * the same small state machine the Auth_Feature's scan uses — so the words
 * "React", "window", and "document" in these modules' extensive docblocks (they
 * repeatedly promise to touch none of them) never produce a false positive.
 * Import specifiers live in string literals, so import detection runs against a
 * comments-only-stripped copy that keeps those specifiers while still discarding
 * import-shaped text hiding in a comment.
 *
 * Requirements: 14.1, 14.2, 14.16, 15.5, 15.8
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// --- Roots -------------------------------------------------------------------

/** This file sits at the App_Shell feature root. */
const shellRoot = dirname(fileURLToPath(import.meta.url));
/** The pure logic directory this scan guards (Requirements 14.16, 15.5). */
const libDir = join(shellRoot, 'lib');
/** `src/features/app-shell` -> `src`. */
const srcRoot = resolve(shellRoot, '..', '..');
/** The one shared theme module `lib/theme.ts` re-exports (Requirement 15.7). */
const sharedThemeDir = join(srcRoot, 'theme');

// --- File classification -----------------------------------------------------

/** True for a test file: excluded from every production scan below. */
function isTestFile(fileName: string): boolean {
  return (
    /\.test\.tsx?$/.test(fileName) ||
    /\.pbt\.test\.tsx?$/.test(fileName) ||
    /\.property\.test\.tsx?$/.test(fileName) ||
    /\.spec\.tsx?$/.test(fileName)
  );
}

/** True for a property-based test file. */
function isPropertyTestFile(fileName: string): boolean {
  return /\.property\.test\.tsx?$/.test(fileName);
}

/** True for a TypeScript source file worth scanning. */
function isTypeScriptSource(fileName: string): boolean {
  return /\.tsx?$/.test(fileName);
}

/** Recursively collect the production `.ts`/`.tsx` files under `dir`. */
function collectProductionSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectProductionSources(full));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!isTypeScriptSource(entry.name) || isTestFile(entry.name)) {
      continue;
    }
    found.push(full);
  }
  return found;
}

/** Recursively collect the property-test files under `dir`. */
function collectPropertyTests(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectPropertyTests(full));
      continue;
    }
    if (entry.isFile() && isPropertyTestFile(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// --- Source stripping --------------------------------------------------------

/**
 * Remove `//` and block comments, keeping string literals verbatim so import
 * specifiers survive for the import patterns to match.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        out += source[i];
        if (source[i] === '\\') {
          if (i + 1 < n) out += source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/**
 * Remove comments *and* string/template literal contents, leaving only live,
 * non-string code. Template *expressions* (`${ … }`) are kept, so a global
 * hidden inside an interpolation is still visible to the scan.
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += ' ';
      continue;
    }

    if (c === '`') {
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '`') {
          i += 1;
          break;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            if (depth > 0) out += source[i];
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      out += ' ';
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

// --- Forbidden imports and references ---------------------------------------

/**
 * An import of React in any form: `import … from 'react'`, `import 'react-dom/client'`,
 * `require('react')`, `await import('react/jsx-runtime')`.
 */
const REACT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]react(?:-dom)?(?:\/[^'"]*)?['"]/;

/** An import of the generated typed client, root specifier or any sub-path. */
const API_CLIENT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/;

/**
 * DOM/BOM globals and DOM types that would couple a pure module to a browser.
 * Matched with word boundaries against fully-stripped code, so the ECMAScript
 * globals the logic legitimately uses (`Error`, `Number`, `Date`, `JSON`,
 * `Intl`, …) are never mistaken for DOM APIs.
 */
const DOM_REFERENCE_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'window', pattern: /\bwindow\b/ },
  { label: 'document', pattern: /\bdocument\b/ },
  { label: 'navigator', pattern: /\bnavigator\b/ },
  { label: 'localStorage', pattern: /\blocalStorage\b/ },
  { label: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { label: 'history', pattern: /\bhistory\b/ },
  { label: 'location', pattern: /\blocation\b/ },
  { label: 'matchMedia', pattern: /\bmatchMedia\b/ },
  { label: 'fetch', pattern: /\bfetch\b/ },
  { label: 'HTML*Element type', pattern: /\bHTML[A-Za-z]*Element\b/ },
  { label: 'Element type', pattern: /\bElement\b/ },
  { label: 'Node type', pattern: /\bNode\b/ },
  { label: 'Document type', pattern: /\bDocument\b/ },
  { label: 'Window type', pattern: /\bWindow\b/ },
  { label: 'Event type', pattern: /\b(?:Mouse|Keyboard|Pointer|Focus|Input|Touch)?Event\b/ },
  { label: 'EventTarget', pattern: /\bEventTarget\b/ },
  { label: 'NodeList', pattern: /\bNodeList\b/ },
  { label: 'DOMParser', pattern: /\bDOMParser\b/ },
  { label: 'MediaQueryList', pattern: /\bMediaQueryList[A-Za-z]*\b/ },
  { label: 'Storage type', pattern: /\bStorage\b/ },
];

// --- The pure functions Requirement 14.1 names ------------------------------

/**
 * Each pure function Requirement 14.1 names, the `lib/` module through which the
 * shell reaches it, and the module that *declares* it.
 *
 * The declaring module is `lib/<module>` for all but Theme resolution and
 * Appearance_Preference interpretation: those two live in the one shared theme
 * module Requirement 15.7 puts outside the feature, and `lib/theme.ts`
 * re-exports them so Requirement 14.16 is satisfied too.
 */
const NAMED_PURE_FUNCTIONS: ReadonlyArray<{
  /** The behaviour as Requirement 14.1 words it. */
  readonly criterion: string;
  /** The exported identifier. */
  readonly exportName: string;
  /** The `lib/` module through which the shell reaches it. */
  readonly libModule: string;
  /** Path of the declaring module, relative to `apps/web/src`. */
  readonly declaredIn: string;
}> = [
  {
    criterion: 'notification response parsing',
    exportName: 'parseNotificationList',
    libModule: 'notificationParsing.ts',
    declaredIn: 'features/app-shell/lib/notificationParsing.ts',
  },
  {
    criterion: 'notification printing',
    exportName: 'printNotificationRecord',
    libModule: 'notificationParsing.ts',
    declaredIn: 'features/app-shell/lib/notificationParsing.ts',
  },
  {
    criterion: 'the non-negative integer parser (10.9)',
    exportName: 'parseNonNegativeInteger',
    libModule: 'countParsing.ts',
    declaredIn: 'features/app-shell/lib/countParsing.ts',
  },
  {
    criterion: 'Unread_Badge formatting',
    exportName: 'unreadBadgeText',
    libModule: 'unreadBadge.ts',
    declaredIn: 'features/app-shell/lib/unreadBadge.ts',
  },
  {
    criterion: 'relative time labelling',
    exportName: 'relativeTimeLabel',
    libModule: 'relativeTime.ts',
    declaredIn: 'features/app-shell/lib/relativeTime.ts',
  },
  {
    criterion: 'Notification_List ordering',
    exportName: 'orderNotifications',
    libModule: 'notificationOrdering.ts',
    declaredIn: 'features/app-shell/lib/notificationOrdering.ts',
  },
  {
    criterion: 'Read_State transition application (mark read)',
    exportName: 'applyMarkRead',
    libModule: 'readStateTransitions.ts',
    declaredIn: 'features/app-shell/lib/readStateTransitions.ts',
  },
  {
    criterion: 'Read_State transition application (mark all read)',
    exportName: 'applyMarkAllRead',
    libModule: 'readStateTransitions.ts',
    declaredIn: 'features/app-shell/lib/readStateTransitions.ts',
  },
  {
    criterion: 'Poll_Interval clamping',
    exportName: 'effectivePollIntervalSeconds',
    libModule: 'pollInterval.ts',
    declaredIn: 'features/app-shell/lib/pollInterval.ts',
  },
  {
    criterion: 'notification outcome mapping',
    exportName: 'mapCallOutcome',
    libModule: 'outcomeMapping.ts',
    declaredIn: 'features/app-shell/lib/outcomeMapping.ts',
  },
  {
    criterion: 'requested-path-to-Destination route resolution',
    exportName: 'resolveDestination',
    libModule: 'routeResolution.ts',
    declaredIn: 'features/app-shell/lib/routeResolution.ts',
  },
  {
    criterion: 'Theme resolution from the Appearance_Preference',
    exportName: 'resolveTheme',
    libModule: 'theme.ts',
    declaredIn: 'theme/themeResolution.ts',
  },
  {
    criterion: 'Appearance_Preference reading',
    exportName: 'interpretStoredPreference',
    libModule: 'theme.ts',
    declaredIn: 'theme/themeResolution.ts',
  },
];

/** The 100-iteration floor Requirement 14.2 sets. */
const MINIMUM_PROPERTY_RUNS = 100;

// --- Collected sources -------------------------------------------------------

const libModules = collectProductionSources(libDir);
const libPropertyTests = collectPropertyTests(libDir);
const allProductionSources = collectProductionSources(srcRoot);

/** Path relative to `lib/`, in forward-slash form, for assertion messages. */
function libRel(path: string): string {
  return relative(libDir, path).replace(/\\/g, '/');
}

/** Path relative to `apps/web/src`, in forward-slash form. */
function srcRel(path: string): string {
  return relative(srcRoot, path).replace(/\\/g, '/');
}

/** Read a file with its comments removed, keeping string literals. */
function readWithoutComments(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

/** Read a file with its comments *and* string contents removed. */
function readCodeOnly(path: string): string {
  return stripCommentsAndStrings(readFileSync(path, 'utf8'));
}

// --- `fc.assert` iteration counts -------------------------------------------

/**
 * The source slice of every `fc.assert( … )` call in `code`, found by walking
 * balanced parentheses. `code` must already have its strings stripped, so no
 * parenthesis inside a literal can unbalance the walk.
 */
function fcAssertCalls(code: string): string[] {
  const calls: string[] = [];
  const opener = /\bfc\s*\.\s*assert\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(code)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') depth -= 1;
      i += 1;
    }
    calls.push(code.slice(match.index, i));
  }

  return calls;
}

/**
 * Resolve the iteration counts a single `fc.assert` call configures.
 *
 * A numeric literal is taken as written; an identifier is resolved against a
 * `const NAME = <number>` in the same file, so a shared floor constant is
 * honoured rather than reported as unreadable. Anything else is reported as
 * `null` — the scan cannot see through it, and an unreadable count is exactly
 * the drift Requirement 14.2 is guarding against.
 *
 * Per-call parameters override any `fc.configureGlobal` default, so a call that
 * states its own `numRuns` cannot be lowered from elsewhere. That is why the
 * scan insists every call state one rather than trusting a global.
 */
function configuredRuns(call: string, fileCode: string): Array<number | null> {
  const found: Array<number | null> = [];
  const pattern = /\bnumRuns\s*:\s*([A-Za-z_$][\w$]*|[\d_]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(call)) !== null) {
    const token = match[1];
    if (/^[\d_]+$/.test(token)) {
      found.push(Number(token.replace(/_/g, '')));
      continue;
    }

    const constant = new RegExp(
      `\\bconst\\s+${token}\\s*(?::[^=]+)?=\\s*([\\d_]+)`,
    ).exec(fileCode);
    found.push(constant === null ? null : Number(constant[1].replace(/_/g, '')));
  }

  return found;
}

// --- Invariant 0: the scan sees something ------------------------------------

describe('the pure logic scan sees the App_Shell lib directory', () => {
  it('collects production modules and property tests, and no test file as a module', () => {
    // A vacuous scan would pass every invariant below, so it is ruled out first.
    expect(libModules.length).toBeGreaterThan(0);
    expect(libPropertyTests.length).toBeGreaterThan(0);
    expect(libModules.map(libRel).some(isTestFile)).toBe(false);
  });

  it('finds a lib module for every pure function Requirement 14.1 names', () => {
    const names = new Set(libModules.map(libRel));

    for (const { criterion, libModule } of NAMED_PURE_FUNCTIONS) {
      expect(names, `${criterion} has no module ${libModule}`).toContain(libModule);
    }
  });
});

// --- Invariants 1 to 3: React-free, DOM-free, transport-free -----------------

describe('every App_Shell lib module is free of React, the DOM, and the transport', () => {
  it('imports nothing from React (Requirements 14.16, 15.5)', () => {
    const offenders = libModules
      .filter((file) => REACT_IMPORT_PATTERN.test(readWithoutComments(file)))
      .map(libRel);

    expect(offenders).toEqual([]);
  });

  it('imports nothing from @pitchmate/api-client (Requirements 14.16, 15.5)', () => {
    const offenders = libModules
      .filter((file) => API_CLIENT_IMPORT_PATTERN.test(readWithoutComments(file)))
      .map(libRel);

    expect(offenders).toEqual([]);
  });

  it('references no DOM global and no DOM type (Requirements 14.16, 15.5)', () => {
    const offenders: Array<{ module: string; reference: string }> = [];

    for (const file of libModules) {
      const code = readCodeOnly(file);
      for (const { label, pattern } of DOM_REFERENCE_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ module: libRel(file), reference: label });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('resolves every relative import inside lib/, save the one shared theme module', () => {
    // The purity above is stated of each module's own source, so it would be
    // hollow if a lib module could pull in a React- or transport-carrying module
    // by a relative path. Every relative specifier must therefore land inside
    // `lib/` — or on `src/theme`, the single shared module Requirement 15.7 puts
    // outside the feature and `lib/theme.ts` re-exports (Requirement 14.16).
    const offenders: Array<{ module: string; specifier: string }> = [];
    const specifierPattern =
      /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;

    for (const file of libModules) {
      const code = readWithoutComments(file);
      let match: RegExpExecArray | null;
      specifierPattern.lastIndex = 0;

      while ((match = specifierPattern.exec(code)) !== null) {
        const target = resolve(dirname(file), match[1]);
        const insideLib = !relative(libDir, target).startsWith('..');
        const isSharedTheme =
          target === sharedThemeDir ||
          !relative(sharedThemeDir, target).startsWith('..');

        if (!insideLib && !isSharedTheme) {
          offenders.push({ module: libRel(file), specifier: match[1] });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

// --- Invariant 4: property tests beside every module, at 100 runs or more ----

describe('every App_Shell lib module has an adjacent property test', () => {
  it('finds <module>.property.test.ts beside every production module (Req 14.2)', () => {
    const testNames = new Set(libPropertyTests.map(libRel));

    const uncovered = libModules
      .map(libRel)
      .filter((module) => {
        const base = module.replace(/\.tsx?$/, '');
        return (
          !testNames.has(`${base}.property.test.ts`) &&
          !testNames.has(`${base}.property.test.tsx`)
        );
      });

    expect(uncovered).toEqual([]);
  });

  it('places every lib property test in lib/, beside the logic it exercises (Req 14.2)', () => {
    // The files are collected from `lib/` itself, so the assertion that matters
    // is the converse: no property test for one of the named pure functions sits
    // anywhere else in the shell. A test placed beside a *component* rather than
    // beside the module would satisfy the check above only by accident.
    const shellPropertyTests = collectPropertyTests(shellRoot).map((file) =>
      relative(shellRoot, file).replace(/\\/g, '/'),
    );

    const namedModuleTests = new Set(
      NAMED_PURE_FUNCTIONS.map(
        ({ libModule }) => `lib/${libModule.replace(/\.tsx?$/, '')}.property.test.ts`,
      ),
    );

    for (const expectedTest of namedModuleTests) {
      expect(shellPropertyTests, `${expectedTest} is missing`).toContain(expectedTest);
    }
  });

  it('imports the adjacent module rather than declaring a copy (Req 14.1)', () => {
    const offenders: string[] = [];

    for (const test of libPropertyTests) {
      const base = libRel(test).replace(/\.property\.test\.tsx?$/, '');
      const code = readWithoutComments(test);
      const importsAdjacent = new RegExp(
        `(?:\\bfrom\\s*|\\bimport\\s*)['"]\\./${base}['"]`,
      ).test(code);
      // A property test whose adjacent module does not exist — the
      // Appearance_Preference and pre-paint bootstrap tests, whose subjects are
      // re-exported through `lib/theme.ts` — must still reach its subject
      // through a module under `lib/`, never through a local copy.
      const importsLibTheme = /(?:\bfrom\s*|\bimport\s*)['"]\.\/theme['"]/.test(code);

      if (!importsAdjacent && !importsLibTheme) {
        offenders.push(libRel(test));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('configures every fc.assert at 100 iterations or more (Req 14.2)', () => {
    const offenders: Array<{ test: string; runs: number | null }> = [];
    let assertions = 0;

    for (const test of libPropertyTests) {
      const code = readCodeOnly(test);
      const calls = fcAssertCalls(code);

      // A property test file with no `fc.assert` is not a property test.
      expect(calls.length, `${libRel(test)} runs no fc.assert`).toBeGreaterThan(0);

      for (const call of calls) {
        assertions += 1;
        const runs = configuredRuns(call, code);

        if (runs.length === 0) {
          offenders.push({ test: libRel(test), runs: null });
          continue;
        }

        for (const value of runs) {
          if (value === null || value < MINIMUM_PROPERTY_RUNS) {
            offenders.push({ test: libRel(test), runs: value });
          }
        }
      }
    }

    expect(offenders).toEqual([]);
    // Non-vacuity: the floor above means nothing if no call was inspected.
    expect(assertions).toBeGreaterThan(libModules.length);
  });
});

// --- Invariant 4 (continued): one implementation, and only one --------------

describe('each pure function Requirement 14.1 names has exactly one implementation', () => {
  it('is declared by exactly one module under apps/web/src (Req 14.1)', () => {
    const offenders: Array<{
      exportName: string;
      expected: string;
      declaredBy: string[];
    }> = [];

    for (const { exportName, declaredIn } of NAMED_PURE_FUNCTIONS) {
      const declaringFiles = allProductionSources
        .filter((file) => {
          const code = readCodeOnly(file);
          return (
            new RegExp(
              `(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${exportName}\\b`,
            ).test(code) ||
            new RegExp(
              `(?:^|\\n)\\s*(?:export\\s+)?const\\s+${exportName}\\s*(?::|=)`,
            ).test(code)
          );
        })
        .map(srcRel);

      if (declaringFiles.length !== 1 || declaringFiles[0] !== declaredIn) {
        offenders.push({ exportName, expected: declaredIn, declaredBy: declaringFiles });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is reachable from its lib module, declared there or re-exported (Req 14.16)', () => {
    const offenders: Array<{ exportName: string; libModule: string }> = [];

    for (const { exportName, libModule } of NAMED_PURE_FUNCTIONS) {
      const code = readWithoutComments(join(libDir, libModule));
      // Either declared in the module, or named in one of its `export { … }`
      // lists — which is how `lib/theme.ts` carries the two theme functions
      // whose single declaration Requirement 15.7 keeps in `src/theme/`.
      const declared = new RegExp(
        `(?:^|\\n)\\s*export\\s+(?:async\\s+)?(?:function|const)\\s+${exportName}\\b`,
      ).test(code);
      const reExported = new RegExp(
        `\\bexport\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}\\s*from`,
      ).test(code);

      if (!declared && !reExported) {
        offenders.push({ exportName, libModule });
      }
    }

    expect(offenders).toEqual([]);
  });
});
