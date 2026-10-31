import type { ReactElement, ReactNode } from 'react';
import { Badge } from './Badge';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Tabs.css';

export interface TabNavItem {
  id: string;
  label: string;
  count?: number;
  icon?: IconName;
}

/** What {@link TabNav} hands the caller to render one tab's link. */
export interface TabNavLinkProps {
  tab: TabNavItem;
  className: string;
  /** `'page'` on the current tab, for `aria-current`. */
  current: 'page' | undefined;
  children: ReactNode;
}

export interface TabNavProps {
  /** Names the navigation landmark for assistive technology. */
  label: string;
  tabs: readonly TabNavItem[];
  /** The id of the tab whose page is showing. */
  active: string;
  /**
   * Renders one tab as a link, spreading what it is given — usually the
   * router's own link, so a tab is an address the back button returns to.
   */
  renderLink: (props: TabNavLinkProps) => ReactElement;
}

/**
 * The underlined tabs as navigation: each tab is a link to its own page, and the
 * current one is marked `aria-current="page"` as well as underlined. Use `Tabs`
 * for panels on one page.
 */
export function TabNav({ label, tabs, active, renderLink }: TabNavProps) {
  return (
    <nav className="pm-tabs" aria-label={label}>
      {tabs.map((tab) => {
        const current = tab.id === active;
        return (
          <span key={tab.id} className="pm-tabnav__item">
            {renderLink({
              tab,
              className: cx('pm-tab', current && 'is-active'),
              current: current ? 'page' : undefined,
              children: (
                <>
                  {tab.icon && <Icon name={tab.icon} size={18} />}
                  {tab.label}
                  {tab.count !== undefined && <Badge>{tab.count}</Badge>}
                </>
              ),
            })}
          </span>
        );
      })}
    </nav>
  );
}
