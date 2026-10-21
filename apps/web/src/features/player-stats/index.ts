/**
 * Public barrel for the Player_Stats_Feature module.
 *
 * Every module of the feature lives under `apps/web/src/features/player-stats/`
 * (Requirement 14.1), split into pure logic (`lib/`), the single transport seam
 * (`api/`), the screen's load machine (`state/`), the presentational
 * `components/` and `screens/`, and the feature token table (`styles/`). Every
 * consumer — which in practice means only `src/app/appRouter.tsx` — reaches the
 * feature through this one entry point (Requirement 14.7).
 *
 * What crosses the boundary, and why each item has to:
 *
 * | Export | Why a consumer outside the feature needs it |
 * | --- | --- |
 * | `createPlayerStatsShellRoutes`, `PlayerStatsRoutesOptions` | the one table the application router nests into the shell's `/app` layout route (Requirements 1.1, 14.7) |
 * | `PlayerStatsScreen`, `PlayerStatsScreenProps` | the element of that table, exported so a test can render the screen without the router |
 * | `SquadLeaderboards`, `SquadLeaderboardsProps` | the squad screen's stats section body, which `appRouter.tsx` injects through the squads feature's `statsContent` slot |
 * | `createPlayerStatsApi`, `PlayerStatsApi`, `PlayerStatsApiDependencies` | the facade `appRouter.tsx` builds once from the Authenticated_Api_Client and threads into the route (Requirement 12.1) |
 *
 * Nothing else is exported (Requirement 14.2). The Response_Parser and its
 * printer, the outcome classifier, the subject reader, the rating-condition
 * resolver, the chart geometry, the formatters, the load machine, and every
 * component below screen level stay internal — so the parse layer can be
 * reshaped and the sections recomposed without any consumer noticing.
 *
 * The route *pattern* is deliberately absent from that list: the
 * Player_Stats_Route is declared by the Squads_Feature's barrel, which is where
 * the player list's rows already build their paths from, and this feature
 * imports it rather than restating it (Requirement 1.2).
 *
 * Requirements: 14.1, 14.2, 14.7
 */

export {
  createPlayerStatsShellRoutes,
  type PlayerStatsRoutesOptions,
} from './playerStatsRoutes';

export {
  PlayerStatsScreen,
  type PlayerStatsScreenProps,
} from './screens/PlayerStatsScreen';

export {
  SquadLeaderboards,
  type SquadLeaderboardsProps,
} from './screens/SquadLeaderboards';

export {
  createPlayerStatsApi,
  type PlayerStatsApi,
  type PlayerStatsApiDependencies,
} from './api/playerStatsApi';
