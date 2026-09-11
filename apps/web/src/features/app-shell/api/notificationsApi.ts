/**
 * The App_Shell's Notifications_Api facade — the **only** module under
 * `features/app-shell/` permitted to touch transport (Requirement 11.3).
 *
 * Everything above this module (the notification centre hook, the panel, the
 * indicator) speaks in {@link Outcome} values and never sees a status code, a
 * header, a response body, or an `AbortSignal` of its own making. That is what
 * makes the single point of transport structurally verifiable: a source scan
 * over every other file under `features/app-shell/` finds no `fetch`, no
 * `XMLHttpRequest`, and no Api_Client method call.
 *
 * ### What each method does
 *
 * 1. **Calls the injected client with the generated path, method, and query
 *    types.** The client is the Authenticated_Api_Client obtained from the
 *    Auth_Feature with the bearer-attaching middleware already installed, so
 *    access-token renewal is the Auth_Feature's concern and this module holds no
 *    token, expiry, or session logic of its own (Requirements 11.1, 9.1, 9.2).
 *    No Api_Client instance is constructed here. Every request path, method, and
 *    query shape is derived from `operations[...]` in `@pitchmate/api-client`, so
 *    no request shape is hand-written (Requirement 11.2).
 * 2. **Bounds the call with the Notification_Call_Timeout of 10 seconds**,
 *    implemented as an `AbortController` plus `setTimeout` chained with any
 *    caller-supplied signal. On a lapsed timeout the in-flight request is
 *    aborted, the call settles as `failure` immediately, and any response or
 *    error that arrives afterwards is disregarded (Requirements 11.4, 11.5,
 *    11.8). `AbortSignal.timeout` is deliberately **not** used: a manual
 *    controller is drivable by `vi.useFakeTimers()`, which is what lets the
 *    timeout be tested rather than waited out.
 * 3. **Settles through the pure mapper, then the pure parser.** The status goes
 *    through `mapCallOutcome`, and only a `success` outcome reads a body — which
 *    then goes through `parseNotificationList` or `parseNonNegativeInteger`. A
 *    parse failure settles the call as `failure`, so an unschematised body takes
 *    the Generic_Notification_Failure path (Requirements 10.9, 10.10, 11.6).
 *    No failure arm carries a status, a header, or a body value, so the caller
 *    has nothing to leak (Requirement 11.10).
 * 4. **Issues exactly one request and never retries.** There is no re-issue, no
 *    fallback request, and no automatic second attempt after any outcome; every
 *    repeat attempt originates from an explicit person-initiated action higher up
 *    (Requirement 11.11).
 *
 * `markRead` sends only the Notification_Record's identity, never a squad id,
 * irrespective of the active Squad_Scope (Requirement 7.5), and treats the
 * `204 No Content` the endpoint returns as success with **no parsed value** — it
 * reads no body at all, so an empty successful response can never be mistaken
 * for an uninterpretable one (Requirement 11.7).
 *
 * ### Why the body is read rather than taken from the generated type
 *
 * The committed OpenAPI document declares all four notification responses with
 * **no content schema**, so the generated types promise no body and the client
 * would hand back `undefined` if trusted. The facade therefore asks the client
 * for the response text (`parseAs: 'text'`) and hands the decoded value to the
 * pure parser, which is exactly why Requirement 10's parser is a contract
 * necessity rather than defensive programming. When the backend spec documents
 * these bodies, {@link readResponseBody} is the one place that changes.
 *
 * Requirements: 7.5, 9.1, 10.9, 10.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6,
 * 11.7, 11.8, 11.9, 11.10, 11.11
 */

import type { PitchMateApiClient, operations } from '@pitchmate/api-client';

import { parseNonNegativeInteger } from '../lib/countParsing';
import {
  parseNotificationList,
  type NotificationRecord,
} from '../lib/notificationParsing';
import { mapCallOutcome } from '../lib/outcomeMapping';

// --- Endpoint paths (the generated contract's own path keys) ----------------

/** `GET /notifications` — the Notification_List (Requirement 5.4). */
const LIST_PATH = '/notifications';

/** `GET /notifications/unread-count` — the Unread_Count (Requirement 4.1). */
const UNREAD_COUNT_PATH = '/notifications/unread-count';

/** `POST /notifications/{notificationId}/read` — mark one read (Req 6.1). */
const MARK_READ_PATH = '/notifications/{notificationId}/read';

/** `POST /notifications/read-all` — mark every one read (Requirement 6.4). */
const MARK_ALL_READ_PATH = '/notifications/read-all';

// --- Request shapes, derived from the generated contract (Req 11.2) ---------

