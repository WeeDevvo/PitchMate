import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type { paths, PitchMateApiClient } from '@pitchmate/api-client';

import type { PlayerProfile } from '../lib/parse/playerProfile';
import { anyProfileFixtureArb } from '../testing/playerProfileFixtures';
import {
  createPlayerStatsApi,
  PROFILE_CALL_TIMEOUT_MS,
  type CallResult,
  type PlayerStatsApi,
} from './playerStatsApi';

/**
 * Property 4: no failing outcome carries anything renderable — plus the two
 * claims about the seam's request behaviour that belong beside it (task 4.6).
 *
 * Requirement 3.7 says nothing taken from a rejected response's body, status,
 * or headers may be rendered, logged to the interface, or placed in an
 * accessible name. Requirement 12.5 says no failing `CallResult` carries a
 * status code, a header, a response body value, or any part of a problem
 * response. Those are absence claims, and an absence is only worth asserting
 * against the thing that could have carried it — so this file drives the real
 * `createPlayerStatsApi` over the whole space of things the Api_Client can do
 * and then **walks what comes back**, looking for anything a component could
 * render.
 *
 * ## Four kinds of evidence, because no one kind is enough
 *
 * 1. **A reflective walk of every failing result.** `Reflect.ownKeys` over the
 *    value and its prototype chain, transitively, cycle-guarded, naming
 *    accessors without invoking them. The claim is that the whole graph is one
 *    member — `kind` — holding one of four fixed tag strings, and that no member
 *    name anywhere in it denotes a status, a header, a response body, or a
 *    problem-response member. A declared type cannot make that claim: a value
 *    can carry members its type does not, and the guarantee is about the graph
 *    rather than the top level.
 * 2. **Value-level non-disclosure.** Walking for *names* would miss a status
 *    carried under an innocent name, so each generated client behaviour also
 *    reports the distinctive values it sent — the status code, a marked string
 *    planted in the body, a marked rejection message, the body's own membership
 *    identity — and the walk asserts that none of them appears anywhere in the
 *    failing result. The strongest case here is a **valid body carried on a
 *    rejecting status**: the parser would have accepted it, and the result must
 *    still carry none of it.
 * 3. **A type-level assertion that no failing arm declares a field.** The
 *    runtime walk can only speak about the behaviours generated; the type check
 *    speaks about every behaviour there will ever be. It is written
 *    distributively, so adding a field to *any* failing arm fails the build
 *    rather than quietly passing because another arm has none.
 * 4. **A throwing accessor on the client's `error`.** The facade declares no
 *    `error` member on its view of the client result, which is a promise about
 *    the source rather than evidence about the behaviour. So every stubbed
 *    result offers `error` — and `headers`, and the response's `headers`,
 *    `statusText`, `url`, `body`, `json`, `text`, and `clone` — as accessors
 *    that record the read and then raise. A seam that read any of them is
 *    caught twice: the read is in the log, and the call rejects instead of
 *    settling.
 *
 * ## And the two request-behaviour claims
 *
 * Requirement 2.6 ("exactly one request per activation, no retry, re-issue, or
 * fallback") and Requirement 12.4 (a caller's signal aborts the request in
 * flight) are asserted here too, because they are claims about the same stubbed
 * client and the same settled calls: every behaviour above is checked for
 * exactly one recorded request, repeated activations are checked for exactly
 * one request each, and a caller abort is checked to abort the signal the client
 * was handed and to settle the call as a transport failure — never as the
 * `timeout` our own lapsed limit reports.
 *
 * The Profile_Call_Timeout is driven with `vi.useFakeTimers()`, which is why the
 * seam uses an `AbortController` plus `setTimeout` rather than
 * `AbortSignal.timeout` (Requirement 12.3). Nothing waits ten seconds.
 *
 * The client is a local stub rather than the generated client over an injected
 * `fetch`: the subject is what the seam does with what the client hands back,
 * including results a real client would be unlikely to produce (a non-numeric
 * status, no response at all, a rejection that is not an `Error`), and a stub is
 * the only way to offer a throwing `error` at all. The generated client's own
 * request shaping is the squads seam's precedent and is not restated here.
 *
 * **Validates: Requirements 3.7, 12.5**
 */

/* -------------------------------------------------------------------------- */
/* The call under test                                                        */
/* -------------------------------------------------------------------------- */

/** The contract's own path for the one operation this feature reads. */
const PROFILE_PATH: keyof paths =
  '/squads/{squadId}/members/{membershipId}/profile';

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4718-8a9b-0c1d2e3f4a5b';

/** Every kind a settled call may report. */
type CallResultKind = CallResult<PlayerProfile>['kind'];

/** The four failing kinds, which are the subject of Property 4. */
const FAILING_KINDS = [
  'not-found',
  'timeout',
  'transport-failure',
  'parse-failure',
] as const;

/* -------------------------------------------------------------------------- */
/* Type-level: no failing arm declares a field                                */
/* -------------------------------------------------------------------------- */

/**
 * A compile-time identity check, satisfied only when two types are mutually
 * assignable — so neither a widened nor a narrowed alias passes.
 */
type AssertIdentical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** The failing arms of `CallResult`, as a union. */
type FailingResult = Exclude<CallResult<PlayerProfile>, { kind: 'success' }>;

/**
 * Every member each arm of a union declares besides its tag, gathered
 * **distributively**.
 *
 * The distribution is the whole point. `keyof` over a union yields only the
 * members every arm shares, so `keyof FailingResult` is `'kind'` even if one arm
 * carried a status — the check would pass while the claim was false. Written
 * this way, a field on *any* arm shows up in the result and fails the build.
 */
type DeclaredFieldsOf<TUnion> = TUnion extends unknown
  ? Exclude<keyof TUnion, 'kind'>
  : never;

/**
 * 12.5: no failing arm of `CallResult` declares a field. Adding a status, a
 * header, a body, or a problem member to any of the four fails here.
 */
const NO_FAILING_ARM_DECLARES_A_FIELD: AssertIdentical<
  DeclaredFieldsOf<FailingResult>,
  never
> = true;

