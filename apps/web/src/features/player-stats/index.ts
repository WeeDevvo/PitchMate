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
 * **Empty by design, for now.** The barrel is filled when the screen lands, and
 * what it will carry is fixed in advance by Requirement 14.2: the route table
 * factory and its options type, the screen and its props type, and the
 * Player_Stats_Api factory with its facade and dependency types. Nothing else.
 * The Response_Parser and its printer, the outcome classifier, the subject
 * reader, the rating-condition resolver, the chart geometry, the formatters, the
 * load machine, and every component below screen level stay internal — so the
 * parse layer can be reshaped and the sections recomposed without any consumer
 * noticing.
 *
 * The route *pattern* is deliberately absent from that list: the
 * Player_Stats_Route is declared by the Squads_Feature's barrel, which is where
 * the player list's rows already build their paths from, and this feature
 * imports it rather than restating it (Requirement 1.2).
 *
 * Requirements: 14.1, 14.2, 14.7
 */

export {};