/** Query parameters of `GET /notifications`. */
type ListQuery = NonNullable<
  operations['ListNotifications']['parameters']['query']
>;

/** Query parameters of `GET /notifications/unread-count`. */
type UnreadCountQuery = NonNullable<
  operations['GetUnreadNotificationCount']['parameters']['query']
>;

/** Query parameters of `POST /notifications/read-all`. */
type MarkAllReadQuery = NonNullable<
  operations['MarkAllNotificationsRead']['parameters']['query']
>;

/** Path parameters of `POST /notifications/{notificationId}/read`. */
type MarkReadPath = operations['MarkNotificationRead']['parameters']['path'];

/** A squad identity as the generated contract types it. */
export type SquadIdentity = ListQuery['squadId'];

/** A notification identity as the generated contract types it. */
export type NotificationIdentity = MarkReadPath['notificationId'];

/**
 * A call that may carry the active Squad_Scope.
 *
 * Omitting `squadId` calls the endpoint **without** a squad identity, which the
 * backend answers account-wide — the behaviour Requirement 7.1 asks for when no
 * well-formed Squad_Scope is active. `signal` lets the caller cancel a call in
 * flight, which is how a Squad_Scope change abandons the previous scope's calls
 * (Requirement 7.3).
 */
export interface ScopedRequest {
  /** The active Squad_Scope, or absent for an account-wide call (Req 7.1, 7.2). */
  readonly squadId?: SquadIdentity;
  /** A caller signal chained with the Notification_Call_Timeout (Req 7.3). */
  readonly signal?: AbortSignal;
}

/**
 * A mark-read call. It carries the Notification_Record's identity as its only
 * supplied value — never a squad identity (Requirement 7.5).
 */
export interface MarkReadRequest {
  /** The identity of the single Notification_Record being marked read. */
  readonly notificationId: NotificationIdentity;
  /** A caller signal chained with the Notification_Call_Timeout. */
  readonly signal?: AbortSignal;
}

// --- Outcomes ---------------------------------------------------------------

/**
 * The settled outcome of one notification call: exactly one of the four
 * outcomes `mapCallOutcome` produces, with a parsed value on the success arm
 * only (Requirement 11.6).
 *
 * The three failing arms carry **nothing**. That is deliberate: a caller cannot
 * render a status code, a status text, a header, or a body value it was never
 * given, so every failing call is presented with the one
 * Generic_Notification_Failure message (Requirement 11.10).
 */
export type Outcome<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failure' };

/** The outcome of a list call. */
export type NotificationCallOutcome = Outcome<NotificationRecord[]>;

/** The outcome of an unread-count or mark-all-read call. */
export type CountCallOutcome = Outcome<number>;

/** The outcome of a mark-read call: success carries no value (Req 11.7). */
export type AcknowledgementOutcome = Outcome<void>;

/** The Notification_Call_Timeout: 10 seconds (Requirement 11.4). */
export const NOTIFICATION_CALL_TIMEOUT_MS = 10_000;

/** The one `failure` value, shared so callers can compare cheaply. */
const FAILURE: Outcome<never> = { kind: 'failure' };

/** The one success value of a call that parses no body (Requirement 11.7). */
const ACKNOWLEDGED: AcknowledgementOutcome = { kind: 'success', value: undefined };

// --- Facade surface ---------------------------------------------------------

/**
 * The notification backend surface the notification centre consumes. Four
 * methods, one request each, no retry (Requirement 11.11).
 */
export interface NotificationsApi {
  /** `GET /notifications` — the Notification_List for the active scope. */
  list(request?: ScopedRequest): Promise<NotificationCallOutcome>;
  /** `GET /notifications/unread-count` — the Unread_Count for the active scope. */
  unreadCount(request?: ScopedRequest): Promise<CountCallOutcome>;
  /** `POST /notifications/{notificationId}/read` — mark one record read. */
  markRead(request: MarkReadRequest): Promise<AcknowledgementOutcome>;
  /** `POST /notifications/read-all` — mark every record of the scope read. */
  markAllRead(request?: ScopedRequest): Promise<CountCallOutcome>;
}

/** Options for {@link createNotificationsApi}. */
export interface NotificationsApiOptions {
  /**
   * The per-call timeout in milliseconds. Defaults to the
   * Notification_Call_Timeout of 10 seconds; a value that is not a positive
   * finite number falls back to that default rather than leaving a call
   * unbounded (Requirement 11.4).
   */
  readonly timeoutMs?: number;
}

/**
 * Create the Notifications_Api over an injected Authenticated_Api_Client.
 *
 * @param client the Authenticated_Api_Client from the Auth_Feature, already
 *   carrying the bearer-attaching middleware. No client is constructed here
 *   (Requirements 11.1, 9.1).
 * @param options per-call timeout override, for tests driving the timeout with
 *   fake timers
 *
 * Requirements: 7.5, 9.1, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.11
 */
