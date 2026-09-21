/**
 * Unit tests for {@link withNestedRoutes} (task 15.2).
 *
 * The helper is the one mechanism by which a feature route reaches the **inside**
 * of another feature's layout route: the Squads_Feature's Squad_Route is appended
 * to the App_Shell's `/app` route, which is what puts it behind the Route_Guard
 * and within the Shell_Frame (squads Requirement 18.5). Two things therefore have
 * to hold, and both are about the helper rather than about routing:
 *
 * 1. **It copies.** The shell hands over the array it built, and no file under
 *    `features/app-shell/` may change (squads Requirement 18.4). If this helper
 *    mutated its argument, the shell's own table would gain a squads child
 *    invisibly — a shared-state bug that a routing test would never localise.
 * 2. **It finds the right route, or nothing.** Appending to the wrong route would
 *    register the Squad_Route outside the guard; appending to a table that
 *    registers the path nowhere must add nothing anywhere rather than guess.
 *
 * The routes here are plain data — no element, no router — because the helper is
 * pure and the assembled table's *behaviour* belongs to the routing tests.
 *
 * Requirements: 18.4, 18.5
 */
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';

import { withNestedRoutes } from './appRouter';

/** The layout route path the production wiring nests under. */
const LAYOUT_PATH = '/app';

/** A stand-in for the shell's table: a layout route with children, plus a sibling. */
function shellLikeTable(): RouteObject[] {
  return [
    { path: '/', id: 'landing' },
    {
      path: LAYOUT_PATH,
      id: 'layout',
      children: [
        { index: true, id: 'home' },
        { path: 'settings', id: 'settings' },
        { path: '*', id: 'shell-not-found' },
      ],
    },
  ];
}

/** The feature children being nested, expressed relative to the layout route. */
function featureChildren(): RouteObject[] {
  return [{ path: 'squads/:squadId', id: 'squad' }];
}

/** The `id` of every child of the route registered at {@link LAYOUT_PATH}. */
function layoutChildIds(routes: readonly RouteObject[]): (string | undefined)[] {
  const layout = routes.find((route) => route.path === LAYOUT_PATH);
  return (layout?.children ?? []).map((child) => child.id);
}

describe('withNestedRoutes', () => {
  it('appends the children to the route registered at the given path', () => {
    const nested = withNestedRoutes(
      shellLikeTable(),
      LAYOUT_PATH,
      featureChildren(),
    );

    expect(layoutChildIds(nested)).toEqual([
      'home',
      'settings',
      'shell-not-found',
      'squad',
    ]);
  });

  it('leaves the given table and its matched route untouched', () => {
    const routes = shellLikeTable();
    const originalLayout = routes[1];
    const originalChildren = originalLayout.children;

    withNestedRoutes(routes, LAYOUT_PATH, featureChildren());

    // The array, the matched route object, and its children array are all as they
    // were handed over.
    expect(routes).toHaveLength(2);
    expect(routes[1]).toBe(originalLayout);
    expect(originalLayout.children).toBe(originalChildren);
    expect(layoutChildIds(routes)).toEqual([
      'home',
      'settings',
      'shell-not-found',
    ]);
  });

  it('returns a new table whose unmatched routes are passed through as they stand', () => {
    const routes = shellLikeTable();

    const nested = withNestedRoutes(routes, LAYOUT_PATH, featureChildren());

    expect(nested).not.toBe(routes);
    // The sibling is the very same route object; only the matched one is a copy.
    expect(nested[0]).toBe(routes[0]);
    expect(nested[1]).not.toBe(routes[1]);
  });

  it('nests twice from the same table without the first call being visible to the second', () => {
    const routes = shellLikeTable();

    const first = withNestedRoutes(routes, LAYOUT_PATH, featureChildren());
    const second = withNestedRoutes(routes, LAYOUT_PATH, [
      { path: 'other', id: 'other' },
    ]);

    expect(layoutChildIds(first)).toEqual([
      'home',
      'settings',
      'shell-not-found',
      'squad',
    ]);
    expect(layoutChildIds(second)).toEqual([
      'home',
      'settings',
      'shell-not-found',
      'other',
    ]);
  });

  it('gives a matched route with no children exactly the nested children', () => {
    const nested = withNestedRoutes(
      [{ path: LAYOUT_PATH, id: 'layout' }],
      LAYOUT_PATH,
      featureChildren(),
    );

    expect(layoutChildIds(nested)).toEqual(['squad']);
  });

  it('leaves a table registering the path nowhere unchanged', () => {
    const routes = shellLikeTable();

    const nested = withNestedRoutes(routes, '/nowhere', featureChildren());

    expect(nested).toEqual(routes);
    for (const [index, route] of nested.entries()) {
      expect(route).toBe(routes[index]);
    }
  });

  it('nests nothing when there are no children to nest', () => {
    const nested = withNestedRoutes(shellLikeTable(), LAYOUT_PATH, []);

    expect(layoutChildIds(nested)).toEqual([
      'home',
      'settings',
      'shell-not-found',
    ]);
  });
});
