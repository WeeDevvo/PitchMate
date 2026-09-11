/**
 * Unit tests for the Squads_Api's use of the **injected** Authenticated_Api_Client
 * (task 6.3).
 *
 * Requirement 16.1 says every squads backend call goes through the Squads_Api,
 * and 16.2 that the Squads_Api issues every one of them through the
 * Authenticated_Api_Client obtained from the Auth_Feature — "so that
 * access-token attachment and renewal remain owned by the Auth_Feature". That is
 * two claims, and they need different kinds of evidence, so this file makes both
 * kinds:
 *
 * 1. **Behavioural** — every one of the fourteen methods issues its request
 *    through the client instance it was handed, and through no other. Two
 *    facades are built over two separately-configured clients and driven in the
 *    same test, so a module-level singleton or a lazily-constructed default
 *    client would send a request to the wrong transport and fail. A third,
 *    never-injected transport is installed as `globalThis.fetch` — the transport
 *    a client the facade built for itself would default to — and asserted never
 *    to be reached.
 * 2. **Credential-blind** — the `Authorization` header an injected client's
 *    middleware attaches arrives intact on every call, and no header appears on
 *    any call when the injected client attaches none. The facade therefore
 *    neither strips nor adds a credential. The middleware used is the
 *    Auth_Feature's real `createAuthenticatedApiClient`, not a stand-in, so the
 *    "obtained from the Auth_Feature" half of 16.2 is exercised as wired rather
 *    than as imagined; the token source is asserted to be consulted once per
 *    request, which is what makes renewal the Auth_Feature's business.
 * 3. **Structural** — a source scan of `api/squadsApi.ts` for the two things a
 *    behavioural test cannot see: that the module calls no Api_Client factory
 *    and `new`s no client (its only import of `@pitchmate/api-client` is
 *    type-only, which makes construction impossible rather than merely absent),
 *    and that it names no token, refresh, session, or credential-storage value.
 *    A behavioural test cannot prove an absence over inputs it did not think of;
 *    a scan over the live code can. It follows the technique the App_Shell's
 *    `transportSeam.structural.test.ts` established — strip comments *and*
 *    string contents before matching identifiers, because this module's docblocks
 *    discuss at length the very things it must not do, and a scan that read prose
 *    would flag the documentation promising compliance.
 *
 * Request shapes, the Squad_Call_Timeout, the abandonment distinction, and parse
 * failures are the sibling `squadsApi.test.ts`'s subject and are not repeated
 * here; every reply below is a bare `204` because *what* came back is beside the
 * point of these claims.
 *
 * Requirements: 16.1, 16.2
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createApiClient,
  type PitchMateApiClient,
} from '@pitchmate/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTHORIZATION_HEADER,
  bearerCredential,
  createAuthenticatedApiClient,
  type BearerTokenSource,
} from '../../auth';

import {
  createSquadsApi,
  type CallResult,
  type CreateGuestRequest,
  type CreateSquadRequest,
  type EditGuestRequest,
  type GenerateInviteRequest,
  type RedeemInviteRequest,
  type SetFeatureFlagRequest,
  type SquadsApi,
  type SquadsApiDependencies,
} from './squadsApi';

// --- The dependency is the generated client, checked at compile time ---------

/**
 * A compile-time identity check, satisfied only when two types are mutually
 * assignable — so neither a widened nor a narrowed alias passes.
 */
type AssertIdentical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * 16.2: the injected dependency **is** the generated `PitchMateApiClient`. A
 * hand-rolled client interface, or a structural subset of the real one, fails to
 * compile here — which is what stops the facade quietly accepting something that
 * is not the Auth_Feature's client.
 */
const DEPENDENCY_IS_THE_GENERATED_CLIENT: AssertIdentical<
  SquadsApiDependencies['apiClient'],
  PitchMateApiClient
> = true;

// --- Fixtures ---------------------------------------------------------------

