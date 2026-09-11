/**
 * Unit tests for the Squads_Api facade's request shapes, its Squad_Call_Timeout,
 * and the outcomes a settled call produces (task 6.2).
 *
 * These drive `createSquadsApi` over the **real** generated
 * `@pitchmate/api-client` with an injected `fetch`, following the precedent of
 * the App_Shell's `notificationsApi.test.ts`. Nothing about the client is
 * mocked, so every assertion is made against the method, path, query string, and
 * body that actually leave the client rather than against a hand-rolled
 * stand-in for it — which is the only way a request-shape claim can be checked
 * at all.
 *
 * Six things are covered:
 *
 * - **One request per call, and no retry.** Every one of the fourteen methods
 *   issues exactly one request for one activation, on a success and on a
 *   failing status alike (Requirement 17.4).
 * - **The 10-second Squad_Call_Timeout**, driven with `vi.useFakeTimers()`: the
 *   call is still unsettled a millisecond before the limit, settles as `timeout`
 *   at it, aborts the request, and issues nothing further (Requirement 16.3).
 * - **The three-way abandonment distinction.** The facade races both
 *   abandonments against the request so a call always settles: the lapsed limit
 *   yields `timeout` with the request aborted, a caller abort yields
 *   `transport-failure` with the request aborted, and a network failure yields
 *   `transport-failure` with the request **never** aborted (Requirement 16.3).
 * - **A `2xx` carrying a body the Response_Parser rejects settles as
 *   `parse-failure`** — uninterpretable text, a well-formed body of the wrong
 *   shape, and an absent body where a value was required (Requirement 16.4).
 * - **An empty `RedeemInvite` body settles as `success`** carrying a Redemption
 *   with no membership, no outcome, and **no squad identity** — the
 *   already-a-member no-op (Requirements 4.6, 16.4).
 * - **The leaderboard query carries the display-rating statistic**, spelled by
 *   the generated contract's own query type (Requirement 16.11).
 *
 * Every path template, every request body type, and the leaderboard's statistic
 * are typed against the generated `paths`, `components`, and `operations` here
 * too, so a renamed path or a changed request body fails to compile in this file
 * rather than passing against a stale string (Requirement 16.11).
 *
 * The authenticated-client claims (Requirements 16.1, 16.2) are asserted by the
 * sibling `squadsApi.client.test.ts`.
 *
 * Requirements: 16.2, 16.3, 16.4, 16.11, 17.4
 */

import {
  createApiClient,
  type components,
  type operations,
  type paths,
} from '@pitchmate/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSquadsApi,
  SQUAD_CALL_TIMEOUT_MS,
  type CallResult,
  type CreateGuestRequest,
  type CreateSquadRequest,
  type EditGuestRequest,
  type GenerateInviteRequest,
  type RedeemInviteRequest,
  type SetFeatureFlagRequest,
  type SquadsApi,
} from './squadsApi';

// --- Contract-derived literals (Requirement 16.11) --------------------------

/** The generated schema table, so the request-type checks below read cleanly. */
type Schemas = components['schemas'];

const SQUADS_PATH: keyof paths = '/squads';
const SQUAD_PATH_TEMPLATE: keyof paths = '/squads/{squadId}';
const LEADERBOARD_PATH_TEMPLATE: keyof paths = '/squads/{squadId}/leaderboard';
const INVITES_PATH_TEMPLATE: keyof paths = '/squads/{squadId}/invites';
const REVOKE_INVITE_PATH_TEMPLATE: keyof paths =
  '/squads/{squadId}/invites/{inviteId}/revoke';
