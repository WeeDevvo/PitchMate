/**
 * The Player_Stats_Feature's single transport seam — the **only** module of the
 * feature permitted to touch the Api_Client (Requirement 12.1).
 *
 * Everything above this module speaks in {@link CallResult} values. The screen,
 * the load machine, and every component never see a status code, a header, a
 * response body, a problem-response member, or an `AbortSignal` of their own
 * making, which is what makes the "one point of transport" claim structurally
 * verifiable: a source scan over every other file under `features/player-stats/`
 * finds no `fetch`, no `XMLHttpRequest`, no endpoint path, no HTTP-method
 * literal, and no Api_Client method call.
 *
 * The shape is the Squads_Feature's seam narrowed to **one operation** and
 * **five outcome arms**. The mechanics are carried over deliberately rather than
 * reinvented — they are proven twice already, and Requirement 12 asks for the
 * same behaviour:
 *
 * 1. **One injected client.** The Authenticated_Api_Client arrives through
 *    {@link PlayerStatsApiDependencies}. This module constructs no client,
 *    installs no middleware, and reads no access token, refresh token, or
 *    session value — attachment and renewal stay the Auth_Feature's concern
 *    (Requirement 12.2).
 * 2. **The response type comes from the generated contract.** The call site is
 *    annotated {@link ClientCall}`<'GetPlayerProfile'>`, so the client's result
 *    must be assignable to the body the OpenAPI document declares for *that*
 *    operation. The typed `data` is handed to `parsePlayerProfile` with **no
 *    cast**, so a change to the declared response body fails to compile here
 *    (Requirement 12.6).
 * 3. **The parser still runs, because a type is not a check.** A typed `data`
 *    value is the contract's *promise* about the body, not evidence about it: a
 *    proxy, a cache, or a backend bug can deliver something the type says is
 *    impossible. An absent body reaches the parser as `undefined`, which it
 *    rejects — there is no valueless success on this operation.
 * 4. **One classification point.** The three signals of a settled call (the
 *    status or its absence, whether our own timeout fired, and the parser's
 *    verdict) go through `classifyOutcome` in `lib/callOutcome.ts`. This module
 *    makes no outcome decision of its own and contains no HTTP status value
 *    (Requirements 12.5, 12.8).
 * 5. **A per-call `AbortController` plus `setTimeout`** at the
 *    Profile_Call_Timeout. `AbortSignal.timeout` is deliberately avoided so a
 *    test can drive the limit with `vi.useFakeTimers()` instead of waiting it
 *    out (Requirement 12.3). A caller-supplied signal is chained to the internal
 *    controller, so an unmount, an Auth_State transition, or a change of
 *    subject abandons the request in flight. The three abandonment causes stay
 *    distinguishable: our timer settles the call as `timeout`, while a caller
 *    abort and a transport rejection both settle it as `transport-failure`
 *    (Requirement 12.4).
 * 6. **No retry, ever.** `invoke` is called exactly once per activation. There
 *    is no re-issue and no fallback request for any outcome, so every repeat
 *    request is the consequence of a person activating a control (Requirement
 *    2.6).
 *
 * Two narrowings against the squads seam are worth naming, because both remove
 * a field rather than leave one unused:
 *
 *  - **The problem body is never read.** `GetPlayerProfile` declares no
 *    client-actionable rejection — the route constrains both identities to a
 *    `guid`, and the `404` carries no `code` extension — so there is no
 *    rejection reason to name and nothing to read out of the client's `error`.
 *    This module never touches that value, so no part of a rejected response has
 *    a path into the feature at all (Requirements 12.5, and 3.7 by consequence).
 *  - **No failing arm of {@link CallResult} declares a field.** Four of the five
 *    arms are bare tags, so a caller has nothing of the backend's wording,
 *    status, or existence claims to render.
 *
 * Requirements: 2.6, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.8
 */

import type { operations, PitchMateApiClient } from '@pitchmate/api-client';

import { classifyOutcome } from '../lib/callOutcome';
import {
  parsePlayerProfile,
  type PlayerProfile,
} from '../lib/parse/playerProfile';

/**
 * `GET /squads/{squadId}/members/{membershipId}/profile` — the one endpoint this
 * feature reads, spelled once, in the generated contract's own path form.
 */
const PLAYER_PROFILE_PATH = '/squads/{squadId}/members/{membershipId}/profile';

/** The Profile_Call_Timeout: 10 seconds (Requirement 12.3). */
export const PROFILE_CALL_TIMEOUT_MS = 10_000;

