/**
 * EmailField — the labelled Email_Address input used on the Sign_Up,
 * Log_In, and Reset_Request screens.
 *
 * A thin, typed wrapper over {@link FormField} that fixes the input to the
 * email type and sensible autofill/keyboard hints while inheriting the shared
 * labelling and error-association contract:
 *
 *   - a persistently visible, programmatically linked label (Requirement 14.2);
 *   - programmatic error association via `aria-invalid`/`aria-describedby`
 *     when an `error` is supplied (Requirement 14.6).
 *
 * It performs no validation itself — screens use `lib/emailValidation` and
 * pass the resulting message via `error`.
 *
 * Requirements: 14.2, 14.6
 */
import { FormField, type FormFieldProps } from './FormField'

export interface EmailFieldProps
  extends Omit<FormFieldProps, 'type' | 'inputMode' | 'label'> {
  /** The visible label text. Defaults to "Email address". */
  label?: string
}

/** A labelled email input with persistent label and error association. */
export function EmailField({
  label = 'Email address',
  autoComplete = 'email',
  ...rest
}: EmailFieldProps) {
  return (
    <FormField
      {...rest}
      label={label}
      type="email"
      inputMode="email"
      autoComplete={autoComplete}
    />
  )
}

export default EmailField
