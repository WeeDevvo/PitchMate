import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type { PitchMateApiClient } from '@pitchmate/api-client';

import {
  createNotificationsApi,
  NOTIFICATION_CALL_TIMEOUT_MS,
  type NotificationsApi,
  type Outcome,
} from './notificationsApi';

/**
 * Property test for the Notification_Call_Timeout, placed beside the one module
 * permitted to touch transport and run well above the 100-iteration floor.
 *
 * This carries **Property 23: A lapsed timeout aborts the request and settles
 * the call as failed** over all four notification calls (`list`, `unreadCount`,
 * `markRead`, `markAllRead`):
 *
 *  - *the request is aborted* — the `AbortSignal` the facade handed to the
 *    Api_Client reports the aborted state the instant the timeout lapses, so the
 *    in-flight request is abandoned rather than still awaited (Requirement 11.4);
 *  - *the call settles as a failed call* — the returned promise settles as
 *    `{ kind: 'failure' }`, and it does so with **no further time passing** on
 *    the clock, which is inside the 500-millisecond allowance the criterion
 *    grants (Requirements 11.4, 11.5);
 *  - *nothing settles early* — one tick short of the timeout the call is still
 *    unsettled and the signal is still unaborted, so the bound is the stated
 *    duration rather than something shorter;
 *  - *a late arrival is disregarded* — a successful response, or an error,
 *    arriving for that call after the abort leaves the settled outcome untouched
 *    and provokes no second request (Requirements 11.4, 11.5);
 *  - *no control is left indefinitely in progress* — every call settles from the
 *    timeout alone, without the transport ever answering.
 *
 * The timeout is driven with `vi.useFakeTimers()`: the facade deliberately uses
 * an `AbortController` plus `setTimeout` rather than `AbortSignal.timeout`, so
 * the ten seconds are advanced rather than waited out. Time is only ever moved
 * by an explicit advance, and settlement is observed by draining the microtask
 * queue, so each iteration is deterministic — no run depends on how long any
 * real work took.
 *
 * The client is a local fake whose calls hang until the test resolves them.
 * That is not a stand-in for behaviour under test: the property is precisely
 * about what the facade does when transport never answers, so an unanswering
 * transport is the real subject.
 *
 * **Validates: Requirements 11.4, 11.5**
 */

// --- Local test doubles -----------------------------------------------------

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

/** The only part of the Api_Client call options this fake reads. */
interface FakeCallInit {
  readonly signal?: AbortSignal;
}

/** One request the facade issued, with the signal it was bounded by. */
interface RecordedRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly signal: AbortSignal | undefined;
  readonly answer: Deferred<unknown>;
}

/**
 * An Api_Client fake that records each request and never answers it until the
 * test does. Only `GET` and `POST` are reachable through the facade; the cast
 * keeps the fake to the surface actually exercised.
 */
function createHangingClient(): {
  readonly client: PitchMateApiClient;
  readonly requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];

  const record = (
    method: 'GET' | 'POST',
    path: string,
    init?: FakeCallInit,
  ): Promise<unknown> => {
    const answer = deferred<unknown>();
    requests.push({ method, path, signal: init?.signal, answer });
    return answer.promise;
  };

  const client = {
    GET: (path: string, init?: FakeCallInit) => record('GET', path, init),
    POST: (path: string, init?: FakeCallInit) => record('POST', path, init),
  } as unknown as PitchMateApiClient;

  return { client, requests };
}

// --- The four notification calls --------------------------------------------

/** The notification calls Property 23 quantifies over. */
type CallKind = 'list' | 'unreadCount' | 'markRead' | 'markAllRead';

const ALL_CALL_KINDS: readonly CallKind[] = [
  'list',
  'unreadCount',
  'markRead',
  'markAllRead',
];

/** Issue one notification call of the given kind. */
function issueCall(
  api: NotificationsApi,
  kind: CallKind,
  squadId: string | undefined,
  notificationId: string,
): Promise<Outcome<unknown>> {
  switch (kind) {
    case 'list':
      return api.list({ squadId });
    case 'unreadCount':
      return api.unreadCount({ squadId });
    case 'markAllRead':
      return api.markAllRead({ squadId });
    case 'markRead':
      return api.markRead({ notificationId });
  }
}

/**
 * A response the facade would have settled as `success` had it arrived in time:
 * a `200` carrying a body each kind's parser accepts. Used to prove a late
 * arrival is disregarded rather than merely lost.
 */
function successfulResponse(kind: CallKind): unknown {
  const body = kind === 'list' ? '[]' : '7';
  return { data: body, response: { status: 200 } };
}

// --- Observing settlement without letting time pass -------------------------

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

/**
 * Drain the microtask queue without advancing the clock, so "has it settled
 * yet?" is answered deterministically rather than by waiting.
 */
async function drainMicrotasks(rounds = 16): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
  }
}

// --- Arbitraries ------------------------------------------------------------

const callKindArb: fc.Arbitrary<CallKind> = fc.constantFrom(...ALL_CALL_KINDS);

/**
 * A timeout to drive. `undefined` exercises the Notification_Call_Timeout
 * itself; the generated values keep the property honest about the bound being
 * whatever timeout is in force rather than a hard-coded ten seconds. Values
 * start at 2 so "one tick short of the timeout" is a positive duration.
 */
const timeoutArb: fc.Arbitrary<number | undefined> = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 2 },
  { arbitrary: fc.constant(NOTIFICATION_CALL_TIMEOUT_MS), weight: 2 },
  { arbitrary: fc.integer({ min: 2, max: 120_000 }), weight: 3 },
);

