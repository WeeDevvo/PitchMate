/**
 * Unit tests for the typed PasswordField wrapper.
 *
 * These confirm the typed wrapper inherits the shared labelling and
 * error-association contract (Requirements 14.2, 14.6) and fixes the password
 * input type.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PasswordField } from './PasswordField'

describe('PasswordField', () => {
  // Validates: Requirements 14.2 — password inputs have no implicit ARIA role,
  // so retrieve by the associated label instead.
  it('exposes a password input by its default accessible label', () => {
    render(<PasswordField value="" onValueChange={() => {}} />)

    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'current-password')
  })

  it('allows overriding the autocomplete hint for new passwords', () => {
    render(
      <PasswordField
        value=""
        onValueChange={() => {}}
        autoComplete="new-password"
      />,
    )

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
  })

  // Validates: Requirements 14.6
  it('associates an error with the input via aria-invalid and aria-describedby', () => {
    render(
      <PasswordField
        value="short"
        onValueChange={() => {}}
        error="Password must be at least 12 characters"
      />,
    )

    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const error = screen.getByText('Password must be at least 12 characters')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
  })
})
