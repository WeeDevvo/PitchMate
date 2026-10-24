/**
 * Structural source scan: the Player_Stats_Feature's pure-logic isolation and
 * its property-test coverage (task 15.2).
 *
 * Requirement 14.6 makes this file part of the product rather than a courtesy
 * check. The rules it enforces are stated as prohibitions and as universals —
 * "every module of the Player_Stats_Feature's pure logic directory SHALL import
 * nothing from React, SHALL reference no DOM global or DOM type, and SHALL
 * resolve every relative import inside that directory, so that purity is closed
 * under import" (14.3), "SHALL provide a property test adjacent to every module
 * of its pure logic directory, each exercising its adjacent module and each
 * configured at no fewer than 100 generated cases" (14.5) — and neither a
 * prohibition nor a universal over a directory can be demonstrated by an
 * example. So the source tree is read and classified, following the mechanism
 * `features/app-shell/pureLogic.structural.test.ts` established,
 * `features/squads/pureLogic.structural.test.ts` repeated, and
 * `structural/sourceScan.ts` declares once for this feature: read each file's
 * text, strip comments and string literals through one shared state machine, and
 * fail naming the offending file and specifier.
 *
 * ### The six invariants
 *
 * 1. **Nothing from React** (Requirement 14.3). No module under `lib/` or
 *    `lib/parse/` imports `react`, `react-dom`, or any sub-path of either, by
 *    `import`, dynamic `import()`, or `require`.
 * 2. **Nothing from the DOM** (Requirement 14.3). No such module references a
 *    DOM/BOM global (`window`, `document`, `localStorage`, …) or a DOM type
 *    (`HTMLElement`, `Event`, `Node`, …), and none names the `React` or `JSX`
 *    namespace — so every one of them is testable with no browser and no
 *    renderer present, which is the reason the criterion gives for the rule.
 * 3. **Nothing from the transport, bar one erased import** (Requirements 14.3,
 *    13.4). No module under `lib/` imports `@pitchmate/api-client` or any
 *    sub-path of it, with exactly one admitted exception:
 *    {@link WIRE_ENUMS_MODULE}, which Requirement 13.4 has express each wire
 *    enum union as an alias over the generated `components['schemas'][…]`
 *    vocabulary rather than as a hand-written list, so that a renamed or
 *    retired backend name fails the build. Only the generated package declares
 *    `components`, so this module must name it. The allowance is to the
 *    **type-only** form alone, which is what preserves the property the rule
 *    protects: a type-only import is erased at compile time, so the emitted
 *    module imports nothing, constructs nothing, and is still testable with no
 *    transport present.
 * 4. **Purity is not smuggled in by a relative path.** Invariants 1 to 3 are
 *    asserted against each module's *own* source, which is what Requirement 14.3
 *    says. That would be hollow if a `lib/` module could reach a React- or
 *    transport-carrying module by a relative specifier, so every relative
 *    specifier of every `lib/` module must resolve inside `lib/`. There is no
 *    admitted exception — not `src/theme`, not the App_Shell barrel, not the
 *    feature's own `testing/` harnesses: `lib/` is closed under import, which is
 *    exactly the clause "so that purity is closed under import" asks for.
 * 5. **No package a pure module may not name.** Invariants 1 and 3 name React
 *    and the client by hand, which catches the two imports the criterion calls
 *    out but not the next renderer- or transport-carrying package someone
 *    reaches for. So the rule is also stated positively: a module of `lib/`
 *    imports nothing but its siblings, with the single erased type import
 *    invariant 3 admits.
 * 6. **A property test beside every module, at 100 iterations or more**
 *    (Requirement 14.5). Every production module under `lib/` has a property
 *    test **in its own directory that imports it**; every property test under
 *    `lib/` reaches its subject through a `lib/` module rather than declaring
 *    its own copy of the logic; a property test whose name begins with a
 *    module's name imports that module; and every `fc.assert` anywhere in the
 *    feature states its own `numRuns` and states it at 100 or above.
 *
 * ### Why adjacency is "a test in this directory that imports it"
 *
 * Requirement 14.5 asks for "a property test adjacent to every module …
 * exercising its adjacent module". A name-matching rule
 * (`<module>.property.test.ts`) is the narrower reading, and it is the wrong one
 * here: `lib/parse/playerProfile.ts` is covered by nine property tests in its
 * own directory — `absence`, `allOrNothing`, `noRatingInternal`, `numericForm`,
 * `reasonDisclosure`, `roundTrip`, `tolerance`, `wholeBodyFailure` — each named
 * for the property it carries rather than for the module, because each ranges
 * over the parser as a whole. Renaming them after the module would lose the
 * correspondence to the design's numbered properties and say nothing more about
 * the product. So coverage is read as *exercising*: a property test sitting in
 * the module's directory whose own imports reach that module. The two further
 * clauses are what keep the looser reading honest — every property test must
 * reach a `lib/` module (so none is testing a private copy), and a test named
 * after a module must import *that* module (so `chartGeometry.order` cannot
 * drift into testing only `progression`).
 *
 * ### The 100-run floor is read feature-wide
 *
 * Requirement 14.5 states the floor for the pure-logic tests; the design states
 * it for the feature ("Every `fc.assert` is configured at no fewer than 100
 * runs"). The wider set is scanned, because the floor's purpose — that a passing
 * property has met enough generated cases to mean something — is no different
 * for the reducer, the transport seam, or the screen suites, and a per-call
 * `numRuns` is what makes a call immune to being lowered from a
 * `fc.configureGlobal` elsewhere. A call that configures nothing is a finding.
 *
 * ### `URL` and `AbortSignal` are not DOM interfaces
 *
 * Neither appears in `lib/` today, and the patterns below do not name them: both
 * belong to standards Node implements as fully as the browser, so neither would
 * couple a module to a renderer or a document. `window.location`, `document`,
 * `localStorage`, and the rest of the browser-only surface stay forbidden, so a
 * `location.href` read cannot hide behind that reasoning.
 *
 * Comments and string/template literals are stripped before matching identifiers,
 * because these modules' docblocks discuss at length the very things they must
 * not do (`identifiers.ts` promises in prose that `lib/` is "React-free,
 * DOM-free, and free of `@pitchmate/api-client`"), and a scan that matched prose
 * would flag the documentation promising compliance. Import specifiers *are*
 * string literals, so import detection reads a comments-only-stripped copy that
 * keeps them while still discarding import-shaped text hiding in a comment.
 *
 * ### Non-vacuity
 *
 * Every rule below is a function over sources, run twice: once over the real
 * `lib/` tree, and once over a synthetic module, test, or snippet written here
 * that violates it. The five the task names explicitly — a React import, a DOM
 * reference, an escaping relative import, a value import of the generated
 * client, and a module with no adjacent property test — each have a control, as
 * do the foreign-package rule and the 100-run floor.
 *
 * Requirements: 14.3, 14.5, 14.6
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MINIMUM_PROPERTY_RUNS,
  collectProductionSources,
  collectPropertyTests,
  collectSources,
  configuredRuns,
  fcAssertCalls,
  isTestFile,
  isWithin,
  norm,
  playerStatsRoot,
  readCodeOnly,
  readWithoutComments,
  relTo,
  stripComments,
  stripCommentsAndStrings,
  targetsBarrelOf,
  wireRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The pure logic directory Requirements 14.3 and 14.5 govern. */