const INJECTED_BASE_URL = 'https://injected.test';
const OTHER_BASE_URL = 'https://other.test';

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4718-8a9b-0c1d2e3f4a5b';
const INVITE_ID = '9e107d9d-3728-4c9b-9a5c-58f3e1f0d1a2';

const ACCESS_TOKEN = 'an-access-token-the-auth-feature-owns';

const CREATE_SQUAD_COMMAND: CreateSquadRequest = {
  name: 'Thursday Nights',
  displayName: 'Dave',
};
const REDEEM_INVITE_COMMAND: RedeemInviteRequest = {
  presentedSecret: 'a-presented-secret',
  displayName: 'Dave',
};
const GENERATE_INVITE_COMMAND: GenerateInviteRequest = { nonExpiring: true };
const CREATE_GUEST_COMMAND: CreateGuestRequest = {
  displayName: 'BigDave',
  skillTier: 1,
  lawfulBasisAcknowledged: true,
};
const EDIT_GUEST_COMMAND: EditGuestRequest = {
  displayName: 'Big Dave',
  updateSkillTier: false,
};
const SET_FEATURE_FLAG_COMMAND: SetFeatureFlagRequest = { feature: 1, enabled: true };

/** The seven kinds a settled call may report — used only to prove it settled. */
const CALL_OUTCOME_KINDS: readonly string[] = [
  'success',
  'not-found',
  'auth-failure',
  'rejected-input',
  'timeout',
  'transport-failure',
  'parse-failure',
];

// --- The fourteen operations -------------------------------------------------

/**
 * One operation of the facade, reduced to its activation.
 *
 * These tests are about *which client* carries a call and *what credential* it
 * carries, so the request's method, path, and body — the sibling file's subject —
 * are deliberately absent from this table.
 */
interface OperationCase {
  readonly name: string;
  readonly invoke: (api: SquadsApi) => Promise<CallResult<unknown>>;
}

const OPERATIONS: readonly OperationCase[] = [
  { name: 'listMySquads', invoke: (api) => api.listMySquads() },
  { name: 'getSquad', invoke: (api) => api.getSquad(SQUAD_ID) },
  {
    name: 'getDisplayRatingLeaderboard',
    invoke: (api) => api.getDisplayRatingLeaderboard(SQUAD_ID),
  },
  { name: 'createSquad', invoke: (api) => api.createSquad(CREATE_SQUAD_COMMAND) },
  { name: 'redeemInvite', invoke: (api) => api.redeemInvite(REDEEM_INVITE_COMMAND) },
  { name: 'previewInvite', invoke: (api) => api.previewInvite() },
  { name: 'listInvites', invoke: (api) => api.listInvites(SQUAD_ID) },
  {
    name: 'generateInvite',
    invoke: (api) => api.generateInvite(SQUAD_ID, GENERATE_INVITE_COMMAND),
  },
  {
    name: 'revokeInvite',
    invoke: (api) => api.revokeInvite(SQUAD_ID, INVITE_ID),
  },
  {
    name: 'createGuest',
    invoke: (api) => api.createGuest(SQUAD_ID, CREATE_GUEST_COMMAND),
  },
  {
    name: 'editGuest',
    invoke: (api) => api.editGuest(SQUAD_ID, MEMBERSHIP_ID, EDIT_GUEST_COMMAND),
  },
  {
    name: 'promoteToAdmin',
    invoke: (api) => api.promoteToAdmin(SQUAD_ID, MEMBERSHIP_ID),
  },
  { name: 'getFeatureFlags', invoke: (api) => api.getFeatureFlags(SQUAD_ID) },
  {
    name: 'setFeatureFlag',
    invoke: (api) => api.setFeatureFlag(SQUAD_ID, SET_FEATURE_FLAG_COMMAND),
  },
];

// --- Recording transports and recording clients -----------------------------

/** What one request carried, as the transport saw it. */
interface RecordedRequest {
  readonly url: string;
  /** The `Authorization` header value, or `null` when none was attached. */
  readonly authorization: string | null;
  /** Every header name the request carried, lower-cased. */
  readonly headerNames: readonly string[];
  readonly headers: ReadonlyMap<string, string>;
}

