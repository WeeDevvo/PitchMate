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
 * The barrel starts empty on purpose. Exports land here as the surfaces they
 * belong to are built: the three screens, the two route tables, and the route
 * paths with their path builders, including the `PLAYER_STATS_ROUTE` seam the
 * later player-stats feature registers against (Requirements 9.2, 9.3).
 *
 * Nothing under `lib/` or `api/` is exported beyond what a screen outside the
 * feature needs (Requirement 18.7): the parsers, printers, the Enum_Code_Map,
 * the ordering and composition functions, the state hooks, and every component
 * below screen level stay internal, so the response-contract chore can change
 * the wire mapping without any consumer noticing.
 *
 * Requirements: 18.1, 18.7
 */

export {};