const libRoot = join(playerStatsRoot, 'lib');

/** Every production module under `lib/`, `lib/parse/` included. */
const libModuleFiles = collectProductionSources(libRoot);

/** Every property test sitting under `lib/`. */
const libPropertyTestFiles = collectPropertyTests(libRoot);

/** Every test file of the feature — the set the 100-run floor binds. */
const featureTestFiles = collectSources(playerStatsRoot).filter((file) =>
  isTestFile(relTo(playerStatsRoot, file)),
);

/**
 * The one module admitted to invariant 3: the wire enum unions.
 *
 * Requirement 13.4 has each named enum union expressed as an alias over the
 * corresponding generated union and checked against the generated vocabulary at
 * compile time. Both are statements about `components['schemas']`, which only
 * the generated package declares — so this module must name it, and the
 * alternative (a hand-written list of names in `lib/` plus the check somewhere
 * outside it) is the very duplication the requirement removes.
 *
 * The exception is narrow in three ways, each asserted below: it is this one
 * path, the import is type-only, and the module is still closed under invariants
 * 1, 2, 4, 5, and 6 like every other.
 */
const WIRE_ENUMS_MODULE = 'wireEnums.ts';

/** Path relative to `lib/`, in forward-slash form, for a failure message. */
function libRel(path: string): string {
  return relTo(libRoot, path);
}

