/**
 * Structural source scan: the Squads_Feature's transport seam (task 17.3).
 *
 * Requirement 20.11 makes this file part of the product rather than a courtesy
 * check. The rules it enforces are prohibitions and universals over a directory —
 * "route every backend call through the Squads_Api, and contain no direct network
 * call and no reference to the global fetch function in any module of the feature
 * other than through the Api_Client" (16.1), "issue every call through the
 * Authenticated_Api_Client obtained from the Auth_Feature" (16.2), "express every
 * request and response type through the generated types of the Api_Client ... so
 * that no type duplicates a contract the generated client already expresses"
 * (16.11), "place every Api_Client usage in the feature's single transport
 * directory, verified by a structural source scan over the feature's files"
 * (18.3) — and neither a prohibition nor a universal can be demonstrated by an
 * example. So the source tree is read and classified, following the mechanism
 * `features/app-shell/transportSeam.structural.test.ts` established and
 * `structural/sourceScan.ts` declares once: read each file's text, strip comments
 * and string literals through the same small state machine, and fail naming the
 * offending file and specifier.
 *
 * ### What is enforced
 *
 * | Rule | Requirement |
 * |---|---|
 * | Only `api/squadsApi.ts` names `@pitchmate/api-client` as a *value*, and `api/` holds it alone | 16.1, 18.3 |
 * | `lib/wireEnums.ts` may name it type-only, and nothing else may | 16.1, 18.3, 12.2 |
 * | No bare transport — `fetch`, `XMLHttpRequest`, `WebSocket`, … — anywhere in the feature | 16.1 |
 * | No Api_Client method call, endpoint path, or HTTP method literal outside the facade | 16.1, 18.3 |
 * | No Api_Client construction in the feature; the injected client is used | 16.2 |
 * | No hand-written type duplicating a generated request shape | 16.11 |
 *
 * ### Scope: production modules, not test files
 *
 * Every rule but one is scoped to the feature's **production** modules — the set
 * `structural/sourceScan.ts` calls {@link squadsModules}, which is everything
 * under the feature root but the test files and the scan-support directory. That
 * scoping is stated here rather than left implicit because this feature's tests
 * legitimately do the two things the rules forbid: `api/squadsApi.test.ts`,
 * `state/problemDisclosure.property.test.tsx`, and three screen property tests
 * drive the **real** `createSquadsApi` over the **real** generated client by
 * calling `createApiClient` themselves and injecting a fake `fetch`, precisely so
 * that their claims cover the wire rather than a mock of it. A scan that banned
 * `createApiClient` and `fetch` across the whole directory would forbid the
 * strongest tests in the feature, and Requirements 16.1 and 16.2 say "module of
 * the feature" and "the Squads_Api", not "every file in the folder".
 *
 * Two consequences are asserted rather than assumed. The facade *does* name the
 * generated client, so the "only one module names it" rule is a restriction and
 * not an accident of nobody using one; and the feature's tests *do* name it, so
 * the production scoping is a real exemption covering real code.
 *
 * ### The one type-only holdout
 *
 * `lib/wireEnums.ts` names the package too, and may: `api-response-contracts`
 * Requirement 12.2 has each named enum union expressed as an alias over
 * `components['schemas'][…]`, which only the generated package declares. The
 * holdout is admitted as the **erased** form alone — its import is asserted to be
 * `import type`, which compiles to no import at all — so what 16.1 and 18.3 are
 * about is untouched: that module holds no client, calls no method, names no
 * endpoint path, and cannot issue a request. A *value* import of the package
 * remains the facade's alone, which is the rule the assertions below now state.
 *
 * The one rule that runs over the *whole* feature, tests included, is the
 * `testing/` harness's membership of the production set: a harness sits in the
 * feature's directories and is held to the feature's boundaries, following the
 * App_Shell's precedent and 17.1's decision.
 *
 * ### Which stripper, and why
 *
 * - Import specifiers, endpoint paths, and HTTP method names *are* string
 *   literals, so those rules read {@link readWithoutComments} — comments gone,
 *   strings kept.
 * - The transport, client-construction, and type-declaration rules are about
 *   *identifiers*, so they read {@link readCodeOnly} — comments and string
 *   contents both gone. This matters more here than anywhere: `api/squadsApi.ts`
 *   opens by promising in prose that "a source scan over every other file under
 *   `features/squads/` finds no `fetch`, no `XMLHttpRequest`, and no Api_Client
 *   method call", `components/InviteReveal.tsx` documents touching no storage,
 *   and a scan matching prose would flag the documentation promising compliance.
 *
 * ### Deliberately not asserted here
 *
 * The facade's freedom from token, refresh, session, and credential-storage
 * values is held by `api/squadsApi.client.test.ts`, which scans that module
 * directly alongside behavioural tests that the injected client's middleware is
 * what attaches a bearer. A feature-wide credential ban would flag
 * `testing/squadsScreenStates.tsx`, whose fake Session_Manager necessarily
 * implements `getAccessTokenForRequest`, and would be asserting something about
 * the harness rather than about the product.
 *
 * Requirements: 16.1, 16.2, 16.11, 18.3, 20.11
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectProductionSources,
  collectSources,
  inAppImports,
  isTestFile,
  norm,
  readCodeOnly,
  readWithoutComments,
  relTo,
  squadsModules,
  squadsRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The one module of the feature permitted to touch transport, relative to root. */
