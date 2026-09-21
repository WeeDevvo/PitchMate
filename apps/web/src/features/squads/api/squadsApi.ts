/**
 * The Squads_Feature's single transport seam — the **only** module of the
 * feature permitted to touch the Api_Client (Requirements 16.1, 18.3).
 *
 * Everything above this module speaks in {@link CallResult} values. A screen, a
 * hook, or a component never sees a status code, a header, a response body, a
 * ProblemDetails `detail`, or an `AbortSignal` of its own making, which is what
 * makes the "one point of transport" claim structurally verifiable: a source
 * scan over every other file under `features/squads/` finds no `fetch`, no
 * `XMLHttpRequest`, and no Api_Client method call.
 *
 * ### How a call works, and why it works that way
 *
 * 1. **One injected client.** The Authenticated_Api_Client arrives through
 *    {@link SquadsApiDependencies}; this module constructs none and reads no
 *    token, no refresh value, and no session state. Access-token attachment and
 *    renewal stay the Auth_Feature's concern (Requirements 16.1, 16.2).
 * 2. **Request shapes come from the generated contract.** Every request body
 *    type is an alias of `components['schemas'][…]` from
 *    `@pitchmate/api-client`, and the leaderboard's `statistic` query value is
 *    typed by `operations['GetSquadLeaderboard']`, so no request shape is
 *    hand-written (Requirement 16.11). Responses are the opposite case — the
 *    committed OpenAPI document declares every squads and stats response as
 *    `200 OK` with no content schema — which is why the raw body is read here
 *    and validated by a pure parser rather than trusted from a generated type.
 * 3. **The raw `Response` is read.** The client is asked for `parseAs: 'stream'`
 *    so it leaves the body untouched; this module reads the response text and
 *    `JSON.parse`s it inside a guard. An **empty body is passed to the parser as
 *    "absent"**, which is how the `RedeemInvite` already-a-member no-op — a
 *    `200` with no body — settles as a successful redemption carrying no
 *    identity rather than as a parse failure.
 * 4. **One classification point.** The four signals of a settled call (status or
 *    its absence, whether our own timeout fired, the ProblemDetails `code`
 *    extension, and the parser's verdict) go through `classifyOutcome` in
 *    `lib/callOutcome.ts`. This module makes no outcome decision of its own and
 *    contains no status literal (Requirements 16.3, 17.8).
 * 5. **A per-call `AbortController` plus `setTimeout` at 10 seconds**
 *    (Requirement 16.3). `AbortSignal.timeout` is deliberately avoided so a test
 *    can drive the Squad_Call_Timeout with `vi.useFakeTimers()` instead of
 *    waiting it out — the same choice the App_Shell's seam made. A
 *    caller-supplied signal is chained to the internal controller, so an unmount
 *    or an Auth_State change aborts the in-flight request. The three abort
 *    causes stay distinguishable: our timer settles the call as `timeout`, a
 *    caller abort settles it as `transport-failure` with the request aborted
 *    (the caller discards the result it asked to abandon), and a network failure
 *    settles it as `transport-failure` with the request never aborted.
 * 6. **No retry, ever.** Each method issues exactly one request for exactly one
 *    activation. Retrying is a person activating a control (Requirement 17.4).
 *
 * No failing arm of {@link CallResult} carries a status, a header, or a body
 * value, so a caller has nothing of the backend's wording to render
 * (Requirement 17.2).
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.11, 17.2, 17.4, 17.8, 18.3
 */

import type {
  components,
  operations,
  PitchMateApiClient,
} from '@pitchmate/api-client';

import {
  classifyOutcome,
  type RejectionReason,
} from '../lib/callOutcome';
import { parseCreatedGuest, type CreatedGuest } from '../lib/parse/createdGuest';
import { parseCreatedSquad, type CreatedSquad } from '../lib/parse/createdSquad';
import { parseFeatureFlags, type FeatureFlag } from '../lib/parse/featureFlags';
import {
  parseGeneratedInvite,
  type GeneratedInvite,
} from '../lib/parse/generatedInvite';
import {
  parseInvitePreview,
  type InvitePreview,
} from '../lib/parse/invitePreview';
import {
  parseInviteSummaryList,
  type InviteSummary,
} from '../lib/parse/inviteSummary';
import {
  parseDisplayRatingLeaderboard,
  type DisplayRatingLeaderboard,
} from '../lib/parse/leaderboard';
import { ok, type ParseResult } from '../lib/parse/primitives';
import { parseRedemption, type Redemption } from '../lib/parse/redemption';
import { parseSquadDetail, type SquadDetail } from '../lib/parse/squadDetail';
import {
  parseSquadSummaryList,
  type SquadSummary,
} from '../lib/parse/squadSummary';