/** A module or test, as the rules below read one: its path and its text. */
interface ScannedFile {
  /** Absolute path — a synthetic control supplies one that need not exist. */
  readonly file: string;
  /** The file's source text. */
  readonly source: string;
}

/** The real pure-logic modules, read once. */
const libModules: readonly ScannedFile[] = libModuleFiles.map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
}));

/** The real pure-logic property tests, read once. */
const libPropertyTests: readonly ScannedFile[] = libPropertyTestFiles.map(
  (file) => ({ file, source: readFileSync(file, 'utf8') }),
);

/** A synthetic file, placed inside `lib/` so only its text differs. */
function control(relativePath: string, source: string): ScannedFile {
  return { file: join(libRoot, ...relativePath.split('/')), source };
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

/** The type-only form the one admitted client import must take. */
const TYPE_ONLY_CLIENT_IMPORT_PATTERN =
  /import\s+type\s*\{[^}]*\bcomponents\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s;

/** A *value* import of the generated client — the form the allowance excludes. */
const VALUE_CLIENT_IMPORT_PATTERN =
  /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s*['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/m;

/**
 * DOM/BOM globals and DOM types that would couple a pure module to a browser or
 * a renderer.
 *
 * Matched with word boundaries against fully stripped code, so the ECMAScript
 * and web-standard globals the logic legitimately uses (`Error`, `Number`,
 * `Date`, `JSON`, `Intl`, `URL`, …) are never mistaken for DOM interfaces, while
 * a lower-case local named `element` is not mistaken for the `Element` type
 * either.
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
  { label: 'SVG*Element type', pattern: /\bSVG[A-Za-z]*Element\b/ },
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

/** Every relative specifier of a source, read from a comment-stripped copy. */
function relativeSpecifiersOf(source: string): string[] {
  const code = stripComments(source);
  const pattern =
    /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    found.push(match[1]);
  }
  return found;
}

/** Every package (non-relative) specifier of a source. */
function packageSpecifiersOf(source: string): string[] {
  const code = stripComments(source);
  const pattern =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'".][^'"]*)['"]/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    found.push(match[1]);
  }
  return found;
}

/** A module path with its `.ts`/`.tsx` extension removed — a stable identity. */
function moduleKey(file: string): string {
  return norm(file).replace(/\.tsx?$/, '');
}

/** Every relative import of a file, resolved to an extension-less module key. */
function relativeTargetsOf({ file, source }: ScannedFile): string[] {
  return relativeSpecifiersOf(source).map((specifier) =>
    moduleKey(resolve(dirname(file), specifier)),
  );
}

// --- The rules, as functions over sources ------------------------------------

/** The modules of `modules` that import React in any form (invariant 1). */
function reactImporters(modules: readonly ScannedFile[]): string[] {
  return modules
    .filter(({ source }) => REACT_IMPORT_PATTERN.test(stripComments(source)))
    .map(({ file }) => libRel(file));
}

/** The modules of `modules` referencing a DOM global, DOM type, or namespace. */
function domReferences(
  modules: readonly ScannedFile[],
): Array<{ module: string; reference: string }> {
  const offenders: Array<{ module: string; reference: string }> = [];

  for (const { file, source } of modules) {
    const code = stripCommentsAndStrings(source);
    for (const { label, pattern } of DOM_REFERENCE_PATTERNS) {
      if (pattern.test(code)) {
        offenders.push({ module: libRel(file), reference: label });
      }
    }
  }

  return offenders;
}

/**
 * The modules of `modules` importing the generated client, the one admitted
 * type-only holdout excepted (invariant 3).
 */
