import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './Badge.css';

export type BadgeTone = 'neutral' | 'owner' | 'admin' | 'guest' | 'provisional' | 'info' | 'former' | 'count' | 'live';

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: IconName;
  title?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', icon, title, children }: BadgeProps) {
  return (
    <span className={`pm-badge pm-badge--${tone}`} title={title}>
      {icon && <Icon name={icon} size={13} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

/** Owner or admin; a member gets no badge. */
export function RoleBadge({ role }: { role: 'owner' | 'admin' | 'member' }) {
  if (role === 'owner') {
    return (
      <Badge tone="owner" icon="crown">
        Owner
      </Badge>
    );
  }
  return role === 'admin' ? (
    <Badge tone="admin" icon="shield">
      Admin
    </Badge>
  ) : null;
}

/** Deliberately quiet: guests are full players. */
export function GuestBadge() {
  return (
    <Badge tone="guest" icon="guest" title="Guest: added by an admin, no account">
      Guest
    </Badge>
  );
}

export function FormerBadge() {
  return <Badge tone="former">Former</Badge>;
}

export interface SettlingMarkProps {
  /** How far along the rating is, such as "3 of 5 matches". */
  detail?: string;
}

/**
 * The note beside a player whose rating has not settled yet: the wave and the
 * word. It goes with the name, never in place of the rating, and the rating
 * number itself looks like every other rating.
 */
export function SettlingMark({ detail }: SettlingMarkProps) {
  return (
    <span className="pm-settling" title="Rating still settling">
      <Icon name="wave" size={14} />
      {detail === undefined ? 'Settling' : `Settling · ${detail}`}
    </span>
  );
}

/** Marks a Pro feature or a Pro squad: an inverse chip with a star, so it never reads as a state. */
export function ProBadge({ children = 'Pro' }: { children?: ReactNode }) {
  return (
    <span className="pm-pro">
      <Icon name="star" size={11} className="pm-pro__star" />
      {children}
    </span>
  );
}
