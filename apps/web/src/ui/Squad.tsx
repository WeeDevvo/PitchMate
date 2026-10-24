import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';
import './Card.css';
import './Squad.css';

/** Up to two initials from a name, for a crest or an avatar. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}

export interface SquadCrestProps {
  name: string;
  /** Overrides the initials, for a squad that has chosen its own crest text. */
  crest?: string;
  size?: 'sm' | 'md';
}

/** A squad's crest tile. Decorative: the squad's name is always printed beside it. */
export function SquadCrest({ name, crest, size = 'md' }: SquadCrestProps) {
  return (
    <span className={cx('pm-crest', size === 'sm' && 'pm-crest--sm')} aria-hidden="true">
      {crest ?? initialsOf(name)}
    </span>
  );
}

/** What a SquadCard hands to the element that renders it. */
export interface SquadCardRenderProps {
  className: string;
  children: ReactNode;
}

export interface SquadCardProps {
  name: string;
  crest?: string;
  /** A line under the name: the viewer's role, player count, state. */
  meta?: ReactNode;
  /** Anything below the head, such as the next match. */
  children?: ReactNode;
  /**
   * Renders the card's one interactive element (a button or a link), spreading
   * the props it is given, so the whole card is the target.
   */
  render: (props: SquadCardRenderProps) => ReactElement;
}

export function SquadCard({ name, crest, meta, children, render }: SquadCardProps) {
  return render({
    className: 'pm-card pm-card--link pm-squadcard',
    children: (
      <>
        <span className="pm-squadcard__head">
          <SquadCrest name={name} crest={crest} />
          <span className="pm-squadcard__titles">
            <span className="pm-squadcard__name">{name}</span>
            {meta !== undefined && <span className="pm-squadcard__meta">{meta}</span>}
          </span>
        </span>
        {children}
      </>
    ),
  });
}
