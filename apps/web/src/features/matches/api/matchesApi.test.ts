/**
 * The Matches_Api over the real generated client, with only `fetch` injected,
 * so every call is checked against the contract's own paths, methods and bodies.
 */
import { createApiClient } from '@pitchmate/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DAY_ISO,
  MATCH_ID,
  TEAM_IDS,
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
      value: { squadId: SQUAD_ID.toUpperCase(), squadName: 'Tuesday 5s', role: 'Owner', state: 'Active' },
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

describe('organiser writes', () => {
  const TEAM_ID = '0198e2a7-4444-7a5e-9c2f-6b1d4a5e7f01';
  const GUEST_ID = '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f01';

  it('sends each write to its contract path with its contract body', async () => {
    const { api, requests } = harness((request) =>
      request.url.endsWith('/confirm')
        ? json({ matchId: MATCH_ID, confirmedDay: DAY_ISO[0], participantCount: 10 })
        : request.url.endsWith('/participants')
          ? json({ participantId: GUEST_ID })
          : request.url.endsWith('/lock')
            ? json({ matchId: MATCH_ID })
            : new Response(null, { status: 204 }),
    );

    const results = [
      await api.confirmMatch(SQUAD_ID, MATCH_ID, DAY_ISO[0]),
      await api.addParticipant(SQUAD_ID, MATCH_ID, GUEST_ID),
      await api.removeParticipant(SQUAD_ID, MATCH_ID, GUEST_ID),
      await api.joinMatch(SQUAD_ID, MATCH_ID),
      await api.leaveMatch(SQUAD_ID, MATCH_ID),
      await api.rerollTeams(MATCH_ID),
      await api.moveParticipant(MATCH_ID, GUEST_ID, TEAM_ID),
      await api.setTeamName(MATCH_ID, TEAM_ID, null),
      await api.setBibTeam(MATCH_ID, TEAM_ID),
      await api.lockTeams(MATCH_ID),
      await api.unlockTeams(MATCH_ID),
    ];

    expect(results.every((result) => result.kind === 'success')).toBe(true);
    expect(requests.map(({ method, url, body }) => [method, url.slice(BASE_URL.length), body])).toEqual([
      ['POST', `/squads/${SQUAD_ID}/matches/${MATCH_ID}/confirm`, { day: DAY_ISO[0] }],
      ['POST', `/squads/${SQUAD_ID}/matches/${MATCH_ID}/participants`, { membershipId: GUEST_ID }],
      ['DELETE', `/squads/${SQUAD_ID}/matches/${MATCH_ID}/participants/${GUEST_ID}`, undefined],
      ['POST', `/squads/${SQUAD_ID}/matches/${MATCH_ID}/participants/me`, undefined],
      ['DELETE', `/squads/${SQUAD_ID}/matches/${MATCH_ID}/participants/me`, undefined],
      ['POST', `/matches/${MATCH_ID}/teams/reroll`, undefined],
      ['POST', `/matches/${MATCH_ID}/teams/moves`, { squadMembershipId: GUEST_ID, toTeamId: TEAM_ID }],
      ['PUT', `/matches/${MATCH_ID}/teams/${TEAM_ID}/name`, { teamName: null }],
      ['PUT', `/matches/${MATCH_ID}/teams/${TEAM_ID}/bib`, undefined],
      ['POST', `/matches/${MATCH_ID}/teams/lock`, undefined],
      ['POST', `/matches/${MATCH_ID}/teams/unlock`, undefined],
    ]);
  });

  it('reads the working teams and the squad’s players', async () => {
    const { api, requests } = harness((request) =>
      request.url.endsWith('/teams')
        ? json({ teams: [], prediction: null, unassignedParticipants: [] })
        : json({ squadId: SQUAD_ID, name: 'Tuesday 5s', features: [], members: [] }),
    );

    expect(await api.getWorkingTeams(MATCH_ID)).toEqual({
      kind: 'success',
      value: { teams: [], prediction: null, unassigned: [] },
    });
    expect(await api.getSquadPlayers(SQUAD_ID)).toEqual({ kind: 'success', value: [] });
    expect(requests.map(({ url }) => url.slice(BASE_URL.length))).toEqual([
      `/matches/${MATCH_ID}/teams`,
      `/squads/${SQUAD_ID}`,
    ]);
  });

  it('reads the team sheet', async () => {
    const { api, requests } = harness(() =>
      json({ location: 'Riverside', confirmedDay: DAY_ISO[0], teams: [] }),
    );

    expect(await api.getTeamSheet(MATCH_ID)).toEqual({
      kind: 'success',
      value: { location: 'Riverside', kickoffMs: Date.parse(DAY_ISO[0]), teams: [] },
    });
    expect(requests[0].url).toBe(`${BASE_URL}/matches/${MATCH_ID}/team-sheet`);
  });

  it('names a refused confirm by its problem code', async () => {
    const { api } = harness(() => problem(409, 'InvalidState'));
    expect(await api.confirmMatch(SQUAD_ID, MATCH_ID, DAY_ISO[0])).toEqual({
      kind: 'rejected',
      reason: 'invalid-state',
    });
  });

  it('conceals a teams read by a non-organiser as not found', async () => {
    const { api } = harness(() => problem(404, 'NotFound'));
    expect(await api.getWorkingTeams(MATCH_ID)).toEqual({ kind: 'not-found' });
  });
});

