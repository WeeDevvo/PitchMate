import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { buttonClasses } from './buttonClasses';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** One primary per view; destructive only behind a confirmation. */
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'accent-ghost';
  /** `pitch` (64px) is for live tracking only. */
  size?: 'sm' | 'md' | 'lg' | 'pitch';
  block?: boolean;
  /** Keeps the width, shows a spinner and sets `aria-busy`. */
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  /** Marks the moment teams are ready to lock. */
  glow?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  icon,
  iconRight,
  glow,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      aria-busy={loading || undefined}
      {...rest}
      type={type}
      className={cx(
        buttonClasses({ variant, size, block }),
        loading && 'is-loading',
        glow && 'pm-btn--glow',
        className,
      )}
    >
      {icon && <Icon name={icon} size={size === 'pitch' ? 28 : 20} />}
      {children}
      {iconRight && <Icon name={iconRight} size={20} />}
      {loading && <span className="pm-spinner" aria-hidden="true" />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: the accessible name and the tooltip. */
  label: string;
  variant?: 'filled' | 'accent';
  size?: number;
  badge?: ReactNode;
}

export function IconButton({
  icon,
  label,
  variant,
  size = 24,
  badge,
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx('pm-iconbtn', variant && `pm-iconbtn--${variant}`, className)}
    >
      <Icon name={icon} size={size} />
      {badge}
    </button>
  );
}
