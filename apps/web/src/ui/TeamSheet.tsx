import type { HTMLAttributes, ReactNode } from 'react';
import { Avatar } from './Avatar';
import { BibFlag } from './BibFlag';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { cx } from './cx';
import './Match.css';
import './TeamSheet.css';

export interface TeamSheetCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The card's heading, such as "Team sheet · Thursday Ballers", as the caller's own heading element. */
  heading: ReactNode;
  /** The day in large type, such as "Sun 9 Nov", and its machine-readable instant. */
  day: string;
  dateTime: string;
  /** The kick-off time as shown ("10:00 KO") and the word read before it ("Kick-off"). */
  time: string;
  timeLabel: string;
  /** Where the match is, and the word read before it ("Where"). */
  location: string;
  locationLabel: string;
  /** The teams: one `TeamSheetSide` each. */
  children: ReactNode;
  /** A line under the teams, left; the site's address sits on the right. */
  footer?: ReactNode;
}

/**
 * The shareable team sheet: a Pitch Green header with the day, kick-off and
 * pitch, the teams side by side, and a footer. Built to be screenshotted into
 * the group chat, so it keeps a fixed shape and large names in both themes.
 */
export function TeamSheetCard({
  heading,
  day,
  dateTime,
  time,
  timeLabel,
  location,
  locationLabel,
  children,
  footer,
  className,
  ...rest
}: TeamSheetCardProps) {
  return (
    <section {...rest} className={cx('pm-sheet', className)}>
      <div className="pm-sheet__head">
        <div className="pm-sheet__top">
          <div className="pm-sheet__overline">{heading}</div>
          <Logo variant="ink" size={30} wordmark={false} />
        </div>
        <time className="pm-sheet__day" dateTime={dateTime}>
          {day}
        </time>
        <dl className="pm-sheet__facts">
          <div>
            <dt className="pm-sr">{timeLabel}</dt>
            <dd>
              <Icon name="clock" size={18} />
              <span className="pm-num">{time}</span>
            </dd>
          </div>
          <div>
            <dt className="pm-sr">{locationLabel}</dt>
            <dd>
              <Icon name="pin" size={18} />
              {location}
            </dd>
          </div>
        </dl>
      </div>
      <div className="pm-sheet__teams">{children}</div>
      <div className="pm-sheet__foot">
        <span>{footer}</span>
        <span className="pm-sheet__site">pitch-mate.co.uk</span>
      </div>
    </section>
  );
}

export interface TeamSheetSideProps extends HTMLAttributes<HTMLElement> {
  side: 'a' | 'b';
  /** "Team A", above the name. */
  sideLabel: string;
  /** The team's name, as the caller's own heading element. */
  heading: ReactNode;
  /** This team wears the bibs: the large flag. The other team shows "No bibs". */
  bibs: boolean;
  bibsLabel?: string;
  /** The players: one `TeamSheetPlayer` each. */
  children: ReactNode;
}

/** One team on the sheet: side label, big name, the bibs flag, and the players. */
export function TeamSheetSide({ side, sideLabel, heading, bibs, bibsLabel, children, className, ...rest }: TeamSheetSideProps) {
  return (
    <section {...rest} className={cx('pm-sheet__side', className)}>
      <span className="pm-team__side">
        <span className={`pm-team__swatch pm-team__swatch--${side}`} aria-hidden="true" />
        {sideLabel}
      </span>
      <div className="pm-sheet__name">{heading}</div>
      <div className="pm-sheet__bibs">{bibs ? <BibFlag size="lg" label={bibsLabel} /> : <BibFlag off />}</div>
      <ul className="pm-sheet__players">{children}</ul>
    </section>
  );
}

export interface TeamSheetPlayerProps {
  /** The player's name, for the avatar. */
  name: string;
  /** The name as shown, usually a link to the player's stats. Defaults to the name. */
  nameContent?: ReactNode;
  guest?: boolean;
  /** Badges after the name, such as the guest badge. */
  badges?: ReactNode;
}

/** A player on the team sheet: a small avatar and the name, large enough to read in a screenshot. */
export function TeamSheetPlayer({ name, nameContent, guest, badges }: TeamSheetPlayerProps) {
  return (
    <li className="pm-sheet__player">
      <Avatar name={name} guest={guest} size={32} />
      <span className="pm-sheet__player-name">{nameContent ?? name}</span>
      {badges}
    </li>
  );
}
