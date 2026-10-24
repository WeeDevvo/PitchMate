/**
 * Structural source scan: the Player_Stats_Feature's transport seam (task 15.3).
 *
 * Requirement 14.6 makes this file part of the product rather than a courtesy
 * check. The rules it enforces are prohibitions and universals over a directory —
 * "issue every backend request through the Player_Stats_Api and through no other
 * module, and no module of the feature other than the Player_Stats_Api shall
 * reference the Api_Client, a network global, an endpoint path, or an HTTP method
 * literal" (12.1), "receive the Authenticated_Api_Client by injection, construct
 * no Api_Client instance, install no client middleware" (12.2), "classify a
 * settled call's outcome in exactly one pure module, which shall be the only
 * module of the feature containing an HTTP status value" (12.8) — and neither a
 * prohibition nor a universal can be demonstrated by an example. So the source
 * tree is read and classified, following the mechanism the App_Shell established,
 * the Squads_Feature consolidated, and `structural/sourceScan.ts` declares once
 * for this feature: read each file's text, strip comments and string literals
 * through the same small state machine, and fail naming the offending file and
 * the thing found in it.
 *
 * ### What is enforced
 *
 * | Rule | Requirement |
 * |---|---|
 * | `api/playerStatsApi.ts` is the only module naming the Api_Client, and `api/` holds it alone | 12.1 |
 * | `lib/wireEnums.ts` may name the generated schema table type-only, and nothing else may name the package at all | 12.1, 13.4 |
 * | No bare transport — `fetch`, `XMLHttpRequest`, `WebSocket`, … — anywhere in the feature, the facade included | 12.1 |
 * | No Api_Client method call, endpoint path, OpenAPI-templated path, or HTTP-method literal outside the facade | 12.1 |
 * | No client factory call and no middleware install anywhere | 12.2 |
 * | `lib/callOutcome.ts` is the only module containing an HTTP status value | 12.8 |
 * | No hand-written type duplicates a generated request or response shape | 12.6 |
 *
 * ### Scope: production modules, not test files
 *
 * Every rule is scoped to the feature's **production** modules — the set
 * `structural/sourceScan.ts` calls {@link playerStatsModules}, which is
 * everything under the feature root but the test files and the scan-support
 * directory. The scoping is stated rather than left implicit because this
 * feature's tests legitimately do what the rules forbid:
 * `api/playerStatsApi.property.test.ts` drives the **real**
 * `createPlayerStatsApi` over a stub typed from the generated `paths` table,
 * naming `@pitchmate/api-client` and rejecting with a `TypeError('Failed to
 * fetch')` so that its claims cover the transport rather than a mock of it, and
 * the outcome properties beside `lib/callOutcome.ts` generate statuses across the
 * whole integer range. A scan that banned those across the whole directory would
 * forbid the strongest tests in the feature, and Requirements 12.1 and 12.8 say
 * "module of the feature", not "every file in the folder".
 *
 * Two consequences are asserted rather than assumed: the facade *does* name the
 * generated package and the classifier *does* contain statuses, so each rule is a
 * restriction rather than an accident of nobody doing the thing; and the
 * feature's tests *do* name the package, so the production scoping is a real
 * exemption covering real code.
 *
 * The one rule that runs over the whole feature, harnesses included, is the
 * `testing/` modules' membership of the production set: a harness sits in the
 * feature's directories and is held to the feature's boundaries, following the
 * App_Shell's and the Squads_Feature's precedent and task 15.1's decision.
 *
 * ### The two admitted holdouts, each asserted narrowly
 *
 * - **`lib/wireEnums.ts` names the package.** Requirement 13.4 has each named
 *   Wire_Enum_Name read against the string union the Api_Client generates, which
 *   only that package declares. The holdout is admitted as the **erased** form
 *   alone — its import is asserted to be `import type`, which compiles to no
 *   import at all — and as the schema table alone: it names no client type, so it
 *   has nothing to call a method on, holds no endpoint path, and cannot issue a
 *   request.
 * - **`api/playerStatsApi.ts` contains the literal `200`.** It sits inside the
 *   `SuccessBody` conditional type, which indexes the generated contract's own
 *   `operations[…]['responses']` map to pin the response body (Requirement 12.6).
 *   That is a **type-level index into the generated document**: erased at compile
 *   time, compared with nothing, and the alternative — naming the body a second
 *   time — is precisely what 12.6 forbids. The facade gathers the three signals
 *   of a settled call and hands them to `classifyOutcome`, making no outcome
 *   decision and no status comparison of its own. So the exemption is granted to
 *   that one declaration rather than to the module: the scan removes the
 *   declaration and then requires the facade to hold no status value at all, and
 *   a control shows that a stray status beside such a declaration is still
 *   caught.
 *
 * ### Which stripper, and why
 *
 * - Import specifiers, endpoint paths, and HTTP method names *are* string
 *   literals, so those rules read {@link stripComments} — comments gone, strings
 *   kept.
 * - The transport, client-construction, status-value, and type-declaration rules
 *   are about identifiers and numbers in live code, so they read
 *   {@link stripCommentsAndStrings} — comments and string contents both gone.
 *   This matters more here than anywhere else in the feature: the facade's
 *   docblock promises that "a source scan over every other file under
 *   `features/player-stats/` finds no `fetch`, no `XMLHttpRequest`, no endpoint
 *   path, no HTTP-method literal, and no Api_Client method call", and
 *   `lib/callOutcome.ts` and `components/NotFoundTreatment.tsx` discuss `401`,
 *   `403`, and `404` at length in prose. A scan matching prose would flag the
 *   documentation promising compliance.
 *
 * ### Non-vacuity
 *
 * Requirement 14.6 asks for more than a green scan: each scan is "accompanied by
 * a control demonstrating that it detects a deliberate violation". So every rule
 * is stated as a function over sources and run twice — once over the real
 * feature, and once over synthetic modules written here that violate it. The
 * three the task names explicitly are a stray status literal, a stray endpoint
 * path, and a stray client call; the other rules carry controls of the same
 * shape, and the rules whose detectors could plausibly over-reach carry a
 * near-miss control too.
 *
 * Requirements: 12.1, 12.2, 12.6, 12.8, 14.6
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectProductionSources,
  collectSources,
  isTestFile,
  norm,
  playerStatsModules,
  playerStatsRoot,
  readWithoutComments,
  relTo,
  stripComments,
  stripCommentsAndStrings,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The one module of the feature permitted to touch transport (Requirement 12.1). */
