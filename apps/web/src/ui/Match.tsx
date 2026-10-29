import type { HTMLAttributes, ReactNode } from 'react';
import { BibFlag } from './BibFlag';
import { Icon, type IconName } from './Icon';
import { MatchStateChip, type MatchStateName } from './MatchState';
import { cx } from './cx';
import './Card.css';
import './Match.css';

/* ------------------------------------------------------------------ *
 * MatchCard
 * ------------------------------------------------------------------ */

/** A day split for the date box: "SAT", "25", "Oct". */
export interface DateParts {
  dow: string;
  num: string;
  mon: string;
}

export interface MatchCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  as?: 'div' | 'li' | 'article';
  /** The match's name, usually the link that opens it. */
  title: ReactNode;
  /** The headline day, for the date box. Absent while no day is known. */
  date?: DateParts;
  /** A line of facts under the title: time, players, teams. */
  meta?: ReactNode;
  state?: MatchStateName;
  /** The state's word, where the caller's vocabulary differs from the chip's. */
  stateLabel?: string;
  children?: ReactNode;
}

/** A match in a list: the date box, the title and its facts, and the state chip. */
export function MatchCard({ as: Element = 'div', title, date, meta, state, stateLabel, children, className, ...rest }: MatchCardProps) {
  return (
    <Element {...rest} className={cx('pm-card pm-matchcard', className)}>
      <div className="pm-matchcard__head">
        <div className="pm-matchcard__when">
          {date && (
            <span className="pm-datebox" aria-hidden="true">
              <small>{date.dow}</small>
              <b className="pm-num">{date.num}</b>
              <small>{date.mon}</small>
            </span>
          )}
          <div className="pm-matchcard__titles">
            <div className="pm-matchcard__title">{title}</div>
            {meta !== undefined && <div className="pm-matchcard__meta">{meta}</div>}
          </div>
        </div>
        {state && <MatchStateChip state={state} label={stateLabel} />}
      </div>
      {children}
    </Element>
  );
}

/* ------------------------------------------------------------------ *
 * DayPicker
 * ------------------------------------------------------------------ */

export interface DayOption extends DateParts {
  id: string;
  /** The day in words, read as the checkbox's name: "Sat 25 Oct, 10:00". */
  label: string;
  /** A kick-off time under the date, if the day has one. */
  time?: string;
  disabled?: boolean;
}

export interface DayPickerProps {
  days: readonly DayOption[];
  selected: ReadonlySet<string> | readonly string[];
  onToggle: (id: string, checked: boolean) => void;
  /**
   * Keep a time line on every tile, blank until the day has a time, so tiles
   * stay one height as times are set (the create-match picker).
   */
  reserveTime?: boolean;
  className?: string;
}

/**
 * Candidate days as tiles. Each is a real checkbox named by the day in words, so
 * it works as a form field; the large tile lettering is decorative. Put the
 * picker in a fieldset with a legend.
 */
