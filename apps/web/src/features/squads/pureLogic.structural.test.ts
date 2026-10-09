/**
 * Structural source scan: the Squads_Feature's pure-logic isolation and its
 * property-test coverage (task 17.2).
 *
 * Requirement 20.11 makes this file part of the product rather than a courtesy
 * check. The rules it enforces are stated as prohibitions and as universals —
 * "the Response_Parser and the Enum_Code_Map ... SHALL import neither React nor
 * any DOM interface" (16.10), "place every module that imports neither React nor
 * any DOM interface in the feature's pure logic directory ... verified by a
 * structural source scan over the feature's files" (18.2), "cover each of its
 * pure logic modules with a property-based test executing at least 100 generated
 * cases" (20.1) — and neither a prohibition nor a universal over a directory can
 * be demonstrated by an example. So the source tree is read and classified,
 * following the mechanism `features/app-shell/pureLogic.structural.test.ts`
 * established and `structural/sourceScan.ts` declares once: read each file's
 * text, strip comments and string literals through the same small state machine,
 * and fail naming the offending file and specifier.
 *
 * ### The five invariants
 *
 * 1. **Nothing from React** (Requirements 16.10, 18.2). No module under
 *    `lib/` imports `react`, `react-dom`, or any sub-path of either, by
 *    `import`, dynamic `import()`, or `require`.
 * 2. **Nothing from the DOM** (Requirements 16.10, 18.2). No such module
 *    references a DOM/BOM global (`window`, `document`, `localStorage`, …) or a
 *    DOM type (`HTMLElement`, `Event`, `Node`, …), so every one of them is
 *    testable without a browser — which is the reason Requirement 16.10 gives
 *    for the rule.
 * 3. **Nothing from the transport, bar one type-only import** (Requirements
 *    16.10, 18.3, 12.2). No module under `lib/` imports `@pitchmate/api-client`
 *    or any sub-path of it, with exactly one admitted exception:
 *    {@link WIRE_ENUMS_MODULE}, which aliases the Generated_Enum_Unions and is
 *    required by `api-response-contracts` Requirement 12.2 to express them as
 *    `components['schemas'][…]` rather than as a hand-written list. Its import
 *    is asserted to be **type-only**, which is what preserves the property this
 *    rule protects: a type-only import is erased at compile time, so the emitted
 *    module imports nothing, constructs nothing, and is still testable with no
 *    transport present. Every other module — the parsers, the ordering, rating,
 *    authority, and validation functions — reads nothing from the client, and
 *    the generated request-body types the feature uses are still named by
 *    `api/squadsApi.ts` and by the state hooks that build a command.
 * 4. **Purity is not smuggled in by a relative path.** Invariants 1 to 3 are
 *    asserted against each module's *own* source, which is what the criteria
 *    say. That would be hollow if a `lib/` module could reach a React- or
 *    transport-carrying module by a relative specifier, so every specifier of
 *    every `lib/` module must resolve inside `lib/`. Unlike the App_Shell, this
 *    feature's pure logic re-exports nothing from `src/theme`, so there is no
 *    admitted exception: `lib/` is closed under import.
 * 5. **A property test beside every module, at 100 iterations or more**
 *    (Requirement 20.1). Every production module under `lib/` has an adjacent
 *    `<module>.property.test.ts`; every property test under `lib/` reaches its
 *    subject by importing a module under `lib/` rather than declaring its own
 *    copy of the logic; and every `fc.assert` in every one of those files states
 *    its own `numRuns` and states it at 100 or above.
 *
 * ### Why the adjacency rule runs one way
 *
 * Every module needs a test beside it; a test does not need a module beside it.
 * Four of this directory's property tests are named for the *property* they
 * carry rather than for a module — `anonymisedPlaceholder`, `displayRatingFormat`
 * (Properties 17 and 20, whose subjects live in `playerList.ts` and
 * `ratingPresentation.ts`), and `parse/roundTrip`, `parse/tolerance` (Properties
 * 36 and 38, which range over every parser at once). Requiring a module beside
 * each of those would force the properties to be renamed after the modules,
 * losing the correspondence to the design's numbering. Invariant 5's second
 * clause is what keeps the looser direction safe: each of those files must still
 * import the `lib/` module it exercises, so none of them can be testing a
 * private copy of the logic.
 *
 * ### `URL` is not a DOM interface
 *
 * `lib/inviteSecret.ts` calls `new URL(candidate)` to decide whether a pasted
 * value is an invite link or a bare Invite_Code. `URL` belongs to the URL
 * Standard and is a global of Node as much as of the browser, so it is not one
 * of the DOM interfaces Requirement 16.10 forbids, and the module is testable
 * without a browser exactly as the criterion demands. The DOM patterns below
 * therefore do not name it — while `window.location`, `document`, and the rest
 * of the browser-only surface remain forbidden, so a `location.href` read cannot
 * hide behind that allowance.
 *
 * Comments and string/template literals are stripped before matching, because
 * these modules' docblocks discuss at length the very things they must not do
 * (`identifiers.ts` promises in prose that it is "React-free, DOM-free, and free
 * of `@pitchmate/api-client`"), and a scan that matched prose would flag the
 * documentation promising compliance. Import specifiers *are* string literals,
 * so import detection reads a comments-only-stripped copy that keeps them while
 * still discarding import-shaped text hiding in a comment.
 *
 * Requirements: 16.10, 18.2, 20.1, 20.11
 */

