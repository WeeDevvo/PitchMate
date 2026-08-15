/**
 * PasswordField — the labelled password input used on the Sign_Up, Log_In,
 * and Reset_Confirm screens.
 *
 * A thin, typed wrapper over {@link FormField} that fixes the input to the
 * password type while inheriting the shared labelling and error-association
 * contract:
 *
 *   - a persistently visible, programmatically linked label (Requirement 14.2);
 *   - programmatic error association via `aria-invalid`/`aria-describedby`
 *     when an `error` is supplied (Requirement 14.6).
 *
 * It performs no validation itself — screens use `lib/passwordPolicy` and pass
 * the resulting message via `error`. The `autoComplete` hint defaults to
 * `current-password`; sign-up and reset-confirm screens override it to
 * `new-password`.
 *
 * Requirements: 14.2, 14.6
 */
import { FormField, type FormFieldProps } from './FormField'

export interface PasswordFieldProps
  extends Omit<FormFieldProps, 'type' | 'label'> {
  /** The visible label text. Defaults to "Password". */
  label?: string
}

/** A labelled password input with persistent label and error association. */
export function PasswordField({
  label = 'Password',
  autoComplete = 'current-password',
  ...rest
}: PasswordFieldProps) {
  return (
    <FormField
      {...rest}
      label={label}
      type="password"
      autoComplete={autoComplete}
    />
  )
}

export default PasswordField
