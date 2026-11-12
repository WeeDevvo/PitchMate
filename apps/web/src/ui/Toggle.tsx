import { useState, type ChangeEvent } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import './Toggle.css';

export interface ToggleProps {
  label: string;
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}

/** An on/off switch. The thumb shows a check when on, so the state isn't colour alone. */
export function Toggle({ label, description, checked, defaultChecked = false, disabled, onChange, className }: ToggleProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultChecked);
  const on = checked ?? uncontrolled;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUncontrolled(event.target.checked);
    onChange?.(event.target.checked);
  };

  return (
    <label className={cx('pm-toggle', disabled && 'is-disabled', className)}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={handleChange} />
      <span className="pm-toggle__track" aria-hidden="true">
        <span className="pm-toggle__thumb">{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
      </span>
      <span className="pm-toggle__text">
        <span className="pm-toggle__label">{label}</span>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}