// --- Request shapes, taken from the generated contract (Requirement 16.11) ---
//
// The OpenAPI document *does* schematise request bodies, so each of these is an
// alias of the generated schema rather than a hand-written duplicate of it. A
// backend change to any of these bodies therefore fails to compile here.

/** The generated schema table, aliased once so the aliases below read cleanly. */
type Schemas = components['schemas'];

/** `POST /squads` body: the squad's name and the creator's display name. */
export type CreateSquadRequest = Schemas['CreateSquadRequest'];

/** `POST /squads/invites/redeem` body: the presented secret, and a display name. */
export type RedeemInviteRequest = Schemas['RedeemInviteRequest'];

/** `POST /squads/{squadId}/invites` body: a validity window, or non-expiring. */
export type GenerateInviteRequest = Schemas['GenerateInviteRequest'];

/** `POST /squads/{squadId}/guests` body: display name, tier, acknowledgement. */
export type CreateGuestRequest = Schemas['CreateGuestRequest'];

/** `PATCH /squads/{squadId}/guests/{membershipId}` body: the guest's edits. */
export type EditGuestRequest = Schemas['EditGuestRequest'];

/** `PUT /squads/{squadId}/features` body: one feature and its desired state. */
export type SetFeatureFlagRequest = Schemas['SetFeatureFlagRequest'];

/** The query of `GET /squads/{squadId}/leaderboard`, as the contract types it. */
type LeaderboardQuery = NonNullable<
  operations['GetSquadLeaderboard']['parameters']['query']
>;

/**
 * The ranking statistic the Squad_Screen asks for: the friendly Display_Rating
 * (Requirement 7.1). The backend parses this query value case-insensitively into
 * its `LeaderboardStatistic` enum, and answers `400 UnsupportedStatistic` for a
 * value outside the supported set — so the name is spelled once, here.
 */
const DISPLAY_RATING_STATISTIC: NonNullable<LeaderboardQuery['statistic']> =
  'DisplayRating';

// --- Endpoint paths (the generated contract's own path keys) -----------------

/** `GET /squads` (list) and `POST /squads` (create). */
const SQUADS_PATH = '/squads';

/** `GET /squads/{squadId}` — the Squad_Detail. */
const SQUAD_PATH = '/squads/{squadId}';

/** `GET /squads/{squadId}/leaderboard` — the Display_Rating_Leaderboard. */
const LEADERBOARD_PATH = '/squads/{squadId}/leaderboard';

/** `GET`/`POST /squads/{squadId}/invites` — list and generate. */
const INVITES_PATH = '/squads/{squadId}/invites';

/** `POST /squads/{squadId}/invites/{inviteId}/revoke`. */
const REVOKE_INVITE_PATH = '/squads/{squadId}/invites/{inviteId}/revoke';

/** `POST /squads/invites/redeem` — redeem a presented Invite_Secret. */
const REDEEM_INVITE_PATH = '/squads/invites/redeem';

/** `GET /squads/invites/preview` — the anonymous, non-disclosing preview. */
const PREVIEW_INVITE_PATH = '/squads/invites/preview';

/** `GET`/`PUT /squads/{squadId}/features` — read and set a Feature_Flag. */
const FEATURES_PATH = '/squads/{squadId}/features';

/** `POST /squads/{squadId}/guests` — create a guest membership. */
const GUESTS_PATH = '/squads/{squadId}/guests';

/** `PATCH /squads/{squadId}/guests/{membershipId}` — edit a guest. */
const GUEST_PATH = '/squads/{squadId}/guests/{membershipId}';

/** `POST /squads/{squadId}/members/{membershipId}/promote`. */
const PROMOTE_PATH = '/squads/{squadId}/members/{membershipId}/promote';

// --- The facade's result type ------------------------------------------------

