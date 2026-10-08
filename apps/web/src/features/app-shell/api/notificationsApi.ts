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
 *    through `mapCallOutcome`, and only a `success` outcome reads a body — the
 *    client's decoded `data`, which then goes through `parseNotificationList`,
 *    `parseUnreadCountResponse`, or `parseMarkAllReadResponse`. A
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
 * ### The typed body is taken, and still validated
 *
 * The committed OpenAPI document now declares a content schema for each
 * notification response that carries one — an array of `NotificationSummary`,
 * an `UnreadCountResponse`, a `MarkAllReadResponse` — so the generated types
 * describe the body and the client decodes it. This facade therefore takes the
 * client's **typed `data` value** rather than asking for the response text and
 * decoding it here (Requirement 12.12). {@link ClientCall} pins each call's
 * `data` to the response body the document declares for *that* operation, so a
 * method pointed at the wrong path, or at an operation whose response shape
 * moved, fails to compile here.
 *
 * A *described* body is not a *verified* one: the generated types state the
 * contract, while a proxy, a cache, or a backend bug can deliver something else.
 * The pure parsers therefore stay exactly where they were (Requirement 12.5),
 * and the all-or-nothing rule and the parse-failure-settles-as-failure rule are
 * unchanged — no Notification_Record and no count is ever produced by asserting
 * a type onto an undecoded value.
 *
 * A `2xx` whose body the client could not decode makes the client's promise
 * reject. That is caught on the one path every call takes and folded into
 * `failure`, which is the same outcome a parser reaching the same body would
 * have produced (Requirements 10.9, 10.10, 11.8).
 *
 * Requirements: 7.5, 9.1, 10.9, 10.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6,
 * 11.7, 11.8, 11.9, 11.10, 11.11, 12.5, 12.12
 */

import type { PitchMateApiClient, operations } from '@pitchmate/api-client';