/** And the failing arms are exactly those four, so a fifth fails the build. */
const THE_FAILING_ARMS_ARE_THE_FOUR: AssertIdentical<
  FailingResult['kind'],
  (typeof FAILING_KINDS)[number]
> = true;

/**
 * The success arm carries exactly one field, the parsed Player_Profile — the
 * control that keeps the assertion above from being true of a `CallResult` that
 * carries nothing at all.
 */
const THE_SUCCESS_ARM_CARRIES_THE_PROFILE: AssertIdentical<
  DeclaredFieldsOf<Extract<CallResult<PlayerProfile>, { kind: 'success' }>>,
  'value'
> = true;

/* -------------------------------------------------------------------------- */
/* The reflective walk                                                        */
/* -------------------------------------------------------------------------- */

/** One member of a walked value graph. */
interface WalkedMember {
  /** Where it sits, as a dotted path. */
  readonly path: string;
  /** Its name; a symbol contributes its description. */
  readonly name: string;
  /** Its value, for a data property; `undefined` for an accessor. */
  readonly value: unknown;
  /** Whether it is an accessor, which is named but never read. */
  readonly isAccessor: boolean;
}

/** A value with no interior to walk. */
function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

/** A member key as a comparable name; a symbol contributes its description. */
function memberName(key: string | symbol): string {
  return typeof key === 'symbol' ? (key.description ?? '') : key;
}

/**
 * The value and every prototype worth reading members from, stopping short of
 * the built-in prototypes.
 *
 * Walking the chain is what makes a class accessor visible: a field declared as
 * a getter is an own property of the prototype, not of the instance.
 */
function holdersOf(value: object): readonly object[] {
  const holders: object[] = [value];
  let current: unknown = Object.getPrototypeOf(value);

  while (
    typeof current === 'object' &&
    current !== null &&
    current !== Object.prototype &&
    current !== Array.prototype
  ) {
    holders.push(current);
    current = Object.getPrototypeOf(current);
  }

  return holders;
}

/**
 * Every member of the transitive value graph of `root`.
 *
 * Iterative and cycle-guarded, so a self-referring graph terminates; reads no
 * accessor, so a planted getter is named without being invoked and cannot
 * decide whether it was found.
 */
function membersOf(root: unknown): readonly WalkedMember[] {
  const members: WalkedMember[] = [];
  const visited = new WeakSet<object>();
  const pending: { readonly value: unknown; readonly path: string }[] = [
    { value: root, path: 'result' },
  ];

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined) {
      break;
    }

    const { value, path } = next;

    if (isPrimitive(value) || visited.has(value as object)) {
      continue;
    }

    visited.add(value as object);

    for (const holder of holdersOf(value as object)) {
      for (const key of Reflect.ownKeys(holder)) {
        const name = memberName(key);
        const at = `${path}.${name}`;
        const descriptor = Object.getOwnPropertyDescriptor(holder, key);
        const isData = descriptor !== undefined && 'value' in descriptor;
        const held: unknown = isData ? descriptor.value : undefined;

        members.push({ path: at, name, value: held, isAccessor: !isData });

        if (isData) {
          pending.push({ value: held, path: at });
        }
      }
    }
  }

  return members;
}

/* -------------------------------------------------------------------------- */
/* What a member name must not denote                                         */
/* -------------------------------------------------------------------------- */

/** The four kinds of thing Requirements 3.7 and 12.5 forbid. */
const A_STATUS = 'a status';
const A_HEADER = 'a header';
const A_RESPONSE_BODY = 'a response body';
const A_PROBLEM_MEMBER = 'a problem-response member';

/** One forbidden member spelling, and what a member of that name would hold. */
interface ForbiddenSpelling {
  readonly spelling: string;
  readonly quantity: string;
}

/**
 * Every spelling a failing `CallResult` must not carry, matched as a whole word
 * of a member name so `statusCode` and `httpStatus` are findings while `kind`
 * is not.
 *
 * Wider than the members the client actually offers: a future change that read
 * the rejected response and renamed it on the way through would violate the
 * requirement exactly as much as one that kept the client's spelling.
 */
const FORBIDDEN_SPELLINGS: readonly ForbiddenSpelling[] = [
  { spelling: 'status', quantity: A_STATUS },
  { spelling: 'statuses', quantity: A_STATUS },
  { spelling: 'code', quantity: A_STATUS },
  { spelling: 'codes', quantity: A_STATUS },
  { spelling: 'header', quantity: A_HEADER },
  { spelling: 'headers', quantity: A_HEADER },
  { spelling: 'body', quantity: A_RESPONSE_BODY },
  { spelling: 'data', quantity: A_RESPONSE_BODY },
  { spelling: 'payload', quantity: A_RESPONSE_BODY },
  { spelling: 'response', quantity: A_RESPONSE_BODY },
  { spelling: 'text', quantity: A_RESPONSE_BODY },
  { spelling: 'json', quantity: A_RESPONSE_BODY },
  { spelling: 'problem', quantity: A_PROBLEM_MEMBER },
  { spelling: 'title', quantity: A_PROBLEM_MEMBER },
  { spelling: 'detail', quantity: A_PROBLEM_MEMBER },
  { spelling: 'details', quantity: A_PROBLEM_MEMBER },
  { spelling: 'instance', quantity: A_PROBLEM_MEMBER },
  { spelling: 'trace', quantity: A_PROBLEM_MEMBER },
  { spelling: 'extensions', quantity: A_PROBLEM_MEMBER },
  { spelling: 'error', quantity: A_PROBLEM_MEMBER },
  { spelling: 'errors', quantity: A_PROBLEM_MEMBER },
  { spelling: 'reason', quantity: A_PROBLEM_MEMBER },
  { spelling: 'message', quantity: A_PROBLEM_MEMBER },
];

/**
 * A member name split into lower-cased words, on camel-case boundaries and on
 * every non-letter: `statusCode` reads as `status, code`, `traceId` as
 * `trace, id`, `kind` as `kind`.
 */