/**
 * The settled outcome of one Player_Stats_Api call: exactly one of the five
 * kinds `classifyOutcome` produces, with the parsed Player_Profile on the
 * `success` arm only (Requirement 12.8).
 *
 * The four failing arms carry **nothing at all** — no status, no header, no body
 * value, no problem-response member — so a screen renders a fixed message
 * because it has nothing else it could render, and the Not_Found_Treatment
 * states nothing about whether a squad or a membership exists (Requirements
 * 3.7, 12.5).
 *
 * This is `CallOutcomeKind` from `lib/callOutcome.ts` widened by one field on
 * one arm, so the seam and the screen read a single vocabulary of outcomes.
 */
export type CallResult<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'transport-failure' }
  | { readonly kind: 'parse-failure' };

/**
 * The stats backend surface the screen consumes: one method, one request per
 * activation, no retry (Requirement 2.6).
 */
export interface PlayerStatsApi {
  /**
   * `GET /squads/{squadId}/members/{membershipId}/profile` — the squad-scoped
   * Player_Profile of one membership.
   *
   * The optional caller signal is chained to the call's own
   * Profile_Call_Timeout, which is how an unmount, an Auth_State transition to
   * `unauthenticated`, or a change of subject abandons a call in flight
   * (Requirement 12.4). A call abandoned that way settles as
   * `transport-failure`, distinguishably from one our own timer abandoned.
   *
   * @param squadId the squad the profile is scoped to
   * @param membershipId the membership whose profile is read
   * @param signal an optional caller signal, chained to the internal controller
   * @returns exactly one settled {@link CallResult}
   */
  getPlayerProfile(
    squadId: string,
    membershipId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<PlayerProfile>>;
}

/** What {@link createPlayerStatsApi} needs, and all it is given. */
export interface PlayerStatsApiDependencies {
  /**
   * The Authenticated_Api_Client obtained from the Auth_Feature, with the
   * bearer-attaching middleware already installed. It is **injected**: this
   * module constructs no client, installs no middleware, and holds no
   * credential (Requirement 12.2).
   */
  readonly apiClient: PitchMateApiClient;
}

/**
 * Create the Player_Stats_Api over an injected Authenticated_Api_Client.
 *
 * @param dependencies the injected client (Requirement 12.2)
 * @returns the one-method facade, issuing exactly one request per activation
 *
 * Requirements: 2.6, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.8
 */
export function createPlayerStatsApi({
  apiClient,
}: PlayerStatsApiDependencies): PlayerStatsApi {
  return {
    getPlayerProfile(squadId, membershipId, signal) {
      return call(
        // 12.6: the annotation is what pins the body type to the generated
        // contract. The client's result must be assignable to the response
        // `GetPlayerProfile` declares, so pointing this at another path — or a
        // contract change to that operation's response — fails to compile here
        // rather than quietly handing the parser something else.
        (callSignal): ClientCall<'GetPlayerProfile'> =>
          apiClient.GET(PLAYER_PROFILE_PATH, {
            params: { path: { squadId, membershipId } },
            signal: callSignal,
          }),
        signal,
      );
    },
  };
}

// --- Call plumbing ----------------------------------------------------------

/**
 * The success body the generated contract declares for one operation, read off
 * the operation's own `200` response rather than named a second time.
 *
 * This is the half of Requirement 12.6 that bites: if `GetPlayerProfile`'s
 * declared response body is renamed, re-shaped, or withdrawn, this type changes
 * and the {@link ClientCall} annotation at the call site stops compiling.
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
 * `TData` is the operation's declared success body, which is what makes `data` a
 * **typed** value here rather than an `unknown` this module casts (Requirement
 * 12.6).
 *
 * The client's `error` is deliberately **not declared**: this feature reads no
 * part of a rejected response, so there is no member here through which a
 * problem body could be reached, even by accident (Requirement 12.5).
 * `response` is narrowed to the one member that is read, so a status which is
 * somehow not a number is handled rather than assumed.
 */
interface ClientCallResult<TData> {
  readonly data?: TData;
  readonly response?: { readonly status?: number };
}

/**
 * One settled Api_Client call of the named operation, as the facade annotates
 * its own request.
 */
type ClientCall<TOperation extends keyof operations> = Promise<
  ClientCallResult<SuccessBody<TOperation>>
>;

/**
 * What became of the one request, before any status is interpreted.
 *
 * Three cases, because the generated client reports them three ways:
 *
 * - `answered` — the client returned, with a decoded `data` or without one;
 * - `undecodable-body` — the client **threw** while decoding a successful body
 *   (see {@link isUndecodableBody});
 * - `no-response` — the client threw for any other reason: a network failure,
 *   or an abort from either signal.
 */
type ClientSettlement<TData> =
  | { readonly kind: 'answered'; readonly result: ClientCallResult<TData> }
  | { readonly kind: 'undecodable-body' }
  | { readonly kind: 'no-response' };

/**
 * A settled call, reduced to the two signals `classifyOutcome` reads from the
 * transport plus the decoded body the parser reads.
 *
 * Nothing renderable travels further than this: `body` is consumed by the
 * parser and is never carried onto a {@link CallResult} except as a fully
 * parsed Player_Profile (Requirement 12.5).
 */
interface Settlement<TData> {
  /** The HTTP status, or `null` when no response reached us. */
  readonly status: number | null;
  /** Whether **our own** Profile_Call_Timeout fired (Requirement 12.3). */
  readonly timedOut: boolean;
  /** The client's decoded success body, or `undefined` when it carried none. */
  readonly body: TData | undefined;
  /**
   * Whether a successful response arrived carrying a body the client could not
   * decode — the one settlement whose outcome no status can name, because the
   * status was consumed along with the body (see {@link isUndecodableBody}).
   */
  readonly undecodableBody: boolean;
}

/**
 * Issue one request, settle it, and classify it — the one path the facade takes.
 *
 * The parser's parameter stays `unknown` on purpose: its job is to be **total**
 * over anything that could actually arrive, which is a stronger obligation than
 * the generated type describes. The value handed to it is the contract's own
 * typed `data`, unmodified and uncast (Requirement 12.6).
 *
 * The parser runs on **every** settlement rather than only on a `2xx`, which is
 * deliberate: it keeps the status ranges in `lib/callOutcome.ts` alone, so this
 * module contains no HTTP status value and cannot disagree with the classifier
 * about what counts as a success. The parser is total and exception-free, so
 * running it over an absent body costs a verdict that is then ignored —
 * `classifyOutcome` consults `parsed` only for a `2xx`.
 *
 * The one settlement that bypasses the classifier is a successful response whose
 * body the client could not decode. That is not a status judgement — the status
 * is unrecoverable by then — it is the same verdict the parser reaching the same
 * body would have reached, reported from the one place that can still see it
 * (Requirement 12.7).
 *
 * Requirements: 2.6, 12.3, 12.5, 12.6, 12.7, 12.8
 */
async function call<TData>(
  invoke: (signal: AbortSignal) => Promise<ClientCallResult<TData>>,
  callerSignal: AbortSignal | undefined,
): Promise<CallResult<PlayerProfile>> {
  const settlement = await performCall(invoke, callerSignal);

  // 12.7: a success whose body the client itself could not decode never became
  // a value, which is a parse failure for the same reason a body the parser
  // rejects is. Read after `performCall`, which reports it only for a call that
  // was neither abandoned nor timed out, so the timeout still wins (12.4).
  if (settlement.undecodableBody) {
    return { kind: 'parse-failure' };
  }

  const parsed = parsePlayerProfile(settlement.body);

  const outcome = classifyOutcome({
    status: settlement.status,
    timedOut: settlement.timedOut,
    parsed: parsed.ok,
  });

  if (outcome.kind !== 'success') {
    // Every non-success kind of the classification is an arm of `CallResult`
    // carrying exactly the same (absent) fields, so it passes straight through.
    return outcome;
  }

  // `classifyOutcome` answers `success` only when `parsed` was true; the guard
  // is what makes that reachable in the types without an assertion.
  return parsed.ok
    ? { kind: 'success', value: parsed.value }
    : { kind: 'parse-failure' };
}

/**
 * Whether a rejection from the generated client is **its own JSON decode**
 * failing rather than the transport failing.
 *
 * The client decodes the successful body itself, because the contract
 * schematises one, and a body that is not JSON makes that decode throw. By then
 * the response has been consumed, so neither its status nor its text can be read
 * again — all that survives is the error, and the fact that the client only
 * decodes a body it has already established to be a success. That is enough: the
 * call settled, on a success, with nothing the parser could have accepted
 * (Requirement 12.7).
 *
 * `SyntaxError` is what a failed JSON decode raises, and nothing else on this
 * path raises one — a network failure rejects with a `TypeError` and an abort
 * with an `AbortError` — so the causes stay distinguishable (Requirement 12.4).
 * The `name` check is the cross-realm form of the same test.
 *
 * Total and exception-free over any rejection value, including `null`,
 * `undefined`, and a non-`Error` thrown by a transport.
 */
function isUndecodableBody(reason: unknown): boolean {
  if (reason instanceof SyntaxError) {
    return true;
  }
  if (typeof reason !== 'object' || reason === null) {
    return false;
  }
  return (reason as { name?: unknown }).name === 'SyntaxError';
}

/**
 * Why a call was abandoned before the transport answered.
 *
 * The distinction is the whole point: our own lapsed limit is a `timeout`, and
 * the caller's abort is not (Requirement 12.4). A transport rejection is neither
 * — the transport answered, with a rejection — so it never produces one of
 * these.
 */
type Abandonment = 'timeout' | 'caller-abort';

/**
 * Issue exactly one request, bounded by the Profile_Call_Timeout, and reduce
 * what comes back to a {@link Settlement}.
 *
 * The timeout is an `AbortController` plus `setTimeout` rather than
 * `AbortSignal.timeout`, so a test can drive it with fake timers instead of
 * waiting ten seconds (Requirement 12.3). Both abandonments — the lapsed limit
 * and a caller abort — are raced against the request, so a transport that never
 * answers an aborted request cannot leave this call unsettled; anything arriving
 * after an abandonment is disregarded, and only the lapsed limit reports a
 * `timeout` (Requirement 12.4).
 *
 * `invoke` is called **once**. There is no retry, no re-issue, and no fallback
 * request for any outcome (Requirement 2.6).
 */
async function performCall<TData>(
  invoke: (signal: AbortSignal) => Promise<ClientCallResult<TData>>,
  callerSignal: AbortSignal | undefined,
): Promise<Settlement<TData>> {
  const controller = new AbortController();

  // Resolved by whichever of the two abandonments happens first, so the call
  // settles at that moment rather than waiting on a transport that may never
  // answer an aborted request.
  let reportAbandonment: (cause: Abandonment) => void = () => {};
  const abandoned = new Promise<Abandonment>((resolve) => {
    reportAbandonment = resolve;
  });

  let abandonment: Abandonment | null = null;
  const abandon = (cause: Abandonment) => {
    abandonment ??= cause;
    controller.abort();
    reportAbandonment(cause);
  };

  const forwardAbort = () => abandon('caller-abort');
  const timer = setTimeout(() => abandon('timeout'), PROFILE_CALL_TIMEOUT_MS);

  // 12.4: the caller's signal — an unmount, an Auth_State transition to
  // `unauthenticated`, or a change of subject — aborts the request in flight. It
  // stays distinguishable from our own timer: only the timer yields a `timeout`.
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      forwardAbort();
    } else {
      callerSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  // One request (Requirement 2.6). A rejection is reduced to one of the two
  // non-answering settlements — the client's own decode failing, or no response
  // at all, which is what a network failure and an abort from either signal come
  // to. Catching here also means an abandoned request can never surface as an
  // unhandled rejection after this call has settled on the timeout.
  const request: Promise<ClientSettlement<TData>> = invoke(controller.signal).then(
    (result): ClientSettlement<TData> => ({ kind: 'answered', result }),
    (reason: unknown): ClientSettlement<TData> =>
      isUndecodableBody(reason)
        ? { kind: 'undecodable-body' }
        : { kind: 'no-response' },
  );

  try {
    const raced = await Promise.race([
      request.then((settlement) => ({ settled: true as const, settlement })),
      abandoned.then(() => ({ settled: false as const, settlement: null })),
    ]);

    // An abandoned call settles on the abandonment, whatever the transport does
    // afterwards. Our own lapsed limit is a `timeout`; the caller's abort is a
    // transport failure the caller is discarding anyway (Requirement 12.4).
    if (abandonment !== null || !raced.settled) {
      return {
        status: null,
        timedOut: abandonment === 'timeout',
        body: undefined,
        undecodableBody: false,
      };
    }

    const settlement = raced.settlement;

    // A success the client could not decode. The response is gone, so no status
    // is reported for it; the flag is what `call` reads instead (12.7).
    if (settlement.kind === 'undecodable-body') {
      return {
        status: null,
        timedOut: false,
        body: undefined,
        undecodableBody: true,
      };
    }

    // No response reached us at all — a network failure, or an abort.
    if (settlement.kind === 'no-response') {
      return {
        status: null,
        timedOut: false,
        body: undefined,
        undecodableBody: false,
      };
    }

    // 12.6: the typed success body the client decoded, exactly as the generated
    // contract types it, handed on with no cast. An absent one stays
    // `undefined`, which is what "absent" means to the parser — it rejects it,
    // because this operation has no valueless success.
    return {
      status: readStatus(settlement.result),
      timedOut: false,
      body: settlement.result.data,
      undecodableBody: false,
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Read the response status, or `null` where the call produced no response at all
 * — a network failure or an abort, which the classifier folds into a transport
 * failure.
 *
 * No status *value* is named here, only the type of one: deciding what a status
 * means is `lib/callOutcome.ts`'s sole business (Requirement 12.8).
 */
function readStatus(result: ClientCallResult<unknown>): number | null {
  const status = result.response?.status;
  return typeof status === 'number' ? status : null;
}