import {
  parseMarkAllReadResponse,
  parseUnreadCountResponse,
  type CountParse,
} from '../lib/countParsing';
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
        (signal): ClientCall<'ListNotifications'> =>
          client.GET(LIST_PATH, {
            params: { query: listQuery(request.squadId) },
            signal,
          }),
      );
      if (settlement.kind !== 'success') {
        return settlement;
      }

      // 10.10: only an array is a Notification_List; anything else is a parse
      // failure, which settles the call as failed rather than rendering a
      // partial list. The contract declares an array here, and the parser is
      // what establishes that one actually arrived (Requirement 12.5).
      const parsed = parseNotificationList(settlement.body);
      return parsed.kind === 'parsed'
        ? { kind: 'success', value: parsed.records }
        : FAILURE;
    },

    async unreadCount(request = {}) {
      const settlement = await performCall(
        timeoutMs,
        request.signal,
        (signal): ClientCall<'GetUnreadNotificationCount'> =>
          client.GET(UNREAD_COUNT_PATH, {
            params: { query: unreadCountQuery(request.squadId) },
            signal,
          }),
      );
      return settleCount(settlement, parseUnreadCountResponse);
    },

    async markRead(request) {
      const settlement = await performCall(
        timeoutMs,
        request.signal,
        (signal): ClientCall<'MarkNotificationRead'> =>
          // 7.5: the notification identity is the only value supplied — this
          // call carries no squad identity, scoped or not.
          client.POST(MARK_READ_PATH, {
            params: { path: markReadPath(request.notificationId) },
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
        (signal): ClientCall<'MarkAllNotificationsRead'> =>
          client.POST(MARK_ALL_READ_PATH, {
            params: { query: markAllReadQuery(request.squadId) },
            signal,
          }),
      );
      return settleCount(settlement, parseMarkAllReadResponse);
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
 * The success body the generated contract declares for one operation, read off
 * that operation's own `200` response rather than named a second time.
 *
 * This is the half of Requirement 12.12 that bites: an operation whose declared
 * response body changes — renamed, re-shaped, or withdrawn — changes this type,
 * and the {@link ClientCall} annotation at that operation's call site stops
 * compiling. An operation declaring a `204` and no content resolves to
 * `undefined`, which is exactly what the client hands back for one, and so is
 * what the mark-read call's settlement carries.
 */
type SuccessBody<TOperation extends keyof operations> =
  operations[TOperation]['responses'] extends {
    200: { content: { 'application/json': infer TBody } };
  }
    ? TBody
    : undefined;

/**
 * The subset of an `openapi-fetch` call result this module reads.
 *
 * `TData` is the operation's declared success body, which is what makes `data`
 * a **typed** value here rather than an `unknown` this module decodes itself
 * (Requirement 12.12).
 *
 * `error` stays `unknown` and is never read: no failing arm of an
 * {@link Outcome} carries a status, a header, or a body value, so there is
 * nothing in a problem body this facade is permitted to pass on
 * (Requirement 11.10). `response` is narrowed to the one member read — the
 * status the mapper classifies.
 */
interface ClientCallResult<TData> {
  readonly data?: TData;
  readonly error?: unknown;
  readonly response?: { readonly status?: number };
}

/**
 * One settled Api_Client call of the named operation, as each method of the
 * facade annotates its own request.
 *
 * The annotation pins `TData` to the contract instead of leaving it to
 * inference, so the value handed to a parser is the response body the committed
 * document declares for that operation (Requirement 12.12).
 */
type ClientCall<TOperation extends keyof operations> = Promise<
  ClientCallResult<SuccessBody<TOperation>>
>;

/**
 * A settled call, before its body is interpreted. The success arm carries the
 * client's decoded body so a valued call can validate it and a valueless call
 * can ignore it; the failing arms are already {@link Outcome} values.
 */
type CallSettlement<TData> =
  | { readonly kind: 'success'; readonly body: TData | undefined }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failure' };

/** The one failed settlement, shared like {@link FAILURE}. */
const FAILED_SETTLEMENT: CallSettlement<never> = { kind: 'failure' };

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
async function performCall<TData>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  invoke: (signal: AbortSignal) => Promise<ClientCallResult<TData>>,
): Promise<CallSettlement<TData>> {
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

  // One request. A thrown transport failure, an abort, or the client's own
  // decode of a `2xx` body failing all become "no response", which the mapper
  // folds into `failure` (Requirements 10.9, 10.10, 11.8). Catching here also
  // means the abandoned promise can never surface as an unhandled rejection
  // after the timeout has settled the call.
  const call: Promise<ClientCallResult<TData> | null> = invoke(
    controller.signal,
  ).then(
    (result) => result,
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
      // 12.12: the typed body the client decoded, exactly as the generated
      // contract types it. An absent one — a `204`, or a `200` carrying nothing
      // — stays `undefined`, which every parser rejects.
      return { kind: 'success', body: raced.result.data };
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
 * each carry nothing but a count, in a **named object** — `{ count }` and
 * `{ markedCount }` respectively (Requirement 7.6) — read by the envelope parser
 * the caller supplies. Both parsers apply the same one value rule, so the only
 * difference between the two calls is the member name. A parse failure settles
 * the call as failed (Requirement 10.9).
 */
function settleCount<TData>(
  settlement: CallSettlement<TData>,
  parse: (body: unknown) => CountParse,
): CountCallOutcome {
  if (settlement.kind !== 'success') {
    return settlement;
  }
  const parsed = parse(settlement.body);
  return parsed.kind === 'parsed'
    ? { kind: 'success', value: parsed.value }
    : FAILURE;
}

/**
 * Read the returned response status, or `null` where the call returned no
 * response at all — a transport failure, an abort, or a `2xx` body the client
 * could not decode, each of which the mapper folds into `failure`
 * (Requirement 11.8).
 */
function readStatus(result: ClientCallResult<unknown> | null): number | null {
  const status = result?.response?.status;
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
