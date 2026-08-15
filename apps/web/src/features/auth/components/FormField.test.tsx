/**
 * Unit tests for the shared FormField primitive.
 *
 * These cover the labelling and error-association contract every auth input
 * relies on:
 *   - the input is retrievable by its accessible label (Requirement 14.2),
 *   - a real `<label>` is programmatically linked to the control,
 *   - when an error is supplied the control gets `aria-invalid` and is
 *     programmatically associated with the visible error text via
 *     `aria-describedby` (Requirement 14.6).
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormField } from './FormField'

describe('FormField labelling and error association', () => {
  // Validates: Requirements 14.2
  it('exposes the input by its accessible label via a real linked <label>', () => {
    render(
      <FormField label="Email address" value="" onValueChange={() => {}} />,
    )

    const input = screen.getByLabelText('Email address')
    expect(input.tagName).toBe('INPUT')

    // The label is a real element linked by htmlFor/id.
    const label = screen.getByText('Email address')
    expect(label.tagName).toBe('LABEL')
    expect(label).toHaveAttribute('for', input.id)
    expect(input.id).toBeTruthy()
  })

  // Validates: Requirements 14.2 — the label is persistent text, not a placeholder.
  it('renders the label as persistently visible text (not placeholder-only)', () => {
    render(<FormField label="Password" value="" onValueChange={() => {}} />)

    expect(screen.getByText('Password')).toBeVisible()
  })

  // Validates: Requirements 14.6
  it('marks the control invalid and associates it with the visible error text when an error is supplied', () => {
    render(
      <FormField
        label="Email address"
        value="nope"
        onValueChange={() => {}}
        error="Enter a valid email address"
      />,
    )

    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')

    // The error text is visible on screen.
    const error = screen.getByText('Enter a valid email address')
    expect(error).toBeVisible()

    // ...and programmatically associated with the control via aria-describedby.
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(describedBy).toBe(error.id)
  })

  // Validates: Requirements 14.6 — a valid field carries no error association.
  it('sets neither aria-invalid nor aria-describedby when there is no error', () => {
    render(
      <FormField
        label="Email address"
        value="a@b.com"
        onValueChange={() => {}}
        error={null}
      />,
    )

    const input = screen.getByLabelText('Email address')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  it('reports typed input back through onValueChange', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <FormField label="Email address" value="" onValueChange={onValueChange} />,
    )

    await user.type(screen.getByLabelText('Email address'), 'hi')

    expect(onValueChange).toHaveBeenCalled()
    // The controlled input forwards the raw string value on each keystroke.
    expect(onValueChange).toHaveBeenLastCalledWith('i')
  })
})
