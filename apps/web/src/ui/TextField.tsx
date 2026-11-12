import { useId, type InputHTMLAttributes, type Ref, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Field.css';

interface FieldMessagesProps {
  id: string;
  hint?: string;
  error?: string | null;
}

/** The hint, or the error in its place; an error says what to do next. */
function FieldMessage({ id, hint, error }: FieldMessagesProps) {
  if (error) {
    return (
      <div className="pm-field__error">
        <Icon name="alert" size={16} />
        {/* The id is on the words alone, so the field is described by the message
            and nothing else. */}
        <span id={id}>{error}</span>
      </div>
    );
  }
  return hint ? (
    <div id={id} className="pm-field__hint">
      {hint}
    </div>
  ) : null;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Always visible; a placeholder is an example, never the label. */
  label: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  loading?: boolean;
  /** The large join-code style. */
  code?: boolean;
  /** The input element, for moving focus to it (for example on an error). */
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  icon,
  loading,
  code,
  id,
  type = 'text',
  disabled,
  className,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const hasMessage = Boolean(error || hint);

  return (
    <div
      className={cx('pm-field', error && 'is-error', disabled && 'is-disabled', loading && 'is-loading', className)}
    >
      <label className="pm-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="pm-input-wrap">
        {icon && <Icon name={icon} size={20} />}
        <input
          {...rest}
          id={inputId}
          type={type}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          aria-busy={loading || undefined}
          className={cx('pm-input', icon && 'pm-input--icon', code && 'pm-input--code')}
        />
      </div>
      <FieldMessage id={messageId} hint={hint} error={error} />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: readonly (string | SelectOption)[];
  hint?: string;
  error?: string | null;
}

export function Select({ label, options, hint, error, id, disabled, className, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;

  return (
    <div className={cx('pm-field', error && 'is-error', disabled && 'is-disabled', className)}>
      <label className="pm-field__label" htmlFor={selectId}>
        {label}
      </label>
      <div className="pm-select-wrap">
        <select
          {...rest}
          id={selectId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className="pm-select"
        >
          {options.map((option) => {
            const { value, label: optionLabel } =
              typeof option === 'string' ? { value: option, label: option } : option;
            return (
              <option key={value} value={value}>
                {optionLabel}
              </option>
            );
          })}
        </select>
        <Icon name="chevronDown" size={18} />
      </div>
      <FieldMessage id={messageId} hint={hint} error={error} />
    </div>
  );
}