function clientImporters(modules: readonly ScannedFile[]): string[] {
  return modules
    .filter(({ file, source }) => {
      const code = stripComments(source);
      if (!API_CLIENT_IMPORT_PATTERN.test(code)) return false;
      if (libRel(file) !== WIRE_ENUMS_MODULE) return true;
      // The holdout is admitted to the erased form only: a value import would
      // reach the client's factory and put the transport back in `lib/`.
      return VALUE_CLIENT_IMPORT_PATTERN.test(code);
    })
    .map(({ file }) => libRel(file));
}

/** The relative imports of `modules` that resolve outside `lib/` (invariant 4). */
function escapingImports(
  modules: readonly ScannedFile[],
): Array<{ module: string; specifier: string }> {
  const offenders: Array<{ module: string; specifier: string }> = [];

  for (const { file, source } of modules) {
    for (const specifier of relativeSpecifiersOf(source)) {
      const target = norm(resolve(dirname(file), specifier));
      // The one admitted exit: the shared wire barrel, itself pure
      // (`src/wire/wire.structural.test.ts`), so purity stays closed under import.
      if (targetsBarrelOf(wireRoot, target)) continue;
      if (!isWithin(libRoot, target)) {
        offenders.push({ module: libRel(file), specifier });
      }
    }
  }

  return offenders;
}

/** The package imports of `modules` a pure module may not name (invariant 5). */
function foreignPackageImports(
  modules: readonly ScannedFile[],
): Array<{ module: string; specifier: string }> {
  const offenders: Array<{ module: string; specifier: string }> = [];

  for (const { file, source } of modules) {
    const admitted =
      libRel(file) === WIRE_ENUMS_MODULE ? '@pitchmate/api-client' : null;
    for (const specifier of packageSpecifiersOf(source)) {
      if (specifier === admitted) continue;
      offenders.push({ module: libRel(file), specifier });
    }
  }

  return offenders;
}

/**
 * The modules of `modules` that no property test of `tests` both sits beside and
 * imports (invariant 6).
 */
function uncoveredModules(
  modules: readonly ScannedFile[],
  tests: readonly ScannedFile[],
): string[] {
  const coverage = tests.map((test) => ({
    directory: norm(dirname(test.file)),
    targets: new Set(relativeTargetsOf(test)),
  }));

  return modules
    .filter(({ file }) => {
      const key = moduleKey(file);
      const directory = norm(dirname(file));
      return !coverage.some(
        (test) => test.directory === directory && test.targets.has(key),
      );
    })
    .map(({ file }) => libRel(file));
}

/** The property tests of `tests` that reach no `lib/` module at all. */
function testsWithoutALibSubject(tests: readonly ScannedFile[]): string[] {
  return tests
    .filter(
      (test) =>
        !relativeTargetsOf(test).some((target) => isWithin(libRoot, target)),
    )
    .map(({ file }) => libRel(file));
}

/**
 * The property tests of `tests` whose name begins with a module's name and that
 * do not import that module.
 *
 * `callOutcome.timeout.property.test.ts` must import `./callOutcome`;
 * `parse/roundTrip.property.test.ts` names no module, so the rule does not bind
 * it and the coverage rule above is what holds it to the parser.
 */
function testsNotImportingTheirNamesake(
  tests: readonly ScannedFile[],
  modules: readonly ScannedFile[],
): string[] {
  const moduleKeys = new Set(modules.map(({ file }) => moduleKey(file)));
  const offenders: string[] = [];

  for (const test of tests) {
    const named = basename(test.file).replace(/\.property\.test\.tsx?$/, '');
    const namesake = moduleKey(join(dirname(test.file), named.split('.')[0]));
    if (!moduleKeys.has(namesake)) continue;
    if (!relativeTargetsOf(test).includes(namesake)) {
      offenders.push(libRel(test.file));
    }
  }

  return offenders;
}

/** One `fc.assert` that states no readable `numRuns` at 100 or above. */
interface RunsFinding {
  /** The file the call sits in, relative to the feature root. */
  readonly test: string;
  /** The configured count, or `null` for "stated none" / "unreadable". */
  readonly runs: number | null;
}

