import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './MatchState.css';

/** The design system's names for the match states; features map the wire enum onto these. */
export type MatchStateName = 'gathering' | 'confirmed' | 'rolled' | 'live' | 'completed' | 'cancelled';

const STATES: Record<MatchStateName, { label: string; icon: IconName }> = {
  gathering: { label: 'Gathering', icon: 'calendar' },
  confirmed: { label: 'Confirmed', icon: 'check' },
  rolled: { label: 'Teams rolled', icon: 'shuffle' },
  live: { label: 'In progress', icon: 'whistle' },
  completed: { label: 'Completed', icon: 'flag' },
  cancelled: { label: 'Cancelled', icon: 'x' },
};

/** Each state has its own icon and word; Cancelled is outlined and struck through. */
export function MatchStateChip({ state }: { state: MatchStateName }) {
  const { label, icon } = STATES[state];
  return (
    <span className={`pm-state pm-state--${state}`}>
      <Icon name={icon} size={16} strokeWidth={2.5} />
      <span>{label}</span>
    </span>
  );
}

const PROGRESS_STEPS: readonly { state: MatchStateName; label: string }[] = [
  { state: 'gathering', label: 'Availability' },
  { state: 'confirmed', label: 'Confirmed' },
  { state: 'rolled', label: 'Teams' },
  { state: 'live', label: 'Playing' },
  { state: 'completed', label: 'Done' },
];

/** Five steps from availability to done. A cancelled match shows no progress. */
export function MatchProgress({ state }: { state: Exclude<MatchStateName, 'cancelled'> }) {
  const current = PROGRESS_STEPS.findIndex((step) => step.state === state);

  return (
    <div className="pm-progress" role="img" aria-label={`Match progress: ${STATES[state].label}`}>
      {PROGRESS_STEPS.map((step, index) => (
        <div
          key={step.state}
          aria-hidden="true"
          className={cx(
            'pm-progress__step',
            (index < current || state === 'completed') && 'is-done',
            index === current && state !== 'completed' && 'is-current',
          )}
        >
          <span className="pm-progress__bar" />
          <span className="pm-progress__label">{step.label}</span>
        </div>
      ))}
    </div>
  );
}
