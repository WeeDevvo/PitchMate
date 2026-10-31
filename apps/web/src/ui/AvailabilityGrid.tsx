import type { ReactNode } from 'react';
import { cx } from './cx';
import './AvailabilityGrid.css';

/** What a person said about one candidate day. */
export type AvailabilityAnswer = 'yes' | 'no' | 'unknown';

export interface AvailabilityGridDay {
  id: string;
  /** "Fri", drawn large in the column head. */
  dow: string;
  /** "13 Nov". */
  date: string;
  /** "15:00", when the day has a kick-off time. */
  time?: string;
}

export interface AvailabilityGridCell {
  answer: AvailabilityAnswer;
  /** The cell's accessible name, as a checkbox when the row is editable: "John, Fri 13 Nov, 15:00". */
  label: string;
}

export interface AvailabilityGridRow {
  id: string;
  name: ReactNode;
  /** One per day, in the order of `days`. */
  cells: readonly AvailabilityGridCell[];
  /** Makes each cell a checkbox: ticked is "yes". */
  onToggle?: (dayIndex: number, checked: boolean) => void;
  /** A control at the row's end, such as a clear button. */
  action?: ReactNode;
}

export interface AvailabilityGridTotal {
  value: number;
  /** Read in place of the number: "3 can play". */
  label: string;
  /** The best-attended day: highlighted and starred. */
  best?: boolean;
}

export interface AvailabilityGridProps {
  /** Names the table: "Who can make each day". */
  caption: string;
  days: readonly AvailabilityGridDay[];
  rows: readonly AvailabilityGridRow[];
  /** The words read for each answer. */
  answerLabels: Readonly<Record<AvailabilityAnswer, string>>;
  totals?: readonly AvailabilityGridTotal[];
  totalsLabel?: string;
  /** Read after a best day's total: "Most players". */
  bestLabel?: string;
  className?: string;
}

const SYMBOLS: Readonly<Record<AvailabilityAnswer, string>> = { yes: '✓', no: '✗', unknown: '?' };
const CELL_CLASS: Readonly<Record<AvailabilityAnswer, string>> = { yes: 'is-yes', no: 'is-no', unknown: 'is-unknown' };

/**
 * Who can make which candidate day: a row per person, a column per day, and a
 * total per day with the best one highlighted. Every cell shows a symbol and
 * carries a word, so no answer rests on colour; an editable row's cells are real
 * checkboxes named by the person and the day.
 */
export function AvailabilityGrid({
  caption,
  days,
  rows,
  answerLabels,
  totals,
  totalsLabel,
  bestLabel,
  className,
}: AvailabilityGridProps) {
  const hasActions = rows.some((row) => row.action !== undefined);

  return (
    <div className={cx('pm-agrid-wrap', className)}>
      <table className="pm-agrid">
        <caption className="pm-sr">{caption}</caption>
        <thead>
          <tr>
            <td />
            {days.map((day) => (
              <th key={day.id} scope="col">
                {day.dow}
                <small>{day.date}</small>
                {day.time && <small className="pm-num">{day.time}</small>}
              </th>
            ))}
            {hasActions && <td />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.name}</th>
              {row.cells.map((cell, index) => (
                <td key={days[index]?.id ?? index} className={cx('pm-agrid__cell', CELL_CLASS[cell.answer])}>
                  {row.onToggle ? (
                    <label className="pm-agrid__toggle">
                      <input
                        type="checkbox"
                        className="pm-agrid__input"
                        aria-label={cell.label}
                        checked={cell.answer === 'yes'}
                        onChange={(event) => row.onToggle?.(index, event.target.checked)}
                      />
                      <span aria-hidden="true">{SYMBOLS[cell.answer]}</span>
                      {cell.answer === 'unknown' && <span className="pm-sr">{answerLabels.unknown}</span>}
                    </label>
                  ) : (
                    <>
                      <span aria-hidden="true">{SYMBOLS[cell.answer]}</span>
                      <span className="pm-sr">{answerLabels[cell.answer]}</span>
                    </>
                  )}
                </td>
              ))}
              {hasActions && <td className="pm-agrid__action">{row.action}</td>}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              <th scope="row">{totalsLabel}</th>
              {totals.map((total, index) => (
                <td key={days[index]?.id ?? index} className={cx('pm-agrid__total', total.best && 'is-best')}>
                  <span className="pm-num" aria-hidden="true">
                    {total.value}
                    {total.best && <span className="pm-agrid__star">★</span>}
                  </span>
                  <span className="pm-sr">
                    {total.label}
                    {total.best && bestLabel ? `, ${bestLabel}` : ''}
                  </span>
                </td>
              ))}
              {hasActions && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** The key under a grid: each symbol and its word. */
export function AvailabilityKey({ labels }: { labels: Readonly<Record<AvailabilityAnswer, string>> }) {
  return (
    <ul className="pm-agrid-key">
      {(['yes', 'no', 'unknown'] as const).map((answer) => (
        <li key={answer}>
          <span className={cx('pm-agrid-key__swatch', CELL_CLASS[answer])} aria-hidden="true">
            {SYMBOLS[answer]}
          </span>
          {labels[answer]}
        </li>
      ))}
    </ul>
  );
}
