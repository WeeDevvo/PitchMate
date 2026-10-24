/**
 * The Squad_Screen's section sidebar: in-page links to each section, built from
 * the design system's Sidebar and NavItem.
 *
 * - **Jump links, not routes.** Every section is on the one screen, so each item
 *   is a fragment link to the section's anchor; following it moves the reading
 *   position and the next Tab stop there, and changes no route.
 * - **The sections' own words.** Each label is the section's heading, read from
 *   the same message, so the link and the heading it leads to cannot disagree.
 * - **Administration only with authority.** The item is absent, not disabled,
 *   for a caller the Admin_Section would render nothing for (Requirement 10.3).
 * - **Not a landmark.** The App_Shell's Primary_Navigation is the frame's one
 *   navigation landmark (shell Requirement 1.5), so this is a plain group of
 *   links inside the main region.
 */
import { type ReactElement } from 'react';
import { NavItem, Sidebar, type IconName } from '../../../ui';
import {
  ADMIN_SECTION_HEADING,
  MATCHES_SECTION_HEADING,
  PLAYERS_SECTION_HEADING,
  SQUAD_DETAIL_SECTION_HEADING,
  STATS_SECTION_HEADING,
} from '../lib/messages';

/** The Squad_Screen's sections, in their document order (Requirement 6.8). */
export type SquadSectionKey = 'detail' | 'players' | 'matches' | 'stats' | 'admin';

const SECTIONS: readonly { key: SquadSectionKey; label: string; icon: IconName }[] = [
  { key: 'detail', label: SQUAD_DETAIL_SECTION_HEADING, icon: 'home' },
  { key: 'players', label: PLAYERS_SECTION_HEADING, icon: 'users' },
  { key: 'matches', label: MATCHES_SECTION_HEADING, icon: 'calendar' },
  { key: 'stats', label: STATS_SECTION_HEADING, icon: 'trophy' },
  { key: 'admin', label: ADMIN_SECTION_HEADING, icon: 'shield' },
];

export interface SquadSectionNavProps {
  /** The anchor id of each section, as the screen renders it. */
  readonly anchorId: (key: SquadSectionKey) => string;
  /** Whether the caller holds Admin_Authority, and so sees the Admin_Section. */
  readonly adminAuthority: boolean;
}

export function SquadSectionNav({ anchorId, adminAuthority }: SquadSectionNavProps): ReactElement {
  return (
    <Sidebar className="squad-screen__nav">
      {SECTIONS.filter((section) => section.key !== 'admin' || adminAuthority).map((section) => (
        <NavItem
          key={section.key}
          label={section.label}
          icon={section.icon}
          render={(props) => (
            <a {...props} className={`squad-screen__nav-link ${props.className}`} href={`#${anchorId(section.key)}`} />
          )}
        />
      ))}
    </Sidebar>
  );
}

export default SquadSectionNav;
