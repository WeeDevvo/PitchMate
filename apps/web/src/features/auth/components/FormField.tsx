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
import type { InputHTMLAttributes, Ref } from 'react'
import { TextField } from '../../../ui'

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
  /** A standing hint under the field, such as the password rule. */
  hint?: string
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
  const hasError = typeof error === 'string' && error.trim().length > 0

  // The design system's field owns the label, the error and their association;
  // this keeps only the auth contract on top (a whitespace-only message is no
  // error).
  return (
    <TextField
      {...inputProps}
      ref={inputRef}
      className={className}
      label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      error={hasError ? error : null}
    />
  )
}

export default FormField