/** A transport that records what reached it and always answers `204`. */
interface RecordingTransport {
  readonly fetch: typeof fetch;
  readonly requests: readonly RecordedRequest[];
}

function recordingTransport(): RecordingTransport {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: Request): Promise<Response> => {
    const headers = new Map<string, string>();
    input.headers.forEach((value, name) => headers.set(name.toLowerCase(), value));
    requests.push({
      url: input.url,
      authorization: input.headers.get(AUTHORIZATION_HEADER),
      headerNames: [...headers.keys()],
      headers,
    });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, requests };
}

/** The generated client's whole HTTP surface. */
const CLIENT_HTTP_METHODS = [
  'GET',
  'PUT',
  'POST',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'PATCH',
  'TRACE',
] as const;

/** One observed invocation of an Api_Client method. */
interface ClientInvocation {
  /** Which client instance was asked — the whole point of the recording. */
  readonly instance: string;
  readonly method: string;
}

/**
 * Wrap a real generated client so every HTTP-method call on it is observed,
 * tagged with the instance's label, and then forwarded unchanged.
 *
 * The wrapped object is the real client: the facade's calls still go through
 * `openapi-fetch`, its middleware, and its transport. Nothing is faked — the
 * proxy only watches, which is what lets an assertion about *which instance* was
 * used sit alongside an assertion about the header that actually left.
 */
function observing(
  client: PitchMateApiClient,
  instance: string,
  log: ClientInvocation[],
): PitchMateApiClient {
  const watched: readonly string[] = CLIENT_HTTP_METHODS;
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof property === 'string' &&
        watched.includes(property) &&
        typeof value === 'function'
      ) {
        const method = value as (...args: readonly unknown[]) => unknown;
        return (...args: readonly unknown[]): unknown => {
          log.push({ instance, method: property });
          return method.apply(target, args);
        };
      }
      return value;
    },
  });
}

/** A token source that counts how often the client's middleware consulted it. */
interface CountingTokenSource extends BearerTokenSource {
  readonly consultations: () => number;
}

function tokenSource(
  outcome:
    | { token: string }
    | { error: 'refresh-failed' }
    | { error: 'unauthenticated' },
): CountingTokenSource {
  let consultations = 0;
  return {
    getAccessTokenForRequest: async () => {
      consultations += 1;
      return outcome;
    },
    consultations: () => consultations,
  };
}

// --- The never-injected transport -------------------------------------------

/**
 * `globalThis.fetch`, replaced for every test by a transport nothing should
 * reach.
 *
 * This is the load-bearing half of "and through no other instance": a client the
 * facade constructed for itself would take no `fetch` option and would therefore
 * land here. Every test asserts this transport saw nothing.
 */
let neverInjected: RecordingTransport;

