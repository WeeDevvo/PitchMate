import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Chip.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: IconName;
}

/** A filter or choice chip that toggles `aria-pressed`. */
export function Chip({ selected = false, icon, type = 'button', className, children, ...rest }: ChipProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={selected}
      className={cx('pm-chip', selected && 'is-selected', className)}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
