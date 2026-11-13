import { cx } from './cx';
import './Rating.css';

export interface RatingProps {
  /** Already formatted for display, e.g. "1,240". */
  value: string;
  /** Change since the last match. */
  delta?: number;
}

/**
 * A display rating. Every player shows a number, and a rating that is still
 * settling looks the same as any other: the note that it is settling goes with
 * the player's name (`SettlingMark`), never on the number.
 */
export function Rating({ value, delta }: RatingProps) {
  return (
    <span className="pm-rating pm-num">
      {value}
      {delta !== undefined && delta !== 0 && (
        <span className={cx('pm-rating__delta', delta > 0 ? 'is-up' : 'is-down')}>
          {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
        </span>
      )}
    </span>
  );
}
