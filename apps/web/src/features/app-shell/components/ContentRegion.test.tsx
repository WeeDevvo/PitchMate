/**
 * Unit tests for the Content_Region.
 *
 * Two behaviours, both of them the frame's rather than the content's:
 *
 *   - the main landmark is programmatically focusable so the Skip_Link can move
 *     focus into it, without joining the Tab order (Requirement 13.1);
 *   - a *change* of the rendered content focuses that content's level-one heading
 *     and conveys its text through a live region, while a re-render of the same
 *     content does neither (Requirements 13.7, 13.12).
 *
 * The component takes no router and no context, so these render it directly.
 *
 * Feature: app-shell
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentRegion, SHELL_CONTENT_ID } from './ContentRegion';

describe('ContentRegion landmark', () => {
  // Requirements 1.5, 13.1 — one main landmark, focusable programmatically only.
  it('renders a main landmark carrying the skip target id and a negative tabindex', () => {
    render(<ContentRegion contentKey="destination:home">Body</ContentRegion>);

    const region = screen.getByRole('main');
    expect(region).toHaveAttribute('id', SHELL_CONTENT_ID);
    expect(region).toHaveAttribute('tabindex', '-1');
    expect(region).toHaveTextContent('Body');
  });

  // Requirement 13.7 — the announcement surface is present before there is
  // anything to announce, so a later message is reliably conveyed.
  it('renders an empty live region before any content change', () => {
    render(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
      </ContentRegion>,
    );

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('ContentRegion content changes', () => {
  // Arriving at a shell route is not an in-app navigation, so the first render
  // leaves focus where the document put it (Requirement 13.12).
  it('moves no focus on the first render', () => {
    render(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
      </ContentRegion>,
    );

    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  // Requirement 13.12 — the new content's `h1` is focused and announced.
  it('focuses and announces the level-one heading when the content changes', () => {
    const { rerender } = render(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
      </ContentRegion>,
    );

    rerender(
      <ContentRegion contentKey="destination:settings">
        <h1>Settings</h1>
      </ContentRegion>,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Settings' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Settings');
  });

  it('announces the boundary state heading when the content kind changes', () => {
    const { rerender } = render(
      <ContentRegion contentKey="destination:profile">
        <h1>Profile</h1>
      </ContentRegion>,
    );

    rerender(
      <ContentRegion contentKey="not-found">
        <h1>Page not found</h1>
      </ContentRegion>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Page not found');
  });

  // A re-render of the same screen is not a content change: focus must not be
  // yanked back to the heading while someone is using the screen.
  it('moves no focus when the same content re-renders', () => {
    const { rerender } = render(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
        <button type="button">Create squad</button>
      </ContentRegion>,
    );

    const control = screen.getByRole('button', { name: 'Create squad' });
    control.focus();

    rerender(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
        <button type="button">Create squad</button>
        <p>Two squads</p>
      </ContentRegion>,
    );

    expect(control).toHaveFocus();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  // Content without an `h1` is a defect in that content, not a reason for the
  // frame to throw or to announce the previous screen again.
  it('clears the announcement when changed content has no level-one heading', () => {
    const { rerender } = render(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
      </ContentRegion>,
    );

    rerender(
      <ContentRegion contentKey="destination:settings">
        <h1>Settings</h1>
      </ContentRegion>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Settings');

    rerender(
      <ContentRegion contentKey="destination:profile">
        <p>No heading here</p>
      </ContentRegion>,
    );

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('main')).toHaveTextContent('No heading here');
  });

  // The content may own its heading's focus behaviour; the frame does not
  // overwrite an existing tabindex.
  it('leaves an existing tabindex on the content heading alone', () => {
    const { rerender } = render(
      <ContentRegion contentKey="destination:home">
        <h1>Squads</h1>
      </ContentRegion>,
    );

    rerender(
      <ContentRegion contentKey="destination:settings">
        <h1 tabIndex={0}>Settings</h1>
      </ContentRegion>,
    );

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveAttribute('tabindex', '0');
    expect(heading).toHaveFocus();
  });
});
