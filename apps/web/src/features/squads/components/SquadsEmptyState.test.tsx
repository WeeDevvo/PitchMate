/**
 * Worked examples for the Squads_Empty_State (task 10.1).
 *
 * The component takes no props, so there is nothing to quantify over: what is
 * worth pinning is the exact copy Requirement 2.4 fixes, and that an empty
 * listing is presented as an absence rather than as a failure (Requirement 2.1).
 *
 * Requirements: 2.1, 2.4
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SQUADS_EMPTY_STATE_SELECTOR, SquadsEmptyState } from './SquadsEmptyState';
import {
  GENERIC_SQUADS_FAILURE,
  SQUADS_EMPTY_STATE_NEXT_STEP,
  SQUADS_EMPTY_STATE_NO_SQUADS,
} from '../lib/messages';

describe('SquadsEmptyState', () => {
  // Requirements: 2.4
  it('states that the person belongs to no squad yet and how to get one', () => {
    render(<SquadsEmptyState />);

    expect(screen.getByText(SQUADS_EMPTY_STATE_NO_SQUADS)).toBeInTheDocument();
    expect(screen.getByText(SQUADS_EMPTY_STATE_NEXT_STEP)).toBeInTheDocument();
  });

  // Requirements: 2.1
  it('renders no error indication of any kind', () => {
    const { container } = render(<SquadsEmptyState />);

    expect(container.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).not.toBeNull();
    expect(screen.queryByText(GENERIC_SQUADS_FAILURE)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[aria-invalid]')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  // Requirements: 2.2, 2.3
  it('renders no control of its own, because both entry points are the screen\u2019s', () => {
    render(<SquadsEmptyState />);

    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});