function segmentsOf(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/** What the given member name denotes, or `null` when it denotes none of them. */
function forbiddenQuantity(name: string): string | null {
  const segments = segmentsOf(name);

  for (const rule of FORBIDDEN_SPELLINGS) {
    if (segments.includes(rule.spelling)) {
      return rule.quantity;
    }
  }

  return null;
}

/** One member of a walked graph that must not be there. */
interface Finding {
  readonly path: string;
  readonly what: string;
}

/** Every member of the graph whose name denotes a forbidden quantity. */
function forbiddenNameFindings(members: readonly WalkedMember[]): readonly Finding[] {
  return members.flatMap((member) => {
    const quantity = forbiddenQuantity(member.name);
    return quantity === null ? [] : [{ path: member.path, what: quantity }];
  });
}

/* -------------------------------------------------------------------------- */
/* What a value must not disclose                                             */
/* -------------------------------------------------------------------------- */

/** A distinctive value one generated client behaviour sent. */
type Marker = string | number;

/**
 * The marker prefix planted in generated bodies and rejection reasons.
 *
 * Long and distinctive, so a substring match cannot fire by coincidence.
 */
const MARKER = 'PITCHMATE-DISCLOSURE-MARKER';

/** The shortest string a substring check is allowed to use. */
const MINIMUM_MARKER_LENGTH = 8;

/** Every member of the graph carrying, or named after, something that was sent. */
function disclosureFindings(
  members: readonly WalkedMember[],
  markers: readonly Marker[],
): readonly Finding[] {
  const strings = markers.filter(
    (marker): marker is string =>
      typeof marker === 'string' && marker.length >= MINIMUM_MARKER_LENGTH,
  );
  const numbers = markers.filter(
    (marker): marker is number => typeof marker === 'number',
  );

  const discloses = (value: unknown): boolean => {
    if (typeof value === 'number') {
      return numbers.includes(value);
    }
    if (typeof value === 'string') {
      return strings.some((marker) => value.includes(marker));
    }
    return false;
  };

  return members.flatMap((member) => {
    if (strings.some((marker) => member.name.includes(marker))) {
      return [{ path: member.path, what: 'a name taken from the response' }];
    }
    if (!member.isAccessor && discloses(member.value)) {
      return [{ path: member.path, what: 'a value taken from the response' }];
    }
    return [];
  });
}

/** The findings as a readable list, for an assertion message. */
function describeFindings(findings: readonly Finding[]): string {
  return findings.map((finding) => `${finding.path} holds ${finding.what}`).join('; ');
}

/** Every primitive the graph holds, in walk order. */
function primitivesOf(members: readonly WalkedMember[]): readonly unknown[] {
  return members
    .filter((member) => !member.isAccessor && isPrimitive(member.value))
    .map((member) => member.value);
}

/**
 * The whole of Property 4, applied to one settled failing result: the graph is
 * one tag member, no name in it denotes a status, a header, a response body, or
 * a problem-response member, and nothing the behaviour sent appears in it.
 */
function expectNothingRenderable(
  outcome: CallResult<PlayerProfile>,
  markers: readonly Marker[],
): void {
  expect(FAILING_KINDS as readonly string[]).toContain(outcome.kind);

  const members = membersOf(outcome);

  // The graph is exactly one member, holding exactly one of the four fixed tags.
  expect(Object.keys(outcome)).toEqual(['kind']);
  expect(members.map((member) => member.name)).toEqual(['kind']);
  expect(primitivesOf(members)).toEqual([outcome.kind]);

  // 12.5: no status, no header, no response body, no problem-response member.
  const named = forbiddenNameFindings(members);
  expect(named, describeFindings(named)).toStrictEqual([]);

  // 3.7: and nothing the rejected response carried, under any name.
  const disclosed = disclosureFindings(members, markers);
  expect(disclosed, describeFindings(disclosed)).toStrictEqual([]);
}

/* -------------------------------------------------------------------------- */
/* The Api_Client stub                                                        */
/* -------------------------------------------------------------------------- */

/** A promise whose settlement the test controls. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

/** The client result a resolving behaviour produces. */
interface ResolvedResult {
  /** Whether the result carries a decoded `data` member at all. */
  readonly hasData: boolean;
  /** The decoded body, when one is carried. */
  readonly data?: unknown;
  /** Whether the result carries a `response` member at all. */
  readonly hasResponse: boolean;
  /** The value of `response.status`, which need not be a number. */
  readonly status?: unknown;
}

/** What the stubbed client does when the seam asks it. */
type StubAnswer =
  | ({ readonly outcome: 'resolve' } & ResolvedResult)
  | { readonly outcome: 'reject'; readonly reason: unknown }
  | { readonly outcome: 'hang' };

/** The only part of the Api_Client call options the stub reads. */
interface StubCallInit {
  readonly params?: { readonly path?: unknown };
  readonly signal?: AbortSignal;
}

/** One request the seam issued, with the signal it was bounded by. */
interface RecordedRequest {
  readonly path: string;
  readonly pathParams: unknown;
  readonly signal: AbortSignal | undefined;
  /** The settlement, for a hanging answer the test drives itself. */
  readonly answer: Deferred<unknown>;
}

/** The facade over one stubbed client, and what that client observed. */
interface Harness {
  readonly api: PlayerStatsApi;
  readonly requests: readonly RecordedRequest[];
  /** Members the seam must never read, in the order they were read. */
  readonly forbiddenReads: readonly string[];
  /** How many times `response.status` was read. */
  readonly statusReads: () => number;
  /** Settle a hanging request with the given answer. */
  readonly settle: (request: RecordedRequest, answer: StubAnswer) => void;
}

/**
 * Members of the client's result the seam must never read.
 *
 * `error` is the one the requirement names: `GetPlayerProfile` declares no
 * client-actionable rejection, so there is no problem body to read and the seam
 * declares no member for one. The rest are the other routes to a rejected
 * response — the headers, the status text, the URL, and every way of reading the
 * body a second time.
 */
const FORBIDDEN_RESULT_MEMBERS = ['error', 'headers'] as const;
const FORBIDDEN_RESPONSE_MEMBERS = [
  'headers',
  'statusText',
  'url',
  'body',
  'bodyUsed',
  'json',
  'text',
  'clone',
  'type',
  'redirected',
] as const;

/**
 * Offer `name` on `target` as an accessor that records the read and then raises.
 *
 * Recording *and* raising is deliberate: the log makes the claim assertable even
 * if something swallowed the error, and the raise makes a read impossible to
 * ignore, because the call rejects instead of settling.
 */
function defineForbidden(
  target: object,
  name: string,
  at: string,
  reads: string[],
): void {
  Object.defineProperty(target, name, {
    enumerable: true,
    configurable: true,
    get(): never {
      reads.push(`${at}.${name}`);
      throw new Error(`the seam read ${at}.${name}, which it must never read`);
    },
  });
}

/** Build the client result object a resolving answer describes. */
function buildResult(
  answer: ResolvedResult,
  reads: string[],
  countStatusRead: () => void,
): unknown {
  const result: Record<string, unknown> = {};

  if (answer.hasData) {
    result.data = answer.data;
  }

  for (const name of FORBIDDEN_RESULT_MEMBERS) {
    defineForbidden(result, name, 'result', reads);
  }

  if (answer.hasResponse) {
    const response: Record<string, unknown> = {};

    // The one member of the response the seam is allowed to read, counted so
    // "read once, carried nowhere" can be asserted rather than assumed.
    Object.defineProperty(response, 'status', {
      enumerable: true,
      configurable: true,
      get(): unknown {
        countStatusRead();
        return answer.status;
      },
    });

    for (const name of FORBIDDEN_RESPONSE_MEMBERS) {
      defineForbidden(response, name, 'result.response', reads);
    }

    result.response = response;
  }

  return result;
}

/**
 * A facade over a stubbed Api_Client that answers every call the same way.
 *
 * `'hang'` never answers, which is the real subject of the timeout and abort
 * properties; the returned harness can settle a hanging request later, which is
 * how "a late arrival changes nothing" is asserted.
 */
function makeApi(answer: StubAnswer): Harness {
  const requests: RecordedRequest[] = [];
  const forbiddenReads: string[] = [];
  let statusReads = 0;

  const settle = (request: RecordedRequest, settlement: StubAnswer): void => {
    if (settlement.outcome === 'resolve') {
      request.answer.resolve(
        buildResult(settlement, forbiddenReads, () => {
          statusReads += 1;
        }),
      );
      return;
    }
    if (settlement.outcome === 'reject') {
      request.answer.reject(settlement.reason);
    }
  };

  const client = {
    GET: (path: string, init?: StubCallInit): Promise<unknown> => {
      const request: RecordedRequest = {
        path,
        pathParams: init?.params?.path,
        signal: init?.signal,
        answer: deferred<unknown>(),
      };
      requests.push(request);
      settle(request, answer);
      return request.answer.promise;
    },
  } as unknown as PitchMateApiClient;

  return {
    api: createPlayerStatsApi({ apiClient: client }),
    requests,
    forbiddenReads,
    statusReads: () => statusReads,
    settle,
  };
}

/** The single recorded request, failing the test if there was not exactly one. */
function onlyRequest(requests: readonly RecordedRequest[]): RecordedRequest {
  expect(requests).toHaveLength(1);
  return requests[0] as RecordedRequest;
}

/**
 * Drain the microtask queue without advancing the clock, so "has it settled
 * yet?" is answered deterministically rather than by waiting.
 */
async function drainMicrotasks(rounds = 16): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
  }
}

