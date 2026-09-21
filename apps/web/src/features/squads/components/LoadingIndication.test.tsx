/**
 * Unit tests for the loading indication.
 *
 * Requirements 1.10, 1.15, 5.12, and 6.9 all ask for a loading indication with a
 * *programmatically determinable* busy state, so that is what is asserted here:
 * `aria-busy` on the region, a `role="status"` live region so the statement is
 * announced without keyboard focus moving (Requirement 17.3), and no error
 * indication of any kind — a wait is not a failure.
 *
 * The per-screen guarantees that sit either side of this component (the indication
 * appearing while nothing is held, and the empty state and the generic failure
 * staying absent while it does) belong to the screens and their state machines,
 * not here.
 *
 * Feature: web-squads-screens
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  LOADING_INDICATION_SELECTOR,
  LoadingIndication,
} from './LoadingIndication';
import { GENERIC_SQUADS_FAILURE } from '../lib/messages';

/** A surface-supplied label, standing in for whichever screen is waiting. */
const LABEL = 'Loading your squads';

describe('LoadingIndication busy state (Reqs 1.10, 1.15, 5.12, 6.9)', () => {
  it('marks the region busy, so the wait is determinable by a program', () => {
    render(<LoadingIndication label={LABEL} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('states in text what is being awaited', () => {
    render(<LoadingIndication label={LABEL} />);

    expect(screen.getByRole('status')).toHaveTextContent(LABEL);
  });

  it('carries its own marker attribute, so a screen test never confuses it with a message region', () => {
    const { container } = render(<LoadingIndication label={LABEL} />);

    const indication = container.querySelector(LOADING_INDICATION_SELECTOR);

    expect(indication).not.toBeNull();
    expect(indication).toHaveTextContent(LABEL);
  });

  it('accepts an id, so a control can reference it', () => {
    render(<LoadingIndication label={LABEL} id="squads-home-loading" />);

    expect(screen.getByRole('status')).toHaveAttribute('id', 'squads-home-loading');
  });
});

describe('LoadingIndication is announced without moving focus (Req 17.3)', () => {
  it('exposes a polite live region', () => {
    render(<LoadingIndication label={LABEL} />);

    const region = screen.getByRole('status');

    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('leaves keyboard focus where it was', () => {
    render(<LoadingIndication label={LABEL} />);

    expect(document.activeElement).toBe(document.body);
  });
});

describe('LoadingIndication is a wait, not a failure (Req 17.1)', () => {
  it('renders no error indication and no control', () => {
    render(<LoadingIndication label={LABEL} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(GENERIC_SQUADS_FAILURE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders exactly the supplied label and nothing else', () => {
    const { container } = render(<LoadingIndication label={LABEL} />);

    expect(container.querySelector(LOADING_INDICATION_SELECTOR)?.textContent).toBe(
      LABEL,
    );
  });
});
