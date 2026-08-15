/**
 * Unit tests for the shared AuthLayout shell.
 *
 * These confirm the single-`h1` heading contract (Requirement 14.1) and that
 * the heading is programmatically associated with its region.
 *
 * Feature: web-auth-screens
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthLayout } from './AuthLayout'

describe('AuthLayout', () => {
  // Validates: Requirements 14.1 — exactly one level-one heading.
  it('renders exactly one h1 carrying the screen heading', () => {
    render(
      <AuthLayout heading="Log in">
        <p>content</p>
      </AuthLayout>,
    )

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Log in')
  })

  it('associates the region with its heading via aria-labelledby', () => {
    render(
      <AuthLayout heading="Create your account">
        <p>content</p>
      </AuthLayout>,
    )

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Create your account',
    })
    const region = screen.getByRole('region', {
      name: 'Create your account',
    })
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id)
  })

  it('renders its children inside the shell', () => {
    render(
      <AuthLayout heading="Reset password">
        <button type="submit">Send reset link</button>
      </AuthLayout>,
    )

    expect(
      screen.getByRole('button', { name: 'Send reset link' }),
    ).toBeInTheDocument()
  })
})
