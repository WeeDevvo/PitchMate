/**
 * Public barrel for the Squads_Feature module.
 *
 * Every module of the feature lives under `apps/web/src/features/squads/`
 * (Requirement 18.1), split into pure logic (`lib/`), the single transport seam
 * (`api/`), the screen load machines (`state/`), the presentational
 * `components/` and `screens/`, and the feature token table (`styles/`). Every
 * consumer — which in practice means only `src/app/appRouter.tsx` — imports the
 * feature through this one entry point (Requirement 18.7).
 *
 * What crosses the boundary, and why each item has to:
 *
 * | Export | Why a consumer outside the feature needs it |
 * | --- | --- |
 * | `SquadsHome` | the App_Shell's injected Home_Slot content (Requirement 1.12, 18.6) |
 * | `SquadScreen`, `InviteLandingScreen` | the elements of the two route tables, exported so a test can render either screen without the router |
 * | `createSquadsShellRoutes`, `createSquadsPublicRoutes` | the two tables the one application router registers (Requirements 18.4, 18.5) |
 * | `SQUAD_ROUTE`, `INVITE_LANDING_ROUTE` | the patterns a router or a redirect check names |
 * | `PLAYER_STATS_ROUTE`, `playerStatsPath` | the seam the later player-stats feature registers its screen against (Requirements 9.2, 9.3) |
 * | `squadPath`, `inviteLandingPath` | path construction, so no consumer rebuilds a path from a pattern |
 * | `createSquadsApi`, `SquadsApi` | the facade `appRouter.tsx` builds once from the Authenticated_Api_Client and threads into the routes (Requirement 16.2) |
 *
 * Nothing else is exported (Requirement 18.7). The Response_Parsers and their
 * printers, the Enum_Code_Map, the ordering and composition functions, the state
 * hooks, and every component below screen level stay internal — so the pending
 * response-contract chore can change the wire mapping, and the admin surfaces can
 * be recomposed, without any consumer noticing.
 *
 * Requirements: 9.3, 18.1, 18.4, 18.5, 18.7
 */

export { SquadsHome, type SquadsHomeProps } from './screens/SquadsHome';
export { SquadScreen, type SquadScreenProps } from './screens/SquadScreen';
export { InviteLandingScreen } from './screens/InviteLandingScreen';

export {
  createSquadsShellRoutes,
  createSquadsPublicRoutes,
  type SquadsRoutesOptions,
} from './squadsRoutes';

export {
  SQUAD_ROUTE,
  PLAYER_STATS_ROUTE,
  INVITE_LANDING_ROUTE,
  squadPath,
  playerStatsPath,
  inviteLandingPath,
} from './lib/routePaths';

export { createSquadsApi, type SquadsApi } from './api/squadsApi';