/** A promise whose settlement can be inspected without awaiting it. */
interface Tracked<T> {
  settled: boolean;
  value: T | undefined;
}

function track<T>(promise: Promise<T>): Tracked<T> {
  const state: Tracked<T> = { settled: false, value: undefined };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

/* -------------------------------------------------------------------------- */
/* The generated client behaviours                                            */
/* -------------------------------------------------------------------------- */

/** One thing the Api_Client can do, and what the seam must make of it. */
interface ClientBehaviour {
  readonly label: string;
  readonly answer: StubAnswer;
  readonly expected: CallResultKind;
  /** The profile a successful behaviour must yield. */
  readonly expectedValue?: PlayerProfile;
  /** The distinctive values this behaviour sent, none of which may come back. */
  readonly markers: readonly Marker[];
}

/**
 * The kind the seam must settle on for a response carrying no body the parser
 * could accept.
 *
 * An independent restatement of the classification's table — the concealing
 * statuses, then the ranges — rather than a call into `classifyOutcome`, which
 * is `lib/callOutcome.ts`'s own three property tests' subject.
 */
function expectedKindForStatus(status: number): CallResultKind {
  if (status === 401 || status === 403 || status === 404) {
    return 'not-found';
  }
  if (status >= 200 && status <= 299) {
    return 'parse-failure';
  }
  return 'transport-failure';
}

/** Every top-level member of the body that rejects null-or-absent. */
const REQUIRED_PROFILE_MEMBERS = [
  'membershipId',
  'displayName',
  'isGuest',
  'record',
  'rating',
  'progression',
  'winStreak',
  'unbeatenStreak',
  'mostPlayedWith',
  'mostPlayedAgainst',
  'bestPartnerships',
  'bogeyOpponents',
  'bibAppearances',
] as const;

/** A `2xx` status, for the behaviours whose outcome turns on the body. */
const successStatusArb: fc.Arbitrary<number> = fc.constantFrom(
  200, 201, 202, 203, 204, 299,
);

/** A rejecting status: every one of them, with the interesting ones weighted. */
const rejectingStatusArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 100, max: 599 }) },
  {
    weight: 4,
    arbitrary: fc.constantFrom(400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504),
  },
  { weight: 1, arbitrary: fc.constantFrom(100, 101, 301, 302, 304, 418, 599) },
);

/** A success carrying a body the Response_Parser accepts. */
const successBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc
  .tuple(anyProfileFixtureArb, successStatusArb)
  .map(([fixture, status]) => ({
    label: 'a success with a valid body',
    answer: {
      outcome: 'resolve' as const,
      hasData: true,
      data: fixture.wire,
      hasResponse: true,
      status,
    },
    expected: 'success' as const,
    expectedValue: fixture.parsed,
    markers: [],
  }));

