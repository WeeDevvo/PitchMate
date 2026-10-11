/**
 * Unit tests for the focus seam.
 *
 * Requirement 16.5 asks that a change of rendered condition between loading,
 * loaded, not-found, and failed leave a keyboard user's position within the main
 * content region. The seam has four behaviours, and three of them are about
 * *not* acting — so each is pinned here rather than left to the screen-level
 * property to discover:
 *
 * | Situation at the moment the condition changes | What the seam does |
 * | --- | --- |
 * | focus was on a control in the body that has gone | moves focus to the region |
 * | focus is still on a control inside the region | leaves it there |
 * | focus is on a connected control outside the region | leaves it there |
 * | first render, nothing changed yet | leaves focus wherever it was |
 *
 * The last two are the ones worth testing deliberately. Pulling focus out of the
 * shell frame because a response arrived, or taking focus on mount from the
 * Player_Row that opened the screen, would both be focus *theft* dressed as
 * repair, and neither is something the requirement asks for.
 *
 * Feature: web-player-stats-screen
 */
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  MAIN_CONTENT_SELECTOR,
  useConditionFocus,
  type ScreenCondition,
} from './surfaceFocus';

/** A control outside the region, standing in for the App_Shell frame's own. */
const OUTSIDE_LABEL = 'Shell frame control stand-in';

/**
 * A screen stand-in: one control outside the region, and inside it a body whose
 * single control is keyed on the condition, so a change of condition unmounts
 * the control that held focus exactly as the real bodies do.
 */
function Harness({ condition }: { readonly condition: ScreenCondition }): ReactElement {
  const { ref, regionProps } = useConditionFocus(condition);

  return (
    <>
      <button type="button">{OUTSIDE_LABEL}</button>
      <div ref={ref} {...regionProps}>
        <button key={condition} type="button">
          {`Body control: ${condition}`}
        </button>
      </div>
    </>
  );
}

/** The label of the body control for a condition. */
function bodyLabel(condition: ScreenCondition): string {
  return `Body control: ${condition}`;
}

/** The main content region of the rendered harness. */
function region(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR);
  if (found === null) {
    throw new Error('the harness rendered no main content region');
  }
  return found;
}

describe('useConditionFocus region attributes (Req 16.5)', () => {
  it('hands back a region that is focusable but never a tab stop', () => {
    const { container } = render(<Harness condition="loading" />);

    expect(region(container)).toHaveAttribute('tabindex', '-1');
  });

  it('hands back stable attributes across a re-render', () => {
    const { container, rerender } = render(<Harness condition="loading" />);

    const before = region(container);

    rerender(<Harness condition="loading" />);

    expect(region(container)).toBe(before);
  });

  it('keeps the region out of the keyboard order, so Tab reaches controls only', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness condition="loaded" />);

    await user.tab();
    expect(screen.getByRole('button', { name: OUTSIDE_LABEL })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: bodyLabel('loaded') })).toHaveFocus();

    expect(region(container)).not.toHaveFocus();
  });
});

describe('useConditionFocus on first render (Req 16.5)', () => {
  it('takes no focus, so nothing is stolen from whatever opened the screen', () => {
    render(<Harness condition="loading" />);

    expect(document.activeElement).toBe(document.body);
  });

  it('takes no focus from a control that already had it', async () => {
    const user = userEvent.setup();

    function Mounting(): ReactElement {
      const [mounted, setMounted] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setMounted(true)}>
            Open the screen
          </button>
          {mounted ? <Harness condition="loading" /> : null}
        </>
      );
    }

    render(<Mounting />);

    const opener = screen.getByRole('button', { name: 'Open the screen' });
    await user.click(opener);

    expect(opener).toHaveFocus();
  });
});

describe('useConditionFocus when the focused control has gone (Req 16.5)', () => {
  it('moves focus to the region, so the next Tab continues inside the screen', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<Harness condition="failed" />);

    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: bodyLabel('failed') })).toHaveFocus();

    rerender(<Harness condition="loading" />);

    expect(region(container)).toHaveFocus();
  });

  it('moves focus to the region when focus had already fallen to the document body', () => {
    const { container, rerender } = render(<Harness condition="loading" />);

    expect(document.activeElement).toBe(document.body);

    rerender(<Harness condition="loaded" />);

    expect(region(container)).toHaveFocus();
  });

  it('repairs focus for every change of condition, not only the first', () => {
    const { container, rerender } = render(<Harness condition="loading" />);

    rerender(<Harness condition="loaded" />);
    expect(region(container)).toHaveFocus();

    rerender(<Harness condition="failed" />);
    expect(region(container)).toHaveFocus();

    rerender(<Harness condition="not-found" />);
    expect(region(container)).toHaveFocus();
  });
});

describe('useConditionFocus when focus is already placed (Req 16.5)', () => {
  it('leaves focus on a control inside the region that survived the change', async () => {
    const user = userEvent.setup();

    /** A body control that is *not* keyed on the condition, so it survives. */
    function SurvivingHarness({
      condition,
    }: {
      readonly condition: ScreenCondition;
    }): ReactElement {
      const { ref, regionProps } = useConditionFocus(condition);

      return (
        <div ref={ref} {...regionProps}>
          <button type="button">Surviving control</button>
        </div>
      );
    }

    const { rerender } = render(<SurvivingHarness condition="loading" />);

    await user.tab();
    const surviving = screen.getByRole('button', { name: 'Surviving control' });
    expect(surviving).toHaveFocus();

    rerender(<SurvivingHarness condition="loaded" />);

    expect(surviving).toHaveFocus();
  });

  it('leaves focus on a connected control outside the region', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<Harness condition="loading" />);

    await user.tab();
    const outside = screen.getByRole('button', { name: OUTSIDE_LABEL });
    expect(outside).toHaveFocus();

    rerender(<Harness condition="failed" />);

    expect(outside).toHaveFocus();
    expect(region(container)).not.toHaveFocus();
  });
});

describe('useConditionFocus when nothing changed (Req 16.5)', () => {
  it('moves no focus on a re-render with the same condition', () => {
    const { container, rerender } = render(<Harness condition="loaded" />);

    rerender(<Harness condition="loaded" />);
    rerender(<Harness condition="loaded" />);

    expect(document.activeElement).toBe(document.body);
    expect(region(container)).not.toHaveFocus();
  });
});
