/**
 * Example-based tests for the pure route resolver.
 *
 * These pin the concrete cases the acceptance criteria name — `/app/settings`,
 * `/app/settings/`, and `/app/Settings` resolving identically (Requirement
 * 3.13), a nested Destination path beating Home (Requirement 3.11), and an
 * unregistered path under `/app` yielding the not-found outcome so no
 * Primary_Navigation control is marked current (Requirement 3.10). The universal
 * statements — totality, single-valuedness, normalisation — are covered by the
 * property test beside this file.
 *
 * Requirements: 3.10, 3.11, 3.12, 3.13
 */

import { describe, expect, it } from 'vitest';

import {
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  PROFILE_ROUTE,
  SETTINGS_ROUTE,
} from './destinations';
import { resolveDestination } from './routeResolution';

describe('resolveDestination', () => {
  it('resolves each registered Destination route path to its own identifier', () => {
    expect(resolveDestination(HOME_ROUTE)).toEqual({
      kind: 'destination',
      id: 'home',
    });
    expect(resolveDestination(NOTIFICATIONS_ROUTE)).toEqual({
      kind: 'destination',
      id: 'notifications',
    });
    expect(resolveDestination(SETTINGS_ROUTE)).toEqual({
      kind: 'destination',
      id: 'settings',
    });
    expect(resolveDestination(PROFILE_ROUTE)).toEqual({
      kind: 'destination',
      id: 'profile',
    });
  });

  it('resolves a trailing separator, ASCII case, and both together identically (3.13)', () => {
    const expected = { kind: 'destination', id: 'settings' };

    expect(resolveDestination('/app/settings')).toEqual(expected);
    expect(resolveDestination('/app/settings/')).toEqual(expected);
    expect(resolveDestination('/app/Settings')).toEqual(expected);
    expect(resolveDestination('/APP/SETTINGS/')).toEqual(expected);
  });

  it('resolves Home for its own path with a trailing separator or a different case', () => {
    const expected = { kind: 'destination', id: 'home' };

    expect(resolveDestination('/app')).toEqual(expected);
    expect(resolveDestination('/app/')).toEqual(expected);
    expect(resolveDestination('/App')).toEqual(expected);
  });

  it('discards the query string and the fragment', () => {
    expect(resolveDestination('/app/notifications?squadId=abc')).toEqual({
      kind: 'destination',
      id: 'notifications',
    });
    expect(resolveDestination('/app/notifications#top')).toEqual({
      kind: 'destination',
      id: 'notifications',
    });
    expect(resolveDestination('/app?tab=1#x')).toEqual({
      kind: 'destination',
      id: 'home',
    });
  });

  it('prefers the Destination matching the greater number of whole segments (3.11)', () => {
    expect(resolveDestination('/app/settings/anything')).toEqual({
      kind: 'destination',
      id: 'settings',
    });
    expect(resolveDestination('/app/notifications/deeper/still')).toEqual({
      kind: 'destination',
      id: 'notifications',
    });
  });

  it('matches whole segments only, never a partial segment', () => {
    expect(resolveDestination('/app/settingsx')).toEqual({ kind: 'not-found' });
    expect(resolveDestination('/application')).toEqual({ kind: 'not-found' });
  });

  it('yields not-found for an unregistered path under /app (3.10)', () => {
    expect(resolveDestination('/app/unknown')).toEqual({ kind: 'not-found' });
    expect(resolveDestination('/app/squads/17')).toEqual({ kind: 'not-found' });
  });

  it('yields not-found for the landing route, a relative value, and empty text', () => {
    expect(resolveDestination('/')).toEqual({ kind: 'not-found' });
    expect(resolveDestination('')).toEqual({ kind: 'not-found' });
    expect(resolveDestination('app/settings')).toEqual({ kind: 'not-found' });
  });

  it('treats a second trailing separator as a further segment, not as normalisation', () => {
    // `/app/settings//` still begins with `/app/settings/`, so Requirement 3.11
    // keeps Settings active; only Home, which matches exactly, misses out.
    expect(resolveDestination('/app/settings//')).toEqual({
      kind: 'destination',
      id: 'settings',
    });
    expect(resolveDestination('/app//')).toEqual({ kind: 'not-found' });
    expect(resolveDestination('/app//settings')).toEqual({ kind: 'not-found' });
  });

  it('is total over non-string input and raises nothing (14.12)', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      0,
      Number.NaN,
      true,
      Symbol('/app'),
      ['/app'],
      { path: '/app' },
      { toString: () => '/app' },
      () => '/app',
      new Map(),
    ];

    for (const input of inputs) {
      expect(resolveDestination(input)).toEqual({ kind: 'not-found' });
    }
  });
});