export function createNotificationsApi(
  client: PitchMateApiClient,
  options?: NotificationsApiOptions,
): NotificationsApi {
  const timeoutMs = effectiveTimeoutMs(options?.timeoutMs);

  return {
    async list(request = {}) {
      const settlement = await performCall(
        timeoutMs,
        request.signal,
        (signal) =>
          client.GET(LIST_PATH, {
            params: { query: listQuery(request.squadId) },
            parseAs: 'text',
            signal,
          }),
      );
      if (settlement.kind !== 'success') {
        return settlement;
      }

      // 10.10: only an array is a Notification_List; anything else is a parse
      // failure, which settles the call as failed rather than rendering a
      // partial list.
      const parsed = parseNotificationList(
        await readResponseBody(settlement.result),
      );
      return parsed.kind === 'parsed'
        ? { kind: 'success', value: parsed.records }
        : FAILURE;
    },

    async unreadCount(request = {}) {
      const settlement = await performCall(
        timeoutMs,
        request.signal,
        (signal) =>
          client.GET(UNREAD_COUNT_PATH, {
            params: { query: unreadCountQuery(request.squadId) },
            parseAs: 'text',
            signal,
          }),
      );
      return settleCount(settlement);
    },

    async markRead(request) {
      const settlement = await performCall(
        timeoutMs,
        request.signal,
        (signal) =>
          // 7.5: the notification identity is the only value supplied — this
          // call carries no squad identity, scoped or not.
          client.POST(MARK_READ_PATH, {
            params: { path: markReadPath(request.notificationId) },
            parseAs: 'text',
            signal,
          }),
      );
      if (settlement.kind !== 'success') {
        return settlement;
      }

      // 11.7: the endpoint answers `204 No Content`. No body is read, so an
      // empty successful response is success with no parsed value rather than
      // an uninterpretable body.
      return ACKNOWLEDGED;
    },

    async markAllRead(request = {}) {
      const settlement = await performCall(
        timeoutMs,
        request.signal,
        (signal) =>
          client.POST(MARK_ALL_READ_PATH, {
            params: { query: markAllReadQuery(request.squadId) },
            parseAs: 'text',
            signal,
          }),
      );
      return settleCount(settlement);
    },
  };
}

// --- Query and path builders (typed by the generated contract) --------------

/**
 * Build the list query. An absent Squad_Scope contributes **no** query
 * parameter, so the account-wide list is requested by omission rather than by a
 * sentinel value (Requirement 7.1).
 */
function listQuery(squadId: SquadIdentity): ListQuery {
  return squadId === undefined ? {} : { squadId };
}

/** Build the unread-count query (Requirements 7.1, 7.2). */
function unreadCountQuery(squadId: SquadIdentity): UnreadCountQuery {
  return squadId === undefined ? {} : { squadId };
}

/** Build the mark-all-read query (Requirements 7.1, 7.2). */
function markAllReadQuery(squadId: SquadIdentity): MarkAllReadQuery {
  return squadId === undefined ? {} : { squadId };
}

/** Build the mark-read path parameters — the identity alone (Req 7.5). */
function markReadPath(notificationId: NotificationIdentity): MarkReadPath {
  return { notificationId };
}

// --- Call plumbing ----------------------------------------------------------

/**
 * The subset of an `openapi-fetch` call result this module reads. The generated
 * types model no response body for these endpoints (see the module note), so the
 * result is read as `unknown` and validated by the pure parsers.
 */
interface ClientCallResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response?: unknown;
}

/**
 * A settled call, before its body is interpreted. The success arm carries the
 * raw client result so a valued call can read a body and a valueless call can
 * ignore it; the failing arms are already {@link Outcome} values.
 */
type CallSettlement =
  | { readonly kind: 'success'; readonly result: ClientCallResult }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failure' };

/** The one failed settlement, shared like {@link FAILURE}. */
const FAILED_SETTLEMENT: CallSettlement = { kind: 'failure' };

/**
 * Issue exactly one request, bounded by the Notification_Call_Timeout, and map
 * its returned status to an outcome.
 *
 * The timeout is an `AbortController` plus `setTimeout` rather than
 * `AbortSignal.timeout` so that a test can drive it with fake timers. When the
 * timer wins the race the request is aborted and the call settles as `failure`
 * at once; the abandoned request's eventual resolution is dropped on the floor,
 * which is what "disregard any response or error that arrives after the abort"
 * means in practice (Requirements 11.4, 11.5, 11.8).
 *
 * `invoke` is called **once**. There is no retry, re-issue, or fallback for any
 * outcome (Requirement 11.11).
 */
