import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import './BibFlag.css';

export interface BibToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  /** This team wears the bibs. */
  pressed: boolean;
  /** The words while it does ("Wearing bibs") and while it doesn't ("Wear bibs"). */
  pressedLabel: string;
  label: string;
}

/**
 * The bibs choice for one team: a pressed button in hi-vis orange with the bib
 * icon while the team wears them. Exactly one team does, so pressing the other
 * team's toggle moves the bibs; the caller re-reads which team has them.
 */
export function BibToggle({ pressed, pressedLabel, label, className, ...rest }: BibToggleProps) {
  return (
    <button {...rest} type="button" aria-pressed={pressed} className={cx('pm-bibtoggle', pressed && 'is-pressed', className)}>
      <Icon name="bib" size={22} />
      {pressed ? pressedLabel : label}
    </button>
  );
}

/**
 * The bibs flag. Orange sits near loss red and draw amber, so the bib icon and
 * the word BIBS are always shown. `off` marks the other team.
 */
export function BibFlag({
  size,
  off,
  label = 'This team wears bibs',
}: {
  size?: 'lg';
  off?: boolean;
  /** The flag's accessible name, where a feature words it differently. */
  label?: string;
}) {
  if (off) {
    return (
      <span className="pm-bib pm-bib--off">
        <Icon name="bib" size={16} />
        No bibs
      </span>
    );
  }
  return (
    <span className={cx('pm-bib', size === 'lg' && 'pm-bib--lg')} role="img" aria-label={label}>
      <Icon name="bib" size={size === 'lg' ? 22 : 17} strokeWidth={2.4} />
      <span aria-hidden="true">Bibs</span>
    </span>
  );
}