/** A success carrying a body the Response_Parser rejects. */
const rejectedBodyBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc
  .tuple(
    fc.oneof(
      {
        weight: 3,
        arbitrary: anyProfileFixtureArb.map((fixture) => ({
          hasData: true,
          data: { ...fixture.wire, membershipId: `${MARKER}-identity` },
          markers: [`${MARKER}-identity`] as readonly Marker[],
        })),
      },
      {
        weight: 3,
        arbitrary: fc
          .tuple(anyProfileFixtureArb, fc.constantFrom(...REQUIRED_PROFILE_MEMBERS))
          .map(([fixture, member]) => {
            const body: Record<string, unknown> = {
              ...fixture.wire,
              [`${MARKER}-unrecognised`]: `${MARKER}-extra`,
            };
            delete body[member];
            return {
              hasData: true,
              data: body,
              markers: [`${MARKER}-extra`, `${MARKER}-unrecognised`] as readonly Marker[],
            };
          }),
      },
      {
        weight: 2,
        arbitrary: fc.constantFrom<{
          hasData: boolean;
          data?: unknown;
          markers: readonly Marker[];
        }>(
          { hasData: true, data: null, markers: [] },
          { hasData: true, data: [], markers: [] },
          { hasData: true, data: `${MARKER}-text`, markers: [`${MARKER}-text`] },
          { hasData: true, data: 424_242, markers: [424_242] },
          { hasData: true, data: true, markers: [] },
          // An absent body: this operation has no valueless success.
          { hasData: false, markers: [] },
        ),
      },
    ),
    successStatusArb,
  )
  .map(([body, status]) => ({
    label: 'a success with a body the parser rejects',
    answer: {
      outcome: 'resolve' as const,
      hasData: body.hasData,
      data: body.data,
      hasResponse: true,
      status,
    },
    expected: 'parse-failure' as const,
    markers: [...body.markers, status],
  }));

/** A success whose body the client itself could not decode. */
const undecodableBodyBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc
  .constantFrom<unknown>(
    new SyntaxError(`Unexpected token in JSON: ${MARKER}-syntax`),
    // The cross-realm form: not an instance, but named one.
    { name: 'SyntaxError', message: `${MARKER}-syntax` },
    Object.assign(new Error(`${MARKER}-syntax`), { name: 'SyntaxError' }),
  )
  .map((reason) => ({
    label: 'a success whose decode threw a SyntaxError',
    answer: { outcome: 'reject' as const, reason },
    expected: 'parse-failure' as const,
    markers: [`${MARKER}-syntax`],
  }));

/** A rejecting status, carrying no body the client could decode. */
const rejectingStatusBehaviourArb: fc.Arbitrary<ClientBehaviour> =
  rejectingStatusArb.map((status) => ({
    label: 'a status carrying no decodable body',
    answer: {
      outcome: 'resolve' as const,
      hasData: false,
      hasResponse: true,
      status,
    },
    expected: expectedKindForStatus(status),
    markers: [status],
  }));

/**
 * A rejecting status carrying a body the parser *would* have accepted — the
 * case that separates "the parse failed" from "the outcome failed".
 */
const rejectedWithValidBodyBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc
  .tuple(anyProfileFixtureArb, rejectingStatusArb.filter((status) => status < 200 || status > 299))
  .map(([fixture, status]) => ({
    label: 'a rejecting status carrying a body the parser accepts',
    answer: {
      outcome: 'resolve' as const,
      hasData: true,
      data: fixture.wire,
      hasResponse: true,
      status,
    },
    expected: expectedKindForStatus(status),
    markers: [status, fixture.parts.membershipId],
  }));

/** A result whose status is not a number, or which carries no response at all. */
const unreadableStatusBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc
  .oneof(
    fc
      .constantFrom<unknown>('404', null, undefined, Number.NaN, {}, true, 404n)
      .map((status) => ({
        label: 'a response whose status is not a number',
        answer: {
          outcome: 'resolve' as const,
          hasData: false,
          hasResponse: true,
          status,
        },
        markers: [] as readonly Marker[],
      })),
    anyProfileFixtureArb.map((fixture) => ({
      label: 'a valid body with no response at all',
      answer: {
        outcome: 'resolve' as const,
        hasData: true,
        data: fixture.wire,
        hasResponse: false,
      },
      markers: [fixture.parts.membershipId] as readonly Marker[],
    })),
  )
  .map((behaviour) => ({
    ...behaviour,
    // No status reached the seam, so the classification has a transport failure
    // to report whatever the body was.
    expected: 'transport-failure' as const,
  }));

/** A transport rejection: a network failure, or something stranger. */
const transportRejectionBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc
  .constantFrom<{ readonly reason: unknown; readonly markers: readonly Marker[] }>(
    { reason: new TypeError('Failed to fetch'), markers: [] },
    { reason: new Error(`${MARKER}-network`), markers: [`${MARKER}-network`] },
    {
      reason: new DOMException('The operation was aborted.', 'AbortError'),
      markers: [],
    },
    { reason: null, markers: [] },
    { reason: undefined, markers: [] },
    { reason: `${MARKER}-thrown-string`, markers: [`${MARKER}-thrown-string`] },
    {
      // A rejection that carries the very things a failing arm must not: a
      // status, headers, and a problem body.
      reason: {
        status: 503,
        headers: { 'x-trace': `${MARKER}-trace` },
        problem: { title: `${MARKER}-title`, detail: `${MARKER}-detail` },
      },
      markers: [
        503,
        `${MARKER}-trace`,
        `${MARKER}-title`,
        `${MARKER}-detail`,
      ],
    },
  )
  .map(({ reason, markers }) => ({
    label: 'a transport rejection',
    answer: { outcome: 'reject' as const, reason },
    expected: 'transport-failure' as const,
    markers,
  }));

/** Everything the Api_Client can do, short of never answering. */
const behaviourArb: fc.Arbitrary<ClientBehaviour> = fc.oneof(
  { weight: 2, arbitrary: successBehaviourArb },
  { weight: 3, arbitrary: rejectedBodyBehaviourArb },
  { weight: 2, arbitrary: undecodableBodyBehaviourArb },
  { weight: 4, arbitrary: rejectingStatusBehaviourArb },
  { weight: 3, arbitrary: rejectedWithValidBodyBehaviourArb },
  { weight: 2, arbitrary: unreadableStatusBehaviourArb },
  { weight: 2, arbitrary: transportRejectionBehaviourArb },
);