/** Every `fc.assert` of `code` falling below the floor, with how many it ran. */
function runsFindings(label: string, code: string): RunsFinding[] {
  const findings: RunsFinding[] = [];

  for (const call of fcAssertCalls(code)) {
    const runs = configuredRuns(call, code);

    // No `numRuns` at all: a `fc.configureGlobal` default elsewhere could lower
    // this call without touching it, which is the drift the floor prevents.
    if (runs.length === 0) {
      findings.push({ test: label, runs: null });
      continue;
    }

    for (const value of runs) {
      if (value === null || value < MINIMUM_PROPERTY_RUNS) {
        findings.push({ test: label, runs: value });
      }
    }
  }

  return findings;
}

// --- Invariant 0: the scan sees something ------------------------------------

describe('the pure logic scan sees the Player_Stats_Feature lib directory', () => {
  it('is rooted at features/player-stats/lib', () => {
    expect(norm(libRoot).endsWith('apps/web/src/features/player-stats/lib')).toBe(
      true,
    );
  });

  it('collects production modules and property tests, and no test file as a module', () => {
    // A vacuous scan would pass every invariant below, so it is ruled out first:
    // the pure logic is the largest part of this feature, it is covered
    // test-for-module, and no test file may leak into a production set.
    expect(libModules.length).toBeGreaterThan(10);
    expect(libPropertyTests.length).toBeGreaterThan(10);
    expect(libModuleFiles.map(libRel).filter(isTestFile)).toEqual([]);
  });

  it('reaches into lib/parse as well as lib/ itself', () => {
    // `lib/parse/` holds the Response_Parser and its primitives — the modules
    // Requirement 13 puts at the transport's edge and 14.3 keeps pure. A walker
    // that stopped at the top level would leave exactly those unscanned while
    // still looking non-vacuous.
    const nested = libModuleFiles
      .map(libRel)
      .filter((path) => path.startsWith('parse/'));

    expect(nested).toEqual([
      'parse/leaderboard.ts',
      'parse/playerProfile.ts',
      'parse/primitives.ts',
    ]);
  });

  it('collects the feature-wide test files the 100-run floor binds', () => {
    const relative = featureTestFiles.map((file) =>
      relTo(playerStatsRoot, file),
    );

    // Beyond `lib/`: the transport seam, the load machine, the components, and
    // the screen suites all carry properties, and the floor is read over all of
    // them.
    expect(relative).toContain('api/playerStatsApi.property.test.ts');
    expect(relative).toContain('state/reducer.property.test.ts');
    expect(relative.length).toBeGreaterThan(libPropertyTests.length);
  });
});

// --- Invariant 1: nothing from React (Requirement 14.3) ----------------------

describe('no Player_Stats_Feature lib module imports React (Requirement 14.3)', () => {
  it('imports neither react nor react-dom, in any form', () => {
    expect(reactImporters(libModules)).toEqual([]);
  });

  it('detects a React import in every form it could take', () => {
    // Control: the four shapes the pattern exists to catch. A detector that
    // reported none of these would report none ever.
    const offenders = reactImporters([
      control('control.ts', "import { useMemo } from 'react';"),
      control('control.ts', "import 'react-dom/client';"),
      control('control.ts', "const react = require('react');"),
      control('control.ts', "const jsx = await import('react/jsx-runtime');"),
    ]);

    expect(offenders).toHaveLength(4);
  });

  it('does not fire on a sibling import or on React named in prose', () => {
    // The other half: the clean result above must be the tree complying rather
    // than an over-broad pattern that happens to match nothing. A specifier that
    // merely contains the letters, and a docblock promising React-freedom, are
    // both admitted.
    expect(
      reactImporters([
        control('control.ts', "import { printDuration } from './duration';"),
        control(
          'control.ts',
          '/** React-free and DOM-free like every module under `lib/`. */',
        ),
        control('control.ts', "import { reactions } from './reactions';"),
      ]),
    ).toEqual([]);
  });
});

// --- Invariant 2: nothing from the DOM (Requirement 14.3) --------------------