describe('the match lifecycle', () => {
  it('starts, records a basic result, completes and cancels at their contract paths', async () => {
    const { api, requests } = harness(({ url }) =>
      json(url.endsWith('/complete') ? { matchId: MATCH_ID, alreadyCompleted: false } : { matchId: MATCH_ID }),
    );

    expect(await api.startMatch(MATCH_ID)).toEqual({ kind: 'success', value: undefined });
    expect(
      await api.recordResult(MATCH_ID, [
        { teamId: TEAM_IDS[0], score: 3 },
        { teamId: TEAM_IDS[1], score: 2 },
      ]),
    ).toEqual({ kind: 'success', value: undefined });
    expect(await api.completeMatch(MATCH_ID)).toEqual({ kind: 'success', value: undefined });
    expect(await api.cancelMatch(MATCH_ID)).toEqual({ kind: 'success', value: undefined });

    expect(requests.map(({ method, url, body }) => [method, url.slice(BASE_URL.length), body])).toEqual([
      ['POST', `/matches/${MATCH_ID}/start`, undefined],
      [
        'POST',
        `/matches/${MATCH_ID}/result`,
        {
          fidelity: 'Basic',
          teamScores: [
            { teamId: TEAM_IDS[0], score: 3 },
            { teamId: TEAM_IDS[1], score: 2 },
          ],
        },
      ],
      ['POST', `/matches/${MATCH_ID}/complete`, undefined],
      ['POST', `/matches/${MATCH_ID}/cancel`, undefined],
    ]);
  });

  it('names a completion refused for want of a result, and a lifecycle step out of turn', async () => {
    expect(await harness(() => problem(409, 'ResultRequired')).api.completeMatch(MATCH_ID)).toEqual({
      kind: 'rejected',
      reason: 'result-required',
    });
    expect(await harness(() => problem(409, 'InvalidState')).api.startMatch(MATCH_ID)).toEqual({
      kind: 'rejected',
      reason: 'invalid-state',
    });
    expect(await harness(() => problem(400, 'LiveTrackingDisabled')).api.recordResult(MATCH_ID, [])).toEqual({
      kind: 'rejected',
      reason: 'validation',
    });
  });

  it('conceals a lifecycle step by a non-organiser as not found', async () => {
    expect(await harness(() => problem(403, 'NotAnOrganiser')).api.cancelMatch(MATCH_ID)).toEqual({
      kind: 'not-found',
    });
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
