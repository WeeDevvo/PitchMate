/**
 * Unit tests for the typed EmailField wrapper.
 *
 * These confirm the typed wrapper inherits the shared labelling and
 * error-association contract (Requirements 14.2, 14.6) and fixes the email
 * input type/hints.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailField } from './EmailField'

describe('EmailField', () => {
  // Validates: Requirements 14.2
  it('exposes an email input by its default accessible label', () => {
    render(<EmailField value="" onValueChange={() => {}} />)

    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('inputmode', 'email')
    expect(input).toHaveAttribute('autocomplete', 'email')
  })

  it('honours a custom label', () => {
    render(
      <EmailField label="Work email" value="" onValueChange={() => {}} />,
    )

    expect(screen.getByLabelText('Work email')).toBeInTheDocument()
  })

  // Validates: Requirements 14.6
  it('associates an error with the input via aria-invalid and aria-describedby', () => {
    render(
      <EmailField
        value="bad"
        onValueChange={() => {}}
        error="Enter a valid email address"
      />,
    )

    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const error = screen.getByText('Enter a valid email address')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
  })
})
