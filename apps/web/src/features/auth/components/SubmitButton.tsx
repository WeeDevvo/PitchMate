/**
 * SubmitButton — the shared form submit control for the auth screens.
 *
 * A single control governs the in-progress / disabled-while-pending contract
 * every auth form relies on to prevent a double submission:
 *
 *   - While `pending` is true (a submitted call is awaiting a backend
 *     response), the button is `disabled` so a second concurrent submission of
 *     the same form cannot be triggered, and it shows a visible in-progress
 *     label instead of the idle label (Requirements 14.3; and the per-screen
 *     double-submit guards 2.8, 3.8, 5.8, 6.9).
 *   - `aria-busy` reflects the pending state so assistive technology is aware a
 *     submission is in flight.
 *   - It is a native `<button type="submit">`, so it is keyboard-reachable and
 *     operable with a visible focus ring (Requirements 14.4, 14.5).
 *
 * Requirements: 14.3
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './SubmitButton.css'

export interface SubmitButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'type'> {
  /** The idle label shown when no submission is in progress. */
  children: ReactNode
  /**
   * True while a submitted call is awaiting a backend response. Disables the
   * control (preventing a double submit) and shows `pendingLabel`.
   */
  pending?: boolean
  /**
   * Additional reason to disable the control (e.g. a screen with no valid
   * token). Combined with `pending`.
   */
  disabled?: boolean
  /** The label shown while `pending`. Defaults to a generic in-progress label. */
  pendingLabel?: ReactNode
}

/**
 * A submit button that disables itself and shows an in-progress label while a
 * submission is pending, preventing a second concurrent submit.
 */
export function SubmitButton({
  children,
  pending = false,
  disabled = false,
  pendingLabel = 'Working…',
  className,
  ...buttonProps
}: SubmitButtonProps) {
  const classes = ['auth-submit', className].filter(Boolean).join(' ')

  return (
    <button
      {...buttonProps}
      type="submit"
      className={classes}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}

export default SubmitButton
