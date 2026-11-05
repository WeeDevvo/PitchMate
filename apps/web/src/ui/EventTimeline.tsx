import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './EventTimeline.css';

export type EventTimelineKind = 'goal' | 'keeper' | 'correction';

export interface EventTimelineItem {
  /** A stable key for the row. */
  key: string;
  /** The minute, display-ready: "19′". */
  minute: string;
  kind: EventTimelineKind;
  /** The side a goal counts for, which colours its ball. */
  team?: 'a' | 'b' | null;
  /** An own goal shows the own-goal mark rather than a ball. */
  own?: boolean;
  /** The headline: the scorer, the keeper, or what the correction did. */
  text: string;
  /** The supporting line: the team, or when and why. */
  sub?: string;
  /** The score after this goal, display-ready: "2–1". */
  score?: string;
  /**
   * Taken back by a later correction. The row stays, struck through; `voidLabel`
   * says so in words, since a strike-through alone is only a style.
   */
  void?: boolean;
  /** Trailing controls for the row, such as an `ActionsMenu`. */
  actions?: ReactNode;
}

export interface EventTimelineProps {
  events: readonly EventTimelineItem[];
  /** The words a voided row carries: "Taken back". */
  voidLabel: string;
  /** The list's accessible name. */
  label: string;
  className?: string;
}

function iconFor(item: EventTimelineItem): IconName {
  if (item.kind === 'keeper') return 'glove';
  if (item.kind === 'correction') return 'history';
  return item.own ? 'ownGoal' : 'ball';
}

/**
 * A rich result's timeline: goals, own goals, keeper changes and corrections,
 * in minute order. A correction is a new row, never an edit: the event it took
 * back stays in place, struck through and labelled in words.
 */
export function EventTimeline({ events, voidLabel, label, className }: EventTimelineProps) {
  return (
    <ol className={cx('pm-timeline', className)} aria-label={label}>
      {events.map((item) => (
        <li
          key={item.key}
          className={cx(
            'pm-timeline__row',
            `pm-timeline__row--${item.kind}`,
            item.void && 'pm-timeline__row--void',
          )}
        >
          <span className="pm-timeline__minute pm-num">{item.minute}</span>
          <span
            className={cx(
              'pm-timeline__mark',
              item.kind === 'goal' && item.team ? `pm-timeline__mark--${item.team}` : undefined,
            )}
          >
            <Icon name={iconFor(item)} size={18} />
          </span>
          <span className="pm-timeline__body">
            <span className="pm-timeline__text">{item.text}</span>
            {item.sub || item.void ? (
              <span className="pm-timeline__sub">
                {item.void ? <span className="pm-timeline__void">{voidLabel}</span> : null}
                {item.void && item.sub ? ' · ' : null}
                {item.sub}
              </span>
            ) : null}
          </span>
          {item.score ? <span className="pm-timeline__score pm-num">{item.score}</span> : null}
          {item.actions ? <span className="pm-timeline__actions">{item.actions}</span> : null}
        </li>
      ))}
    </ol>
  );
}
