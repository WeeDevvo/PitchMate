import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import './Checkbox.css';

export interface CheckboxProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Keep the label for screen readers only, where the row beside it already shows it. */
  hideLabel?: boolean;
  size?: 'lg';
  className?: string;
}

/**
 * A checkbox with a drawn tick, so the state isn't colour alone, on a 44px hit
 * area. The native input stays in the tree and carries the label.
 */
export function Checkbox({ label, description, checked, onChange, disabled, hideLabel, size, className }: CheckboxProps) {
  const descriptionId = useId();

  return (
    <label
      className={cx('pm-check', checked && 'is-checked', disabled && 'is-disabled', size === 'lg' && 'pm-check--lg', className)}
    >
      <input
        type="checkbox"
        className="pm-check__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pm-check__box" aria-hidden="true">
        {checked && <Icon name="check" size={size === 'lg' ? 20 : 16} strokeWidth={3} />}
      </span>
      <span className={hideLabel ? 'pm-sr' : 'pm-check__text'}>
        <span className="pm-check__label">{label}</span>
        {description !== undefined && (
          <small id={descriptionId} className="pm-check__desc">
            {description}
          </small>
        )}
      </span>
    </label>
  );
}
