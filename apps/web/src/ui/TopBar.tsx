import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import './TopBar.css';

export type TopBarProps = HTMLAttributes<HTMLElement>;

/**
 * The web top bar: a 64px banner holding the logo, navigation and the
 * notification and account controls, which the caller supplies as children.
 */
export function TopBar({ className, children, ...rest }: TopBarProps) {
  return (
    <header {...rest} className={cx('pm-topbar', className)}>
      {children}
    </header>
  );
}