describe('no Player_Stats_Feature lib module touches the DOM (Requirement 14.3)', () => {
  it('references no DOM global, no DOM type, and no React or JSX namespace', () => {
    expect(domReferences(libModules)).toEqual([]);
  });

  it('detects a DOM global, a DOM type, and a namespace reference', () => {
    // Control: a read of a browser global, a DOM type in a signature, and the
    // React namespace in a type position — the three shapes a renderer
    // dependency arrives in.
    const offenders = domReferences([
      control(
        'control.ts',
        'export function readWidth(): number { return window.innerWidth; }',
      ),
      control(
        'control.ts',
        'export function label(node: HTMLElement): string { return node.textContent ?? ""; }',
      ),
      control(
        'control.ts',
        'export type Render = (value: number) => React.ReactNode;',
      ),
    ]);

    expect(offenders.map(({ reference }) => reference)).toEqual([
      'window',
      'HTML*Element type',
      'React namespace',
    ]);
  });

  it('does not fire on prose, on a string, or on a lower-case local', () => {
    // The other half, and the reason both strippers exist: these modules'
    // docblocks name the very things they must not do, their message constants
    // are sentences, and a local named `element` is not the `Element` type.
    expect(
      domReferences([
        control(
          'control.ts',
          '/** React-free and DOM-free: reads no window, document, or localStorage. */',
        ),
        control(
          'control.ts',
          "export const NO_RATING_HISTORY = 'No rating history yet.';",
        ),
        control(
          'control.ts',
          'export function first(element: number, nodes: readonly number[]): number { return element + nodes.length; }',
        ),
      ]),
    ).toEqual([]);
  });
});

// --- Invariant 3: nothing from the transport, bar one erased import ----------

describe('no Player_Stats_Feature lib module names the generated client as a value', () => {
  it('imports @pitchmate/api-client nowhere but the wire enums (14.3, 13.4)', () => {
    expect(clientImporters(libModules)).toEqual([]);
  });

  it('keeps the wire enums the one holdout, and keeps its import type-only (13.4)', () => {
    // The positive half of the exception. An admitted holdout that did not
    // actually import the client would make the rule above look narrower than it
    // is, and a value import would reach the client's factory.
    const wireEnums = libModuleFiles.filter(
      (file) => libRel(file) === WIRE_ENUMS_MODULE,
    );
    expect(wireEnums.map(libRel)).toEqual([WIRE_ENUMS_MODULE]);

    const code = readWithoutComments(wireEnums[0]);
    expect(API_CLIENT_IMPORT_PATTERN.test(code)).toBe(true);
    expect(code).toMatch(TYPE_ONLY_CLIENT_IMPORT_PATTERN);
    expect(VALUE_CLIENT_IMPORT_PATTERN.test(code)).toBe(false);
  });

  it('detects a value import of the client, in the holdout and in a sibling', () => {
    // Control: the same rule, over three deliberate violations — the holdout
    // importing the client as a *value*, the holdout re-exporting from it, and
    // another module importing it at all, type-only or not. The allowance is to
    // one path and one erased form, and each half is exercised here.
    const offenders = clientImporters([
      control(
        WIRE_ENUMS_MODULE,
        "import createClient from '@pitchmate/api-client';",
      ),
      control(
        WIRE_ENUMS_MODULE,
        "export { createPlayerStatsClient } from '@pitchmate/api-client';",
      ),
      control(
        'parse/playerProfile.ts',
        "import type { components } from '@pitchmate/api-client';",
      ),
    ]);

    expect(offenders).toEqual([
      WIRE_ENUMS_MODULE,
      WIRE_ENUMS_MODULE,
      'parse/playerProfile.ts',
    ]);
  });

  it('admits the erased form in the holdout alone', () => {
    expect(
      clientImporters([
        control(
          WIRE_ENUMS_MODULE,
          "import type { components } from '@pitchmate/api-client';",
        ),
      ]),
    ).toEqual([]);
  });
});

// --- Invariant 4: purity is closed under import (Requirement 14.3) ----------

