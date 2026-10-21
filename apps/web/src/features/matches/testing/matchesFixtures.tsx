/**
 * Test support for the Matches_Feature: wire bodies shaped like the generated
 * contract, a fake Matches_Api, and a renderer that mounts a screen at its real
 * route inside a real router and a real AuthProvider.
 *
 * Production modules never import this file.
 *
 * Screens call the App_Shell's `usePublishSquadScopeFromRoute`, which needs the
 * shell's scope provider above it. A test file that renders a screen therefore
 * declares, at its top:
 *
 * ```ts
 * vi.mock('../../app-shell', async () => {
 *   const actual =
 *     await vi.importActual<typeof import('../../app-shell')>('../../app-shell');
 *   return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
 * });
 * ```
 */
import type { components } from '@pitchmate/api-client';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type { CallResult, MatchesApi } from '../api/matchesApi';
import type { MatchDetail } from '../lib/parse/matchDetail';
import { LocationProbe } from './LocationProbe';
import type { MatchList, MatchSummary } from '../lib/parse/matchList';
import type { DayTally, SquadStanding } from '../lib/parse/responses';

type Schemas = components['schemas'];

/* Identities and days ------------------------------------------------------- */

export const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
export const OTHER_SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02';
export const MATCH_ID = '0198e2a7-2222-7a5e-9c2f-6b1d4a5e7f01';
export const MEMBER_IDS = [
  '0198e2a7-3333-7a5e-9c2f-6b1d4a5e7f01',
  '0198e2a7-3333-7a5e-9c2f-6b1d4a5e7f02',
  '0198e2a7-3333-7a5e-9c2f-6b1d4a5e7f03',
] as const;

/** Three candidate days, far enough ahead to stay in the future. */
export const DAY_ISO = [
  '2030-03-02T19:00:00.000Z',
  '2030-03-04T19:00:00.000Z',
  '2030-03-06T18:30:00.000Z',
] as const;
export const DAY_MS = DAY_ISO.map((iso) => Date.parse(iso));

/** A clock fixed well before every candidate day. */
export const NOW_MS = Date.parse('2030-01-01T12:00:00.000Z');

/* Wire bodies --------------------------------------------------------------- */

export function wireMatchListEntry(
  overrides: Partial<Schemas['MatchListEntry']> = {},
): Schemas['MatchListEntry'] {
  return {
    matchId: MATCH_ID,
    state: 'GatheringAvailability',
    location: 'Riverside 5s, pitch 2',
    confirmedDay: null,
    candidateDays: [...DAY_ISO],
    participantCount: 0,
    lockedTeams: [],
    recordedResult: null,
    completedAt: null,
    ...overrides,
  };
}

export function wireMatchList(
  entries: readonly Schemas['MatchListEntry'][] = [wireMatchListEntry()],
  truncated = false,
): Schemas['MatchList'] {
  return { matches: [...entries], truncated };
}

export function wireMatchDetail(
  overrides: Partial<Schemas['MatchDetail']> = {},
): Schemas['MatchDetail'] {
  return {
    matchId: MATCH_ID,
    squadId: SQUAD_ID,
    state: 'GatheringAvailability',
    location: 'Riverside 5s, pitch 2',
    candidateDays: [...DAY_ISO],
    confirmedDay: null,
    participantCount: 0,
    participants: [],
    effectiveMinimumPlayerThreshold: 10,
    callerAvailability: { hasStoredResponse: true, markedDays: [DAY_ISO[1]] },
    recordedResult: null,
    completedAt: null,
    ...overrides,
  };
}

export function wireTally(counts: readonly number[] = [4, 10, 0]): Schemas['AvailabilityTally'] {
  return {
    days: counts.map((count, index) => ({
      day: DAY_ISO[index],
      availableMemberIds: [],
      count,
    })),
  };
}

/* Parsed values ------------------------------------------------------------- */

export function matchSummary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: MATCH_ID,
    state: 'GatheringAvailability',
    location: 'Riverside 5s, pitch 2',
    confirmedDayMs: null,
    candidateDaysMs: [...DAY_MS],
    participantCount: 0,
    ...overrides,
  };
}

export function matchList(
  matches: readonly MatchSummary[] = [matchSummary()],
  truncated = false,
): MatchList {
  return { matches, truncated };
}

export function matchDetail(overrides: Partial<MatchDetail> = {}): MatchDetail {
  return {
    matchId: MATCH_ID,
    squadId: SQUAD_ID,
    state: 'GatheringAvailability',
    location: 'Riverside 5s, pitch 2',
    candidateDaysMs: [...DAY_MS],
    confirmedDayMs: null,
    participantCount: 0,
    participants: [],
    minimumPlayerThreshold: 10,
    callerAvailability: { hasStoredResponse: true, markedDaysMs: [DAY_MS[1]] },
    ...overrides,
  };
}

export function tally(counts: readonly number[] = [4, 10, 0]): readonly DayTally[] {
  return counts.map((count, index) => ({ dayMs: DAY_MS[index], count }));
}

export const ORGANISER: SquadStanding = { squadId: SQUAD_ID, role: 'Admin', state: 'Active' };
export const MEMBER: SquadStanding = { squadId: SQUAD_ID, role: 'Member', state: 'Active' };

/* A fake Matches_Api -------------------------------------------------------- */

export function success<T>(value: T): CallResult<T> {
  return { kind: 'success', value };
}

export type FakeMatchesApi = { [K in keyof MatchesApi]: ReturnType<typeof vi.fn> & MatchesApi[K] };

/** A Matches_Api whose every call succeeds with the fixtures above, as an organiser. */
export function fakeMatchesApi(overrides: Partial<MatchesApi> = {}): FakeMatchesApi {
  const api: MatchesApi = {
    listMatches: async () => success(matchList()),
    getMatch: async () => success(matchDetail()),
    getAvailabilityTally: async () => success(tally()),
    getSquadStanding: async () => success<SquadStanding | null>(ORGANISER),
    createDraft: async () => success(MATCH_ID),
    submitAvailability: async () => success(undefined),
    clearAvailability: async () => success(undefined),
    ...overrides,
  };

  return Object.fromEntries(
    Object.entries(api).map(([name, implementation]) => [name, vi.fn(implementation)]),
  ) as FakeMatchesApi;
}

/* Rendering ------------------------------------------------------------------ */

export function sessionManagerReporting(state: AuthState): SessionManager {
  return {
    bootstrap: (): AuthState => state,
    establish: vi.fn(),
    getState: (): AuthState => state,
    getAccessTokenForRequest: vi.fn(async () => ({ token: 'access-token' })),
    signOut: vi.fn(async () => {}),
    subscribe: () => () => {},
  } as unknown as SessionManager;
}

/**
 * Mount `element` at `pattern`, addressed at `path`, inside a real router and a
 * real AuthProvider. Every other address renders the location probe.
 */
export function renderAtRoute(
  element: ReactElement,
  pattern: string,
  path: string,
  authState: AuthState = 'authenticated',
): RenderResult {
  return render(
    <AuthProvider manager={sessionManagerReporting(authState)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}
