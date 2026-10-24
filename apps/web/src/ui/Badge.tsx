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

/** Amber is shared with draws, so provisional always carries the "~" and the word. */
export function ProvisionalBadge({ short = false }: { short?: boolean }) {
  return (
    <Badge tone="provisional" title="Provisional: rating not settled yet">
      {short ? '~ Prov' : '~ Provisional'}
    </Badge>
  );
}

export function FormerBadge() {
  return <Badge tone="former">Former</Badge>;
}