const TRANSPORT_MODULE = 'api/playerStatsApi.ts';

/** The one module permitted to contain an HTTP status value (Requirement 12.8). */
const CLASSIFIER_MODULE = 'lib/callOutcome.ts';

/** The one module permitted a type-only name of the package (Requirement 13.4). */
const WIRE_ENUMS_MODULE = 'lib/wireEnums.ts';

/** The feature's single transport directory. */
const transportRoot = join(playerStatsRoot, 'api');

const facadePath = join(playerStatsRoot, 'api', 'playerStatsApi.ts');
const wireEnumsPath = join(playerStatsRoot, 'lib', 'wireEnums.ts');

/** The feature's production modules: the set every rule below binds. */
const featureModules = playerStatsModules();

/** Every test file of the feature, for the exemption control. */
const featureTests = collectSources(playerStatsRoot).filter((file) =>
  isTestFile(relTo(playerStatsRoot, file)),
);

/** Path relative to the feature root, in forward-slash form, for messages. */
function featureRel(path: string): string {
  return relTo(playerStatsRoot, path);
}

/** A module of the feature, as the rules below read one: its path and its text. */
interface ScannedModule {
  /** Absolute path — a synthetic control supplies one that need not exist. */
  readonly file: string;
  /** The module's source text. */
  readonly source: string;
}

/** The real feature, read once. */
const scannedModules: readonly ScannedModule[] = featureModules.map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
}));

/** Those of {@link scannedModules} that are not the transport facade. */
const outsideTransport = scannedModules.filter(
  ({ file }) => featureRel(file) !== TRANSPORT_MODULE,
);

/** Those of {@link scannedModules} that are not the outcome classifier. */
const outsideClassifier = scannedModules.filter(
  ({ file }) => featureRel(file) !== CLASSIFIER_MODULE,
);

/** Just the facade, as a one-element set a rule can be run over. */
const facadeOnly = scannedModules.filter(
  ({ file }) => featureRel(file) === TRANSPORT_MODULE,
);

/** Just the classifier, as a one-element set a rule can be run over. */
const classifierOnly = scannedModules.filter(
  ({ file }) => featureRel(file) === CLASSIFIER_MODULE,
);

/** A synthetic module, placed inside the feature so only its text differs. */
function control(relativePath: string, source: string): ScannedModule {
  return { file: join(playerStatsRoot, ...relativePath.split('/')), source };
}

// --- The shared detector shape -----------------------------------------------

/** One named thing a rule looks for. Unflagged, so `test` stays stateless. */
interface PatternRule {
  readonly label: string;
  readonly pattern: RegExp;
}

/** One finding: the module it was found in, and what was found. */
interface Finding {
  readonly module: string;
  readonly found: string;
}

/**
 * Every rule of `rules` that fires on any module of `modules`, read through
 * `read`.
 *
 * The same function serves the real feature and the synthetic controls, which is
 * what makes a control a demonstration that *this* rule detects a violation
 * rather than a second, weaker rule stated beside it.
 */
function findingsOf(
  modules: readonly ScannedModule[],
  rules: readonly PatternRule[],
  read: (source: string) => string,
): Finding[] {
  const findings: Finding[] = [];
  for (const { file, source } of modules) {
    const text = read(source);
    for (const { label, pattern } of rules) {
      if (pattern.test(text)) {
        findings.push({ module: featureRel(file), found: label });
      }
    }
  }
  return findings;
}

/** Findings ordered by module then label, so an assertion is order-free. */
function ordered(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    left.module === right.module
      ? left.found.localeCompare(right.found)
      : left.module.localeCompare(right.module),
  );
}