describe('every relative import of a lib module resolves inside lib/ (Requirement 14.3)', () => {
  it('resolves every one of them inside the pure logic directory', () => {
    expect(escapingImports(libModules)).toEqual([]);
  });

  it('reaches a sibling and a sub-directory at all', () => {
    // Guard: `lib/` modules do import one another — `subject.ts` takes the
    // identity check, `parse/primitives.ts` takes the duration reader — so an
    // empty offender list above means the imports resolve inside rather than
    // that no relative import was seen. The shared wire barrel is the one
    // target outside lib/.
    const targets = libModules
      .flatMap(relativeTargetsOf)
      .filter((target) => !targetsBarrelOf(wireRoot, target));

    expect(targets.length).toBeGreaterThan(5);
    expect(targets.every((target) => isWithin(libRoot, target))).toBe(true);
    expect(
      targets.some((target) => isWithin(join(libRoot, 'parse'), target)),
    ).toBe(true);
  });

  it('detects a relative import that escapes lib/', () => {
    // Control: four deliberate violations, one per escape a pure module might
    // reach for — a component, the load machine, the feature's own test harness,
    // and the shared theme module. Each is a module `lib/` must not depend on,
    // because each would put React, a hook, a fixture, or an appearance store
    // behind a function that claims to be pure.
    const offenders = escapingImports([
      control(
        'control.ts',
        "import { StatSection } from '../components/StatSection';",
      ),
      control(
        'control.ts',
        "import { usePlayerStatsScreen } from '../state/usePlayerStatsScreen';",
      ),
      control(
        'parse/control.ts',
        "import { playerProfileArb } from '../../testing/playerProfileFixtures';",
      ),
      control('parse/control.ts', "import type { Theme } from '../../../../theme';"),
    ]);

    expect(offenders.map(({ specifier }) => specifier)).toEqual([
      '../components/StatSection',
      '../state/usePlayerStatsScreen',
      '../../testing/playerProfileFixtures',
      '../../../../theme',
    ]);
  });
});

// --- Invariant 5: no package a pure module may not name ---------------------

describe('a lib module imports nothing but its siblings (Requirement 14.3)', () => {
  it('names no package other than the one erased type import', () => {
    expect(foreignPackageImports(libModules)).toEqual([]);
  });

  it('detects a renderer, a transport, and a formatting package', () => {
    // Control: the rule is stated positively precisely so that the *next*
    // dependency is caught rather than only the two the criterion names. Nothing
    // under `lib/` needs a runtime dependency, and the day one does is the day
    // this rule should be reconsidered deliberately rather than silently.
    const offenders = foreignPackageImports([
      control('control.ts', "import { useMemo } from 'react';"),
      control('control.ts', "import axios from 'axios';"),
      control('control.ts', "import { format } from 'date-fns';"),
      control('control.ts', "import fc from 'fast-check';"),
    ]);

    expect(offenders.map(({ specifier }) => specifier)).toEqual([
      'react',
      'axios',
      'date-fns',
      'fast-check',
    ]);
  });
});

// --- Invariant 6: a property test beside every module, at 100 runs or more ---

