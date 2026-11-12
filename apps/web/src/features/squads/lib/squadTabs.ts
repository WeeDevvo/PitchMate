/**
 * The Squad_Screen's tabs: which ones a viewer is offered, the address each one
 * lives at, and which one an address shows.
 *
 * | Tab | Address | Offered to |
 * | --- | --- | --- |
 * | Players | `/app/squads/:squadId` | everyone |
 * | Matches | `/app/squads/:squadId/matches` | everyone |
 * | Leaderboards | `/app/squads/:squadId/leaderboards` | everyone |
 * | Admin | `/app/squads/:squadId/admin` | an admin only — absent, not disabled, for a member |
 *
 * Players is the squad's own address, so every existing link to a squad still
 * lands on it. Each tab is an address rather than a piece of screen state, so a
 * tab can be linked to and the back button returns to the previous one.
 *
 * React-free and DOM-free like every module under `lib/`.
 */

import { SQUAD_ROUTE, squadPath } from './routePaths';

/** One of the Squad_Screen's tabs. */
export type SquadTab = 'players' | 'matches' | 'leaderboards' | 'admin';

/** The tabs in the order the tab bar shows them. */
export const SQUAD_TABS: readonly SquadTab[] = ['players', 'matches', 'leaderboards', 'admin'];

/** The path segment each tab other than Players adds to the squad's address. */
export const SQUAD_TAB_SEGMENTS: Readonly<Record<Exclude<SquadTab, 'players'>, string>> = {
  matches: 'matches',
  leaderboards: 'leaderboards',
  admin: 'admin',
};

/**
 * The full route patterns of the tabs other than Players, which is the
 * Squad_Route itself: what a router or a collision check names.
 */
export const SQUAD_TAB_ROUTES: readonly string[] = (
  Object.keys(SQUAD_TAB_SEGMENTS) as Exclude<SquadTab, 'players'>[]
).map((tab) => `${SQUAD_ROUTE}/${SQUAD_TAB_SEGMENTS[tab]}`);

/** The route pattern of a tab other than Players, relative to the squad's own. */
export function squadTabChildPath(tab: Exclude<SquadTab, 'players'>): string {
  return SQUAD_TAB_SEGMENTS[tab];
}

/** The address of `tab` in the squad `squadId`. */
export function squadTabPath(squadId: string, tab: SquadTab): string {
  return tab === 'players' ? squadPath(squadId) : `${squadPath(squadId)}/${SQUAD_TAB_SEGMENTS[tab]}`;
}

/**
 * The tab an address shows: the tab whose segment follows the squad's identity
 * in `/app/squads/:squadId/<tab>`, compared without regard to case, and Players
 * otherwise. Reading the segment *after* the identity means an identity that
 * happens to spell a tab's name can never be mistaken for one.
 */
export function squadTabOf(pathname: string): SquadTab {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const squadsAt = segments.findIndex((segment) => segment.toLowerCase() === 'squads');
  const tabSegment = squadsAt < 0 ? '' : (segments[squadsAt + 2] ?? '').toLowerCase();
  const match = (Object.keys(SQUAD_TAB_SEGMENTS) as Exclude<SquadTab, 'players'>[]).find(
    (tab) => SQUAD_TAB_SEGMENTS[tab] === tabSegment,
  );
  return match ?? 'players';
}

/** The tabs offered to a viewer: Admin only with admin authority. */
export function squadTabsFor(isAdmin: boolean): readonly SquadTab[] {
  return isAdmin ? SQUAD_TABS : SQUAD_TABS.filter((tab) => tab !== 'admin');
}