async function performCall(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  invoke: (signal: AbortSignal) => Promise<unknown>,
): Promise<CallSettlement> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();

  let lapsed = false;
  let reportLapse: () => void = () => {};
  const timeoutLapsed = new Promise<void>((resolve) => {
    reportLapse = resolve;
  });
  const timer = setTimeout(() => {
    lapsed = true;
    controller.abort();
    reportLapse();
  }, timeoutMs);

  // Chain the caller's signal so a Squad_Scope change or an unmount cancels the
  // request as well (Requirement 7.3).
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  // One request. A thrown transport failure or abort becomes "no response",
  // which the mapper folds into `failure` (Requirement 11.8). Catching here also
  // means the abandoned promise can never surface as an unhandled rejection
  // after the timeout has settled the call.
  const call: Promise<ClientCallResult | null> = invoke(controller.signal).then(
    (result) => result as ClientCallResult,
    () => null,
  );

  try {
    const raced = await Promise.race([
      call.then((result) => ({ settled: true as const, result })),
      timeoutLapsed.then(() => ({ settled: false as const, result: null })),
    ]);

    // 11.4, 11.5: a lapsed timeout is a failed call, whatever arrives later.
    if (lapsed || !raced.settled) {
      return FAILED_SETTLEMENT;
    }

    const outcome = mapCallOutcome(readStatus(raced.result));
    if (outcome === 'success' && raced.result !== null) {
      return { kind: 'success', result: raced.result };
    }
    if (outcome === 'unauthenticated') {
      return { kind: 'unauthenticated' };
    }
    if (outcome === 'not-found') {
      return { kind: 'not-found' };
    }
    return FAILED_SETTLEMENT;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Interpret a settled count call: the unread-count and mark-all-read responses
 * both carry nothing but a count, parsed by the one non-negative integer parser.
 * A parse failure settles the call as failed (Requirement 10.9).
 */
async function settleCount(
  settlement: CallSettlement,
): Promise<CountCallOutcome> {
  if (settlement.kind !== 'success') {
    return settlement;
  }
  const parsed = parseNonNegativeInteger(await readResponseBody(settlement.result));
  return parsed.kind === 'parsed'
    ? { kind: 'success', value: parsed.value }
    : FAILURE;
}

/**
 * Decode a successful response body into the `unknown` value the pure parsers
 * validate.
 *
 * Because the contract declares no content schema, the client is asked for text
 * and the JSON decoding happens here. Three shapes are accommodated so that the
 * facade behaves identically against the real generated client and against a
 * client fake in a test:
 *
 * - a string `data` — the response text, decoded here, with an empty body
 *   yielding `undefined` (which every parser rejects);
 * - any other present `data` — a fake that supplies an already-decoded body;
 * - no `data` — the body is read from the response object if it still can be.
 *
 * The function never throws: a malformed body yields `undefined`, which the
 * parsers turn into a parse failure and so into a failed call
 * (Requirements 10.9, 10.10).
 */
async function readResponseBody(result: ClientCallResult): Promise<unknown> {
  if (typeof result.data === 'string') {
    return decodeJson(result.data);
  }
  if (result.data !== undefined) {
    return result.data;
  }

  const response = result.response;
  if (!isUnreadBody(response)) {
    return undefined;
  }
  try {
    return decodeJson(await response.text());
  } catch {
    return undefined;
  }
}

/** Decode a response text, yielding `undefined` for empty or malformed text. */
function decodeJson(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A response whose body is still readable. */
function isUnreadBody(
  response: unknown,
): response is { text(): Promise<string> } {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const candidate = response as { text?: unknown; bodyUsed?: unknown };
  return typeof candidate.text === 'function' && candidate.bodyUsed !== true;
}

/**
 * Read the returned response status, or `null` where the call returned no
 * response at all — a transport failure or an abort, which the mapper folds into
 * `failure` (Requirement 11.8).
 */
function readStatus(result: ClientCallResult | null): number | null {
  if (result === null || typeof result.response !== 'object' || result.response === null) {
    return null;
  }
  const status = (result.response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * Resolve the per-call timeout. A value that is not a positive finite number
 * falls back to the Notification_Call_Timeout, so no call is left unbounded
 * (Requirement 11.4).
 */
function effectiveTimeoutMs(configured: number | undefined): number {
  if (
    typeof configured !== 'number' ||
    !Number.isFinite(configured) ||
    configured <= 0
  ) {
    return NOTIFICATION_CALL_TIMEOUT_MS;
  }
  return configured;
}
