/**
 * Unit tests for the loading indication.
 *
 * Requirements 2.2 and 2.3 both ask for a *programmatically determinable* busy
 * state, which is the whole of this component's job, so these tests assert the
 * three things that make the wait readable by a program rather than merely
 * visible: `aria-busy` on the element, a `role="status"` region around it, and a
 * statement whose words come from `lib/messages.ts`.
 *
 * The fourth assertion is the shape claim that keeps the one guaranteed-announced
 * string on the screen non-disclosing: the component's whole subtree is exactly
 * {@link PROFILE_LOADING_LABEL}, and there is no prop through which a caller
 * could add to it (Requirements 3.7, 4.2).
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  LOADING_INDICATION_SELECTOR,
  LoadingIndication,
} from './LoadingIndication';
import { PROFILE_LOADING_LABEL } from '../lib/messages';

describe('LoadingIndication busy state (Reqs 2.2, 2.3)', () => {
  it('marks the indication busy, so the wait is programmatically determinable', () => {
    const { container } = render(<LoadingIndication />);

    expect(container.querySelector(LOADING_INDICATION_SELECTOR)).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('renders the label as a visible statement', () => {
    render(<LoadingIndication />);

    expect(screen.getByText(PROFILE_LOADING_LABEL)).toBeVisible();
  });

  it('renders no spinner element and no animated node', () => {
    const { container } = render(<LoadingIndication />);

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[class*="spinner"]')).toBeNull();
  });
});

describe('LoadingIndication announcement', () => {
  it('places the statement in a polite, atomic live region', () => {
    render(<LoadingIndication />);

    const region = screen.getByRole('status');

    expect(region).toHaveTextContent(PROFILE_LOADING_LABEL);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('leaves keyboard focus where it was', () => {
    render(<LoadingIndication />);

    expect(document.activeElement).toBe(document.body);
  });
});

describe('LoadingIndication copy (Reqs 3.7, 4.2)', () => {
  it('renders exactly the fixed label, so no caller can add to the announced text', () => {
    const { container } = render(<LoadingIndication />);

    expect(container.querySelector(LOADING_INDICATION_SELECTOR)?.textContent).toBe(
      PROFILE_LOADING_LABEL,
    );
  });

  it('renders no control, so the loading state offers nothing to activate', () => {
    render(<LoadingIndication />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('LoadingIndication referencing id', () => {
  it('carries a supplied id, so a region can describe itself by the indication', () => {
    render(<LoadingIndication id="profile-busy" />);

    expect(screen.getByRole('status')).toHaveAttribute('id', 'profile-busy');
  });

  it('carries no id by default', () => {
    render(<LoadingIndication />);

    expect(screen.getByRole('status')).not.toHaveAttribute('id');
  });
});
