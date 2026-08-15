/**
 * FormField — the shared labelled-input primitive behind EmailField and
 * PasswordField.
 *
 * A single code path governs the labelling and error-association contract that
 * every auth input must satisfy:
 *
 *   - The `<label>` is a real element, programmatically linked to the input via
 *     `htmlFor`/`id`, and rendered as **persistently visible** text above the
 *     control — never placeholder-only or visually hidden (Requirement 14.2).
 *   - When an `error` is supplied, the control is marked `aria-invalid="true"`
 *     and `aria-describedby` points at the error text node, so assistive
 *     technology conveys the problem through a programmatic association without
 *     focus having to move onto the message (Requirement 14.6).
 *   - The control is a native `<input>`, so it is keyboard-reachable and
 *     operable with a visible focus ring (Requirements 14.4, 14.5).
 *
 * It is presentational: it owns no validation. Screens compute validity with
 * the pure `lib/` validators and pass the resulting message in via `error`.
 *
 * Requirements: 14.2, 14.6
 */
import { useId, type InputHTMLAttributes, type Ref } from 'react'
import './FormField.css'

export interface FormFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'aria-invalid' | 'aria-describedby'
  > {
  /** The persistently visible, programmatically linked label text. */
  label: string
  /**
   * The current value (controlled). Screens own the value so they can retain
   * or preserve input across failures.
   */
  value: string
  /** Change handler receiving the raw string value. */
  onValueChange: (value: string) => void
  /**
   * The validation/error message to associate with the control, or `null`/
   * `undefined` when the field is valid. When present, drives `aria-invalid`
   * and `aria-describedby` (Requirement 14.6).
   */
  error?: string | null
  /** Optional ref to the underlying input (used for focus-on-error). */
  inputRef?: Ref<HTMLInputElement>
}

/**
 * A labelled text input with persistent label and programmatic error
 * association. The building block for the typed auth fields.
 */
export function FormField({
  label,
  value,
  onValueChange,
  error,
  inputRef,
  className,
  ...inputProps
}: FormFieldProps) {
  const inputId = useId()
  const errorId = useId()
  const hasError = typeof error === 'string' && error.trim().length > 0
  const classes = ['auth-field', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <label className="auth-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        ref={inputRef}
        id={inputId}
        className="auth-field__input"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
      />
      {hasError ? (
        <p id={errorId} className="auth-field__error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default FormField