beforeEach(() => {
  neverInjected = recordingTransport();
  vi.stubGlobal('fetch', neverInjected.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Assert no request escaped to a transport the facade was never handed. */
function expectNothingEscaped(): void {
  expect(neverInjected.requests.map((request) => request.url)).toEqual([]);
}

// ---------------------------------------------------------------------------
// The facade's surface. If this drifts, every `it.each` below silently covers
// less than it claims to, so it is asserted first.
// ---------------------------------------------------------------------------

describe('the Squads_Api surface under test', () => {
  it('is the fourteen operations, every one of them exercised here', () => {
    expect(DEPENDENCY_IS_THE_GENERATED_CLIENT).toBe(true);

    const { api } = injectedFacade('injected');
    const methods = Object.keys(api).sort();

    expect(methods).toHaveLength(14);
    expect(methods).toEqual([...OPERATIONS.map((operation) => operation.name)].sort());
  });

  it('constructs nothing and issues nothing until a method is activated', () => {
    const log: ClientInvocation[] = [];
    const transport = recordingTransport();
    const client = observing(
      createApiClient({ baseUrl: INJECTED_BASE_URL, fetch: transport.fetch }),
      'injected',
      log,
    );

    createSquadsApi({ apiClient: client });

    // 16.1: building the facade is not a call. Nothing reached the injected
    // client, and nothing reached the global transport either.
    expect(log).toEqual([]);
    expect(transport.requests).toEqual([]);
    expectNothingEscaped();
  });
});

/** A facade over a freshly-configured, observed client and its own transport. */
function injectedFacade(instance: string): {
  readonly api: SquadsApi;
  readonly transport: RecordingTransport;
  readonly log: ClientInvocation[];
  readonly baseUrl: string;
} {
  const log: ClientInvocation[] = [];
  const transport = recordingTransport();
  const baseUrl = instance === 'injected' ? INJECTED_BASE_URL : OTHER_BASE_URL;
  const apiClient = observing(
    createApiClient({ baseUrl, fetch: transport.fetch }),
    instance,
    log,
  );
  return { api: createSquadsApi({ apiClient }), transport, log, baseUrl };
}

// ---------------------------------------------------------------------------
// Requirement 16.2 — every call issues through the injected instance.
// ---------------------------------------------------------------------------

describe('every call issues through the injected client (Requirement 16.2)', () => {
  it.each(OPERATIONS)(
    '$name asks the injected instance, and only that instance',
    async ({ invoke }) => {
      const { api, transport, log, baseUrl } = injectedFacade('injected');

      const outcome = await invoke(api);

      // The call settled, so the assertions below are about a completed call.
      expect(CALL_OUTCOME_KINDS).toContain(outcome.kind);
      // 16.2: exactly one Api_Client method invocation, on the injected instance.
      expect(log).toHaveLength(1);
      expect(log.every((invocation) => invocation.instance === 'injected')).toBe(true);
      expect(CLIENT_HTTP_METHODS as readonly string[]).toContain(log[0]?.method);
      // The injected instance's own configuration carried the request, which a
      // client built anywhere else could not have done.
      expect(transport.requests).toHaveLength(1);
      expect(transport.requests[0]?.url.startsWith(baseUrl)).toBe(true);
      expectNothingEscaped();
    },
  );

  it.each(OPERATIONS)(
    '$name follows the client it was given, not one the module remembers',
    async ({ invoke }) => {
      // Two facades, two separately-configured clients, driven in one test. A
      // module-level client — or a default one built on first use — would send
      // both calls to the same transport and fail one of these four assertions.
      const first = injectedFacade('injected');
      const second = injectedFacade('other');

      await invoke(first.api);
      await invoke(second.api);

      expect(first.transport.requests).toHaveLength(1);
      expect(second.transport.requests).toHaveLength(1);
      expect(first.transport.requests[0]?.url.startsWith(INJECTED_BASE_URL)).toBe(true);
      expect(second.transport.requests[0]?.url.startsWith(OTHER_BASE_URL)).toBe(true);
      expect(first.log.map((invocation) => invocation.instance)).toEqual(['injected']);
      expect(second.log.map((invocation) => invocation.instance)).toEqual(['other']);
      expectNothingEscaped();
    },
  );

  it('reaches no transport of its own across all fourteen operations', async () => {
    const { api, transport, log } = injectedFacade('injected');

    for (const { invoke } of OPERATIONS) {
      await invoke(api);
    }

    // 16.1: fourteen activations, fourteen requests, all through the one
    // injected client — and nothing at all through a client of the facade's own.
    expect(log).toHaveLength(OPERATIONS.length);
    expect(transport.requests).toHaveLength(OPERATIONS.length);
    expect(new Set(log.map((invocation) => invocation.instance))).toEqual(
      new Set(['injected']),
    );
    expectNothingEscaped();
  });
});

// ---------------------------------------------------------------------------
// Requirement 16.2 — the injected client's credential survives, untouched.
// ---------------------------------------------------------------------------

/** A facade over the Auth_Feature's real authenticated client. */
function authenticatedFacade(
  source: CountingTokenSource,
  extraHeader?: readonly [string, string],
): { readonly api: SquadsApi; readonly transport: RecordingTransport } {
  const transport = recordingTransport();
  const apiClient = createAuthenticatedApiClient(source, {
    baseUrl: INJECTED_BASE_URL,
    fetch: transport.fetch,
  });
  if (extraHeader !== undefined) {
    apiClient.use({
      onRequest({ request }) {
        request.headers.set(extraHeader[0], extraHeader[1]);
        return request;
      },
    });
  }
  return { api: createSquadsApi({ apiClient }), transport };
}

describe("the injected client's credential survives every call (Requirement 16.2)", () => {
  it.each(OPERATIONS)('$name carries the attached bearer credential', async ({ invoke }) => {
    const source = tokenSource({ token: ACCESS_TOKEN });
    const { api, transport } = authenticatedFacade(source);

    await invoke(api);

    expect(transport.requests).toHaveLength(1);
    // 16.2: the credential the Auth_Feature's middleware attached arrives
    // intact. The facade did not read it, re-derive it, or overwrite it.
    expect(transport.requests[0]?.authorization).toBe(bearerCredential(ACCESS_TOKEN));
    // Attachment and renewal stay the Auth_Feature's business: its token source
    // was consulted once for the one request, by the middleware, not the facade.
    expect(source.consultations()).toBe(1);
    expectNothingEscaped();
  });

  it('carries it on all fourteen operations, consulting the source once each', async () => {
    const source = tokenSource({ token: ACCESS_TOKEN });
    const { api, transport } = authenticatedFacade(source);

    for (const { invoke } of OPERATIONS) {
      await invoke(api);
    }

    expect(transport.requests).toHaveLength(OPERATIONS.length);
    expect(
      new Set(transport.requests.map((request) => request.authorization)),
    ).toEqual(new Set([bearerCredential(ACCESS_TOKEN)]));
    expect(source.consultations()).toBe(OPERATIONS.length);
    expectNothingEscaped();
  });

  it('renews nothing itself — a rotated token is simply the one that leaves', async () => {
    // A source answering a different token each time stands in for the
    // Auth_Feature's just-in-time renewal. Whatever it answers is what the
    // request carries, because the facade contributes nothing to the decision.
    let issued = 0;
    const rotating: BearerTokenSource = {
      getAccessTokenForRequest: async () => {
        issued += 1;
        return { token: `${ACCESS_TOKEN}-${issued}` };
      },
    };
    const transport = recordingTransport();
    const api = createSquadsApi({
      apiClient: createAuthenticatedApiClient(rotating, {
        baseUrl: INJECTED_BASE_URL,
        fetch: transport.fetch,
      }),
    });

    await api.listMySquads();
    await api.listMySquads();
    await api.getSquad(SQUAD_ID);

    expect(transport.requests.map((request) => request.authorization)).toEqual([
      bearerCredential(`${ACCESS_TOKEN}-1`),
      bearerCredential(`${ACCESS_TOKEN}-2`),
      bearerCredential(`${ACCESS_TOKEN}-3`),
    ]);
    expectNothingEscaped();
  });

  it.each(OPERATIONS)(
    '$name adds no credential of its own when the client attaches none',
    async ({ invoke }) => {
      // The Auth_Feature's middleware attaches nothing while unauthenticated. If
      // the facade held a credential — or invented one — a header would appear
      // here anyway.
      const source = tokenSource({ error: 'unauthenticated' });
      const { api, transport } = authenticatedFacade(source);

      await invoke(api);

      expect(transport.requests).toHaveLength(1);
      expect(transport.requests[0]?.authorization).toBeNull();
      expect(transport.requests[0]?.headerNames).not.toContain('authorization');
      expect(source.consultations()).toBe(1);
      expectNothingEscaped();
    },
  );

  it('adds no credential when a plain client is injected, and asks for no token', async () => {
    const source = tokenSource({ token: ACCESS_TOKEN });
    const transport = recordingTransport();
    // A client with no auth middleware at all: the facade has no other way to
    // reach a token, so none can be attached.
    const api = createSquadsApi({
      apiClient: createApiClient({
        baseUrl: INJECTED_BASE_URL,
        fetch: transport.fetch,
      }),
    });

    for (const { invoke } of OPERATIONS) {
      await invoke(api);
    }

    expect(transport.requests).toHaveLength(OPERATIONS.length);
    expect(
      transport.requests.filter((request) => request.authorization !== null),
    ).toEqual([]);
    expect(source.consultations()).toBe(0);
    expectNothingEscaped();
  });

  it.each(OPERATIONS)(
    '$name leaves every other header the injected client set intact',
    async ({ invoke }) => {
      // A second middleware header stands for anything else the Auth_Feature's
      // client may install. The facade is a pass-through for all of it.
      const source = tokenSource({ token: ACCESS_TOKEN });
      const { api, transport } = authenticatedFacade(source, [
        'X-PitchMate-Client',
        'injected-marker',
      ]);

      await invoke(api);

      const request = transport.requests[0];
      expect(request?.headers.get('x-pitchmate-client')).toBe('injected-marker');
      expect(request?.authorization).toBe(bearerCredential(ACCESS_TOKEN));
      expectNothingEscaped();
    },
  );
});

// ---------------------------------------------------------------------------
// Requirements 16.1, 16.2 — structural: no construction, no credential reading.
// ---------------------------------------------------------------------------

const facadeSourcePath = join(dirname(fileURLToPath(import.meta.url)), 'squadsApi.ts');
const facadeSource = readFileSync(facadeSourcePath, 'utf8');

/**
 * Remove `//` and block comments, preserving string literals — which is what the
 * import checks need, since an import specifier *is* a string literal.
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

    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i];
          if (i + 1 < n) out += source[i + 1];
          i += 2;
          continue;
        }
        out += source[i];
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
 * non-string code. Template *expressions* are kept, so an identifier hidden in
 * an interpolation is still visible.
 *
 * This is the stripper the identifier scans use. The facade's docblocks discuss
 * bearer attachment, tokens, sessions, and credentials at length precisely
 * because it does none of it; matching prose would flag the documentation.
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

const facadeCodeWithStrings = stripComments(facadeSource);
const facadeLiveCode = stripCommentsAndStrings(facadeSource);

/** Api_Client factories, none of which the facade may call. */
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
  { label: 'new …Client', pattern: /\bnew\s+\w*Client\b/ },
  // `client.use(…)` installs middleware, which only an owner of a client does.
  { label: '.use( middleware installation', pattern: /\b\w+\s*\.\s*use\s*\(/ },
];

describe('the facade constructs no Api_Client (Requirements 16.1, 16.2)', () => {
  it('scans live code, not prose (guard on the stripper)', () => {
    // The docblocks say "bearer", "token", and "session"; the live code must
    // not. If the stripper stopped working, the scans below would be either
    // vacuous or self-defeating, so both halves are checked here.
    expect(facadeSource).toMatch(/bearer/i);
    expect(facadeLiveCode).not.toMatch(/bearer/i);
    expect(facadeLiveCode).toMatch(/\bexport\s+function\s+createSquadsApi\b/);
    expect(facadeCodeWithStrings).toMatch(/@pitchmate\/api-client/);
  });

  it('calls no Api_Client factory and news no client', () => {
    const offenders = CLIENT_CONSTRUCTION_PATTERNS.filter(({ pattern }) =>
      pattern.test(facadeLiveCode),
    ).map(({ label }) => label);
    expect(offenders).toEqual([]);
  });

  it('imports the generated package for types only, so construction is impossible', () => {
    // A value import is the only route to `createApiClient`; every import of the
    // package being type-only is what makes 16.2 structural rather than merely
    // observed.
    const packageImports = [
      ...facadeCodeWithStrings.matchAll(
        /import\s+([^;]*?)from\s*['"]@pitchmate\/api-client['"]/gs,
      ),
    ];
    expect(packageImports.length).toBeGreaterThan(0);
    for (const [, clause] of packageImports) {
      expect(clause.trimStart().startsWith('type')).toBe(true);
    }
  });

  it('takes the client as an injected dependency and issues every call on it', () => {
    expect(facadeLiveCode).toMatch(
      /function\s+createSquadsApi\s*\(\s*\{\s*apiClient\s*\}\s*:\s*SquadsApiDependencies\s*\)/,
    );
    // Every HTTP verb the facade uses is invoked on that one injected parameter.
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH'] as const) {
      expect(facadeLiveCode).toMatch(new RegExp(`\\bapiClient\\.${verb}\\s*\\(`));
    }
    // And no HTTP-method call is made on anything else.
    const clientCalls = [
      ...facadeLiveCode.matchAll(
        /(\w+)\s*\.\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/g,
      ),
    ].map(([, receiver]) => receiver);
    expect(clientCalls.length).toBe(OPERATIONS.length);
    expect(new Set(clientCalls)).toEqual(new Set(['apiClient']));
  });
});

/**
 * Identifiers that would mean the facade is reading, renewing, evaluating, or
 * persisting a credential itself rather than leaving it to the injected client.
 *
 * Matched against fully stripped code, so the module's own documentation of what
 * it does not do cannot trip them.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'token identifier', pattern: /\btoken\w*\b/i },
  { label: 'refresh identifier', pattern: /\brefresh\w*\b/i },
  { label: 'session identifier', pattern: /\bsession\w*\b/i },
  { label: 'credential identifier', pattern: /\bcredential\w*\b/i },
  { label: 'bearer identifier', pattern: /\bbearer\w*\b/i },
  { label: 'Authorization header', pattern: /\bauthorization\b/i },
  { label: 'JWT handling', pattern: /jwt/i },
  { label: 'base64 decoding', pattern: /\b(?:atob|btoa)\s*\(/ },
  { label: 'browser storage', pattern: /\b(?:localStorage|sessionStorage)\b/ },
  { label: 'cookie access', pattern: /\bcookie\b/i },
  { label: 'token retrieval hook', pattern: /\bgetAccessTokenForRequest\b/ },
  { label: 'auth state hook', pattern: /\buseAuth\w*\b/ },
  { label: 'middleware installation', pattern: /\bMiddleware\b/ },
];

describe('the facade reads no token, refresh, or session value (Requirement 16.2)', () => {
  it('names no credential, storage, or session identifier in live code', () => {
    const offenders = CREDENTIAL_PATTERNS.filter(({ pattern }) =>
      pattern.test(facadeLiveCode),
    ).map(({ label }) => label);
    expect(offenders).toEqual([]);
  });

  it('imports nothing from the Auth_Feature but receives its client', () => {
    // Access-token attachment and renewal remain the Auth_Feature's, and the
    // facade reaches none of that machinery: its only tie to auth is the client
    // parameter it is handed.
    const specifiers = [
      ...facadeCodeWithStrings.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g,
      ),
    ].map(([, , specifier]) => specifier);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => /(?:^|\/)auth(?:\/|$)/.test(specifier))).toEqual(
      [],
    );
    expect(specifiers).toContain('@pitchmate/api-client');
  });

  it('declares exactly one dependency, and it is the client', () => {
    const dependencies = facadeLiveCode.match(
      /interface\s+SquadsApiDependencies\s*\{([\s\S]*?)\n\}/,
    );
    expect(dependencies).not.toBeNull();
    const members = [
      ...(dependencies?.[1] ?? '').matchAll(/(\w+)\s*:\s*PitchMateApiClient\b/g),
    ].map(([, name]) => name);
    expect(members).toEqual(['apiClient']);
  });
});
