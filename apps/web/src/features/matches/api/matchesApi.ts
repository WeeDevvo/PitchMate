/**
 * The Matches_Api: the Matches_Feature's one transport facade.
 *
 * This is the only module of the feature that uses `@pitchmate/api-client` as a
 * value. It is built over the Authenticated_Api_Client the application wiring
 * hands in, so the bearer token and its refresh stay inside the auth feature.
 *
 * Every call settles to exactly one {@link CallResult}: a parsed value, or one
 * of the classified failures in `lib/callOutcome.ts`. A call is abandoned at
 * {@link MATCH_CALL_TIMEOUT_MS}, or when the caller's signal aborts, and an
 * abandoned call's late response is ignored.
 */
import type {
  components,
  operations,
  PitchMateApiClient,
} from '@pitchmate/api-client';

import { ok, type ParseResult } from '../../../wire';
import { classifyOutcome, type RejectionReason } from '../lib/callOutcome';
import { parseMatchDetail, type MatchDetail } from '../lib/parse/matchDetail';
import { parseMatchList, type MatchList } from '../lib/parse/matchList';
import {
  parseAvailabilityTally,
  parseCreatedDraft,
  parseSquadStandings,
  type DayTally,
  type SquadStanding,
} from '../lib/parse/responses';

type Schemas = components['schemas'];

/** The body of a draft, as the create-match screen builds it. */
export interface CreateDraftCommand {
  readonly location: string;
  /** ISO-8601 instants. */
  readonly candidateDays: readonly string[];
}

const SQUADS_PATH = '/squads';
const SQUAD_MATCHES_PATH = '/squads/{squadId}/matches';
const MATCH_PATH = '/matches/{matchId}';
const AVAILABILITY_PATH = '/squads/{squadId}/matches/{matchId}/availability';
const TALLY_PATH = '/squads/{squadId}/matches/{matchId}/availability/tally';

/** How long a call may take before it is abandoned. */
export const MATCH_CALL_TIMEOUT_MS = 10_000;

export type CallResult<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'rejected'; readonly reason: RejectionReason }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'transport-failure' }
  | { readonly kind: 'parse-failure' };

export interface MatchesApi {
  /** The squad's matches, soonest first. */
  listMatches(squadId: string, signal?: AbortSignal): Promise<CallResult<MatchList>>;

  /** One match, as its screen presents it. */
  getMatch(matchId: string, signal?: AbortSignal): Promise<CallResult<MatchDetail>>;

