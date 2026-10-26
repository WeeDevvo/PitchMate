import { Icon } from './Icon';
import { cx } from './cx';
import './BibFlag.css';

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