export function DayPicker({ days, selected, onToggle, reserveTime, className }: DayPickerProps) {
  const isSelected = (id: string) =>
    Array.isArray(selected) ? selected.includes(id) : (selected as ReadonlySet<string>).has(id);

  return (
    <ul className={cx('pm-days', className)}>
      {days.map((day) => (
        <li key={day.id}>
          <label className={cx('pm-day', isSelected(day.id) && 'is-selected', day.disabled && 'is-disabled')}>
            <input
              type="checkbox"
              className="pm-day__input"
              aria-label={day.label}
              checked={isSelected(day.id)}
              disabled={day.disabled}
              onChange={(event) => onToggle(day.id, event.target.checked)}
            />
            <span className="pm-day__dow" aria-hidden="true">
              {day.dow}
            </span>
            <span className="pm-day__num pm-num" aria-hidden="true">
              {day.num}
            </span>
            <span className="pm-day__mon" aria-hidden="true">
              {day.mon}
            </span>
            {(day.time || reserveTime) && (
              <span className="pm-day__time pm-num" aria-hidden="true">
                {day.time}
              </span>
            )}
          </label>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * FairnessMeter
 * ------------------------------------------------------------------ */

export interface FairnessMeterProps {
  teamA: string;
  teamB: string;
  /** Probabilities from 0 to 1. */
  winA: number;
  winB: number;
  draw: number;
  /** The word for a draw. */
  drawLabel?: string;
  /** Side sizes, shown when the teams are uneven. */
  sizes?: readonly [number, number];
}

const percent = (probability: number) => Math.round(probability * 100);

const VERDICTS: readonly { within: number; tone: string; icon: IconName; word: string }[] = [
  { within: 4, tone: 'sweet', icon: 'sparkle', word: 'Dead even' },
  { within: 12, tone: 'ok', icon: 'check', word: 'Pretty fair' },
  { within: Infinity, tone: 'lopsided', icon: 'alert', word: 'Bit lopsided' },
];

/**
 * The predicted result as the fairness meter: each side's win chance either side
 * of the draw, a bar with a centre line, and a verdict. The numbers are a
 * definition list, so they read as text; the bar is decorative.
 */
export function FairnessMeter({ teamA, teamB, winA, winB, draw, drawLabel = 'Draw', sizes }: FairnessMeterProps) {
  const [a, b, d] = [percent(winA), percent(winB), percent(draw)];
  const verdict = VERDICTS.find((candidate) => Math.abs(a - b) <= candidate.within) ?? VERDICTS[2];
  const uneven = sizes !== undefined && sizes[0] !== sizes[1];

  return (
    <div className="pm-fair">
      <dl className="pm-fair__top">
        <div className="pm-fair__side">
          <dt className="pm-fair__team">
            <span className="pm-team__swatch pm-team__swatch--a" aria-hidden="true" />
            {teamA}
            {uneven && <span className="pm-fair__size"> · {sizes[0]}</span>}
          </dt>
          <dd className="pm-fair__pct pm-num">{a}%</dd>
        </div>
        <div className="pm-fair__draw">
          <dt className="pm-fair__draw-label">{drawLabel}</dt>
          <dd className="pm-num">{d}%</dd>
        </div>
        <div className="pm-fair__side pm-fair__side--b">
          <dt className="pm-fair__team">
            {uneven && <span className="pm-fair__size">{sizes[1]} · </span>}
            {teamB}
            <span className="pm-team__swatch pm-team__swatch--b" aria-hidden="true" />
          </dt>
          <dd className="pm-fair__pct pm-num">{b}%</dd>
        </div>
      </dl>
      <div className="pm-fair__wrap" aria-hidden="true">
        <div className="pm-fair__bar">
          <span className="pm-fair__seg pm-fair__seg--a" style={{ flexBasis: `${a}%` }} />
          <span className="pm-fair__seg pm-fair__seg--d" style={{ flexBasis: `${d}%` }} />
          <span className="pm-fair__seg pm-fair__seg--b" style={{ flexBasis: `${b}%` }} />
        </div>
        <span className="pm-fair__mid" />
      </div>
      <p className={`pm-fair__verdict pm-fair__verdict--${verdict.tone}`}>
        <Icon name={verdict.icon} size={20} strokeWidth={2.5} />
        {verdict.word}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * TeamColumn
 * ------------------------------------------------------------------ */

export interface TeamColumnProps extends HTMLAttributes<HTMLElement> {
  side: 'a' | 'b';
  /** The side's word above the name, such as "Team A". */
  sideLabel?: string;
  /** The team's heading, as the caller's own heading element. */
  heading: ReactNode;
  /** This team wears the bibs. */
  bibs?: boolean;
  /** The bibs flag's accessible name, where the feature words it differently. */
  bibsLabel?: string;
  /** Facts under the name: player count, average rating. */
  meta?: ReactNode;
  children?: ReactNode;
}

/** One team: a coloured stripe and side label, the name, the bibs flag, and the roster below. */
export function TeamColumn({ side, sideLabel, heading, bibs, bibsLabel, meta, children, className, ...rest }: TeamColumnProps) {
  return (
    <section {...rest} className={cx('pm-team', `pm-team--${side}`, className)}>
      <div className="pm-team__head">
        <span className="pm-team__stripe" aria-hidden="true" />
        {sideLabel && (
          <span className="pm-team__side">
            <span className={`pm-team__swatch pm-team__swatch--${side}`} aria-hidden="true" />
            {sideLabel}
          </span>
        )}
        <div className="pm-team__name">
          {heading}
          {bibs && <BibFlag label={bibsLabel} />}
        </div>
        {meta !== undefined && <div className="pm-team__meta">{meta}</div>}
      </div>
      {children !== undefined && <div className="pm-team__body">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Scoreboard
 * ------------------------------------------------------------------ */

export interface ScoreboardProps {
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  /** Which side wears the bibs, if either. */
  bibs?: 'a' | 'b' | null;
  /** Provisional until an admin completes the match: muted numerals and a badge. */
  status: 'provisional' | 'final';
  /** The words for each status. */
  provisionalLabel?: string;
  finalLabel?: string;
  /** Show the status under the score; off where the caller already states it. */
  showStatus?: boolean;
}

/**
 * The big score. Decorative: the caller states the result in words beside it
 * (each team, its score and its outcome), so the board is not read twice.
 */
export function Scoreboard({
  teamA,
  teamB,
  scoreA,
  scoreB,
  bibs,
  status,
  provisionalLabel = 'Provisional',
  finalLabel = 'Full time',
  showStatus = true,
}: ScoreboardProps) {
  return (
    <div className={cx('pm-score', status === 'provisional' && 'is-provisional')} aria-hidden="true">
      <div className="pm-score__team">
        <span className="pm-score__name">{teamA}</span>
        {bibs === 'a' && <BibFlag />}
      </div>
      <div className="pm-score__mid">
        <div className="pm-score__nums pm-num">
          <span>{scoreA}</span>
          <i>–</i>
          <span>{scoreB}</span>
        </div>
        {!showStatus ? null : status === 'provisional' ? (
          <span className="pm-score__tag pm-score__tag--provisional">
            <Icon name="clock" size={13} strokeWidth={2.5} />
            {provisionalLabel}
          </span>
        ) : (
          <span className="pm-score__tag">{finalLabel}</span>
        )}
      </div>
      <div className="pm-score__team pm-score__team--b">
        <span className="pm-score__name">{teamB}</span>
        {bibs === 'b' && <BibFlag />}
      </div>
    </div>
  );
}
