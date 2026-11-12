import { ICONS, type IconName } from './icons';
import { cx } from './cx';
import './ui.css';

export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number;
  /** Give a label only when the icon stands alone and carries meaning; otherwise it is hidden. */
  label?: string;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 24, label, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      className={cx('pm-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