/** An import of the generated typed client, root specifier or any sub-path. */
const API_CLIENT_SPECIFIER = /['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/;

/** A *value* import of the generated client — the thing that reaches its factory. */
const API_CLIENT_VALUE_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?from\s*['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/m;

/** The modules of `modules` that name the generated package at all. */
function packageNamers(modules: readonly ScannedModule[]): string[] {
  return modules
    .filter(({ source }) => API_CLIENT_SPECIFIER.test(stripComments(source)))
    .map(({ file }) => featureRel(file));
}

// ---------------------------------------------------------------------------
// Invariant 0: the scan sees something.
//
// Every rule below is a prohibition, so a scan that discovered nothing would
// pass all of them. That is ruled out first.
// ---------------------------------------------------------------------------

describe('the transport scan sees the Player_Stats_Feature and its seam', () => {
  it('is rooted at apps/web/src/features/player-stats', () => {
    expect(
      norm(playerStatsRoot).endsWith('apps/web/src/features/player-stats'),
    ).toBe(true);
  });

  it('discovers the production modules, the seam among them, and no test file', () => {
    const names = featureModules.map(featureRel);

    expect(names.length).toBeGreaterThan(30);
    expect(names).toContain(TRANSPORT_MODULE);
    expect(names).toContain(CLASSIFIER_MODULE);
    expect(names).toContain(WIRE_ENUMS_MODULE);
    expect(names).toContain('screens/PlayerStatsScreen.tsx');
    expect(names).toContain('state/usePlayerStatsScreen.ts');
    expect(names.filter(isTestFile)).toEqual([]);

    // The rules below quantify over "every module but the facade" and "every
    // module but the classifier", which would be hollow if either set were the
    // whole feature or nothing at all.
    expect(facadeOnly).toHaveLength(1);
    expect(classifierOnly).toHaveLength(1);
    expect(outsideTransport).toHaveLength(featureModules.length - 1);
    expect(outsideClassifier).toHaveLength(featureModules.length - 1);
  });

  it('discovers the feature test files the production scoping exempts', () => {
    // The scoping note in this file's docblock is only honest if those tests
    // exist. They do, and the seam's own property test drives the real facade.
    expect(featureTests.length).toBeGreaterThan(20);
    expect(featureTests.map(featureRel)).toContain(
      'api/playerStatsApi.property.test.ts',
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 12.1 — one transport seam, in one transport directory.
// ---------------------------------------------------------------------------

describe('only api/playerStatsApi.ts names the Api_Client (Requirement 12.1)', () => {
  it('names the generated package in exactly the facade and the wire enums', () => {
    expect(packageNamers(scannedModules).sort()).toEqual(
      [TRANSPORT_MODULE, WIRE_ENUMS_MODULE].sort(),
    );
  });

  it('detects a third module naming the generated package', () => {
    // Control: the same detector over synthetic modules that reach for the
    // package — one as a type, one as a value, one by sub-path. Each is found,
    // so the two-element result above is a fact about the tree.
    expect(
      packageNamers([
        control(
          'state/ControlModule.ts',
          "import type { components } from '@pitchmate/api-client';",
        ),
        control(
          'components/ControlModule.tsx',
          "import { createApiClient } from '@pitchmate/api-client';",
        ),
        control(
          'lib/ControlModule.ts',
          "import type { paths } from '@pitchmate/api-client/schema';",
        ),
      ]),
    ).toEqual([
      'state/ControlModule.ts',
      'components/ControlModule.tsx',
      'lib/ControlModule.ts',
    ]);
  });

  it('makes no value import of it anywhere in the feature (Requirement 12.2)', () => {
    // Neither namer reaches the package's factory: both imports are type-only, so
    // no production module of this feature can construct a client at all. The
    // facade is handed one.
    const valueImporters = scannedModules
      .filter(({ source }) => API_CLIENT_VALUE_IMPORT.test(stripComments(source)))
      .map(({ file }) => featureRel(file));

    expect(valueImporters).toEqual([]);
  });

  it('detects a value import, and holds off the type-only near-miss', () => {
    expect(
      API_CLIENT_VALUE_IMPORT.test(
        "import { createApiClient } from '@pitchmate/api-client';",
      ),
    ).toBe(true);
    expect(
      API_CLIENT_VALUE_IMPORT.test(
        "import type { components } from '@pitchmate/api-client';",
      ),
    ).toBe(false);
  });

  it('lets the facade name the operations table and the client type', () => {
    // The positive half of the rule: the seam is pinned to the generated
    // contract, which is what Requirement 12.6 rests on. `PitchMateApiClient`
    // types the injected dependency; `operations` types the response body.
    const withStrings = readWithoutComments(facadePath);

    expect(withStrings).toMatch(API_CLIENT_SPECIFIER);
    expect(withStrings).toMatch(
      /import\s+type\s*\{[^}]*\boperations\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s,
    );
    expect(withStrings).toMatch(
      /import\s+type\s*\{[^}]*\bPitchMateApiClient\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s,
    );
  });

  it('lets the wire enums name the schema table and nothing else (Req 13.4)', () => {
    // What separates the holdout from a second seam is *which* name it takes. It
    // imports the generated schema table, type-only, and no client type — so it
    // has nothing to call a method on. The rules below pin the rest: no endpoint
    // path, no HTTP method literal, no client method call outside the facade.
    const withStrings = readWithoutComments(wireEnumsPath);

    expect(withStrings).toMatch(API_CLIENT_SPECIFIER);
    expect(withStrings).not.toMatch(API_CLIENT_VALUE_IMPORT);
    expect(withStrings).toMatch(
      /import\s+type\s*\{\s*components\s*,?\s*\}\s*from\s*['"]@pitchmate\/api-client['"]/,
    );

    const code = stripCommentsAndStrings(readFileSync(wireEnumsPath, 'utf8'));
    expect(code).not.toMatch(/\bPitchMateApiClient\b/);
    expect(code).not.toMatch(/\bcreateApiClient\b/);
    expect(code).not.toMatch(/\boperations\b/);
    expect(code).not.toMatch(/\bpaths\b/);
  });

  it('holds the whole transport directory in that one production module', () => {
    // One directory with one module in it is what makes the seam a seam rather
    // than a habit.
    const transportModules = collectProductionSources(transportRoot).map(featureRel);

    expect(transportModules).toEqual([TRANSPORT_MODULE]);
  });

  it('is a real exemption: the feature tests name the generated package too', () => {
    // `api/playerStatsApi.property.test.ts` types its stub from the generated
    // `paths` table so that its claims cover the contract. If no such test
    // existed, the production-only scoping would be excusing nothing and could
    // simply be widened.
    const naming = featureTests
      .filter((file) => API_CLIENT_SPECIFIER.test(readWithoutComments(file)))
      .map(featureRel);

    expect(naming.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Requirement 12.1 — no bare transport, no second caller.
// ---------------------------------------------------------------------------

/**
 * Bare transports that would bypass the generated client entirely.
 *
 * `\bfetch\b` also catches `window.fetch` and `globalThis.fetch`, since `.` is a
 * word boundary, and catches passing the function along as a value as well as
 * calling it.
 */
const BARE_TRANSPORT_RULES: readonly PatternRule[] = [
  { label: 'fetch', pattern: /\bfetch\b/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bWebSocket\b/ },
  { label: 'EventSource', pattern: /\bEventSource\b/ },
  { label: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { label: 'axios', pattern: /\baxios\b/ },
];

/**
 * The endpoint path and the contract's templated path form — string literals,
 * so they are read with strings kept.
 *
 * The endpoint pattern requires the quote to be followed immediately by
 * `/squads`, so the feature's *route* paths — `/app/squads/…`, and imported from
 * the Squads_Feature's barrel rather than written — do not match. The templated
 * pattern excludes `${…}`, so an interpolated route being built is not mistaken
 * for a contract being restated.
 */
const ENDPOINT_PATH_RULES: readonly PatternRule[] = [
  { label: 'endpoint path', pattern: /(['"`])\/squads(?:[/?#]|\1)/ },
  { label: 'templated path', pattern: /(['"`])\/[^'"`$]*\{[A-Za-z]\w*\}/ },
];

/**
 * An HTTP verb written as a value. The generated client's methods carry the verb,
 * so a `'GET'` literal means a module describing a request the generated types
 * already describe.
 */
const HTTP_METHOD_LITERAL_RULES: readonly PatternRule[] = [
  {
    label: 'HTTP method literal',
    pattern: /(['"`])(?:GET|POST|PUT|PATCH|DELETE|HEAD)\1/,
  },
];

/**
 * A call of the generated client's own surface. Case-sensitive, so a
 * `Map.get(…)` or a `Map.delete(…)` is not it.
 */
const CLIENT_METHOD_RULES: readonly PatternRule[] = [
  {
    label: 'Api_Client method call',
    pattern: /\.\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/,
  },
];

/** Every bare transport reference in `modules`, prose excluded. */
function bareTransportFindings(modules: readonly ScannedModule[]): Finding[] {
  return findingsOf(modules, BARE_TRANSPORT_RULES, stripCommentsAndStrings);
}

/** Every path, verb, or client call of `modules` that only the facade may hold. */
function facadeOnlyFindings(modules: readonly ScannedModule[]): Finding[] {
  return [
    ...findingsOf(
      modules,
      [...ENDPOINT_PATH_RULES, ...HTTP_METHOD_LITERAL_RULES],
      stripComments,
    ),
    ...findingsOf(modules, CLIENT_METHOD_RULES, stripCommentsAndStrings),
  ];
}

describe('no module of the feature performs bare transport (Requirement 12.1)', () => {
  it('references no network global, the facade included', () => {
    // The facade is *in* this set: it reaches the network through the injected
    // Api_Client and never through `fetch` itself, which is what makes "every
    // call goes through the Api_Client" true rather than merely centralised.
    expect(bareTransportFindings(scannedModules)).toEqual([]);
  });

  it('detects a bare transport in any module, the facade included', () => {
    expect(
      bareTransportFindings([
        control(
          'state/ControlModule.ts',
          'const load = async () => globalThis.fetch(url);',
        ),
        control('api/ControlFacade.ts', 'const request = new XMLHttpRequest();'),
        control('lib/ControlModule.ts', 'const live = new WebSocket(url);'),
      ]),
    ).toEqual([
      { module: 'state/ControlModule.ts', found: 'fetch' },
      { module: 'api/ControlFacade.ts', found: 'XMLHttpRequest' },
      { module: 'lib/ControlModule.ts', found: 'WebSocket' },
    ]);
  });

  it('writes no client call, endpoint path, templated path, or verb outside the facade', () => {
    expect(facadeOnlyFindings(outsideTransport)).toEqual([]);
  });

  it('detects a stray client call, endpoint path, templated path, and verb', () => {
    // Control: two of the three violations the task names, plus the templated
    // form and the verb a second caller would reach for alongside them.
    expect(
      facadeOnlyFindings([
        control(
          'state/ControlModule.ts',
          "const result = await apiClient.GET('/squads/{squadId}/members/{membershipId}/profile', { method: 'GET' });",
        ),
      ]),
    ).toEqual([
      { module: 'state/ControlModule.ts', found: 'endpoint path' },
      { module: 'state/ControlModule.ts', found: 'templated path' },
      { module: 'state/ControlModule.ts', found: 'HTTP method literal' },
      { module: 'state/ControlModule.ts', found: 'Api_Client method call' },
    ]);
  });

  it('holds off the near-miss of each path and call rule', () => {
    // The other half of the control: an application route path, an interpolated
    // route, and a lower-case map access are none of them transport, and a rule
    // that flagged them would have to be turned off rather than obeyed.
    expect(
      facadeOnlyFindings([
        control(
          'components/ControlModule.tsx',
          "const to = '/app/squads/' + squadId;\n" +
            'const also = `/app/squads/${squadId}/players/${membershipId}`;\n' +
            'const seen = cache.get(key);\n' +
            'const dropped = cache.delete(key);',
        ),
      ]),
    ).toEqual([]);
  });

  it('writes no HTTP method as a literal anywhere in the feature', () => {
    // The facade included: it calls `apiClient.GET` rather than naming a verb.
    expect(
      findingsOf(scannedModules, HTTP_METHOD_LITERAL_RULES, stripComments),
    ).toEqual([]);
  });

  it('routes the facade call through the generated client', () => {
    // The positive half: the seam is not merely the only module allowed to touch
    // transport, it is the module that does — once, on the one path it owns.
    const code = stripCommentsAndStrings(readFileSync(facadePath, 'utf8'));
    expect(code).toMatch(/\bapiClient\s*\.\s*GET\s*\(/);

    expect(readWithoutComments(facadePath)).toContain(
      "'/squads/{squadId}/members/{membershipId}/profile'",
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 12.2 — the client is injected, never constructed.
// ---------------------------------------------------------------------------

const CLIENT_CONSTRUCTION_RULES: readonly PatternRule[] = [
  { label: 'createApiClient(', pattern: /\bcreateApiClient\s*\(/ },
  {
    label: 'createAuthenticatedApiClient(',
    pattern: /\bcreateAuthenticatedApiClient\s*\(/,
  },
  { label: 'createClient(', pattern: /\bcreateClient\s*\(/ },
  { label: 'createFetchClient(', pattern: /\bcreateFetchClient\s*\(/ },
  { label: 'createAuthMiddleware(', pattern: /\bcreateAuthMiddleware\s*\(/ },
  // `client.use(middleware)` — `openapi-fetch`'s own install call. A React hook
  // is `useX(` rather than `.use(`, so this does not reach one.
  { label: 'middleware install', pattern: /\.\s*use\s*\(/ },
];

/** Every client factory call or middleware install in `modules`. */
function clientConstructionFindings(modules: readonly ScannedModule[]): Finding[] {
  return findingsOf(modules, CLIENT_CONSTRUCTION_RULES, stripCommentsAndStrings);
}

describe('the feature constructs no Api_Client of its own (Requirement 12.2)', () => {
  it('calls no client factory and installs no middleware, the facade included', () => {
    // Access-token attachment and renewal stay the Auth_Feature's: this feature
    // receives a client that already attaches a bearer, so it needs no factory
    // and no middleware of its own.
    expect(clientConstructionFindings(scannedModules)).toEqual([]);
  });

  it('detects a factory call and a middleware install', () => {
    expect(
      clientConstructionFindings([
        control('api/ControlFacade.ts', 'const client = createApiClient({ baseUrl });'),
        control('state/ControlModule.ts', 'apiClient.use(attachBearerMiddleware);'),
      ]),
    ).toEqual([
      { module: 'api/ControlFacade.ts', found: 'createApiClient(' },
      { module: 'state/ControlModule.ts', found: 'middleware install' },
    ]);
  });

  it('receives the client as an injected dependency, typed by the contract', () => {
    const code = stripCommentsAndStrings(readFileSync(facadePath, 'utf8'));

    expect(code).toMatch(/\breadonly\s+apiClient\s*:\s*PitchMateApiClient\b/);
    // And it arrives as a parameter of the factory rather than being reached for.
    expect(code).toMatch(
      /function\s+createPlayerStatsApi\s*\(\s*\{\s*apiClient\s*,?\s*\}\s*:\s*PlayerStatsApiDependencies\s*\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 12.8 — one module holds an HTTP status value.
// ---------------------------------------------------------------------------

/**
 * What makes a number in live code an HTTP status value.
 *
 * Five readings, because a status reaches code in five shapes and a scan
 * matching only one of them would be an invitation to write the others. Every
 * pattern is case-insensitive, so `status`, `Status`, and `STATUS_MIN` are all
 * seen.
 *
 * - **A comparison**, either way round — `status === 404`, `200 <= httpStatus`.
 * - **A binding** — `const NOT_FOUND = 404`, `const SUCCESS_STATUS_MIN = 200`.
 *   The status-shaped names are listed alongside `…status…` because a status
 *   bound to `NOT_FOUND` is no less a status for not saying so.
 * - **A status-keyed member** — `404: 'not-found'`, or the `200:` of a generated
 *   `responses` map. The key must open a member (it follows `{`, `,`, `[`, or a
 *   line start), so a ternary's `? 200 : 300` is not read as one.
 * - **The vocabulary itself** — a bare `401`, `409`, `503`, …, wherever it
 *   appears. The round hundreds are deliberately **absent** from that list:
 *   `100`, `200`, `300`, `400`, and `500` are ordinary magnitudes in this
 *   feature — a percentage ceiling, a chart height, a leap-year divisor, a
 *   generated fixture's bound — and flagging them would make the rule something
 *   to be switched off rather than obeyed. Those five are reached by the
 *   comparison, binding, and member readings instead, which is where a status
 *   has to appear in order to do anything.
 */
const STATUS_VALUE_RULES: readonly PatternRule[] = [
  {
    label: 'status comparison',
    pattern: /\b\w*status\w*\s*(?:===|!==|==|!=|>=|<=|>|<)\s*-?\d{3}\b/i,
  },
  {
    label: 'status comparison, reversed',
    pattern: /\b-?\d{3}\s*(?:===|!==|==|!=|>=|<=|>|<)\s*\w*status\w*\b/i,
  },
  {
    label: 'status binding',
    pattern:
      /\b(?:\w*status\w*|NOT_FOUND|BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|CONFLICT|GONE|SERVER_ERROR|SERVICE_UNAVAILABLE|TOO_MANY_REQUESTS)\s*(?::[^=;\n]*)?=\s*-?\d{3}\b/i,
  },
  { label: 'status-keyed member', pattern: /(?:^|[{,[])\s*\d{3}\s*:/m },
  {
    label: 'status vocabulary',
    pattern:
      /\b(?:201|202|204|301|302|304|307|308|401|403|404|405|409|410|415|422|429|451|501|502|503|504)\b/,
  },
];

/**
 * The end of the type declaration beginning at `start`: the first `;` outside any
 * brace, or the end of the text.
 */
function declarationEnd(code: string, start: number): number {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === ';' && depth === 0) return index + 1;
  }
  return code.length;
}

/**
 * A type alias whose right-hand side **begins** by indexing the generated
 * `operations` table — the one admitted form.
 *
 * Deliberately this narrow. A looser opener (any `type X`, exempted if
 * `operations[` appeared somewhere inside it) would hand the removal a slice of
 * every type declaration in the feature, and a declaration written without a
 * terminating semicolon would then swallow the code after it — hiding exactly
 * what this scan exists to find. Matching only `type X<…> = operations[` means
 * nothing else is ever a candidate for removal.
 */
const GENERATED_RESPONSE_INDEX = /\btype\s+\w+\s*(?:<[^{};]*>)?\s*=\s*operations\s*\[/g;

/**
 * `code` with every type alias that indexes the generated `operations` table
 * removed.
 *
 * This is the one admitted form of a status in the facade: `SuccessBody` reads
 * the body off `operations[TOperation]['responses']`'s own `200` key, pinning the
 * response type to the contract (Requirement 12.6). It is a type-level index,
 * erased at compile time, compared with nothing, and the alternative — naming the
 * body a second time — is exactly what 12.6 forbids.
 *
 * The exemption belongs to the declaration rather than to the module: only that
 * declaration's slice is removed, bounded by brace depth. A status written
 * anywhere else in the same file, before or after it, and a status inside any
 * other type declaration, are both still found — which the controls below
 * demonstrate.
 */
function withoutGeneratedResponseIndex(code: string): string {
  GENERATED_RESPONSE_INDEX.lastIndex = 0;
  let kept = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = GENERATED_RESPONSE_INDEX.exec(code)) !== null) {
    if (match.index < cursor) continue;
    const end = declarationEnd(code, match.index);

    kept += code.slice(cursor, match.index);
    kept += ' ';

    cursor = end;
    GENERATED_RESPONSE_INDEX.lastIndex = end;
  }

  return kept + code.slice(cursor);
}

/**
 * Every HTTP status value in `modules`.
 *
 * Read with comments *and* strings stripped, because `lib/callOutcome.ts`,
 * `api/playerStatsApi.ts`, and `components/NotFoundTreatment.tsx` each discuss
 * `401`, `403`, and `404` at length in prose, and a scan matching prose would
 * flag the documentation promising compliance.
 *
 * @param keepGeneratedIndex whether to leave an erased
 * `operations[…]['responses']` index in place, which the exemption check below
 * needs in order to assert that the facade holds exactly one status reading and
 * that it is that one
 */
function statusValueFindings(
  modules: readonly ScannedModule[],
  { keepGeneratedIndex = false }: { keepGeneratedIndex?: boolean } = {},
): Finding[] {
  return findingsOf(modules, STATUS_VALUE_RULES, (source) => {
    const code = stripCommentsAndStrings(source);
    return keepGeneratedIndex ? code : withoutGeneratedResponseIndex(code);
  });
}

describe('lib/callOutcome.ts is the only module with an HTTP status value (Req 12.8)', () => {
  it('finds a status value in no other production module', () => {
    expect(statusValueFindings(outsideClassifier)).toEqual([]);
  });

  it('detects a stray status literal in each shape it could take', () => {
    // Control: the violation the task names, in all five readings. Each is
    // found, so the clean result above is a fact about the tree.
    expect(
      ordered(
        statusValueFindings([
          control('state/ControlComparison.ts', 'if (status === 404) return;'),
          control('state/ControlReversed.ts', 'if (200 <= httpStatus) return;'),
          control('lib/ControlBinding.ts', 'const NOT_FOUND = 404;'),
          control('lib/ControlRange.ts', 'const SUCCESS_STATUS_MIN = 200;'),
          control(
            'components/ControlKeyed.tsx',
            'const message = { 503: unavailable }[reason];',
          ),
          control('lib/ControlVocabulary.ts', 'const concealed = [401, 403];'),
        ]),
      ),
    ).toEqual(
      ordered([
        { module: 'state/ControlComparison.ts', found: 'status comparison' },
        { module: 'state/ControlComparison.ts', found: 'status vocabulary' },
        {
          module: 'state/ControlReversed.ts',
          found: 'status comparison, reversed',
        },
        { module: 'lib/ControlBinding.ts', found: 'status binding' },
        { module: 'lib/ControlBinding.ts', found: 'status vocabulary' },
        { module: 'lib/ControlRange.ts', found: 'status binding' },
        { module: 'components/ControlKeyed.tsx', found: 'status-keyed member' },
        { module: 'components/ControlKeyed.tsx', found: 'status vocabulary' },
        { module: 'lib/ControlVocabulary.ts', found: 'status vocabulary' },
      ]),
    );
  });

  it('holds off the ordinary magnitudes this feature legitimately contains', () => {
    // The other half of the control. A percentage ceiling, a chart height, a
    // leap-year divisor, a generated fixture's bound, and a UTC offset are not
    // statuses — and each of these lines is drawn from a real module of the
    // feature.
    expect(
      statusValueFindings([
        control(
          'lib/ControlMagnitudes.ts',
          'const MAX_PERCENTAGE = 100;\n' +
            'export const PROGRESSION_CHART_HEIGHT = 200;\n' +
            'const leap = year % 100 !== 0 || year % 400 === 0;\n' +
            'const bound = fc.nat({ max: 400 });\n' +
            'const offset = minutes === -300 ? 120 : 480;',
        ),
      ]),
    ).toEqual([]);
  });

  it('is not vacuous: the classifier does contain status values', () => {
    // 12.8 is a restriction, not an accident of nobody naming a status. The
    // module owning the five-way classification names `401`, `403`, `404`, and
    // the bounds of the success range.
    const found = statusValueFindings(classifierOnly).map(({ found }) => found);

    expect(found).toContain('status vocabulary');
    expect(found).toContain('status binding');
  });

  it("admits the facade's one status only as an erased index into the contract", () => {
    // Left in place, the facade holds exactly one status reading, and it is the
    // generated `responses` map's own key — no comparison, no binding, and
    // nothing from the status vocabulary.
    expect(statusValueFindings(facadeOnly, { keepGeneratedIndex: true })).toEqual([
      { module: TRANSPORT_MODULE, found: 'status-keyed member' },
    ]);

    // That key belongs to the conditional type indexing the generated contract,
    // which is erased: no emitted statement of this module holds a status.
    expect(readWithoutComments(facadePath)).toMatch(
      /type\s+SuccessBody<[^>]*>\s*=\s*operations\[TOperation\]\['responses'\]\s*extends\s*\{\s*200\s*:/,
    );

    // And the exemption is the declaration's, not the module's: with it removed,
    // the facade holds no status value at all.
    expect(statusValueFindings(facadeOnly)).toEqual([]);
  });

  it('removes that declaration and nothing else of the facade', () => {
    // The exemption is only as good as its blast radius. What is dropped is one
    // short declaration: the code before it and the code after it both survive,
    // so "the facade holds no status once the index is removed" is a claim about
    // the whole module rather than about whatever was left of it.
    const code = stripCommentsAndStrings(readFileSync(facadePath, 'utf8'));
    const trimmed = withoutGeneratedResponseIndex(code);

    expect(code.length - trimmed.length).toBeLessThan(200);
    expect(trimmed).not.toMatch(/\btype\s+SuccessBody\b/);
    // Declared before the removal, and after it, respectively.
    expect(trimmed).toContain('createPlayerStatsApi');
    expect(trimmed).toContain('readStatus');
  });

  it('still detects a stray status beside an admitted contract index', () => {
    // Control for the exemption itself: a module carrying both the erased index
    // and a status of its own is an offender. Otherwise the exemption would be a
    // hole wide enough to classify an outcome in.
    expect(
      statusValueFindings([
        control(
          'api/ControlFacade.ts',
          'type SuccessBody<T extends keyof operations> =\n' +
            "  operations[T]['responses'] extends {\n" +
            "    200: { content: { 'application/json': infer B } };\n" +
            '  }\n' +
            '    ? B\n' +
            '    : undefined;\n' +
            'const outcome = status === 404 ? notFound : failure;',
        ),
        // And a type declaration that is *not* a generated index is no holdout
        // at all: a status table written as a type is still a status table.
        control('lib/ControlTyped.ts', 'type Concealed = { 404: string };'),
      ]),
    ).toEqual([
      { module: 'api/ControlFacade.ts', found: 'status comparison' },
      { module: 'api/ControlFacade.ts', found: 'status vocabulary' },
      { module: 'lib/ControlTyped.ts', found: 'status-keyed member' },
      { module: 'lib/ControlTyped.ts', found: 'status vocabulary' },
    ]);
  });

  it('classifies the outcome in that one module, and calls it from the seam', () => {
    // The positive half of 12.8: the facade gathers the three signals and calls
    // the classifier, which is why it needs no status of its own. A third module
    // reaching for `classifyOutcome` would be a second decision point.
    const callers = scannedModules
      .filter(({ source }) =>
        /\bclassifyOutcome\s*\(/.test(stripCommentsAndStrings(source)),
      )
      .map(({ file }) => featureRel(file));

    expect(callers.sort()).toEqual([CLASSIFIER_MODULE, TRANSPORT_MODULE].sort());
  });
});

// ---------------------------------------------------------------------------
// Requirement 12.6 — the wire shapes come from the generated contract.
// ---------------------------------------------------------------------------

/**
 * A declaration whose *name* announces a wire shape.
 *
 * The parsed read model is deliberately not named like this and deliberately is
 * not one: `PlayerProfile`, `RatingSummary`, and `RichStats` in `lib/parse/`
 * carry the values the screen presents — instants as milliseconds, durations as
 * milliseconds, no mean and no uncertainty — which is a narrower shape than the
 * body, derived from it by a parser rather than restating it. What this rule
 * forbids is a module declaring the *wire* a second time.
 */
const WIRE_SHAPE_DECLARATION =
  /\b(?:type|interface)\s+(\w*(?:Request|Dto|Payload|RequestBody|ResponseBody|ApiRequest|ApiResponse))\b/g;

/** Every wire-shape-named declaration in `modules`. */
function wireShapeDeclarations(modules: readonly ScannedModule[]): Finding[] {
  const findings: Finding[] = [];
  for (const { file, source } of modules) {
    const code = stripCommentsAndStrings(source);
    WIRE_SHAPE_DECLARATION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIRE_SHAPE_DECLARATION.exec(code)) !== null) {
      findings.push({ module: featureRel(file), found: match[1] });
    }
  }
  return findings;
}

/** Every module of `modules` that indexes one of the generated type tables. */
function generatedIndexFindings(modules: readonly ScannedModule[]): Finding[] {
  return findingsOf(
    modules,
    [
      { label: 'operations index', pattern: /\boperations\s*\[/ },
      { label: 'components index', pattern: /\bcomponents\s*\[/ },
      { label: 'paths index', pattern: /\bpaths\s*\[/ },
    ],
    stripCommentsAndStrings,
  );
}

describe('no hand-written type duplicates a generated shape (Requirement 12.6)', () => {
  it('declares no wire-shape type of its own anywhere in the feature', () => {
    // `GetPlayerProfile` sends no request body at all — the operation declares
    // `requestBody?: never`, and the two identities travel as path parameters —
    // so there is no request shape to restate and the permitted set is empty.
    expect(wireShapeDeclarations(scannedModules)).toEqual([]);
  });

  it('detects a hand-written request or response shape', () => {
    expect(
      wireShapeDeclarations([
        control(
          'state/ControlModule.ts',
          'interface GetPlayerProfileRequest { squadId: string }\n' +
            'type PlayerProfileResponseBody = { membershipId: string };',
        ),
      ]),
    ).toEqual([
      { module: 'state/ControlModule.ts', found: 'GetPlayerProfileRequest' },
      { module: 'state/ControlModule.ts', found: 'PlayerProfileResponseBody' },
    ]);
  });

  it('indexes the generated type tables in the facade and the wire enums only', () => {
    // The two namers are also the only two readers: the facade indexes
    // `operations` to pin the response body, the wire enums index
    // `components['schemas']` to pin the two enum unions, and no third module
    // reads the generated document at all.
    expect(ordered(generatedIndexFindings(scannedModules))).toEqual(
      ordered([
        { module: TRANSPORT_MODULE, found: 'operations index' },
        { module: WIRE_ENUMS_MODULE, found: 'components index' },
      ]),
    );
  });

  it('detects a third module indexing the generated tables', () => {
    expect(
      generatedIndexFindings([
        control(
          'lib/ControlModule.ts',
          "type Profile = components['schemas']['PlayerProfile'];",
        ),
      ]),
    ).toEqual([{ module: 'lib/ControlModule.ts', found: 'components index' }]);
  });

  it('derives the response body from the operation and passes it on uncast', () => {
    // The positive half of 12.6: the body type is read off the contract, and the
    // value is handed to the Response_Parser exactly as the client typed it. A
    // cast at the handoff would make the annotation decorative.
    const withStrings = readWithoutComments(facadePath);
    const code = stripCommentsAndStrings(readFileSync(facadePath, 'utf8'));

    expect(withStrings).toContain("operations[TOperation]['responses']");
    expect(withStrings).toContain("'application/json': infer TBody");
    expect(withStrings).toMatch(/:\s*ClientCall<'GetPlayerProfile'>\s*=>/);
    expect(withStrings).toMatch(/:\s*ClientCall<'GetSquadLeaderboard'>\s*=>/);
    // Each operation hands its own parser to the one call path, which applies
    // it to the body exactly as the client typed it.
    expect(code).toMatch(/\bparsePlayerProfile,/);
    expect(code).toMatch(/\bparseLeaderboard\s*\(\s*body\s*,\s*statistic\s*\)/);
    expect(code).toMatch(/\bparse\s*\(\s*settlement\.body\s*\)/);
  });
});
