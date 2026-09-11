/**
 * Property tests for the Notifications_Api's single-request discipline (task 7.2).
 *
 * These carry **Property 22: Each call issues exactly one request and never
 * retries itself**:
 *
 *  - *exactly one request per call* — for any of the four notification calls and
 *    any outcome of it (any returned status, an uninterpretable body, no body at
 *    all, a transport failure, or a call the Notification_Call_Timeout aborts),
 *    the injected Api_Client is invoked exactly once, with no re-issue and no
 *    fallback request to a second endpoint (Requirement 11.11);
 *  - *no automatic retry* — once a call has settled, no further request appears,
 *    however long the test idles afterwards, whatever the outcome was
 *    (Requirement 11.11);
 *  - *one request per explicit activation* — repeating a call the number of times
 *    a person might activate a retry control issues exactly that many requests,
 *    each to the same endpoint, so every repeat attempt is traceable to an
 *    explicit activation rather than to the facade acting on its own
 *    (Requirements 5.9, 11.11).
 *
 * Scope note: Requirement 5.9's other half — the retry *control* remaining
 * available, and a further activation being prevented while a call awaits a
 * response — lives in the Notification_Panel, and is covered where that control
 * is built. What is provable at this seam, and what is proved here, is that the
 * facade contributes exactly one request per activation and never adds one of its
 * own.
 *
 * The client is a local fake rather than the generated client over an injected
 * `fetch`, deliberately: counting invocations of the seam the facade is required
 * to call once is exactly the measurement Property 22 asks for, and it keeps this
 * file free of any transport call of its own, which Requirement 11.3's source
 * scan over `features/app-shell/` depends on.
 *
 * Timeout *semantics* (abort, settle-as-failed within the stated window) belong
 * to Property 23 and its fake-timer test; this file drives a short real timeout
 * only to reach the "aborted by the Notification_Call_Timeout" arm of
 * Requirement 11.11 and count requests across it.
 *
 * Validates: Requirements 5.9, 11.11
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { PitchMateApiClient } from '@pitchmate/api-client';

import {
  createNotificationsApi,
  type NotificationsApi,
  type Outcome,
} from './notificationsApi';

// --- The client fake -------------------------------------------------------

/** The two client methods the facade is allowed to reach for. */
type ClientMethod = 'GET' | 'POST';

/** One recorded invocation of the injected client. */
interface RecordedRequest {
  readonly method: ClientMethod;
  readonly path: string;
}

/** How the fake client answers every invocation of a single scenario. */
type ClientReply =
  /** A returned response, with whatever body the scenario supplies. */
  | { readonly kind: 'respond'; readonly status: number; readonly body: unknown }
  /** A transport failure: the client's promise rejects. */
  | { readonly kind: 'reject' }
  /** A call that never answers, so the Notification_Call_Timeout decides it. */
  | { readonly kind: 'hang' };

/** The recorded call log of one fake client. */
interface FakeClient {
  readonly client: PitchMateApiClient;
  readonly requests: RecordedRequest[];
}

/**
 * A client fake that records every invocation and answers each one identically.
 *
 * It models only what the facade consumes: a `GET`/`POST` pair taking a path and
 * an init object, answering with `{ data, response }` the way `openapi-fetch`
 * does. The cast is confined to this one function.
 */
function fakeClient(reply: ClientReply): FakeClient {
  const requests: RecordedRequest[] = [];

  const respond = (method: ClientMethod, path: string): Promise<unknown> => {
    requests.push({ method, path });

    if (reply.kind === 'reject') {
      return Promise.reject(new TypeError('network unreachable'));
    }

    if (reply.kind === 'hang') {
      return new Promise<never>(() => {
        // Never settles: the facade's own timeout is what ends this call.
      });
    }

    return Promise.resolve({
      data: reply.body,
      response: { status: reply.status },
    });
  };

  const client = {
    GET: (path: string) => respond('GET', path),
    POST: (path: string) => respond('POST', path),
  };

  return { client: client as unknown as PitchMateApiClient, requests };
}

// --- Calls under test ------------------------------------------------------

/** The four notification calls the facade exposes. */
type CallName = 'list' | 'unreadCount' | 'markRead' | 'markAllRead';

/** One call to issue: which method, and the values it carries. */
interface CallSpec {
  readonly name: CallName;
  /** The active Squad_Scope, or absent for an account-wide call. */
  readonly squadId: string | undefined;
  /** The record identity a mark-read call carries. */
  readonly notificationId: string;
}

/** Issue one call, whichever of the four it is, and yield its settled outcome. */
function issue(api: NotificationsApi, call: CallSpec): Promise<Outcome<unknown>> {
  const scoped = call.squadId === undefined ? {} : { squadId: call.squadId };

  switch (call.name) {
    case 'list':
      return api.list(scoped);
    case 'unreadCount':
      return api.unreadCount(scoped);
    case 'markAllRead':
      return api.markAllRead(scoped);
    case 'markRead':
      return api.markRead({ notificationId: call.notificationId });
  }
}

