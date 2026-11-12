import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Result.css';

export type ResultLetter = 'W' | 'L' | 'D';

const RESULTS: Record<ResultLetter, { modifier: string; icon: IconName; word: string }> = {
  W: { modifier: 'w', icon: 'check', word: 'Win' },
  L: { modifier: 'l', icon: 'x', word: 'Loss' },
  D: { modifier: 'd', icon: 'dash', word: 'Draw' },
};

function ResultTile({ result, large }: { result: ResultLetter; large?: boolean }) {
  const { modifier, icon } = RESULTS[result];
  return (
    <span className={cx('pm-result', `pm-result--${modifier}`, large && 'pm-result--lg')} aria-hidden="true">
      <Icon name={icon} size={large ? 18 : 14} strokeWidth={3} />
      {result}
    </span>
  );
}

/** A W / L / D tile: never colour alone, always the letter and its icon. */
export function ResultBadge({ result, size }: { result: ResultLetter; size?: 'lg' }) {
  return (
    <span className="pm-result-wrap" role="img" aria-label={RESULTS[result].word} title={RESULTS[result].word}>
      <ResultTile result={result} large={size === 'lg'} />
    </span>
  );
}

/** Recent results, oldest first. */
export function FormGuide({ results }: { results: readonly ResultLetter[] }) {
  return (
    <span
      className="pm-form"
      role="img"
      aria-label={`Last ${results.length}: ${results.map((result) => RESULTS[result].word).join(', ')}`}
    >
      {results.map((result, index) => (
        <ResultTile key={index} result={result} />
      ))}
    </span>
  );
}
