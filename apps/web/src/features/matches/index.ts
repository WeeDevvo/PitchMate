/**
 * The Matches_Feature's public barrel: the only way into the feature.
 *
 * The application wiring builds one Matches_Api over the authenticated client,
 * injects `MatchesSection` as the squad screen's matches content, and nests the
 * route table into the shell.
 */
export { createMatchesShellRoutes, type MatchesRoutesOptions } from './matchesRoutes';

export { MatchesSection, type MatchesSectionProps } from './components/MatchesSection';

export { MATCH_ROUTE, NEW_MATCH_ROUTE, matchPath, newMatchPath } from './lib/routePaths';

export {
  createMatchesApi,
  type MatchesApi,
  type MatchesApiDependencies,
} from './api/matchesApi';