/** A well-formed squad identity, or none — the timeout applies either way. */
const squadIdArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.uuid(),
);

const notificationIdArb: fc.Arbitrary<string> = fc.uuid();

/** The timeout actually in force for a given override. */
function effectiveTimeout(configured: number | undefined): number {
  return configured ?? NOTIFICATION_CALL_TIMEOUT_MS;
}

// --- The property -----------------------------------------------------------

describe('Property 23: a lapsed timeout aborts the request and settles the call as failed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the in-flight request and settles as failure the moment the timeout lapses', async () => {
    await fc.assert(
      fc.asyncProperty(
        callKindArb,
        timeoutArb,
        squadIdArb,
        notificationIdArb,
        async (kind, timeoutMs, squadId, notificationId) => {
          const { client, requests } = createHangingClient();
          const api = createNotificationsApi(
            client,
            timeoutMs === undefined ? undefined : { timeoutMs },
          );
          const lapseAt = effectiveTimeout(timeoutMs);

          const call = issueCall(api, kind, squadId, notificationId);
          const tracked = track(call);
          await drainMicrotasks();

          // Exactly one request went out, bounded by a signal of the facade's
          // own making.
          expect(requests).toHaveLength(1);
          const { signal } = requests[0];
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(signal?.aborted).toBe(false);

          // One tick short of the timeout nothing has happened: the bound is the
          // stated duration, not something shorter.
          vi.advanceTimersByTime(lapseAt - 1);
          await drainMicrotasks();
          expect(signal?.aborted).toBe(false);
          expect(tracked.settled).toBe(false);

          // The timeout lapses. The abort is immediate (Requirement 11.4).
          vi.advanceTimersByTime(1);
          expect(signal?.aborted).toBe(true);

          // ... and the call settles as failed with no further time passing,
          // which is inside the 500-millisecond allowance the criterion grants
          // (Requirements 11.4, 11.5).
          const settledAt = Date.now();
          await drainMicrotasks();
          expect(tracked.settled).toBe(true);
          expect(Date.now() - settledAt).toBeLessThanOrEqual(500);

          const outcome = await call;
          expect(outcome).toEqual({ kind: 'failure' });

          // The transport never answered, and the facade never asked twice.
          expect(requests).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('disregards a successful response that arrives after the abort', async () => {
    await fc.assert(
      fc.asyncProperty(
        callKindArb,
        timeoutArb,
        squadIdArb,
        notificationIdArb,
        fc.boolean(),
        async (kind, timeoutMs, squadId, notificationId, answerBeforeDraining) => {
          const { client, requests } = createHangingClient();
          const api = createNotificationsApi(
            client,
            timeoutMs === undefined ? undefined : { timeoutMs },
          );

          const call = issueCall(api, kind, squadId, notificationId);
          await drainMicrotasks();
          expect(requests).toHaveLength(1);

          vi.advanceTimersByTime(effectiveTimeout(timeoutMs));
          expect(requests[0].signal?.aborted).toBe(true);

          // The abandoned request answers successfully. Whether it lands in the
          // same turn as the abort or long after the call has already settled,
          // the outcome is the failed call the timeout produced.
          if (answerBeforeDraining) {
            requests[0].answer.resolve(successfulResponse(kind));
            expect(await call).toEqual({ kind: 'failure' });
          } else {
            expect(await call).toEqual({ kind: 'failure' });
            requests[0].answer.resolve(successfulResponse(kind));
            await drainMicrotasks();
            expect(await call).toEqual({ kind: 'failure' });
          }

          await drainMicrotasks();
          expect(requests).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('disregards an error that arrives for the aborted request', async () => {
    await fc.assert(
      fc.asyncProperty(
        callKindArb,
        timeoutArb,
        squadIdArb,
        notificationIdArb,
        async (kind, timeoutMs, squadId, notificationId) => {
          const { client, requests } = createHangingClient();
          const api = createNotificationsApi(
            client,
            timeoutMs === undefined ? undefined : { timeoutMs },
          );

          const call = issueCall(api, kind, squadId, notificationId);
          await drainMicrotasks();

          vi.advanceTimersByTime(effectiveTimeout(timeoutMs));
          expect(requests[0].signal?.aborted).toBe(true);

          // An aborted transport typically rejects. That rejection must neither
          // change the settled outcome nor escape as an unhandled rejection.
          requests[0].answer.reject(
            new DOMException('The operation was aborted.', 'AbortError'),
          );
          await drainMicrotasks();

          expect(await call).toEqual({ kind: 'failure' });
          expect(requests).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('applies the Notification_Call_Timeout of ten seconds by default', async () => {
    await fc.assert(
      fc.asyncProperty(
        callKindArb,
        squadIdArb,
        notificationIdArb,
        async (kind, squadId, notificationId) => {
          const { client, requests } = createHangingClient();
          const api = createNotificationsApi(client);

          const call = issueCall(api, kind, squadId, notificationId);
          const tracked = track(call);
          await drainMicrotasks();

          vi.advanceTimersByTime(NOTIFICATION_CALL_TIMEOUT_MS - 1);
          await drainMicrotasks();
          expect(requests[0].signal?.aborted).toBe(false);
          expect(tracked.settled).toBe(false);

          vi.advanceTimersByTime(1);
          await drainMicrotasks();
          expect(requests[0].signal?.aborted).toBe(true);
          expect(tracked.settled).toBe(true);
          expect(await call).toEqual({ kind: 'failure' });
        },
      ),
      { numRuns: 100 },
    );
  });
});
