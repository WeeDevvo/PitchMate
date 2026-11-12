import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import './Card.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `section` or `article` when the card is a landmark or a self-contained item. */
  as?: 'div' | 'section' | 'article' | 'li';
  raised?: boolean;
}

/** The base surface for squad, match and stat cards: a border before a shadow. */
export function Card({ as: Element = 'div', raised, className, ...rest }: CardProps) {
  return <Element {...rest} className={cx('pm-card', raised && 'pm-card--raised', className)} />;
}
