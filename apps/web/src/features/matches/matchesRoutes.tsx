/**
 * The Matches_Feature's route table.
 *
 * The feature registers nothing itself: `src/app/appRouter.tsx` nests these
 * children into the App_Shell's `/app` layout route, which puts both screens
 * behind the Route_Guard and inside the shell frame. The child paths are derived
 * from the patterns in `lib/routePaths.ts`, which are in turn derived from the
 * Squads_Feature's published `SQUAD_ROUTE`, so no path literal is restated.
 */
import type { RouteObject } from 'react-router-dom';

import { HOME_ROUTE } from '../app-shell';
import type { MatchesApi } from './api/matchesApi';
import { MATCH_ROUTE, NEW_MATCH_ROUTE } from './lib/routePaths';
import { CreateMatchScreen } from './screens/CreateMatchScreen';
import { MatchScreen } from './screens/MatchScreen';

/** A pattern beneath the shell's prefix, expressed relative to it. */
export function relativeToShellPrefix(pattern: string): string {
  const prefix = `${HOME_ROUTE}/`;
  return pattern.startsWith(prefix) ? pattern.slice(prefix.length) : pattern;
}

export interface MatchesRoutesOptions {
  /** The Matches_Api every screen calls the backend through. */
  readonly api: MatchesApi;
}

/** Build the feature's routes, as children of the shell's `/app` layout route. */
export function createMatchesShellRoutes({ api }: MatchesRoutesOptions): RouteObject[] {
  return [
    {
      path: relativeToShellPrefix(NEW_MATCH_ROUTE),
      element: <CreateMatchScreen api={api} />,
    },
    {
      path: relativeToShellPrefix(MATCH_ROUTE),
      element: <MatchScreen api={api} />,
    },
  ];
}