const REDEEM_INVITE_PATH: keyof paths = '/squads/invites/redeem';
const PREVIEW_INVITE_PATH: keyof paths = '/squads/invites/preview';
const FEATURES_PATH_TEMPLATE: keyof paths = '/squads/{squadId}/features';
const GUESTS_PATH_TEMPLATE: keyof paths = '/squads/{squadId}/guests';
const GUEST_PATH_TEMPLATE: keyof paths = '/squads/{squadId}/guests/{membershipId}';
const PROMOTE_PATH_TEMPLATE: keyof paths =
  '/squads/{squadId}/members/{membershipId}/promote';

/** The type of the leaderboard's `statistic` query value, as the contract has it. */
type LeaderboardStatistic = NonNullable<
  NonNullable<operations['GetSquadLeaderboard']['parameters']['query']>['statistic']
>;

/** The one statistic the Squad_Screen asks for (Requirement 7.1). */
const DISPLAY_RATING_STATISTIC: LeaderboardStatistic = 'DisplayRating';

/**
 * A compile-time identity check, satisfied only when two types are mutually
 * assignable — so neither a widened nor a narrowed alias passes.
 */
type AssertIdentical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * 16.11: every request body type the facade exports **is** the generated schema,
 * checked in both directions. A hand-written duplicate of any of these bodies
 * fails to compile here.
 */
const REQUEST_TYPES_COME_FROM_THE_CONTRACT: readonly [
  AssertIdentical<CreateSquadRequest, Schemas['CreateSquadRequest']>,
  AssertIdentical<RedeemInviteRequest, Schemas['RedeemInviteRequest']>,
  AssertIdentical<GenerateInviteRequest, Schemas['GenerateInviteRequest']>,
  AssertIdentical<CreateGuestRequest, Schemas['CreateGuestRequest']>,
  AssertIdentical<EditGuestRequest, Schemas['EditGuestRequest']>,
  AssertIdentical<SetFeatureFlagRequest, Schemas['SetFeatureFlagRequest']>,
] = [true, true, true, true, true, true];

// --- Fixtures ---------------------------------------------------------------

const BASE_URL = 'https://api.test';

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4718-8a9b-0c1d2e3f4a5b';
const INVITE_ID = '9e107d9d-3728-4c9b-9a5c-58f3e1f0d1a2';

const CREATED_AT = '2025-01-01T00:00:00Z';
const CREATED_AT_MS = Date.parse(CREATED_AT);

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
  updateSkillTier: true,
  skillTier: 2,
};

const SET_FEATURE_FLAG_COMMAND: SetFeatureFlagRequest = { feature: 1, enabled: true };

// --- Transport fake ---------------------------------------------------------

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly bodyText: string;
  /** The signal the facade's per-call controller supplied, kept live. */
  readonly signal: AbortSignal;
}

interface Harness {
  readonly api: SquadsApi;
  readonly requests: readonly RecordedRequest[];
  /** Settles once the transport has been asked for its first request. */
  readonly firstRequest: Promise<void>;
}

/**
 * A fake `fetch` that records what left the client and replies from `reply`.
 *
 * The recorded `signal` is the live `AbortSignal` the facade's own controller
 * produced, which is what makes the "aborted / never aborted" halves of the
 * three-way abandonment distinction observable.
 */
function makeApi(
  reply: (request: RecordedRequest) => Response | Promise<Response>,
): Harness {
  const requests: RecordedRequest[] = [];
  let announceRequest: () => void = () => {};
  const firstRequest = new Promise<void>((resolve) => {
    announceRequest = resolve;
  });

  const fetchImpl = (async (input: Request): Promise<Response> => {
    const recorded: RecordedRequest = {
      url: input.url,
      method: input.method,
      bodyText: await input.clone().text(),
      signal: input.signal,
    };
    requests.push(recorded);
    announceRequest();
    return reply(recorded);
  }) as unknown as typeof fetch;

  const apiClient = createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  return { api: createSquadsApi({ apiClient }), requests, firstRequest };
}

/** A `200 OK` carrying `body` as JSON text — what every valued call reads. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `200 OK` carrying raw text, for the uninterpretable-body cases. */
function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `200 OK` with no body at all — the `RedeemInvite` no-op's answer. */
function emptyOkResponse(): Response {
  return new Response(null, { status: 200 });
}