/** The four outcome kinds a settled call is allowed to be. */
const OUTCOME_KINDS: readonly string[] = [
  'success',
  'unauthenticated',
  'not-found',
  'failure',
];

/**
 * Let the runtime run: a settled call gets a window of real time in which a
 * microtask- or timer-scheduled retry, if the facade had one, would show up in
 * the recorded call log.
 */
async function idle(ms = 2): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// --- Arbitraries -----------------------------------------------------------

/** A well-formed 36-character hyphenated identity. */
const identityArb: fc.Arbitrary<string> = fc.uuid();

/** A wire notification the pure parser accepts, so the success arm is reachable. */
const notificationWireArb = fc.record({
  notificationId: identityArb,
  type: fc.integer({ min: 0, max: 7 }),
  squadId: identityArb,
  title: fc.string({ minLength: 1, maxLength: 40 }),
  body: fc.string({ maxLength: 60 }),
  createdAt: fc
    .date({
      min: new Date('2020-01-01T00:00:00.000Z'),
      max: new Date('2030-01-01T00:00:00.000Z'),
      noInvalidDate: true,
    })
    .map((instant) => instant.toISOString()),
  readState: fc.integer({ min: 0, max: 1 }),
});

/**
 * Response bodies spanning both interpretations the facade attempts and the
 * shapes neither parser accepts, so the parse-failure arm is sampled as densely
 * as the success arm.
 */
const responseBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.array(notificationWireArb, { maxLength: 3 }),
  fc.nat({ max: 2_147_483_647 }),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('not json at all'),
  fc.record({ count: fc.nat() }),
  fc.integer({ min: -50, max: -1 }),
  fc.double({ min: 0.5, max: 9.5, noNaN: true }),
);

/** Every returned status, with the four the criteria name sampled densely. */
const statusArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constantFrom(200, 204, 401, 404, 409, 500, 503), weight: 3 },
  { arbitrary: fc.integer({ min: 100, max: 599 }), weight: 1 },
);

/** A reply that answers promptly, one way or another. */
const responsiveReplyArb: fc.Arbitrary<ClientReply> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('respond' as const),
      status: statusArb,
      body: responseBodyArb,
    }),
    weight: 4,
  },
  { arbitrary: fc.constant({ kind: 'reject' as const }), weight: 1 },
);

/** Any of the four calls, scoped or account-wide. */
const callArb: fc.Arbitrary<CallSpec> = fc.record({
  name: fc.constantFrom<CallName>('list', 'unreadCount', 'markRead', 'markAllRead'),
  squadId: fc.option(identityArb, { nil: undefined }),
  notificationId: identityArb,
});

// --- Property 22 -----------------------------------------------------------

describe('Property 22: each call issues exactly one request and never retries itself', () => {
  it('invokes the client exactly once per call, whatever the outcome', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, responsiveReplyArb, async (call, reply) => {
        const { client, requests } = fakeClient(reply);
        const api = createNotificationsApi(client);

        const outcome = await issue(api, call);

        // 11.11: one request. Not two, and never a fallback to a second
        // endpoint, whichever outcome the reply produced.
        expect(requests).toHaveLength(1);
        expect(OUTCOME_KINDS).toContain(outcome.kind);
      }),
      { numRuns: 200 },
    );
  });

  it('issues no further request after the call has settled', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, responsiveReplyArb, async (call, reply) => {
        const { client, requests } = fakeClient(reply);
        const api = createNotificationsApi(client);

        await issue(api, call);
        const afterSettling = requests.length;

        // 11.11: no automatic retry, however long the facade is left alone.
        await idle();
        expect(requests).toHaveLength(afterSettling);
        expect(requests).toHaveLength(1);
      }),
      { numRuns: 200 },
    );
  });

  it('issues exactly one request per explicit activation, always to the same endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        responsiveReplyArb,
        fc.integer({ min: 1, max: 5 }),
        async (call, reply, activations) => {
          const { client, requests } = fakeClient(reply);
          const api = createNotificationsApi(client);

          for (let attempt = 0; attempt < activations; attempt += 1) {
            const outcome = await issue(api, call);
            expect(OUTCOME_KINDS).toContain(outcome.kind);
            // 5.9: each activation contributes exactly one further request.
            expect(requests).toHaveLength(attempt + 1);
          }

          await idle();
          expect(requests).toHaveLength(activations);

          // 11.11: every attempt reaches the same endpoint — no fallback.
          const endpoints = new Set(
            requests.map((request) => `${request.method} ${request.path}`),
          );
          expect(endpoints.size).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('issues no second request after the call timeout has abandoned the first', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, async (call) => {
        const { client, requests } = fakeClient({ kind: 'hang' });
        // A short timeout stands in for the Notification_Call_Timeout so the
        // abandoned-call arm of Requirement 11.11 is reachable in real time.
        const api = createNotificationsApi(client, { timeoutMs: 5 });

        const outcome = await issue(api, call);

        expect(outcome.kind).toBe('failure');
        expect(requests).toHaveLength(1);

        // 11.11: an aborted call is not re-issued; the next attempt has to come
        // from a person.
        await idle(20);
        expect(requests).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });
});