/**
 * The settled outcome of one Squads_Api call: exactly one of the seven kinds
 * `classifyOutcome` produces, with a parsed value on the `success` arm only
 * (Requirement 17.8).
 *
 * Six of the seven arms carry nothing at all, and the seventh carries a
 * {@link RejectionReason} this feature declares. There is no field on which a
 * status code, a request path, or the backend's own wording could ride along, so
 * a screen renders a fixed message because it has nothing else to render
 * (Requirement 17.2).
 */
export type CallResult<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'auth-failure' }
  | { readonly kind: 'rejected-input'; readonly reason: RejectionReason }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'transport-failure' }
  | { readonly kind: 'parse-failure' };

/**
 * The squads backend surface the screens consume: one method per operation, one
 * request per method, no retry (Requirement 17.4).
 *
 * Every method takes an optional caller `AbortSignal`, chained to the call's own
 * Squad_Call_Timeout, which is how an unmount or an Auth_State transition to
 * `unauthenticated` abandons a call in flight (Requirement 17.5).
 */
export interface SquadsApi {
  /** `GET /squads` — the caller's Squad_Summary list (Requirement 1.1). */
  listMySquads(signal?: AbortSignal): Promise<CallResult<readonly SquadSummary[]>>;

  /** `GET /squads/{squadId}` — the Squad_Detail (Requirement 6.2). */
  getSquad(squadId: string, signal?: AbortSignal): Promise<CallResult<SquadDetail>>;