/** A `204 No Content`, which the valueless operations answer with. */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** A never-settling transport, for the abandonment tests. */
function neverSettles(): Promise<Response> {
  return new Promise<Response>(() => {});
}

/** The single recorded request, failing the test if there was not exactly one. */
function onlyRequest(requests: readonly RecordedRequest[]): RecordedRequest {
  expect(requests).toHaveLength(1);
  return requests[0] as RecordedRequest;
}

/** The path of a recorded request, base URL stripped. */
function pathOf(request: RecordedRequest): string {
  return new URL(request.url).pathname;
}

/** The query string of a recorded request, `?` included, or `''` if none. */
function searchOf(request: RecordedRequest): string {
  return new URL(request.url).search;
}

/** A path template with its `{…}` segments filled in. */
function fill(template: string, segments: Readonly<Record<string, string>>): string {
  return Object.entries(segments).reduce(
    (path, [name, value]) => path.replace(`{${name}}`, value),
    template,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// --- The fourteen operations, each with its request shape and its success ----

/**
 * One operation of the facade: how it is activated, the request it must produce,
 * the body a successful call answers with, and the value that must come back.
 */
interface OperationCase {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly requestBodyText: string;
  /** The `200` body, or `undefined` where the operation answers `204`. */
  readonly successBody?: unknown;
  readonly expected: CallResult<unknown>;
  readonly invoke: (
    api: SquadsApi,
    signal?: AbortSignal,
  ) => Promise<CallResult<unknown>>;
}

const SQUAD_ID_SEGMENTS = { squadId: SQUAD_ID };

const OPERATIONS: readonly OperationCase[] = [
  {
    name: 'listMySquads',
    method: 'GET',
    path: SQUADS_PATH,
    search: '',
    requestBodyText: '',
    successBody: [{ squadId: SQUAD_ID, name: 'Thursday Nights', role: 2, state: 1 }],
    expected: {
      kind: 'success',
      value: [
        { squadId: SQUAD_ID, name: 'Thursday Nights', role: 'admin', state: 'active' },
      ],
    },
    invoke: (api, signal) => api.listMySquads(signal),
  },
  {
    name: 'getSquad',
    method: 'GET',
    path: fill(SQUAD_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: '',
    requestBodyText: '',
    successBody: {
      squadId: SQUAD_ID,
      name: 'Thursday Nights',
      members: [
        {
          membershipId: MEMBERSHIP_ID,
          displayName: 'Dave',
          role: 1,
          state: 1,
          isGuest: false,
        },
      ],
      features: [{ feature: 1, isEnabled: false }],
    },
    expected: {
      kind: 'success',
      value: {
        squadId: SQUAD_ID,
        name: 'Thursday Nights',
        members: [
          {
            membershipId: MEMBERSHIP_ID,
            displayName: 'Dave',
            role: 'owner',
            state: 'active',
            isGuest: false,
          },
        ],
        features: [{ feature: 'live-match-tracking', isEnabled: false }],
      },
    },
    invoke: (api, signal) => api.getSquad(SQUAD_ID, signal),
  },
  {
    name: 'getDisplayRatingLeaderboard',
    method: 'GET',
    path: fill(LEADERBOARD_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: `?statistic=${DISPLAY_RATING_STATISTIC}`,
    requestBodyText: '',
    successBody: {
      statistic: 2,
      entries: [{ membershipId: MEMBERSHIP_ID, displayName: 'Dave', value: 1042.4 }],
    },
    expected: {
      kind: 'success',
      value: {
        entries: [{ membershipId: MEMBERSHIP_ID, displayName: 'Dave', value: 1042.4 }],
      },
    },
    invoke: (api, signal) => api.getDisplayRatingLeaderboard(SQUAD_ID, signal),
  },
  {
    name: 'createSquad',
    method: 'POST',
    path: SQUADS_PATH,
    search: '',
    requestBodyText: JSON.stringify(CREATE_SQUAD_COMMAND),
    successBody: { squadId: SQUAD_ID, ownerMembershipId: MEMBERSHIP_ID },
    expected: {
      kind: 'success',
      value: { squadId: SQUAD_ID, ownerMembershipId: MEMBERSHIP_ID },
    },
    invoke: (api, signal) => api.createSquad(CREATE_SQUAD_COMMAND, signal),
  },
  {
    name: 'redeemInvite',
    method: 'POST',
    path: REDEEM_INVITE_PATH,
    search: '',
    requestBodyText: JSON.stringify(REDEEM_INVITE_COMMAND),
    successBody: { membershipId: MEMBERSHIP_ID, outcome: 0 },
    expected: {
      kind: 'success',
      value: { membershipId: MEMBERSHIP_ID, outcome: 'joined', squadId: null },
    },
    invoke: (api, signal) => api.redeemInvite(REDEEM_INVITE_COMMAND, signal),
  },
  {
    name: 'previewInvite',
    method: 'GET',
    path: PREVIEW_INVITE_PATH,
    search: '',
    requestBodyText: '',
    successBody: { requiresAuthentication: true, message: 'Sign in to join.' },
    expected: {
      kind: 'success',
      value: { requiresAuthentication: true, message: 'Sign in to join.' },
    },
    invoke: (api, signal) => api.previewInvite(signal),
  },
  {
    name: 'listInvites',
    method: 'GET',
    path: fill(INVITES_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: '',
    requestBodyText: '',
    successBody: [
      {
        inviteId: INVITE_ID,
        state: 1,
        createdAt: CREATED_AT,
        createdBy: 'Dave',
        expiresAt: null,
      },
    ],
    expected: {
      kind: 'success',
      value: [
        {
          inviteId: INVITE_ID,
          state: 'active',
          createdAtMs: CREATED_AT_MS,
          createdBy: 'Dave',
          expiresAtMs: null,
        },
      ],
    },
    invoke: (api, signal) => api.listInvites(SQUAD_ID, signal),
  },
  {
    name: 'generateInvite',
    method: 'POST',
    path: fill(INVITES_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: '',
    requestBodyText: JSON.stringify(GENERATE_INVITE_COMMAND),
    successBody: {
      inviteId: INVITE_ID,
      redeemableLink: 'https://pitch-mate.co.uk/join/a-secret',
      code: 'a-secret',
      expiresAt: null,
    },
    expected: {
      kind: 'success',
      value: {
        inviteId: INVITE_ID,
        redeemableLink: 'https://pitch-mate.co.uk/join/a-secret',
        code: 'a-secret',
        expiresAtMs: null,
      },
    },
    invoke: (api, signal) =>
      api.generateInvite(SQUAD_ID, GENERATE_INVITE_COMMAND, signal),
  },
  {
    name: 'revokeInvite',
    method: 'POST',
    path: fill(REVOKE_INVITE_PATH_TEMPLATE, {
      squadId: SQUAD_ID,
      inviteId: INVITE_ID,
    }),
    search: '',
    requestBodyText: '',
    expected: { kind: 'success', value: undefined },
    invoke: (api, signal) => api.revokeInvite(SQUAD_ID, INVITE_ID, signal),
  },
  {
    name: 'createGuest',
    method: 'POST',
    path: fill(GUESTS_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: '',
    requestBodyText: JSON.stringify(CREATE_GUEST_COMMAND),
    successBody: { guestMembershipId: MEMBERSHIP_ID },
    expected: { kind: 'success', value: { guestMembershipId: MEMBERSHIP_ID } },
    invoke: (api, signal) => api.createGuest(SQUAD_ID, CREATE_GUEST_COMMAND, signal),
  },
  {
    name: 'editGuest',
    method: 'PATCH',
    path: fill(GUEST_PATH_TEMPLATE, {
      squadId: SQUAD_ID,
      membershipId: MEMBERSHIP_ID,
    }),
    search: '',
    requestBodyText: JSON.stringify(EDIT_GUEST_COMMAND),
    expected: { kind: 'success', value: undefined },
    invoke: (api, signal) =>
      api.editGuest(SQUAD_ID, MEMBERSHIP_ID, EDIT_GUEST_COMMAND, signal),
  },
  {
    name: 'promoteToAdmin',
    method: 'POST',
    path: fill(PROMOTE_PATH_TEMPLATE, {
      squadId: SQUAD_ID,
      membershipId: MEMBERSHIP_ID,
    }),
    search: '',
    requestBodyText: '',
    expected: { kind: 'success', value: undefined },
    invoke: (api, signal) => api.promoteToAdmin(SQUAD_ID, MEMBERSHIP_ID, signal),
  },
  {
    name: 'getFeatureFlags',
    method: 'GET',
    path: fill(FEATURES_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: '',
    requestBodyText: '',
    successBody: [{ feature: 1, isEnabled: true }],
    expected: {
      kind: 'success',
      value: [{ feature: 'live-match-tracking', isEnabled: true }],
    },
    invoke: (api, signal) => api.getFeatureFlags(SQUAD_ID, signal),
  },
  {
    name: 'setFeatureFlag',
    method: 'PUT',
    path: fill(FEATURES_PATH_TEMPLATE, SQUAD_ID_SEGMENTS),
    search: '',
    requestBodyText: JSON.stringify(SET_FEATURE_FLAG_COMMAND),
    expected: { kind: 'success', value: undefined },
    invoke: (api, signal) =>
      api.setFeatureFlag(SQUAD_ID, SET_FEATURE_FLAG_COMMAND, signal),
  },
];

/** The reply a successful activation of `operation` receives. */
function successReply(operation: OperationCase): Response {
  return operation.successBody === undefined
    ? noContent()
    : jsonResponse(operation.successBody);
}

// --- Request shapes (Requirement 16.11) -------------------------------------

describe('createSquadsApi — request shapes', () => {
  it('takes every request body type from the generated contract', () => {
    // The assertion that matters is the type of the constant above; this keeps
    // the check a runtime test as well as a compile-time one.
    expect(REQUEST_TYPES_COME_FROM_THE_CONTRACT).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it.each(OPERATIONS)(
    '$name issues exactly one request with the contract method, path, and body',
    async (operation) => {
      const { api, requests } = makeApi(() => successReply(operation));

      const outcome = await operation.invoke(api);

      // 17.4: one activation, one request — no retry, no follow-up call.
      const request = onlyRequest(requests);
      expect(request.method).toBe(operation.method);
      expect(pathOf(request)).toBe(operation.path);
      expect(searchOf(request)).toBe(operation.search);
      expect(request.bodyText).toBe(operation.requestBodyText);
      expect(outcome).toEqual(operation.expected);
    },
  );

  it.each(OPERATIONS)(
    '$name issues no second request after a failing status',
    async (operation) => {
      // 17.4: a failure is a person's cue to retry, never the facade's. A `5xx`
      // classifies as a transport failure and stops there.
      const { api, requests } = makeApi(() =>
        jsonResponse({ title: 'Server error', status: 500 }, 500),
      );

      const outcome = await operation.invoke(api);

      expect(outcome).toEqual({ kind: 'transport-failure' });
      expect(requests).toHaveLength(1);
    },
  );

  it('requests the leaderboard with the display-rating statistic', async () => {
    const { api, requests } = makeApi(() =>
      jsonResponse({ statistic: 2, entries: [] }),
    );

    const outcome = await api.getDisplayRatingLeaderboard(SQUAD_ID);

    expect(outcome).toEqual({ kind: 'success', value: { entries: [] } });
    const request = onlyRequest(requests);
    // 16.11: the statistic name is the contract's own query value, carried once.
    expect(searchOf(request)).toBe(`?statistic=${DISPLAY_RATING_STATISTIC}`);
    expect(new URL(request.url).searchParams.getAll('statistic')).toEqual([
      DISPLAY_RATING_STATISTIC,
    ]);
  });
});

// --- The Squad_Call_Timeout (Requirement 16.3) ------------------------------

describe('createSquadsApi — the Squad_Call_Timeout', () => {
  it('bounds a call at ten seconds', () => {
    expect(SQUAD_CALL_TIMEOUT_MS).toBe(10_000);
  });

  it('leaves a call unsettled a millisecond before the limit', async () => {
    vi.useFakeTimers();
    const { api, firstRequest } = makeApi(() => neverSettles());

    let settled = false;
    const pending = api.listMySquads().then((outcome) => {
      settled = true;
      return outcome;
    });
    await firstRequest;

    await vi.advanceTimersByTimeAsync(SQUAD_CALL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    // Settle it so the pending promise is not left dangling.
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: 'timeout' });
  });

  it('settles as a timeout at the limit, aborts the request, and issues nothing further', async () => {
    vi.useFakeTimers();
    const { api, requests, firstRequest } = makeApi(() => neverSettles());

    const pending = api.getSquad(SQUAD_ID);
    await firstRequest;
    const request = onlyRequest(requests);
    expect(request.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(SQUAD_CALL_TIMEOUT_MS);

    expect(await pending).toEqual({ kind: 'timeout' });
    // 16.3: the lapsed limit aborts the request it abandoned.
    expect(request.signal.aborted).toBe(true);
    // 17.4: and issues no replacement for it.
    expect(requests).toHaveLength(1);
  });

  it('settles a submitting call as a timeout too', async () => {
    vi.useFakeTimers();
    const { api, requests, firstRequest } = makeApi(() => neverSettles());

    const pending = api.createSquad(CREATE_SQUAD_COMMAND);
    await firstRequest;
    await vi.advanceTimersByTimeAsync(SQUAD_CALL_TIMEOUT_MS);

    expect(await pending).toEqual({ kind: 'timeout' });
    expect(requests).toHaveLength(1);
  });

  it('does not report a timeout for a call that answered before the limit', async () => {
    vi.useFakeTimers();
    const { api } = makeApi(() => jsonResponse([]));

    const outcome = await api.listMySquads();

    expect(outcome).toEqual({ kind: 'success', value: [] });
    // Nothing is left scheduled: the timer is cleared on settlement, so
    // advancing past the limit produces no further outcome.
    await vi.advanceTimersByTimeAsync(SQUAD_CALL_TIMEOUT_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// --- The three-way abandonment distinction (Requirement 16.3) --------------

describe('createSquadsApi — timeout, caller abort, and network failure are distinct', () => {
  it('settles a caller abort as a transport failure with the request aborted', async () => {
    const controller = new AbortController();
    const { api, requests, firstRequest } = makeApi(() => neverSettles());

    const pending = api.listMySquads(controller.signal);
    await firstRequest;
    const request = onlyRequest(requests);

    controller.abort();

    // 16.3: not a `timeout` — only the facade's own lapsed limit reports that.
    expect(await pending).toEqual({ kind: 'transport-failure' });
    expect(request.signal.aborted).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('settles a call whose caller signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { api } = makeApi(() => neverSettles());

    expect(await api.getSquad(SQUAD_ID, controller.signal)).toEqual({
      kind: 'transport-failure',
    });
  });

  it('settles a network failure as a transport failure with the request never aborted', async () => {
    const seen: AbortSignal[] = [];
    const { api, requests } = makeApi((request) => {
      seen.push(request.signal);
      throw new Error('offline');
    });

    const outcome = await api.listInvites(SQUAD_ID);

    expect(outcome).toEqual({ kind: 'transport-failure' });
    expect(requests).toHaveLength(1);
    // 16.3: nothing abandoned this call — the transport answered, with a
    // rejection — so the request is left unaborted, which is what distinguishes
    // it from a caller abort that reports the same outcome.
    expect(seen.map((signal) => signal.aborted)).toEqual([false]);
  });

  it('reports a timeout rather than a transport failure once the limit has lapsed', async () => {
    vi.useFakeTimers();
    const { api, firstRequest } = makeApi(
      () =>
        // A transport that rejects only *after* being aborted, as a real one
        // does. The outcome must still be the timeout that abandoned it.
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => reject(new Error('aborted')), SQUAD_CALL_TIMEOUT_MS * 2);
        }),
    );

    const pending = api.previewInvite();
    await firstRequest;
    await vi.advanceTimersByTimeAsync(SQUAD_CALL_TIMEOUT_MS * 3);

    expect(await pending).toEqual({ kind: 'timeout' });
  });
});

// --- Parse failures on a 2xx (Requirement 16.4) ----------------------------

describe('createSquadsApi — a 2xx body the parser rejects', () => {
  it('settles uninterpretable text as a parse failure', async () => {
    const { api, requests } = makeApi(() => textResponse('not json at all'));

    expect(await api.getSquad(SQUAD_ID)).toEqual({ kind: 'parse-failure' });
    // 17.4: an uninterpretable body is not re-requested.
    expect(requests).toHaveLength(1);
  });

  it('settles a well-formed body of the wrong shape as a parse failure', async () => {
    const { api } = makeApi(() => jsonResponse({ squads: [] }));

    expect(await api.listMySquads()).toEqual({ kind: 'parse-failure' });
  });

  it('settles a member with an unnamed role code as a parse failure', async () => {
    const { api } = makeApi(() =>
      jsonResponse({
        squadId: SQUAD_ID,
        name: 'Thursday Nights',
        members: [
          {
            membershipId: MEMBERSHIP_ID,
            displayName: 'Dave',
            role: 9,
            state: 1,
            isGuest: false,
          },
        ],
        features: [],
      }),
    );

    expect(await api.getSquad(SQUAD_ID)).toEqual({ kind: 'parse-failure' });
  });

  it('settles an absent body as a parse failure where a value was required', async () => {
    const { api } = makeApi(() => emptyOkResponse());

    expect(await api.getSquad(SQUAD_ID)).toEqual({ kind: 'parse-failure' });
  });
});

// --- The RedeemInvite no-op (Requirements 4.6, 16.4) ----------------------

describe('createSquadsApi — an empty RedeemInvite body', () => {
  it('settles a 200 with no body as a success carrying no squad identity', async () => {
    const { api, requests } = makeApi(() => emptyOkResponse());

    const outcome = await api.redeemInvite(REDEEM_INVITE_COMMAND);

    // 4.6: the already-a-member no-op is a *successful* redemption. Failing it
    // would tell a person their invite did not work when nothing needed doing.
    expect(outcome).toEqual({
      kind: 'success',
      value: { membershipId: null, outcome: null, squadId: null },
    });
    expect(requests).toHaveLength(1);
  });

  it('settles a 200 with an empty text body the same way', async () => {
    const { api } = makeApi(() => textResponse(''));

    expect(await api.redeemInvite(REDEEM_INVITE_COMMAND)).toEqual({
      kind: 'success',
      value: { membershipId: null, outcome: null, squadId: null },
    });
  });

  it('carries no squad identity, so the caller falls back to re-listing', async () => {
    const { api } = makeApi(() => emptyOkResponse());

    const outcome = await api.redeemInvite(REDEEM_INVITE_COMMAND);

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.value.squadId).toBeNull();
      expect(outcome.value.membershipId).toBeNull();
    }
  });
});
