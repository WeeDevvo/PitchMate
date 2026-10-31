import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Feedback.css';

const TOAST_ICONS: Record<ToastTone, IconName> = {
  success: 'check',
  error: 'x',
  info: 'info',
  offline: 'cloudOff',
};

export type ToastTone = 'success' | 'error' | 'info' | 'offline';

export interface ToastProps {
  tone?: ToastTone;
  children: ReactNode;
  /** One optional action, such as "Undo". */
  actionLabel?: string;
  onAction?: () => void;
}

/** A short status message. Where it sits on screen, and for how long, is the caller's call. */
export function Toast({ tone = 'success', children, actionLabel, onAction }: ToastProps) {
  return (
    <div className={`pm-toast pm-toast--${tone}`} role="status">
      <span className="pm-toast__icon">
        <Icon name={TOAST_ICONS[tone]} size={16} strokeWidth={3} />
      </span>
      <span className="pm-toast__msg">{children}</span>
      {actionLabel && (
        <button type="button" className="pm-toast__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export type BannerTone = 'info' | 'warn' | 'error' | 'success';

const BANNER_ICONS: Record<BannerTone, IconName> = {
  info: 'info',
  warn: 'alert',
  error: 'alert',
  success: 'check',
};

export interface BannerProps {
  tone?: BannerTone;
  icon?: IconName;
  title?: string;
  action?: ReactNode;
  children?: ReactNode;
  /**
   * Announce the banner as an alert or status (the default). Turn it off when
   * the banner sits inside a live region the caller already keeps in the page,
   * so the message is announced once.
   */
  announce?: boolean;
}

/** The inline equivalent of a toast. An error banner is announced as an alert. */
export function Banner({ tone = 'info', icon, title, action, children, announce = true }: BannerProps) {
  const role = !announce ? undefined : tone === 'error' ? 'alert' : 'status';
  return (
    <div className={`pm-banner pm-banner--${tone}`} role={role}>
      <Icon name={icon ?? BANNER_ICONS[tone]} size={20} />
      <div className="pm-banner__body">
        {title && <b className="pm-banner__title">{title}</b>}
        {children}
      </div>
      {action}
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: IconName;
  /** The heading; leave it out where the state sits under a heading of its own, such as a failed load. */
  title?: string;
  /**
   * The heading level that fits the outline of the screen it sits in: 1 where
   * the state is the whole screen (not found).
   */
  headingLevel?: 1 | 2 | 3;
  /** Attributes for the heading, such as a feature's own class. */
  headingProps?: HTMLAttributes<HTMLHeadingElement>;
  /** Attributes for the message, such as a live region's role. */
  bodyProps?: HTMLAttributes<HTMLParagraphElement>;
  action?: ReactNode;
  tone?: 'error';
  /** Drops the dashed outline. */
  plain?: boolean;
  children?: ReactNode;
}

export function EmptyState({
  icon = 'ball',
  title,
  headingLevel = 2,
  headingProps,
  bodyProps,
  action,
  tone,
  plain,
  children,
  className,
  ...rest
}: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div
      {...rest}
      className={cx('pm-empty', tone === 'error' && 'pm-empty--error', plain && 'pm-empty--plain', className)}
    >
      <span className="pm-empty__art" aria-hidden="true">
        <Icon name={icon} size={44} strokeWidth={1.8} />
      </span>
      {title === undefined ? null : (
        <Heading {...headingProps} className={cx('pm-empty__title', headingProps?.className)}>
          {title}
        </Heading>
      )}
      {children && (
        <p {...bodyProps} className={cx('pm-empty__body', bodyProps?.className)}>
          {children}
        </p>
      )}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  headingLevel?: 1 | 2 | 3;
  onRetry: () => void;
  children?: ReactNode;
}

/** A failed load, with "Try again". */
export function ErrorState({
  title = "That didn't load",
  headingLevel,
  onRetry,
  children = 'Probably the signal, not you. Give it another go.',
}: ErrorStateProps) {
  return (
    <EmptyState
      icon="cloudOff"
      tone="error"
      title={title}
      headingLevel={headingLevel}
      action={
        <Button variant="secondary" icon="sync" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {children}
    </EmptyState>
  );
}

export interface NotFoundStateProps {
  headingLevel?: 1 | 2 | 3;
  /** Usually a way back to the squads list. */
  action?: ReactNode;
}

/**
 * The same for content that doesn't exist and content the viewer isn't allowed
 * to see, so it never reveals that a squad exists.
 */
export function NotFoundState({ headingLevel, action }: NotFoundStateProps) {
  return (
    <EmptyState icon="search" title="Nothing here" headingLevel={headingLevel} action={action}>
      This page doesn&apos;t exist, or it isn&apos;t shared with you. If someone sent you a link, ask them for a fresh
      invite.
    </EmptyState>
  );
}

export interface SkeletonProps {
  width?: number | string;
  height?: number;
  circle?: boolean;
  radius?: number;
}

/** A placeholder block that mirrors the final layout; its shimmer is off under reduced motion. */
export function Skeleton({ width = '100%', height = 16, circle, radius }: SkeletonProps) {
  return (
    <span
      className={cx('pm-skel', circle && 'pm-skel--circle')}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}
