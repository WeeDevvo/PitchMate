import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Sidebar.css';

export interface SidebarProps {
  /** Given a label, the sidebar is a navigation landmark; without one it is a plain group inside another landmark. */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** A vertical list of navigation items: the web squad sidebar, or a menu drawer's contents. */
export function Sidebar({ label, className, children }: SidebarProps) {
  return label ? (
    <nav className={cx('pm-sidebar', className)} aria-label={label}>
      {children}
    </nav>
  ) : (
    <div className={cx('pm-sidebar', className)}>{children}</div>
  );
}

/** A small uppercase heading between groups of items, such as "Your squads". */
export function SidebarLabel({ children }: { children: ReactNode }) {
  return <div className="pm-sidebar__label">{children}</div>;
}

/** What a NavItem hands to the element that renders it. */
export interface NavItemRenderProps {
  className: string;
  'aria-current': 'page' | undefined;
  children: ReactNode;
}

export interface NavItemProps {
  label: string;
  icon?: IconName;
  /** The current page: tinted, and marked `aria-current="page"`. */
  active?: boolean;
  badge?: ReactNode;
  /**
   * Renders the interactive element, usually the router's link, spreading the
   * props it is given. The library stays free of any router this way.
   */
  render: (props: NavItemRenderProps) => ReactElement;
}

export function NavItem({ label, icon, active = false, badge, render }: NavItemProps) {
  return render({
    className: cx('pm-navitem', active && 'is-active'),
    'aria-current': active ? 'page' : undefined,
    children: (
      <>
        {icon && <Icon name={icon} size={20} />}
        <span className="pm-navitem__label">{label}</span>
        {badge}
      </>
    ),
  });
}