describe('every Player_Stats_Feature lib module is exercised by an adjacent property test', () => {
  it('finds a property test in its own directory importing it (Requirement 14.5)', () => {
    expect(uncoveredModules(libModules, libPropertyTests)).toEqual([]);
  });

  it('detects a module no adjacent property test imports', () => {
    // Control: three deliberate violations — a module with no test at all, a
    // module whose only test sits in another directory, and a module whose
    // same-directory test imports a different module. A name-matching rule would
    // miss the third; this one is about exercising, so it does not.
    const modules = [
      control('control.ts', 'export const value = 1;'),
      control('parse/control.ts', 'export const parsed = 1;'),
      control('untested.ts', 'export const untested = 1;'),
    ];
    const tests = [
      control(
        'parse/control.property.test.ts',
        "import { value } from '../control';",
      ),
      control(
        'untested.property.test.ts',
        "import { printDuration } from './duration';",
      ),
    ];

    expect(uncoveredModules(modules, tests)).toEqual([
      'control.ts',
      'parse/control.ts',
      'untested.ts',
    ]);

    // And the other half: a test beside the module that imports it clears it, so
    // the clean result above is coverage rather than a predicate that never
    // holds.
    expect(
      uncoveredModules(
        [control('control.ts', 'export const value = 1;')],
        [
          control(
            'control.property.test.ts',
            "import { value } from './control';",
          ),
        ],
      ),
    ).toEqual([]);
  });

  it('reaches its subject through a lib module rather than a local copy (14.5)', () => {
    expect(testsWithoutALibSubject(libPropertyTests)).toEqual([]);
  });

  it('detects a property test that imports no lib module', () => {
    // Control: a test that reached only the feature's fixtures would pass the
    // coverage count for nothing — whatever logic it asserted would be its own.
    expect(
      testsWithoutALibSubject([
        control(
          'parse/control.property.test.ts',
          "import { playerProfileArb } from '../../testing/playerProfileFixtures';",
        ),
      ]),
    ).toEqual(['parse/control.property.test.ts']);
  });

  it('imports its namesake where a test is named after a module (14.5)', () => {
    expect(testsNotImportingTheirNamesake(libPropertyTests, libModules)).toEqual(
      [],
    );
  });

  it('detects a test named after a module it does not import', () => {
    const offenders = testsNotImportingTheirNamesake(
      [
        control(
          'chartGeometry.order.property.test.ts',
          "import { toProgressionSeries } from './progression';",
        ),
        control(
          'parse/primitives.property.test.ts',
          "import { parsePlayerProfile } from './playerProfile';",
        ),
        // Named after no module, so the rule leaves it to the coverage rule.
        control(
          'parse/roundTrip.property.test.ts',
          "import { printPlayerProfile } from './playerProfile';",
        ),
      ],
      libModules,
    );

    expect(offenders).toEqual([
      'chartGeometry.order.property.test.ts',
      'parse/primitives.property.test.ts',
    ]);
  });

  it('runs at least one fc.assert in every lib property test', () => {
    // A property-test file with no `fc.assert` is not a property test, so it
    // cannot be what satisfies the coverage rule above for its module.
    const silent = libPropertyTests
      .filter(({ file }) => fcAssertCalls(readCodeOnly(file)).length === 0)
      .map(({ file }) => libRel(file));

    expect(silent).toEqual([]);
  });

  it('configures every fc.assert in the feature at 100 runs or more (14.5)', () => {
    const findings: RunsFinding[] = [];
    let assertions = 0;

    for (const file of featureTestFiles) {
      const code = readCodeOnly(file);
      const label = relTo(playerStatsRoot, file);
      assertions += fcAssertCalls(code).length;
      findings.push(...runsFindings(label, code));
    }

    expect(findings).toEqual([]);
    // Non-vacuity: the floor means nothing if no call was inspected. There is at
    // least one `fc.assert` per pure logic module, and in practice several, plus
    // the seam, reducer, component, and screen properties.
    expect(assertions).toBeGreaterThan(libModules.length);
  });

  it('detects a low count, an unreadable one, and a call that states none', () => {
    // Control: the three ways a call falls below the floor. The counts are read
    // from a synthetic source so that no file has to carry a violation, and the
    // reader is the same one the rule above runs.
    const source = [
      'const LOW = 25;',
      'fc.assert(fc.property(arb, check), { numRuns: 10 });',
      'fc.assert(fc.property(arb, check), { numRuns: LOW });',
      'fc.assert(fc.property(arb, check), { numRuns: fromElsewhere });',
      'fc.assert(fc.property(arb, check));',
      'fc.assert(fc.property(arb, check), { numRuns: 100 });',
      'fc.assert(fc.property(arb, check), { numRuns: 500, examples: [[1]] });',
    ].join('\n');

    const code = stripCommentsAndStrings(source);
    expect(fcAssertCalls(code)).toHaveLength(6);
    expect(runsFindings('control.property.test.ts', code)).toEqual([
      { test: 'control.property.test.ts', runs: 10 },
      { test: 'control.property.test.ts', runs: 25 },
      { test: 'control.property.test.ts', runs: null },
      { test: 'control.property.test.ts', runs: null },
    ]);
  });
});