  /**
   * `GET /squads/{squadId}/leaderboard?statistic=DisplayRating` — the
   * Display_Rating_Leaderboard, which decorates the Player_List and never
   * determines its membership (Requirement 7.1).
   */
  getDisplayRatingLeaderboard(
    squadId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<DisplayRatingLeaderboard>>;

  /** `POST /squads` — create a squad, owned by the caller (Requirement 3.1). */
  createSquad(
    command: CreateSquadRequest,
    signal?: AbortSignal,
  ): Promise<CallResult<CreatedSquad>>;

  /**
   * `POST /squads/invites/redeem` — redeem a presented Invite_Secret. The
   * already-a-member no-op answers `200` with an empty body, which settles as a
   * success carrying a Redemption with no identity (Requirement 4.6).
   */
  redeemInvite(
    command: RedeemInviteRequest,
    signal?: AbortSignal,
  ): Promise<CallResult<Redemption>>;

  /**
   * `GET /squads/invites/preview` — the anonymous preview. It accepts no invite
   * code and discloses nothing about any squad (Requirement 5.6).
   */
  previewInvite(signal?: AbortSignal): Promise<CallResult<InvitePreview>>;

  /** `GET /squads/{squadId}/invites` — the squad's invites (Requirement 11.1). */
  listInvites(
    squadId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<readonly InviteSummary[]>>;

  /** `POST /squads/{squadId}/invites` — generate an invite (Requirement 11.7). */
  generateInvite(
    squadId: string,
    command: GenerateInviteRequest,
    signal?: AbortSignal,
  ): Promise<CallResult<GeneratedInvite>>;

  /** `POST …/invites/{inviteId}/revoke` — revoke one invite (Req 11.10). */
  revokeInvite(
    squadId: string,
    inviteId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<void>>;

  /** `POST /squads/{squadId}/guests` — create a guest (Requirement 12.6). */
  createGuest(
    squadId: string,
    command: CreateGuestRequest,
    signal?: AbortSignal,
  ): Promise<CallResult<CreatedGuest>>;

  /** `PATCH …/guests/{membershipId}` — edit a guest (Requirement 12.10). */
  editGuest(
    squadId: string,
    membershipId: string,
    command: EditGuestRequest,
    signal?: AbortSignal,
  ): Promise<CallResult<void>>;

  /** `POST …/members/{membershipId}/promote` — promote to admin (Req 13.5). */
  promoteToAdmin(
    squadId: string,
    membershipId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<void>>;

  /** `GET /squads/{squadId}/features` — the Feature_Flag set (Req 14.7). */
  getFeatureFlags(
    squadId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<readonly FeatureFlag[]>>;

  /** `PUT /squads/{squadId}/features` — set one Feature_Flag (Req 14.4). */
  setFeatureFlag(
    squadId: string,
    command: SetFeatureFlagRequest,
    signal?: AbortSignal,
  ): Promise<CallResult<void>>;
}

/** What {@link createSquadsApi} needs, and all it is given. */
export interface SquadsApiDependencies {
  /**
   * The Authenticated_Api_Client obtained from the Auth_Feature, with the
   * bearer-attaching middleware already installed. It is **injected**: this
   * module constructs no client and holds no credential (Requirements 16.1,
   * 16.2).
   */
  readonly apiClient: PitchMateApiClient;
}

/** The Squad_Call_Timeout: 10 seconds (Requirement 16.3). */
export const SQUAD_CALL_TIMEOUT_MS = 10_000;

/**
 * Create the Squads_Api over an injected Authenticated_Api_Client.
 *
 * @param dependencies the injected client (Requirements 16.1, 16.2)
 * @returns the fourteen-method facade, each method issuing exactly one request
 *
 * Requirements: 16.1, 16.2, 16.3, 16.11, 17.4, 18.3
 */
export function createSquadsApi({ apiClient }: SquadsApiDependencies): SquadsApi {
  return {
    listMySquads(signal) {
      return call(
        (callSignal) =>
          apiClient.GET(SQUADS_PATH, { parseAs: 'stream', signal: callSignal }),
        parseSquadSummaryList,
        signal,
      );
    },

    getSquad(squadId, signal) {
      return call(
        (callSignal) =>
          apiClient.GET(SQUAD_PATH, {
            params: { path: { squadId } },
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseSquadDetail,
        signal,
      );
    },

    getDisplayRatingLeaderboard(squadId, signal) {
      return call(
        (callSignal) =>
          apiClient.GET(LEADERBOARD_PATH, {
            params: {
              path: { squadId },
              // 7.1: the friendly rating, named by the generated contract's own
              // query type rather than by a loose string.
              query: { statistic: DISPLAY_RATING_STATISTIC },
            },
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseDisplayRatingLeaderboard,
        signal,
      );
    },

    createSquad(command, signal) {
      return call(
        (callSignal) =>
          apiClient.POST(SQUADS_PATH, {
            body: command,
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseCreatedSquad,
        signal,
      );
    },

    redeemInvite(command, signal) {
      return call(
        (callSignal) =>
          apiClient.POST(REDEEM_INVITE_PATH, {
            body: command,
            parseAs: 'stream',
            signal: callSignal,
          }),
        // The one parser that accepts an absent body: the already-a-member no-op
        // answers `200` with nothing, and that is a successful redemption (4.6).
        parseRedemption,
        signal,
      );
    },

    previewInvite(signal) {
      return call(
        (callSignal) =>
          apiClient.GET(PREVIEW_INVITE_PATH, {
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseInvitePreview,
        signal,
      );
    },

    listInvites(squadId, signal) {
      return call(
        (callSignal) =>
          apiClient.GET(INVITES_PATH, {
            params: { path: { squadId } },
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseInviteSummaryList,
        signal,
      );
    },

    generateInvite(squadId, command, signal) {
      return call(
        (callSignal) =>
          apiClient.POST(INVITES_PATH, {
            params: { path: { squadId } },
            body: command,
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseGeneratedInvite,
        signal,
      );
    },

    revokeInvite(squadId, inviteId, signal) {
      return call(
        (callSignal) =>
          apiClient.POST(REVOKE_INVITE_PATH, {
            params: { path: { squadId, inviteId } },
            parseAs: 'stream',
            signal: callSignal,
          }),
        acceptNoValue,
        signal,
      );
    },

    createGuest(squadId, command, signal) {
      return call(
        (callSignal) =>
          apiClient.POST(GUESTS_PATH, {
            params: { path: { squadId } },
            body: command,
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseCreatedGuest,
        signal,
      );
    },

    editGuest(squadId, membershipId, command, signal) {
      return call(
        (callSignal) =>
          apiClient.PATCH(GUEST_PATH, {
            params: { path: { squadId, membershipId } },
            body: command,
            parseAs: 'stream',
            signal: callSignal,
          }),
        acceptNoValue,
        signal,
      );
    },

    promoteToAdmin(squadId, membershipId, signal) {
      return call(
        (callSignal) =>
          apiClient.POST(PROMOTE_PATH, {
            params: { path: { squadId, membershipId } },
            parseAs: 'stream',
            signal: callSignal,
          }),
        acceptNoValue,
        signal,
      );
    },

    getFeatureFlags(squadId, signal) {
      return call(
        (callSignal) =>
          apiClient.GET(FEATURES_PATH, {
            params: { path: { squadId } },
            parseAs: 'stream',
            signal: callSignal,
          }),
        parseFeatureFlags,
        signal,
      );
    },

    setFeatureFlag(squadId, command, signal) {
      return call(
        (callSignal) =>
          apiClient.PUT(FEATURES_PATH, {
            params: { path: { squadId } },
            body: command,
            parseAs: 'stream',
            signal: callSignal,
          }),
        acceptNoValue,
        signal,
      );
    },
  };
}

// --- Call plumbing ----------------------------------------------------------

/**
 * The parser of an operation that returns **no value** — revoke, edit guest,
 * promote, and set feature flag.
 *
 * It accepts whatever the response carried, because there is nothing to read:
 * the operation's evidence of success is its status, and the refreshed state
 * comes from a subsequent read. Routing these calls through the same
 * {@link call} helper as the valued ones is what keeps the timeout, the abort
 * chaining, and the classification identical for all fourteen.
 */
function acceptNoValue(): ParseResult<void> {
  return ok(undefined);
}

/**
 * The subset of an `openapi-fetch` call result this module reads.
 *
 * The generated types model no response body for these operations (see the
 * module note), so the result is read as `unknown` and validated by the pure
 * parsers rather than trusted.
 */
interface ClientCallResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response?: unknown;
}

/**
 * A settled call, reduced to the four signals `classifyOutcome` reads plus the
 * decoded body the parser reads.
 *
 * Nothing renderable travels further than this: `body` is consumed by a parser
 * and `problemCode` by the classifier, and neither is carried onto a
 * {@link CallResult} (Requirement 17.2).
 */
interface Settlement {
  /** The HTTP status, or `null` when no response reached us. */
  readonly status: number | null;
  /** Whether our own Squad_Call_Timeout fired (Requirement 16.3). */
  readonly timedOut: boolean;
  /** The decoded body, or `undefined` for an absent or unreadable one. */
  readonly body: unknown;
  /** The ProblemDetails `code` extension, or `null` when the body carried none. */
  readonly problemCode: string | null;
}

/**
 * Issue one request, settle it, and classify it — the one path every method of
 * the facade takes.
 *
 * The parser runs on **every** settlement rather than only on a `2xx`, which is
 * deliberate: it keeps the status ranges in `lib/callOutcome.ts` alone, so this
 * module contains no status literal and cannot disagree with the classifier
 * about what counts as a success. Every parser is total and free of exceptions,
 * so running one over a rejection body costs a verdict that is then ignored —
 * `classifyOutcome` consults `parsed` only for a `2xx` (Requirement 16.4).
 *
 * Requirements: 16.3, 16.4, 17.2, 17.4, 17.8
 */
async function call<T>(
  invoke: (signal: AbortSignal) => Promise<unknown>,
  parse: (body: unknown) => ParseResult<T>,
  callerSignal: AbortSignal | undefined,
): Promise<CallResult<T>> {
  const settlement = await performCall(invoke, callerSignal);
  const parsed = parse(settlement.body);

  const outcome = classifyOutcome({
    status: settlement.status,
    timedOut: settlement.timedOut,
    problemCode: settlement.problemCode,
    parsed: parsed.ok,
  });

  if (outcome.kind !== 'success') {
    // Every non-success arm of the classification is an arm of `CallResult`
    // carrying exactly the same fields, so it passes straight through.
    return outcome;
  }

  // `classifyOutcome` answers `success` only when `parsed` was true; the guard
  // is what makes that reachable in the types without an assertion.
  return parsed.ok ? { kind: 'success', value: parsed.value } : { kind: 'parse-failure' };
}

/**
 * Why a call was abandoned before the transport answered.
 *
 * The distinction is the whole point: our own lapsed limit is a `timeout`, and
 * the caller's abort is not (Requirement 16.3). A network failure is neither —
 * the transport answered, with a rejection — so it never produces one of these.
 */
type Abandonment = 'timeout' | 'caller-abort';

/**
 * Issue exactly one request, bounded by the Squad_Call_Timeout, and reduce what
 * comes back to a {@link Settlement}.
 *
 * The timeout is an `AbortController` plus `setTimeout` rather than
 * `AbortSignal.timeout`, so a test can drive it with fake timers instead of
 * waiting ten seconds. Both abandonments — the lapsed limit and a caller abort —
 * are raced against the request, so a transport that never answers an aborted
 * request cannot leave this call unsettled; anything arriving after an
 * abandonment is disregarded, and only the lapsed limit reports a `timeout`
 * (Requirement 16.3).
 *
 * `invoke` is called **once**. There is no retry, no re-issue, and no fallback
 * request for any outcome (Requirement 17.4).
 */
async function performCall(
  invoke: (signal: AbortSignal) => Promise<unknown>,
  callerSignal: AbortSignal | undefined,
): Promise<Settlement> {
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
  const timer = setTimeout(() => abandon('timeout'), SQUAD_CALL_TIMEOUT_MS);

  // 17.5: the caller's signal — an unmount, or an Auth_State transition to
  // `unauthenticated` — aborts the request in flight. It stays distinguishable
  // from our own timer: only the timer yields a `timeout` outcome.
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      forwardAbort();
    } else {
      callerSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  // One request. A rejection — a network failure, or an abort from either
  // signal — becomes "no response". Catching here also means an abandoned
  // request can never surface as an unhandled rejection after this call has
  // settled on the timeout.
  const request: Promise<ClientCallResult | null> = invoke(controller.signal).then(
    (result) => result as ClientCallResult,
    () => null,
  );

  try {
    const raced = await Promise.race([
      request.then((result) => ({ settled: true as const, result })),
      abandoned.then(() => ({ settled: false as const, result: null })),
    ]);

    // An abandoned call settles on the abandonment, whatever the transport does
    // afterwards. Our own lapsed limit is a `timeout`; the caller's abort is a
    // transport failure the caller is discarding anyway (Requirement 16.3).
    if (abandonment !== null || !raced.settled) {
      return {
        status: null,
        timedOut: abandonment === 'timeout',
        body: undefined,
        problemCode: null,
      };
    }

    const body = await readSettledBody(raced.result);
    return {
      status: readStatus(raced.result),
      timedOut: false,
      body,
      problemCode: readProblemCode(body),
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Decode the settled response into the `unknown` value a pure parser validates.
 *
 * The client is asked for `parseAs: 'stream'`, so a successful response arrives
 * with its body **unread** and the raw `Response` is read here. Four shapes are
 * accommodated, in the order they can occur:
 *
 * - a readable `Response` — the normal case for a `2xx`: its text is read and
 *   `JSON.parse`d inside a guard;
 * - a present `error` — a rejecting status, whose body `openapi-fetch` has
 *   already read and decoded, so the response can no longer be read;
 * - a present `data` — a string body decoded here, or an already-decoded value
 *   from a client fake;
 * - nothing at all.
 *
 * An **empty body yields `undefined`**, which is what "absent" means to a
 * parser: every parser but `parseRedemption` rejects it, and `parseRedemption`
 * accepts it as the already-a-member no-op.
 *
 * The function never throws — a malformed body yields `undefined` and so a parse
 * failure (Requirement 16.4).
 */
async function readSettledBody(result: ClientCallResult | null): Promise<unknown> {
  if (result === null) {
    return undefined;
  }

  if (isReadableBody(result.response)) {
    try {
      return decodeJson(await result.response.text());
    } catch {
      return undefined;
    }
  }

  if (typeof result.error === 'string') {
    return decodeJson(result.error);
  }
  if (result.error !== undefined && result.error !== null) {
    return result.error;
  }

  if (typeof result.data === 'string') {
    return decodeJson(result.data);
  }
  return result.data;
}

/** Decode a body's text, yielding `undefined` for empty or malformed text. */
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

/** A response whose body has not been read and still can be. */
function isReadableBody(
  response: unknown,
): response is { text(): Promise<string> } {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const candidate = response as { text?: unknown; bodyUsed?: unknown };
  return typeof candidate.text === 'function' && candidate.bodyUsed !== true;
}

/**
 * Read the response status, or `null` where the call produced no response at
 * all — a network failure or an abort, which the classifier folds into a
 * transport failure.
 */
function readStatus(result: ClientCallResult | null): number | null {
  if (result === null) {
    return null;
  }
  const response = result.response;
  if (typeof response !== 'object' || response === null) {
    return null;
  }
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * Read the ProblemDetails `code` extension the backend emits on a rejection.
 *
 * It is handed to `classifyOutcome`, which maps it to one of this feature's own
 * {@link RejectionReason} names; nothing else of the problem body — not
 * `detail`, not `title`, not `instance` — is read anywhere (Requirement 17.2).
 */
function readProblemCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  if (!Object.hasOwn(body, 'code')) {
    return null;
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
