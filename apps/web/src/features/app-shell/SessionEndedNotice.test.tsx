/**
 * Unit tests for the session-ended notice.
 *
 * Requirement 9.7 governs what the Content_Region shows while a session expiry
 * handover is in progress: exactly one level-one heading, a neutral statement
 * that the session has ended and that sign-in is being reached, no error
 * indication, and none of the content or values the previous screen displayed.
 *
 * The last of those is asserted as a shape claim rather than a data claim — the
 * component takes no props, so the rendered text is exactly the two fixed strings
 * and nothing else can reach it. The test pins that by asserting the notice's
 * whole subtree carries only those two strings.
 *
 * Property 28 (task 8.7) covers the handover in the state machine; this file
 * covers only the content the handover swaps in.
 *
 * Feature: app-shell
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SessionEndedNotice } from './SessionEndedNotice';
import { SESSION_ENDED_BODY, SESSION_ENDED_HEADING } from './lib/messages';

describe('SessionEndedNotice heading and wording (Req 9.7)', () => {
  it('renders exactly one level-one heading', () => {
    render(<SessionEndedNotice />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('states that the session has ended and that sign-in is being reached', () => {
    render(<SessionEndedNotice />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      SESSION_ENDED_HEADING,
    );
    expect(screen.getByText(SESSION_ENDED_BODY)).toBeVisible();
  });
});

describe('SessionEndedNotice carries nothing of the previous screen (Req 9.7)', () => {
  it('renders only its two fixed strings', () => {
    const { container } = render(<SessionEndedNotice />);

    const notice = container.querySelector('.shell-boundary');

    expect(notice).not.toBeNull();
    expect(notice?.textContent).toBe(`${SESSION_ENDED_HEADING}${SESSION_ENDED_BODY}`);
  });

  it('presents no control of its own, so the Auth_Feature owns the navigation', () => {
    render(<SessionEndedNotice />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('SessionEndedNotice is a handover, not an error (Req 9.7)', () => {
  it('renders no alert, status, or live region', () => {
    const { container } = render(<SessionEndedNotice />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});
