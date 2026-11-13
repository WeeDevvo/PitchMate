import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './LockedFeature.css';

export interface LockedFeatureListProps extends HTMLAttributes<HTMLUListElement> {
  children: ReactNode;
}

/**
 * The Pro features a squad does not have, as one dashed-outline list of
 * `LockedFeature` rows. A feature an admin has switched off is not locked: it
 * keeps its ordinary toggle.
 */
export function LockedFeatureList({ className, children, ...rest }: LockedFeatureListProps) {
  return (
    <ul {...rest} className={cx('pm-locked', className)}>
      {children}
    </ul>
  );
}

export interface LockedFeatureProps extends HTMLAttributes<HTMLLIElement> {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  /** The lock's accessible name. The lock is never the only sign: the row sits in a dashed list. */
  lockedLabel?: string;
}

/** One locked Pro feature: what it is, what it does, and a lock named in words. */
export function LockedFeature({
  icon,
  title,
  description,
  lockedLabel = 'Locked',
  className,
  ...rest
}: LockedFeatureProps) {
  return (
    <li {...rest} className={cx('pm-locked__row', className)}>
      {icon && (
        <span className="pm-locked__icon">
          <Icon name={icon} size={20} />
        </span>
      )}
      <span className="pm-locked__text">
        <span className="pm-locked__title">{title}</span>
        {description !== undefined && <span className="pm-locked__desc">{description}</span>}
      </span>
      <Icon name="lock" size={20} label={lockedLabel} className="pm-locked__lock" />
    </li>
  );
}