  /** How many members can make each candidate day. */
  getAvailabilityTally(
    squadId: string,
    matchId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<readonly DayTally[]>>;

  /**
   * The caller's role and membership state in the squad, or `null` when the
   * caller's squads do not include it.
   */
  getSquadStanding(
    squadId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<SquadStanding | null>>;

  /** Create a match draft, answering the new match's identity. */
  createDraft(
    squadId: string,
    command: CreateDraftCommand,
    signal?: AbortSignal,
  ): Promise<CallResult<string>>;

  /** Replace the caller's availability with exactly these candidate days. */
  submitAvailability(
    squadId: string,
    matchId: string,
    markedDays: readonly string[],
    signal?: AbortSignal,
  ): Promise<CallResult<void>>;

  /** Withdraw the caller's availability response altogether. */
  clearAvailability(
    squadId: string,
    matchId: string,
    signal?: AbortSignal,
  ): Promise<CallResult<void>>;
}

export interface MatchesApiDependencies {
  readonly apiClient: PitchMateApiClient;
}

export function createMatchesApi({ apiClient }: MatchesApiDependencies): MatchesApi {
  return {
    listMatches(squadId, signal) {
      return call(
        (callSignal): ClientCall<'ListSquadMatches'> =>
          apiClient.GET(SQUAD_MATCHES_PATH, {
            params: { path: { squadId } },
            signal: callSignal,
          }),
        parseMatchList,
        signal,
      );
    },

    getMatch(matchId, signal) {
      return call(
        (callSignal): ClientCall<'GetMatchDetail'> =>
          apiClient.GET(MATCH_PATH, {
            params: { path: { matchId } },
            signal: callSignal,
          }),
        parseMatchDetail,
        signal,
      );
    },

    getAvailabilityTally(squadId, matchId, signal) {
      return call(
        (callSignal): ClientCall<'GetAvailabilityTally'> =>
          apiClient.GET(TALLY_PATH, {
            params: { path: { squadId, matchId } },
            signal: callSignal,
          }),
        parseAvailabilityTally,
        signal,
      );
    },

    getSquadStanding(squadId, signal) {
      return call(
        (callSignal): ClientCall<'ListMySquads'> =>
          apiClient.GET(SQUADS_PATH, { signal: callSignal }),
        (body) => {
          const standings = parseSquadStandings(body);
          if (!standings.ok) return standings;
          const lowered = squadId.toLowerCase();
          return ok(
            standings.value.find((standing) => standing.squadId.toLowerCase() === lowered) ??
              null,
          );
        },
        signal,
      );
    },

    createDraft(squadId, command, signal) {
      const body: Schemas['CreateMatchDraftRequest'] = {
        location: command.location,
        candidateDays: [...command.candidateDays],
        // The server mints the GUID v7 identity; a client-chosen one would not
        // make a retry idempotent, because the handler does not deduplicate.
        matchId: null,
      };

      return call(
        (callSignal): ClientCall<'CreateMatchDraft'> =>
          apiClient.POST(SQUAD_MATCHES_PATH, {
            params: { path: { squadId } },
            body,
            signal: callSignal,
          }),
        parseCreatedDraft,
        signal,
      );
    },

    submitAvailability(squadId, matchId, markedDays, signal) {
      const body: Schemas['SubmitAvailabilityRequest'] = { markedDays: [...markedDays] };

      return call(
        (callSignal): ClientCall<'SubmitAvailabilityResponse'> =>
          apiClient.PUT(AVAILABILITY_PATH, {
            params: { path: { squadId, matchId } },
            body,
            signal: callSignal,
          }),
        acceptNoValue,
        signal,
      );
    },

    clearAvailability(squadId, matchId, signal) {
      return call(
        (callSignal): ClientCall<'ClearAvailabilityResponse'> =>
          apiClient.DELETE(AVAILABILITY_PATH, {
            params: { path: { squadId, matchId } },
            signal: callSignal,
          }),
        acceptNoValue,
        signal,
      );
    },
  };
}

/** The parser for a call whose success carries nothing this feature reads. */
function acceptNoValue(): ParseResult<void> {
  return ok(undefined);
}

/* -------------------------------------------------------------------------- */
/* Settling a call                                                            */
/* -------------------------------------------------------------------------- */

type SuccessBody<TOperation extends keyof operations> =
  operations[TOperation]['responses'] extends {
    200: { content: { 'application/json': infer TBody } };
  }
    ? TBody
    : undefined;

interface ClientCallResult<TData> {
  readonly data?: TData;
  readonly error?: unknown;
  readonly response?: { readonly status?: number };
}

type ClientCall<TOperation extends keyof operations> = Promise<
  ClientCallResult<SuccessBody<TOperation>>
>;

type ClientSettlement<TData> =
  | { readonly kind: 'answered'; readonly result: ClientCallResult<TData> }
  | { readonly kind: 'undecodable-body' }
  | { readonly kind: 'no-response' };

interface Settlement<TData> {
  readonly status: number | null;
  readonly timedOut: boolean;
  readonly body: TData | undefined;
  readonly problemCode: string | null;
  readonly undecodableBody: boolean;
}

const NO_SETTLEMENT = {
  status: null,
  timedOut: false,
  body: undefined,
  problemCode: null,
  undecodableBody: false,
} as const;

async function call<TData, TValue>(
  invoke: (signal: AbortSignal) => Promise<ClientCallResult<TData>>,
  parse: (body: NoInfer<TData> | undefined) => ParseResult<TValue>,
  callerSignal: AbortSignal | undefined,
): Promise<CallResult<TValue>> {
  const settlement = await performCall(invoke, callerSignal);

  if (settlement.undecodableBody) {
    return { kind: 'parse-failure' };
  }

  const parsed = parse(settlement.body);

  const outcome = classifyOutcome({
    status: settlement.status,
    timedOut: settlement.timedOut,
    problemCode: settlement.problemCode,
    parsed: parsed.ok,
  });

  if (outcome.kind !== 'success') {
    return outcome;
  }

  return parsed.ok ? { kind: 'success', value: parsed.value } : { kind: 'parse-failure' };
}

/** True when a client rejection means the body arrived but was not JSON. */
function isUndecodableBody(reason: unknown): boolean {
  if (reason instanceof SyntaxError) {
    return true;
  }
  if (typeof reason !== 'object' || reason === null) {
    return false;
  }
  return (reason as { name?: unknown }).name === 'SyntaxError';
}

type Abandonment = 'timeout' | 'caller-abort';

async function performCall<TData>(
  invoke: (signal: AbortSignal) => Promise<ClientCallResult<TData>>,
  callerSignal: AbortSignal | undefined,
): Promise<Settlement<TData>> {
  const controller = new AbortController();

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
  const timer = setTimeout(() => abandon('timeout'), MATCH_CALL_TIMEOUT_MS);

  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      forwardAbort();
    } else {
      callerSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  const request: Promise<ClientSettlement<TData>> = invoke(controller.signal).then(
    (result): ClientSettlement<TData> => ({ kind: 'answered', result }),
    (reason: unknown): ClientSettlement<TData> =>
      isUndecodableBody(reason) ? { kind: 'undecodable-body' } : { kind: 'no-response' },
  );

  try {
    const raced = await Promise.race([
      request.then((settlement) => ({ settled: true as const, settlement })),
      abandoned.then(() => ({ settled: false as const, settlement: null })),
    ]);

    if (abandonment !== null || !raced.settled) {
      return { ...NO_SETTLEMENT, timedOut: abandonment === 'timeout' };
    }

    const { settlement } = raced;

    if (settlement.kind === 'undecodable-body') {
      return { ...NO_SETTLEMENT, undecodableBody: true };
    }

    if (settlement.kind === 'no-response') {
      return NO_SETTLEMENT;
    }

    return {
      status: readStatus(settlement.result),
      timedOut: false,
      body: settlement.result.data,
      problemCode: readProblemCode(settlement.result.error),
      undecodableBody: false,
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

function readStatus(result: ClientCallResult<unknown>): number | null {
  const status = result.response?.status;
  return typeof status === 'number' ? status : null;
}

/** The ProblemDetails `code` extension of a failure body, or `null`. */
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
