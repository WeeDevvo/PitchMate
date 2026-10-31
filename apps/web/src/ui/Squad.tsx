import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';
import { MatchStateChip, type MatchStateName } from './MatchState';
import { FormGuide, type ResultLetter } from './Result';
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

/** A squad card's next match: its state, then a title and a line under it. */
export interface SquadCardNextMatch {
  state: MatchStateName;
  /** "Sun 9 Nov · 10:00", or "Pick a day" while still gathering availability. */
  title: ReactNode;
  /** "Hackney Marshes", "3 candidate days". */
  sub?: ReactNode;
}

export interface SquadCardProps {
  name: string;
  crest?: string;
  /** A line under the name: the viewer's role, player count, state. */
  meta?: ReactNode;
  /**
   * The squad's next match, shown in a well under the head; `null` shows
   * {@link noNextMatch} there instead. Omit it to leave the well out.
   */
  next?: SquadCardNextMatch | null;
  /** What the well says when there is no next match: "Nothing planned yet". */
  noNextMatch?: ReactNode;
  /**
   * The viewer's recent results, oldest first, in the footer; an empty list
   * shows {@link noForm} there instead. Omit it to leave the footer out.
   */
  form?: readonly ResultLetter[];
  /** The footer's label: "Form". */
  formLabel?: ReactNode;
  /** What the footer says before any result: "No games yet". */
  noForm?: ReactNode;
  /** Anything else below the head. */
  children?: ReactNode;
  /**
   * Renders the card's one interactive element (a button or a link), spreading
   * the props it is given, so the whole card is the target.
   */
  render: (props: SquadCardRenderProps) => ReactElement;
}

/**
 * The squads-home card: crest, name and meta, then the next match in a sunken
 * well and the viewer's form in a footer. The whole card is one control, which
 * the caller renders; everything inside it is phrasing content, so it is valid
 * inside a button or a link.
 */
export function SquadCard({
  name,
  crest,
  meta,
  next,
  noNextMatch,
  form,
  formLabel = 'Form',
  noForm,
  children,
  render,
}: SquadCardProps) {
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
        {next !== undefined && (
          <span className={cx('pm-squadcard__next', next === null && 'pm-squadcard__next--none')}>
            {next === null ? (
              <span className="pm-squadcard__next-sub">{noNextMatch}</span>
            ) : (
              <>
                <MatchStateChip state={next.state} />
                <span className="pm-squadcard__next-text">
                  <span className="pm-squadcard__next-title">{next.title}</span>
                  {/* A space between the two lines, so the card's accessible name
                      does not run them together; the column ignores it. */}
                  {next.sub !== undefined && (
                    <>
                      {' '}
                      <span className="pm-squadcard__next-sub">{next.sub}</span>
                    </>
                  )}
                </span>
              </>
            )}
          </span>
        )}
        {form !== undefined && (
          <span className="pm-squadcard__foot">
            <span className="pm-squadcard__foot-label">{formLabel}</span>{' '}
            {form.length > 0 ? <FormGuide results={form} /> : <span className="pm-squadcard__next-sub">{noForm}</span>}
          </span>
        )}
        {children}
      </>
    ),
  });
}
