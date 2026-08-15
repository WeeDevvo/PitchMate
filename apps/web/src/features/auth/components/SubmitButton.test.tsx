/**
 * Unit tests for the shared SubmitButton control.
 *
 * These cover the disabled-while-pending double-submit prevention contract
 * every auth form relies on:
 *   - while `pending`, the control is disabled and shows the in-progress label
 *     (Requirement 14.3; per-screen double-submit guards 2.8, 3.8),
 *   - a second activation while pending does NOT fire the click handler again,
 *   - `aria-busy` reflects the pending state.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubmitButton } from './SubmitButton'

describe('SubmitButton disabled-while-pending behaviour', () => {
  it('renders a native submit button with the idle label when not pending', () => {
    render(<SubmitButton>Create account</SubmitButton>)

    const button = screen.getByRole('button', { name: 'Create account' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy')
  })

  // Validates: Requirements 14.3, 2.8, 3.8
  it('disables the control and shows the in-progress label while pending', () => {
    render(
      <SubmitButton pending pendingLabel="Signing in…">
        Log in
      </SubmitButton>,
    )

    // The idle label is replaced by the in-progress indication.
    const button = screen.getByRole('button', { name: 'Signing in…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Log in')).not.toBeInTheDocument()
  })

  // Validates: Requirements 2.8, 3.8 — a second activation while pending is a no-op.
  it('does not fire onClick a second time while pending (double-submit prevention)', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    // A stateful harness: the first click flips the form into the pending
    // state, mirroring how a screen disables the button while its submit call
    // is in flight. Any further click must be ignored by the disabled control.
    function Harness() {
      return (
        <SubmitButton pending onClick={onClick}>
          Submit
        </SubmitButton>
      )
    }

    render(<Harness />)

    const button = screen.getByRole('button')
    await user.click(button)
    await user.click(button)

    // A disabled button swallows activation, so the handler never fires.
    expect(onClick).not.toHaveBeenCalled()
  })

  it('fires onClick when enabled but the disabled prop also blocks it', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    const { rerender } = render(
      <SubmitButton onClick={onClick}>Submit</SubmitButton>,
    )

    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)

    // The explicit `disabled` reason (e.g. missing token) also blocks clicks.
    rerender(
      <SubmitButton onClick={onClick} disabled>
        Submit
      </SubmitButton>,
    )
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
