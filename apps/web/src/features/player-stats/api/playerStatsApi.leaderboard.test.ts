import { createApiClient } from '@pitchmate/api-client';
import { describe, expect, it, vi } from 'vitest';

import { createPlayerStatsApi } from './playerStatsApi';

/**
 * `getLeaderboard` over the real generated client with an injected `fetch`, so
 * the request the contract types is the request that goes out, and the body the
 * contract types is the body the parser reads.
 */

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const MEMBER_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02';

function apiAnswering(response: () => Response) {
  const fetchSpy = vi.fn((request: Request) => {
    void request;
    return Promise.resolve(response());
  });
  const apiClient = createApiClient({
    baseUrl: 'https://api.test',
    fetch: fetchSpy as unknown as typeof fetch,
  });

  return { api: createPlayerStatsApi({ apiClient }), fetchSpy };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getLeaderboard over the generated client', () => {
  it('asks for the squad and the statistic by its wire name', async () => {
    const { api, fetchSpy } = apiAnswering(() =>
      json({ statistic: 'WinPercentage', entries: [] }),
    );

    await api.getLeaderboard(SQUAD_ID, 'WinPercentage');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0]![0];
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.pathname).toBe(`/squads/${SQUAD_ID}/leaderboard`);
    expect(url.searchParams.get('statistic')).toBe('WinPercentage');
  });

  it('settles a valid board as success, entries in the order sent', async () => {
    const { api } = apiAnswering(() =>
      json({
        statistic: 'Appearances',
        entries: [
          { membershipId: MEMBER_ID, displayName: 'Dave', value: 12 },
          { membershipId: SQUAD_ID, displayName: 'Sam', value: 9 },
        ],
      }),
    );

    const result = await api.getLeaderboard(SQUAD_ID, 'Appearances');

    expect(result).toEqual({
      kind: 'success',
      value: {
        statistic: 'Appearances',
        entries: [
          { membershipId: MEMBER_ID, displayName: 'Dave', value: 12 },
          { membershipId: SQUAD_ID, displayName: 'Sam', value: 9 },
        ],
      },
    });
  });

  it('settles a board for another statistic as a parse failure', async () => {
    const { api } = apiAnswering(() => json({ statistic: 'Appearances', entries: [] }));

    expect(await api.getLeaderboard(SQUAD_ID, 'DisplayRating')).toEqual({
      kind: 'parse-failure',
    });
  });

  it('settles the concealed 404 as not-found, and a 503 as a transport failure', async () => {
    const concealed = apiAnswering(() => new Response(null, { status: 404 }));
    const unavailable = apiAnswering(() => new Response(null, { status: 503 }));

    expect(await concealed.api.getLeaderboard(SQUAD_ID, 'Appearances')).toEqual({
      kind: 'not-found',
    });
    expect(await unavailable.api.getLeaderboard(SQUAD_ID, 'Appearances')).toEqual({
      kind: 'transport-failure',
    });
  });
});
