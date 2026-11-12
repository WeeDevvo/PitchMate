import { ProvisionalBadge } from './Badge';
import { cx } from './cx';
import './Rating.css';

export type RatingProps =
  | {
      /** Already formatted for display, e.g. "1,240". */
      value: string;
      /** Change since the last match. */
      delta?: number;
      provisional?: false;
    }
  | {
      provisional: true;
      /** The rough band shown instead of a number, e.g. "1,1xx". */
      band: string;
    };

/** A display rating, or the "~" band: a provisional player never shows a precise number. */
export function Rating(props: RatingProps) {
  if (props.provisional) {
    return (
      <span className="pm-rating pm-rating--prov">
        <span className="pm-rating__band pm-num">~{props.band}</span>
        <ProvisionalBadge short />
      </span>
    );
  }

  const { value, delta } = props;
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
