/**
 * The Matches_Api over the real generated client, with only `fetch` injected,
 * so every call is checked against the contract's own paths, methods and bodies.
 */
import { createApiClient } from '@pitchmate/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DAY_ISO,
  MATCH_ID,
  SQUAD_ID,
  matchDetail,
  wireMatchDetail,
  wireMatchList,
  wireTally,
} from '../testing/matchesFixtures';
import { MATCH_CALL_TIMEOUT_MS, createMatchesApi } from './matchesApi';

const BASE_URL = 'https://api.test';

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ title: code, status, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

function harness(reply: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: Request) => {
    const text = await input.clone().text();
    const recorded = {
      method: input.method,
      url: input.url,
      body: text.length === 0 ? undefined : JSON.parse(text),
    };
    requests.push(recorded);
    return reply(recorded);
  }) as unknown as typeof fetch;

  const api = createMatchesApi({
    apiClient: createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl }),
  });
  return { api, requests };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('reads', () => {
  it('lists a squad’s matches', async () => {
    const { api, requests } = harness(() => json(wireMatchList()));
    const result = await api.listMatches(SQUAD_ID);

    expect(requests).toEqual([
      { method: 'GET', url: `${BASE_URL}/squads/${SQUAD_ID}/matches`, body: undefined },
    ]);
    expect(result.kind).toBe('success');
  });

  it('reads one match', async () => {
    const { api, requests } = harness(() => json(wireMatchDetail()));

    expect(await api.getMatch(MATCH_ID)).toEqual({ kind: 'success', value: matchDetail() });
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${BASE_URL}/matches/${MATCH_ID}` });
  });

  it('reads the availability tally under the squad', async () => {
    const { api, requests } = harness(() => json(wireTally()));
    const result = await api.getAvailabilityTally(SQUAD_ID, MATCH_ID);

    expect(requests[0].url).toBe(
      `${BASE_URL}/squads/${SQUAD_ID}/matches/${MATCH_ID}/availability/tally`,
    );
    expect(result.kind).toBe('success');
  });

  it('finds the caller’s standing in the squad, ignoring letter case', async () => {
    const { api } = harness(() =>
      json([
        { squadId: SQUAD_ID.toUpperCase(), name: 'Tuesday 5s', role: 'Owner', state: 'Active' },
      ]),
    );

    expect(await api.getSquadStanding(SQUAD_ID)).toEqual({
      kind: 'success',
      value: { squadId: SQUAD_ID.toUpperCase(), role: 'Owner', state: 'Active' },
    });
  });

  it('answers no standing for a squad the caller is not in', async () => {
    const { api } = harness(() => json([]));
    expect(await api.getSquadStanding(SQUAD_ID)).toEqual({ kind: 'success', value: null });
  });
});

describe('writes', () => {
  it('creates a draft and leaves the identity to the server', async () => {
    const { api, requests } = harness(() => json({ matchId: MATCH_ID }));
    const result = await api.createDraft(SQUAD_ID, {
      location: 'Riverside',
      candidateDays: [DAY_ISO[0]],
    });

    expect(result).toEqual({ kind: 'success', value: MATCH_ID });
    expect(requests[0]).toEqual({
      method: 'POST',
      url: `${BASE_URL}/squads/${SQUAD_ID}/matches`,
      body: { location: 'Riverside', candidateDays: [DAY_ISO[0]], matchId: null },
    });
  });

  it('submits availability as the marked days', async () => {
    const { api, requests } = harness(() =>
      json({ matchId: MATCH_ID, squadMembershipId: MATCH_ID, submittedAt: DAY_ISO[0], markedDays: [] }),
    );

    expect(await api.submitAvailability(SQUAD_ID, MATCH_ID, [DAY_ISO[1]])).toEqual({
      kind: 'success',
      value: undefined,
    });
    expect(requests[0]).toEqual({
      method: 'PUT',
      url: `${BASE_URL}/squads/${SQUAD_ID}/matches/${MATCH_ID}/availability`,
      body: { markedDays: [DAY_ISO[1]] },
    });
  });

  it('clears availability with a DELETE that answers no content', async () => {
    const { api, requests } = harness(() => new Response(null, { status: 204 }));

    expect(await api.clearAvailability(SQUAD_ID, MATCH_ID)).toEqual({
      kind: 'success',
      value: undefined,
    });
    expect(requests[0].method).toBe('DELETE');
  });
});

describe('failures', () => {
  it('conceals a missing or forbidden match as not found', async () => {
    for (const status of [401, 403, 404]) {
      const { api } = harness(() => problem(status, 'NotFound'));
      expect(await api.getMatch(MATCH_ID)).toEqual({ kind: 'not-found' });
    }
  });

  it('names a rejection by its problem code', async () => {
    const { api } = harness(() => problem(409, 'InvalidState'));
    expect(await api.submitAvailability(SQUAD_ID, MATCH_ID, [])).toEqual({
      kind: 'rejected',
      reason: 'invalid-state',
    });
  });

  it('reports a malformed success body as a parse failure', async () => {
    const { api } = harness(() => json({ matchId: 'nope' }));
    expect(await api.getMatch(MATCH_ID)).toEqual({ kind: 'parse-failure' });
  });

  it('reports a body that is not JSON as a parse failure', async () => {
    const { api } = harness(
      () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await api.getMatch(MATCH_ID)).toEqual({ kind: 'parse-failure' });
  });

  it('reports a network failure as a transport failure', async () => {
    const { api } = harness(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await api.listMatches(SQUAD_ID)).toEqual({ kind: 'transport-failure' });
  });

  it('abandons a call at its deadline', async () => {
    vi.useFakeTimers();
    const { api } = harness(() => new Promise<Response>(() => {}));

    const pending = api.getMatch(MATCH_ID);
    await vi.advanceTimersByTimeAsync(MATCH_CALL_TIMEOUT_MS);

    expect(await pending).toEqual({ kind: 'timeout' });
  });

  it('settles a caller-aborted call without a value', async () => {
    const { api } = harness(() => new Promise<Response>(() => {}));
    const controller = new AbortController();

    const pending = api.getMatch(MATCH_ID, controller.signal);
    controller.abort();

    expect((await pending).kind).toBe('transport-failure');
  });
});