/** Every behaviour that must settle as one of the four failing kinds. */
const failingBehaviourArb: fc.Arbitrary<ClientBehaviour> = fc.oneof(
  { weight: 3, arbitrary: rejectedBodyBehaviourArb },
  { weight: 2, arbitrary: undecodableBodyBehaviourArb },
  { weight: 4, arbitrary: rejectingStatusBehaviourArb },
  { weight: 3, arbitrary: rejectedWithValidBodyBehaviourArb },
  { weight: 2, arbitrary: unreadableStatusBehaviourArb },
  { weight: 2, arbitrary: transportRejectionBehaviourArb },
);

/* -------------------------------------------------------------------------- */
/* Property 4, over every settled behaviour                                   */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 4: No failing outcome carries anything renderable
// Validates: Requirements 3.7, 12.5
describe('no failing outcome carries anything renderable', () => {
  it('settles every client behaviour, and every failing one carries nothing', async () => {
    await fc.assert(
      fc.asyncProperty(behaviourArb, async (behaviour) => {
        const harness = makeApi(behaviour.answer);

        const outcome = await harness.api.getPlayerProfile(SQUAD_ID, MEMBERSHIP_ID);

        expect(outcome.kind).toBe(behaviour.expected);
        // 2.6: one activation, one request, whatever the outcome.
        expect(harness.requests).toHaveLength(1);
        // 12.5: the client's `error` — and every other route to a rejected
        // response — went unread.
        expect(harness.forbiddenReads).toStrictEqual([]);

        if (outcome.kind === 'success') {
          // The control that keeps the rest non-vacuous: a valid body on a `2xx`
          // really does come back, so "carries nothing" is a statement about the
          // failing arms rather than about a seam that never yields anything.
          expect(outcome.value).toStrictEqual(behaviour.expectedValue);
          return;
        }

        expectNothingRenderable(outcome, behaviour.markers);
      }),
      { numRuns: 300 },
    );
  });

  it('reads the status at most once and carries it nowhere', async () => {
    await fc.assert(
      fc.asyncProperty(failingBehaviourArb, async (behaviour) => {
        const harness = makeApi(behaviour.answer);

        const outcome = await harness.api.getPlayerProfile(SQUAD_ID, MEMBERSHIP_ID);

        expect(harness.statusReads()).toBeLessThanOrEqual(1);
        expectNothingRenderable(outcome, behaviour.markers);
      }),
      { numRuns: 200 },
    );
  });

  it('settles identically for every concealed status, carrying nothing from any', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(401, 403, 404),
        anyProfileFixtureArb,
        async (status, fixture) => {
          // 3.2 by consequence: the three concealed causes are one outcome, and
          // that outcome carries nothing that could tell them apart — not even
          // when the response arrived with a perfectly good profile attached.
          const harness = makeApi({
            outcome: 'resolve',
            hasData: true,
            data: fixture.wire,
            hasResponse: true,
            status,
          });

          const outcome = await harness.api.getPlayerProfile(
            SQUAD_ID,
            MEMBERSHIP_ID,
          );

          expect(outcome).toStrictEqual({ kind: 'not-found' });
          expectNothingRenderable(outcome, [status, fixture.parts.membershipId]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 4 under a lapsed Profile_Call_Timeout                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 4: No failing outcome carries anything renderable
// Validates: Requirements 3.7, 12.5
describe('a lapsed Profile_Call_Timeout carries nothing renderable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds the call at ten seconds', () => {
    expect(PROFILE_CALL_TIMEOUT_MS).toBe(10_000);
  });

  it('settles as a bare timeout, and a late answer changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // What the abandoned request does afterwards: nothing, answer
        // successfully, or reject. None of it may reach the settled outcome.
        fc.oneof(
          fc.constant<ClientBehaviour | null>(null),
          successBehaviourArb,
          rejectedBodyBehaviourArb,
          transportRejectionBehaviourArb,
        ),
        async (late) => {
          const harness = makeApi({ outcome: 'hang' });

          const pending = harness.api.getPlayerProfile(SQUAD_ID, MEMBERSHIP_ID);
          const tracked = track(pending);
          await drainMicrotasks();

          const request = onlyRequest(harness.requests);
          expect(request.signal).toBeInstanceOf(AbortSignal);
          expect(request.signal?.aborted).toBe(false);

          // One tick short of the limit, nothing has happened.
          vi.advanceTimersByTime(PROFILE_CALL_TIMEOUT_MS - 1);
          await drainMicrotasks();
          expect(tracked.settled).toBe(false);
          expect(request.signal?.aborted).toBe(false);

          // 12.3: the limit lapses, driven rather than waited out.
          vi.advanceTimersByTime(1);
          expect(request.signal?.aborted).toBe(true);
          await drainMicrotasks();
          expect(tracked.settled).toBe(true);

          // The abandoned request answers late, carrying everything a failing
          // arm must not.
          if (late !== null) {
            harness.settle(request, late.answer);
            await drainMicrotasks();
          }

          const outcome = await pending;

          expect(outcome).toStrictEqual({ kind: 'timeout' });
          expectNothingRenderable(outcome, late?.markers ?? []);
          expect(harness.requests).toHaveLength(1);
          expect(harness.forbiddenReads).toStrictEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('reports a timeout rather than the status of a response that arrived too late', async () => {
    await fc.assert(
      fc.asyncProperty(rejectingStatusArb, async (status) => {
        const harness = makeApi({ outcome: 'hang' });

        const pending = harness.api.getPlayerProfile(SQUAD_ID, MEMBERSHIP_ID);
        await drainMicrotasks();
        const request = onlyRequest(harness.requests);

        vi.advanceTimersByTime(PROFILE_CALL_TIMEOUT_MS);
        await drainMicrotasks();

        harness.settle(request, {
          outcome: 'resolve',
          hasData: false,
          hasResponse: true,
          status,
        });
        await drainMicrotasks();

        // 12.4: our own lapsed limit wins, and the status it beat is not carried.
        expect(await pending).toStrictEqual({ kind: 'timeout' });
        expectNothingRenderable(await pending, [status]);
        expect(harness.requests).toHaveLength(1);
      }),
      { numRuns: 150 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Exactly one request per activation (Requirement 2.6)                       */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 4: No failing outcome carries anything renderable
// Validates: Requirements 3.7, 12.5
describe('exactly one request per method activation', () => {
  it('issues nothing until a method is activated', () => {
    const harness = makeApi({ outcome: 'hang' });

    expect(harness.requests).toStrictEqual([]);
  });

  it('issues one request for one activation, for every client behaviour', async () => {
    await fc.assert(
      fc.asyncProperty(behaviourArb, async (behaviour) => {
        const harness = makeApi(behaviour.answer);

        await harness.api.getPlayerProfile(SQUAD_ID, MEMBERSHIP_ID);

        // 2.6: no retry, no re-issue, no fallback — a failure is a person's cue
        // to try again, never the seam's.
        const request = onlyRequest(harness.requests);
        expect(request.path).toBe(PROFILE_PATH);
        expect(request.pathParams).toStrictEqual({
          squadId: SQUAD_ID,
          membershipId: MEMBERSHIP_ID,
        });
      }),
      { numRuns: 200 },
    );
  });

  it('issues one request per activation and no more, however many times it is activated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(behaviourArb, { minLength: 1, maxLength: 6 }),
        async (behaviours) => {
          // One harness per behaviour would prove nothing about repetition, so
          // the same facade is activated repeatedly and the count must track the
          // activations exactly.
          let issued = 0;

          for (const behaviour of behaviours) {
            const harness = makeApi(behaviour.answer);

            for (let activation = 0; activation < behaviours.length; activation += 1) {
              await harness.api.getPlayerProfile(SQUAD_ID, MEMBERSHIP_ID);
            }

            expect(harness.requests).toHaveLength(behaviours.length);
            // Each activation was bounded by a signal of its own, so no two
            // calls shared a controller.
            expect(
              new Set(harness.requests.map((request) => request.signal)).size,
            ).toBe(behaviours.length);
            issued += harness.requests.length;
          }

          expect(issued).toBe(behaviours.length * behaviours.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The caller's signal aborts the request in flight (Requirement 12.4)        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 4: No failing outcome carries anything renderable
// Validates: Requirements 3.7, 12.5
describe("the caller's signal aborts the request in flight", () => {
  it('aborts the signal the client holds and settles as a transport failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        // What the abandoned request does after the abort, if anything.
        fc.oneof(
          fc.constant<ClientBehaviour | null>(null),
          successBehaviourArb,
          transportRejectionBehaviourArb,
        ),
        async (late) => {
          const controller = new AbortController();
          const harness = makeApi({ outcome: 'hang' });

          const pending = harness.api.getPlayerProfile(
            SQUAD_ID,
            MEMBERSHIP_ID,
            controller.signal,
          );
          const tracked = track(pending);
          await drainMicrotasks();

          const request = onlyRequest(harness.requests);
          expect(request.signal?.aborted).toBe(false);
          expect(tracked.settled).toBe(false);

          // 12.4: an unmount, an Auth_State transition, or a change of subject.
          controller.abort();

          // The request the client is holding is abandoned at once.
          expect(request.signal?.aborted).toBe(true);
          await drainMicrotasks();
          expect(tracked.settled).toBe(true);

          if (late !== null) {
            harness.settle(request, late.answer);
            await drainMicrotasks();
          }

          // A caller abort is a transport failure, never the `timeout` our own
          // lapsed limit reports — the two causes stay distinguishable.
          const outcome = await pending;
          expect(outcome).toStrictEqual({ kind: 'transport-failure' });
          expectNothingRenderable(outcome, late?.markers ?? []);
          expect(harness.requests).toHaveLength(1);
          expect(harness.forbiddenReads).toStrictEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('settles a call whose caller signal was already aborted, issuing one request', async () => {
    await fc.assert(
      fc.asyncProperty(failingBehaviourArb, async (behaviour) => {
        const controller = new AbortController();
        controller.abort();
        const harness = makeApi(behaviour.answer);

        const outcome = await harness.api.getPlayerProfile(
          SQUAD_ID,
          MEMBERSHIP_ID,
          controller.signal,
        );

        expect(outcome).toStrictEqual({ kind: 'transport-failure' });
        expect(harness.requests).toHaveLength(1);
        expect(harness.requests[0]?.signal?.aborted).toBe(true);
        expectNothingRenderable(outcome, behaviour.markers);
      }),
      { numRuns: 150 },
    );
  });

  it('leaves the call unaborted and unsettled while no one abandons it', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (drains) => {
        const controller = new AbortController();
        const harness = makeApi({ outcome: 'hang' });

        const pending = harness.api.getPlayerProfile(
          SQUAD_ID,
          MEMBERSHIP_ID,
          controller.signal,
        );
        const tracked = track(pending);

        for (let round = 0; round < drains; round += 1) {
          await drainMicrotasks();
        }

        // The abort is the caller's to make: nothing happens on its own, which
        // is what makes the test above a statement about the abort.
        const request = onlyRequest(harness.requests);
        expect(request.signal?.aborted).toBe(false);
        expect(tracked.settled).toBe(false);

        // Settle it so the pending promise is not left dangling.
        controller.abort();
        expect(await pending).toStrictEqual({ kind: 'transport-failure' });
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the walk, the markers, and the forbidden accessors all fire    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 4: No failing outcome carries anything renderable
// Validates: Requirements 3.7, 12.5
describe('the renderable-content walk', () => {
  it('holds the type-level claims about the failing arms', () => {
    // The assertions that matter are the types of these constants; keeping them
    // here makes the claims live at runtime as well as at compile time.
    expect([
      NO_FAILING_ARM_DECLARES_A_FIELD,
      THE_FAILING_ARMS_ARE_THE_FOUR,
      THE_SUCCESS_ARM_CARRIES_THE_PROFILE,
    ]).toStrictEqual([true, true, true]);
  });

  it('finds nothing in the four real failing arms', () => {
    for (const kind of FAILING_KINDS) {
      const members = membersOf({ kind });

      expect(members.map((member) => member.name)).toEqual(['kind']);
      expect(forbiddenNameFindings(members)).toStrictEqual([]);
    }
  });

  it('detects a planted status, header, body, or problem member', () => {
    const planted: readonly {
      readonly label: string;
      readonly value: unknown;
      readonly what: string;
    }[] = [
      { label: 'a status code', value: { kind: 'not-found', status: 404 }, what: A_STATUS },
      {
        label: 'a status under a longer name',
        value: { kind: 'transport-failure', httpStatusCode: 503 },
        what: A_STATUS,
      },
      {
        label: 'a problem code',
        value: { kind: 'not-found', problemCode: 'squad-not-found' },
        what: A_STATUS,
      },
      {
        label: 'the response headers',
        value: { kind: 'timeout', headers: { 'x-trace': 'abc' } },
        what: A_HEADER,
      },
      {
        label: 'one header',
        value: { kind: 'timeout', traceHeader: 'abc' },
        what: A_HEADER,
      },
      {
        label: 'the response body',
        value: { kind: 'parse-failure', responseBody: { displayName: 'Dave' } },
        what: A_RESPONSE_BODY,
      },
      {
        label: 'the decoded data',
        value: { kind: 'parse-failure', data: { displayName: 'Dave' } },
        what: A_RESPONSE_BODY,
      },
      {
        label: 'the whole response',
        value: { kind: 'transport-failure', response: { status: 500 } },
        what: A_RESPONSE_BODY,
      },
      {
        label: 'a problem response',
        value: { kind: 'transport-failure', problem: { title: 'Server error' } },
        what: A_PROBLEM_MEMBER,
      },
      {
        label: 'a problem detail',
        value: { kind: 'not-found', detail: 'no such membership' },
        what: A_PROBLEM_MEMBER,
      },
      {
        label: 'a trace identity',
        value: { kind: 'transport-failure', traceId: '00-abc-def-01' },
        what: A_PROBLEM_MEMBER,
      },
      {
        label: 'the client error',
        value: { kind: 'transport-failure', error: { title: 'Server error' } },
        what: A_PROBLEM_MEMBER,
      },
      {
        label: 'a status nested one level down',
        value: { kind: 'timeout', cause: { attempt: { status: 504 } } },
        what: A_STATUS,
      },
      {
        label: 'a status inside an array',
        value: { kind: 'timeout', attempts: [{ status: 504 }] },
        what: A_STATUS,
      },
      {
        label: 'a non-enumerable status',
        value: Object.defineProperty({ kind: 'not-found' }, 'status', {
          value: 404,
          enumerable: false,
        }),
        what: A_STATUS,
      },
      {
        label: 'a symbol-keyed status',
        value: { kind: 'not-found', [Symbol('status')]: 404 },
        what: A_STATUS,
      },
      {
        label: 'a status behind a prototype accessor',
        value: new (class {
          readonly kind = 'not-found';

          get status(): never {
            throw new Error('the walk must name a planted member, never read it');
          }
        })(),
        what: A_STATUS,
      },
    ];

    for (const { label, value, what } of planted) {
      const findings = forbiddenNameFindings(membersOf(value));

      expect(findings.length, label).toBeGreaterThan(0);
      expect(findings.map((finding) => finding.what), label).toContain(what);
    }
  });

  it('is not simply firing on the tag the failing arms do carry', () => {
    for (const name of ['kind', 'value'] satisfies readonly string[]) {
      expect(forbiddenQuantity(name)).toBeNull();
    }
  });

  it('detects a disclosed value under an innocent name, and at depth', () => {
    const markers: readonly Marker[] = [404, `${MARKER}-detail`];
    const planted: readonly { readonly label: string; readonly value: unknown }[] = [
      { label: 'a bare number', value: { kind: 'not-found', hint: 404 } },
      { label: 'a bare string', value: { kind: 'not-found', hint: `${MARKER}-detail` } },
      {
        label: 'a string the marker is embedded in',
        value: { kind: 'not-found', hint: `because: ${MARKER}-detail (sorry)` },
      },
      { label: 'inside an array', value: { kind: 'timeout', hints: [`${MARKER}-detail`] } },
      {
        label: 'two levels down',
        value: { kind: 'timeout', outer: { inner: { hint: 404 } } },
      },
      { label: 'as a member name', value: { kind: 'timeout', [`${MARKER}-detail`]: 1 } },
    ];

    for (const { label, value } of planted) {
      const findings = disclosureFindings(membersOf(value), markers);

      expect(findings.length, label).toBeGreaterThan(0);
    }
  });

  it('does not report a disclosure for a value nothing sent', () => {
    const members = membersOf({ kind: 'not-found', hint: 42, note: 'unrelated' });

    expect(disclosureFindings(members, [404, `${MARKER}-detail`])).toStrictEqual([]);
  });

  it('terminates on a graph that refers to itself', () => {
    const cyclic: Record<string, unknown> = { kind: 'timeout', status: 504 };
    cyclic.itself = cyclic;
    cyclic.viaAnArray = [cyclic, { nested: cyclic }];

    const findings = forbiddenNameFindings(membersOf(cyclic));

    expect(findings.map((finding) => finding.what)).toContain(A_STATUS);
  });

  it('records a read of a forbidden member rather than letting it pass', () => {
    // The control for the throwing accessors: a reader of the client's `error`
    // is caught. Nothing in the seam does this, so the read is performed here —
    // against the same stub the properties above drive, so a passing property is
    // evidence that the seam did not.
    const reads: string[] = [];
    const result = buildResult(
      { hasData: false, hasResponse: true, status: 404 },
      reads,
      () => {},
    );

    for (const name of FORBIDDEN_RESULT_MEMBERS) {
      expect(() => (result as Record<string, unknown>)[name]).toThrow(
        /must never read/,
      );
    }

    const response = (result as { response: Record<string, unknown> }).response;
    for (const name of FORBIDDEN_RESPONSE_MEMBERS) {
      expect(() => response[name]).toThrow(/must never read/);
    }

    expect(reads).toHaveLength(
      FORBIDDEN_RESULT_MEMBERS.length + FORBIDDEN_RESPONSE_MEMBERS.length,
    );
    expect(reads).toContain('result.error');

    // And the status, which the seam *is* allowed to read, is readable.
    expect(response.status).toBe(404);
  });
});
