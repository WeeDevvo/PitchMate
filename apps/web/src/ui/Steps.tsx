import { Icon } from './Icon';
import { cx } from './cx';
import './Steps.css';

export interface StepsProps {
  /** Names the list for assistive technology: "Create match steps". */
  label: string;
  steps: readonly string[];
  /** The index of the step in progress; earlier ones are done. */
  current: number;
  /** Words read before a finished step's name; drawn as a tick. */
  doneLabel?: string;
}

/**
 * A multi-step flow's progress: a bar per step, green up to the current one,
 * with the step's number and name beneath. The current step carries
 * `aria-current="step"`, and a finished one says so in words as well as with a
 * tick, so neither colour nor the icon is the only cue.
 */
export function Steps({ label, steps, current, doneLabel = 'Done' }: StepsProps) {
  return (
    <ol className="pm-steps" aria-label={label}>
      {steps.map((step, index) => {
        const done = index < current;
        return (
          <li
            key={step}
            className={cx('pm-steps__step', done && 'is-done', index === current && 'is-current')}
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="pm-steps__bar" aria-hidden="true" />
            <span className="pm-steps__label">
              {done ? (
                <>
                  <Icon name="check" size={14} strokeWidth={3} />
                  <span className="pm-sr">{doneLabel}: </span>
                </>
              ) : (
                <span className="pm-num">{index + 1}. </span>
              )}
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