const TRANSPORT_MODULE = 'api/squadsApi.ts';

/** The feature's single transport directory (Requirement 18.3). */
const transportRoot = join(squadsRoot, 'api');

/** The facade itself. */
const facadePath = join(transportRoot, 'squadsApi.ts');

/** The feature's production modules: the set every rule below binds. */
const featureModules = squadsModules();

/** Every production module but the facade. */
const modulesOutsideTransport = featureModules.filter(
  (file) => relTo(squadsRoot, file) !== TRANSPORT_MODULE,
);

/** Every test file of the feature, for the two non-vacuity checks. */
const featureTests = collectSources(squadsRoot).filter((file) =>
  isTestFile(relTo(squadsRoot, file)),
);

/** Path relative to the feature root, in forward-slash form, for messages. */
function featureRel(path: string): string {
  return relTo(squadsRoot, path);
}

/** An import of the generated typed client, root specifier or any sub-path. */
const API_CLIENT_SPECIFIER = /['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/;

/**
 * The one module admitted to name the package type-only (Requirement 12.2): the
 * wire enum unions, which alias `components['schemas'][…]`.
 */
const WIRE_ENUMS_MODULE = 'lib/wireEnums.ts';

/** A *value* import of the generated client — the thing that reaches its factory. */
const API_CLIENT_VALUE_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?from\s*['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/m;

/** The six generated request bodies this feature sends (Requirement 16.11). */
const GENERATED_REQUEST_TYPES = [
  'CreateSquadRequest',
  'RedeemInviteRequest',
  'GenerateInviteRequest',
  'CreateGuestRequest',
  'EditGuestRequest',
  'SetFeatureFlagRequest',
] as const;

// ---------------------------------------------------------------------------
// Invariant 0: the scan sees something.
//
// Every rule below is a prohibition, so a scan that discovered nothing would
// pass all of them. That is ruled out first.
// ---------------------------------------------------------------------------

describe('the transport scan sees the Squads_Feature and its seam', () => {
  it('is rooted at apps/web/src/features/squads', () => {
    expect(norm(squadsRoot).endsWith('apps/web/src/features/squads')).toBe(true);
  });

  it('discovers the production modules, the facade among them, and no test file', () => {
    const names = featureModules.map(featureRel);

    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain(TRANSPORT_MODULE);
    expect(names).toContain('screens/SquadsHome.tsx');
    expect(names).toContain('state/useGuestManager.ts');
    expect(names.filter(isTestFile)).toEqual([]);
    // The rules below quantify over "every module but the facade", which would be
    // hollow if that set were the whole feature or nothing at all.
    expect(modulesOutsideTransport.length).toBe(featureModules.length - 1);
  });

  it('discovers the feature test files the production scoping exempts', () => {
    // The scoping note in this file's docblock is only honest if those tests
    // exist. They do, and several of them drive the real generated client.
    expect(featureTests.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Requirements 16.1, 18.3 — one transport seam, in one transport directory.
// ---------------------------------------------------------------------------

describe('only api/squadsApi.ts names the Api_Client (Requirements 16.1, 18.3)', () => {
  it('names the generated client in exactly the facade and the wire enums', () => {
    const naming = featureModules
      .filter((file) => API_CLIENT_SPECIFIER.test(readWithoutComments(file)))
      .map(featureRel);

    expect(naming.sort()).toEqual([WIRE_ENUMS_MODULE, TRANSPORT_MODULE].sort());
  });

  it('makes no value import of it anywhere in the feature (Requirement 16.2)', () => {
    // Neither module reaches the package's factory: both imports are type-only,
    // so no production module of this feature can construct a client at all. The
    // facade is handed one.
    const valueImporters = featureModules
      .filter((file) => API_CLIENT_VALUE_IMPORT.test(readWithoutComments(file)))
      .map(featureRel);

    expect(valueImporters).toEqual([]);
  });

  it('lets the wire enums name the schema table and nothing else (12.2)', () => {
    // What separates the holdout from a second seam is *which* name it takes. It
    // imports the generated schema table, type-only, and no client type — so it
    // has nothing to call a method on. The rules below pin the rest: no endpoint
    // path, no HTTP method literal, no client method call outside the facade.
    const wireEnumsCode = readWithoutComments(
      join(squadsRoot, 'lib', 'wireEnums.ts'),
    );

    expect(wireEnumsCode).toMatch(API_CLIENT_SPECIFIER);
    expect(wireEnumsCode).not.toMatch(API_CLIENT_VALUE_IMPORT);
    expect(wireEnumsCode).toMatch(
      /import\s+type\s*\{\s*components\s*,?\s*\}\s*from\s*['"]@pitchmate\/api-client['"]/,
    );
    expect(wireEnumsCode).not.toMatch(/\bPitchMateApiClient\b/);
    expect(wireEnumsCode).not.toMatch(/\bcreateApiClient\b/);
  });

  it('holds the whole transport directory in that one production module', () => {
    // 18.3 speaks of "the feature's single transport directory". One directory
    // with one module in it is what makes the seam a seam rather than a habit.
    const transportModules = collectProductionSources(transportRoot).map(featureRel);

    expect(transportModules).toEqual([TRANSPORT_MODULE]);
  });

  it('is not vacuous: the facade does name the generated client', () => {
    expect(readWithoutComments(facadePath)).toMatch(API_CLIENT_SPECIFIER);
  });

  it('is a real exemption: the feature tests name the generated client too', () => {
    // These are the tests that drive `createSquadsApi` over the real client with
    // an injected `fetch`. If none existed, the production-only scoping above
    // would be excusing nothing and could simply be widened.
    const naming = featureTests
      .filter((file) => API_CLIENT_SPECIFIER.test(readWithoutComments(file)))
      .map(featureRel);

    expect(naming.length).toBeGreaterThan(0);
  });
});

/**
 * Bare transports that would bypass the generated client entirely.
 *
 * `\bfetch\s*\(` also catches `window.fetch(` and `globalThis.fetch(`, since `.`
 * is a word boundary; the bare identifier is matched too, so passing `fetch`
 * along as a value is caught as well as calling it.
 */
const BARE_TRANSPORT_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'fetch', pattern: /\bfetch\b/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bWebSocket\b/ },
  { label: 'EventSource', pattern: /\bEventSource\b/ },
  // `navigator` itself is not banned: `components/InviteReveal.tsx` reaches
  // `navigator.clipboard` to copy an invite link, which is not transport. The one
  // network member of that object is named instead.
  { label: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { label: 'axios', pattern: /\baxios\b/ },
];

describe('no module of the feature performs bare transport (Requirement 16.1)', () => {
  it('references no network global, the facade included', () => {
    // The facade is *in* this set: it reaches the network through the injected
    // Api_Client and never through `fetch` itself, which is what makes "every
    // call goes through the Api_Client" true rather than merely centralised.
    const offenders: Array<{ module: string; transport: string }> = [];

    for (const file of featureModules) {
      const code = readCodeOnly(file);
      for (const { label, pattern } of BARE_TRANSPORT_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ module: featureRel(file), transport: label });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('calls no Api_Client method outside the facade', () => {
    // `client.GET(…)` / `client.POST(…)` and friends: the generated client's whole
    // surface. Anywhere but the facade this is transport leaking upwards. The
    // match is case-sensitive, so a `Map.get(…)` or `Map.delete(…)` is not it.
    const clientMethodCall =
      /\.\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/;

    const offenders = modulesOutsideTransport
      .filter((file) => clientMethodCall.test(readCodeOnly(file)))
      .map(featureRel);

    expect(offenders).toEqual([]);
  });

  it('writes no squads endpoint path outside the facade', () => {
    // A `'/squads…'` literal outside the facade means a second module knows the
    // wire contract, which is the thing one seam exists to prevent. The feature's
    // *route* paths are `/app/squads/…` and `/join/:code`, so they do not match:
    // the quote must be followed immediately by `/squads`.
    const endpointLiteral = /(['"`])\/squads(?:[/?#]|\1)/;

    const offenders = modulesOutsideTransport
      .filter((file) => endpointLiteral.test(readWithoutComments(file)))
      .map(featureRel);

    expect(offenders).toEqual([]);
  });

  it('writes no OpenAPI-templated path outside the facade', () => {
    // The rule above names `/squads`; this one catches the next endpoint someone
    // reaches for, whatever its prefix, by the `{param}` spelling only a wire
    // path uses. A template literal's `${…}` is excluded — `/app/squads/${id}` is
    // a route being built, not a contract being restated.
    const templatedPath = /(['"`])\/[^'"`$]*\{[A-Za-z][\w]*\}/;

    const offenders = modulesOutsideTransport
      .filter((file) => templatedPath.test(readWithoutComments(file)))
      .map(featureRel);

    expect(offenders).toEqual([]);
  });

  it('writes no HTTP method as a literal anywhere in the feature', () => {
    // The generated client's methods carry the verb, so a `'POST'` literal means
    // a module is describing a request the generated types already describe.
    const methodLiteral = /(['"`])(?:GET|POST|PUT|PATCH|DELETE|HEAD)\1/;

    const offenders = featureModules
      .filter((file) => methodLiteral.test(readWithoutComments(file)))
      .map(featureRel);

    expect(offenders).toEqual([]);
  });

  it('routes every facade call through the generated client', () => {
    // The positive half: the seam is not merely the only module allowed to touch
    // transport, it is the module that does.
    const code = readCodeOnly(facadePath);

    for (const method of ['GET', 'POST', 'PUT', 'PATCH']) {
      expect(code, `the facade must issue a ${method}`).toMatch(
        new RegExp(`\\bapiClient\\s*\\.\\s*${method}\\s*\\(`),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 16.2 — the client is injected, never constructed.
// ---------------------------------------------------------------------------

const CLIENT_CONSTRUCTION_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'createApiClient(', pattern: /\bcreateApiClient\s*\(/ },
  {
    label: 'createAuthenticatedApiClient(',
    pattern: /\bcreateAuthenticatedApiClient\s*\(/,
  },
  { label: 'createClient(', pattern: /\bcreateClient\s*\(/ },
  { label: 'createFetchClient(', pattern: /\bcreateFetchClient\s*\(/ },
  { label: 'createAuthMiddleware(', pattern: /\bcreateAuthMiddleware\s*\(/ },
];

describe('the feature constructs no Api_Client of its own (Requirement 16.2)', () => {
  it('calls no Api_Client factory and installs no middleware', () => {
    // Access-token attachment and renewal stay the Auth_Feature's: this feature
    // receives a client that already attaches a bearer, so it needs no factory
    // and no middleware of its own.
    const offenders: Array<{ module: string; factory: string }> = [];

    for (const file of featureModules) {
      const code = readCodeOnly(file);
      for (const { label, pattern } of CLIENT_CONSTRUCTION_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ module: featureRel(file), factory: label });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('imports the generated package type-only, so construction is impossible', () => {
    // A value import of `@pitchmate/api-client` is the only way to reach its
    // factory. Keeping every production import type-only makes constructing a
    // client impossible rather than merely absent.
    const valueImport =
      /^\s*import\s+(?!type\b)[^;]*?from\s*['"]@pitchmate\/api-client(?:\/[^'"]*)?['"]/m;

    const offenders = featureModules
      .filter((file) => valueImport.test(readWithoutComments(file)))
      .map(featureRel);

    expect(offenders).toEqual([]);
  });

  it('receives the client as an injected dependency, typed by the contract', () => {
    const withStrings = readWithoutComments(facadePath);
    const code = readCodeOnly(facadePath);

    // The dependency is the generated client type, named from the package.
    expect(withStrings).toMatch(
      /import\s+type\s*\{[^}]*\bPitchMateApiClient\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s,
    );
    expect(code).toMatch(
      /\breadonly\s+apiClient\s*:\s*PitchMateApiClient\b/,
    );
    // And it arrives as a parameter of the factory rather than being reached for.
    expect(code).toMatch(
      /function\s+createSquadsApi\s*\(\s*\{\s*apiClient\s*\}\s*:\s*SquadsApiDependencies\s*\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 16.11 — request shapes come from the generated contract.
// ---------------------------------------------------------------------------

describe('no hand-written type duplicates a generated request shape (Req 16.11)', () => {
  const facadeWithStrings = readWithoutComments(facadePath);

  it('aliases the generated schema table rather than restating it', () => {
    expect(facadeWithStrings).toMatch(
      /import\s+type\s*\{[^}]*\bcomponents\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s,
    );
    expect(facadeWithStrings).toMatch(
      /\btype\s+Schemas\s*=\s*components\s*\[\s*'schemas'\s*\]/,
    );
  });

  it('derives each of the six request bodies from the generated schema', () => {
    // `type CreateSquadRequest = Schemas['CreateSquadRequest']` — the alias reads
    // the contract, so a backend change to any of these bodies fails to compile
    // here rather than diverging silently.
    const undeclared = GENERATED_REQUEST_TYPES.filter(
      (name) =>
        !new RegExp(
          `\\btype\\s+${name}\\s*=\\s*(?:Schemas|components\\s*\\[\\s*'schemas'\\s*\\])\\s*\\[\\s*'${name}'\\s*\\]`,
        ).test(facadeWithStrings),
    );

    expect(undeclared).toEqual([]);
  });

  it('declares each of those names in the facade and nowhere else', () => {
    // A second declaration anywhere in the feature would be the hand-written
    // duplicate 16.11 forbids, whether or not it happened to agree today.
    const offenders: Array<{ module: string; declaration: string }> = [];

    for (const file of modulesOutsideTransport) {
      const code = readCodeOnly(file);
      for (const name of GENERATED_REQUEST_TYPES) {
        if (new RegExp(`\\b(?:type|interface)\\s+${name}\\b`).test(code)) {
          offenders.push({ module: featureRel(file), declaration: name });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('has every module naming a request body import it from the facade', () => {
    // The forms, the hooks, and the screens all build command bodies. Each must
    // reach the *generated* type through the seam; a module that named the type
    // without importing it would be declaring its own.
    const offenders: Array<{ module: string; type: string }> = [];
    const facadeTarget = norm(facadePath).replace(/\.tsx?$/, '');

    for (const file of modulesOutsideTransport) {
      const code = readCodeOnly(file);
      const named = GENERATED_REQUEST_TYPES.filter((name) =>
        new RegExp(`\\b${name}\\b`).test(code),
      );
      if (named.length === 0) continue;

      const importsFacade = inAppImports(file).some(
        ({ target }) => target.replace(/\.tsx?$/, '') === facadeTarget,
      );

      if (!importsFacade) {
        for (const name of named) {
          offenders.push({ module: featureRel(file), type: name });
        }
      }
    }

    expect(offenders).toEqual([]);
    // Non-vacuity: those command bodies are built somewhere, so the rule has to
    // have had something to quantify over.
    const consumers = modulesOutsideTransport.filter((file) => {
      const code = readCodeOnly(file);
      return GENERATED_REQUEST_TYPES.some((name) =>
        new RegExp(`\\b${name}\\b`).test(code),
      );
    });
    expect(consumers.length).toBeGreaterThan(3);
  });

  it('declares no wire-shape type of its own anywhere in the feature', () => {
    // A `…Request`, `…Dto`, `…Payload`, `…RequestBody`, or `…ResponseBody`
    // declaration outside the facade's six aliases is a hand-written duplicate of
    // something the generated contract already says. The Guest_Form's
    // `GuestCreateSubmission` and `GuestEditSubmission` are deliberately *not*
    // such types and deliberately not named like them: they carry the tier
    // *selection* a person made, which `lib/skillTier.ts` maps into the generated
    // `CreateGuestRequest`/`EditGuestRequest` fields. The submission is a form
    // value; the request is the wire, and only the wire type is generated.
    const wireShapeDeclaration =
      /\b(?:type|interface)\s+(\w*(?:Request|Dto|Payload|RequestBody|ResponseBody|ApiRequest|ApiResponse))\b/g;
    const permitted = new Set<string>(GENERATED_REQUEST_TYPES);
    const offenders: Array<{ module: string; declaration: string }> = [];

    for (const file of featureModules) {
      const code = readCodeOnly(file);
      wireShapeDeclaration.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wireShapeDeclaration.exec(code)) !== null) {
        if (!permitted.has(match[1])) {
          offenders.push({ module: featureRel(file), declaration: match[1] });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('types the leaderboard query value from the generated operation', () => {
    // The one request *query* value the feature sends. Requirement 16.11 covers
    // it as much as a body: the statistic name is typed by the operation's own
    // query type, so a contract that renamed or dropped it fails to compile.
    expect(facadeWithStrings).toMatch(
      /import\s+type\s*\{[^}]*\boperations\b[^}]*\}\s*from\s*['"]@pitchmate\/api-client['"]/s,
    );
    expect(facadeWithStrings).toContain(
      "operations['GetSquadLeaderboard']['parameters']['query']",
    );
    expect(facadeWithStrings).toMatch(
      /\bDISPLAY_RATING_STATISTIC\s*:\s*NonNullable<\s*LeaderboardQuery\['statistic'\]\s*>/,
    );
  });
});
