import type { HTMLAttributes, ReactNode } from 'react';
import { Avatar } from './Avatar';
import { cx } from './cx';
import './PlayerRow.css';

export interface PlayerRowProps extends HTMLAttributes<HTMLDivElement> {
  /** The player's display name, for the avatar's initials and tint. */
  name: string;
  /** Guests get the hatched avatar. */
  guest?: boolean;
  /** A former player's row is muted. */
  former?: boolean;
  avatarSrc?: string;
  /**
   * The name as rendered, when it is more than text: usually the control that
   * opens the player's stats. Defaults to the name.
   */
  nameContent?: ReactNode;
  /** Role, guest, provisional or former badges beside the name. */
  badges?: ReactNode;
  /** A line under the name. */
  meta?: ReactNode;
  /** The trailing column: the rating, then any row actions. */
  end?: ReactNode;
}

/**
 * One player in a list: avatar, name with its badges, an optional meta line, and
 * a trailing column. Guests look like everyone else apart from the avatar and the
 * badge the caller passes.
 */
export function PlayerRow({
  name,
  guest,
  former,
  avatarSrc,
  nameContent,
  badges,
  meta,
  end,
  className,
  ...rest
}: PlayerRowProps) {
  return (
    <div {...rest} className={cx('pm-player', former && 'is-former', className)}>
      <Avatar name={name} guest={guest} src={avatarSrc} />
      <span className="pm-player__main">
        <span className="pm-player__name">
          {nameContent ?? name}
          {badges}
        </span>
        {meta !== undefined && <span className="pm-player__meta">{meta}</span>}
      </span>
      {end !== undefined && <span className="pm-player__end">{end}</span>}
    </div>
  );
}