import { join, relative, resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MINIMUM_PROPERTY_RUNS,
  collectProductionSources,
  collectPropertyTests,
  configuredRuns,
  fcAssertCalls,
  isTestFile,
  norm,
  readCodeOnly,
  readWithoutComments,
  relTo,
  squadsRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The pure logic directory Requirements 16.10 and 18.2 govern. */
const libRoot = join(squadsRoot, 'lib');

/** Every production module under `lib/`, `lib/parse/` included. */
const libModules = collectProductionSources(libRoot);

/** Every property test sitting under `lib/`. */
const libPropertyTests = collectPropertyTests(libRoot);

/**
 * The one module admitted to invariant 3: the wire enum unions.
 *
 * `api-response-contracts` Requirement 12.2 has each named enum union expressed
 * as an alias over the corresponding Generated_Enum_Union, and Requirement 12.3
 * has that alias checked against the generated vocabulary at compile time. Both
 * are statements about `components['schemas']`, which only the generated package
 * declares — so this module must name it, and the alternative (a hand-written
 * list of names in `lib/` plus the check somewhere outside it) is the very
 * duplication the requirement removes.
 *
 * The exception is narrow in three ways, each asserted below: it is this one
 * path, the import is type-only, and the module is still closed under invariants
 * 1, 2, 4 and 5 like every other.
 */
const WIRE_ENUMS_MODULE = 'wireEnums.ts';

/** Path relative to `lib/`, in forward-slash form, for a failure message. */
function libRel(path: string): string {
  return relTo(libRoot, path);
}

// --- Forbidden imports and references ----------------------------------------

/**
 * An import of React in any form: `import … from 'react'`,
 * `import 'react-dom/client'`, `require('react')`,
 * `await import('react/jsx-runtime')`.
 */
const REACT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]react(?:-dom)?(?:\/[^'"]*)?['"]/;

/** An import of the generated typed client, root specifier or any sub-path. */
const API_CLIENT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/;

/**
 * DOM/BOM globals and DOM types that would couple a pure module to a browser.
 * Matched with word boundaries against fully stripped code, so the ECMAScript
 * and URL-Standard globals the logic legitimately uses (`Error`, `Number`,
 * `Date`, `JSON`, `URL`, `decodeURIComponent`, …) are never mistaken for DOM
 * interfaces, while a lower-case local named `element` is not mistaken for the
 * `Element` type either.
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
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bWebSocket\b/ },
  { label: 'HTML*Element type', pattern: /\bHTML[A-Za-z]*Element\b/ },
  { label: 'Element type', pattern: /\bElement\b/ },
  { label: 'Node type', pattern: /\bNode\b/ },
  { label: 'Document type', pattern: /\bDocument\b/ },
  { label: 'Window type', pattern: /\bWindow\b/ },
  {
    label: 'Event type',
    pattern: /\b(?:Mouse|Keyboard|Pointer|Focus|Input|Touch)?Event\b/,
  },
  { label: 'EventTarget', pattern: /\bEventTarget\b/ },
  { label: 'NodeList', pattern: /\bNodeList\b/ },
  { label: 'DOMParser', pattern: /\bDOMParser\b/ },
  { label: 'MediaQueryList', pattern: /\bMediaQueryList[A-Za-z]*\b/ },
  { label: 'Storage type', pattern: /\bStorage\b/ },
  { label: 'React namespace', pattern: /\bReact\b/ },
  { label: 'JSX namespace', pattern: /\bJSX\b/ },
];

/** Every relative specifier of a module, read from comment-stripped source. */
function relativeSpecifiers(file: string): string[] {
  const code = readWithoutComments(file);
  const pattern =
    /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    found.push(match[1]);
  }
  return found;
}

// --- Invariant 0: the scan sees something ------------------------------------

describe('the pure logic scan sees the Squads_Feature lib directory', () => {
  it('is rooted at features/squads/lib', () => {
    expect(norm(libRoot).endsWith('apps/web/src/features/squads/lib')).toBe(true);
  });

  it('collects production modules and property tests, and no test file as a module', () => {
    // A vacuous scan would pass every invariant below, so it is ruled out first:
    // the pure logic is the largest part of this feature (the parsers alone are
    // eleven modules), it is covered test-for-module, and no test file may leak
    // into a production set.
    expect(libModules.length).toBeGreaterThan(20);
    expect(libPropertyTests.length).toBeGreaterThan(20);
    expect(libModules.map(libRel).filter(isTestFile)).toEqual([]);
  });

  it('reaches into lib/parse as well as lib/ itself', () => {
    // `lib/parse/` holds the Response_Parsers and Response_Printers Requirement
    // 16.10 names explicitly. A walker that stopped at the top level would leave
    // exactly those modules unscanned while still looking non-vacuous.
    const nested = libModules.map(libRel).filter((path) => path.startsWith('parse/'));

    expect(nested.length).toBeGreaterThan(5);
  });
});

// --- Invariants 1 to 4: React-free, DOM-free, transport-free, closed ---------

describe('every Squads_Feature lib module is free of React, the DOM, and the transport', () => {
  it('imports nothing from React (Requirements 16.10, 18.2)', () => {
    const offenders = libModules
      .filter((file) => REACT_IMPORT_PATTERN.test(readWithoutComments(file)))
      .map(libRel);

    expect(offenders).toEqual([]);
  });

  it('imports nothing from @pitchmate/api-client, bar the wire enums (16.10, 18.3)', () => {
    const offenders = libModules
      .filter((file) => libRel(file) !== WIRE_ENUMS_MODULE)
      .filter((file) => API_CLIENT_IMPORT_PATTERN.test(readWithoutComments(file)))
      .map(libRel);

    expect(offenders).toEqual([]);
  });

  it('keeps the wire enums the only holdout, and keeps its import type-only (12.2)', () => {
    // The positive half of the exception. An admitted holdout that did not
    // actually import the client would make the rule above look narrower than it
    // is, and a *value* import would reach the client's factory — so the
    // allowance is to the erased form only.
    const wireEnums = libModules.filter((file) => libRel(file) === WIRE_ENUMS_MODULE);

    expect(wireEnums.map(libRel)).toEqual([WIRE_ENUMS_MODULE]);

    const code = readWithoutComments(wireEnums[0]);

    expect(API_CLIENT_IMPORT_PATTERN.test(code)).toBe(true);
    expect(code).toMatch(
      /import\s+type\s*\{[^}]*\bcomponents\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s,
    );
    expect(code).not.toMatch(
      /^\s*import\s+(?!type\b)[^;]*?from\s*['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/m,
    );
  });

  it('references no DOM global, no DOM type, and no React namespace (Req 16.10, 18.2)', () => {
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

  it('resolves every relative import inside lib/, so purity is closed under import', () => {
    const offenders: Array<{ module: string; specifier: string }> = [];

    for (const file of libModules) {
      for (const specifier of relativeSpecifiers(file)) {
        const target = resolve(dirname(file), specifier);
        if (relative(libRoot, target).startsWith('..')) {
          offenders.push({ module: libRel(file), specifier });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('imports no package other than the ones a pure module may name', () => {
    // The three patterns above name React and the client by hand, which catches
    // the two imports the criteria forbid but not the next transport-carrying
    // package someone reaches for. So the rule is stated positively instead: a
    // module of `lib/` imports nothing but its siblings, with the single erased
    // type import invariant 3 admits. Nothing under `lib/` needs a *runtime*
    // dependency, and the day one does is the day this rule should be
    // reconsidered deliberately rather than silently.
    const offenders: Array<{ module: string; specifier: string }> = [];
    const pattern =
      /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'".][^'"]*)['"]/g;

    for (const file of libModules) {
      const code = readWithoutComments(file);
      const admitted =
        libRel(file) === WIRE_ENUMS_MODULE ? '@pitchmate/api-client' : null;
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        if (match[1] === admitted) continue;
        offenders.push({ module: libRel(file), specifier: match[1] });
      }
    }

    expect(offenders).toEqual([]);
  });
});

// --- Invariant 5: property tests beside every module, at 100 runs or more -----

describe('every Squads_Feature lib module has an adjacent property test', () => {
  it('finds <module>.property.test.ts beside every production module (Req 20.1)', () => {
    const testNames = new Set(libPropertyTests.map(libRel));

    const uncovered = libModules.map(libRel).filter((module) => {
      const base = module.replace(/\.tsx?$/, '');
      return (
        !testNames.has(`${base}.property.test.ts`) &&
        !testNames.has(`${base}.property.test.tsx`)
      );
    });

    expect(uncovered).toEqual([]);
  });

  it('reaches its subject through a lib module rather than a local copy (Req 20.1)', () => {
    // The adjacency rule above runs one way, so a property test named for a
    // property rather than for a module is admitted — but only if it imports the
    // logic it claims to exercise. A file that declared its own copy would pass
    // the count above and assert nothing about the product.
    const offenders: string[] = [];

    for (const test of libPropertyTests) {
      const testDir = dirname(test);
      const reachesLib = relativeSpecifiers(test).some((specifier) => {
        const target = resolve(testDir, specifier);
        return !relative(libRoot, target).startsWith('..');
      });

      if (!reachesLib) {
        offenders.push(libRel(test));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('imports the adjacent module in the test that sits beside one (Req 20.1)', () => {
    const offenders: string[] = [];

    for (const test of libPropertyTests) {
      const base = libRel(test).replace(/\.property\.test\.tsx?$/, '');
      const adjacent = new Set(libModules.map((file) => libRel(file).replace(/\.tsx?$/, '')));
      if (!adjacent.has(base)) continue;

      const bareName = base.split('/').pop() ?? base;
      const importsAdjacent = relativeSpecifiers(test).some(
        (specifier) => specifier === `./${bareName}` || specifier === `./${bareName}.ts`,
      );

      if (!importsAdjacent) {
        offenders.push(libRel(test));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('configures every fc.assert at 100 iterations or more (Req 20.1)', () => {
    const offenders: Array<{ test: string; runs: number | null }> = [];
    let assertions = 0;

    for (const test of libPropertyTests) {
      const code = readCodeOnly(test);
      const calls = fcAssertCalls(code);

      // A property test file with no `fc.assert` is not a property test, so it
      // cannot be what satisfies the adjacency rule above for its module.
      expect(calls.length, `${libRel(test)} runs no fc.assert`).toBeGreaterThan(0);

      for (const call of calls) {
        assertions += 1;
        const runs = configuredRuns(call, code);

        // No `numRuns` at all: a `fc.configureGlobal` default elsewhere could
        // lower this call without touching it, which is the drift the floor
        // exists to prevent.
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
    // Non-vacuity: the floor means nothing if no call was inspected. There is at
    // least one `fc.assert` per module, and in practice several.
    expect(assertions).toBeGreaterThan(libModules.length);
  });
});
