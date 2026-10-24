import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import './Avatar.css';

const TINTS = 5;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}

/** A tint chosen from the name, so a player keeps the same colour everywhere. */
function tintOf(name: string): number {
  return ([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS) + 1;
}

export interface AvatarProps {
  name: string;
  src?: string;
  size?: number;
  /** Guests get a hatched outline instead of a tint. */
  guest?: boolean;
  /** A small corner tag, such as the keeper glove. */
  tag?: ReactNode;
}

/** Decorative: the player's name is always printed beside it. */
export function Avatar({ name, src, size = 40, guest, tag }: AvatarProps) {
  return (
    <span
      className={cx('pm-avatar', guest ? 'pm-avatar--guest' : !src && `pm-avatar--c${tintOf(name)}`)}
      style={{ '--pm-avatar-size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" /> : initialsOf(name)}
      {tag && <span className="pm-avatar__tag">{tag}</span>}
    </span>
  );
}

export function AvatarStack({ names, max = 4, size = 32 }: { names: readonly string[]; max?: number; size?: number }) {
  const overflow = names.length - max;
  return (
    <span className="pm-avatar-stack" aria-hidden="true">
      {names.slice(0, max).map((name) => (
        <Avatar key={name} name={name} size={size} />
      ))}
      {overflow > 0 && (
        <span className="pm-avatar pm-avatar--more" style={{ '--pm-avatar-size': `${size}px` } as CSSProperties}>
          +{overflow}
        </span>
      )}
    </span>
  );
}
