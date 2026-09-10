/**
 * Unit tests for the Shell_Frame's layout behaviour — the Compact_Layout, the
 * Wide_Layout, and the crossing between them.
 *
 * These run the real composition rather than a component in isolation:
 * `ShellFrame` → `ShellHeader` (which owns the disclosure group and keys it on
 * the layout) → `PrimaryNavigation` (which collapses the destination list at
 * compact widths), with the destinations as child routes so the Content_Region's
 * content is genuinely mounted by the router. The layout facts under test are
 * *distributed* across those three components — the hook reports the width, the
 * header decides what survives a crossing, the navigation decides what a
 * collapsed list looks like — so asserting them anywhere narrower would pin the
 * seams and not the behaviour.
 *
 * What is pinned here:
 *
 *   - the layout each of the five widths Requirement 1.8 names calls for, and the
 *     inclusive boundary at 768 (Requirements 1.6, 1.7);
 *   - the Compact_Layout's collapsed-on-first-render list behind a disclosure
 *     control that reports its state programmatically (Requirement 1.6), and the
 *     reversal plus keyboard reachability on activation (Requirement 1.11);
 *   - the Wide_Layout rendering no disclosure control at all (Requirement 1.7);
 *   - collapse with focus returned to the disclosure control, both on activating
 *     a destination control and on Escape (Requirement 1.12);
 *   - a breakpoint crossing rendering the other layout, keeping the active
 *     Destination_Content mounted, and discarding any previously expanded
 *     disclosure state (Requirement 1.13);
 *   - the Skip_Link's position in the Tab order, at both layouts
 *     (Requirement 13.11).
 *
 * ### What jsdom cannot answer, and where it is answered instead
 *
 * jsdom computes no layout: every box is zero-sized, no media query is evaluated,
 * and no stylesheet cascade is applied to a computed style. So three acceptance
 * criteria cannot be verified by rendering at all:
 *
 *   - **1.8** — no rendered width exceeding the viewport and no horizontal
 *     scrolling, at 360, 767, 768, 1024, and 1920 pixels;
 *   - **13.11** — the focused Skip_Link's label and focus indicator wholly inside
 *     the viewport bounds;
 *   - **13.13** — 44×44 pixel pointer targets with 8 pixels between adjacent
 *     targets in the Compact_Layout.
 *
 * Those three are asserted from the **declared styles** in
 * `styles/shell.declaredStyles.test.ts`, which reads `styles/shell.css` as source
 * text. That test and this one together are the automated floor;
 * **all three criteria still need manual verification in a browser** at the named
 * widths, because a declared rule that is correct can still be overridden,
 * mis-scoped, or defeated by content the shell does not control. The behavioural
 * halves that *are* checkable — which layout each width renders, and the
 * Skip_Link's Tab position — live here.
 *
 * The width itself comes from the shared `matchMedia` harness in
 * `state/viewportLayoutTestHarness.ts`, installed before each render because
 * `useViewportLayout` reads the width on its first render.
 *
 * Feature: app-shell
 * Requirements: 1.6, 1.7, 1.8, 1.11, 1.12, 1.13, 13.11, 13.13
 */
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ShellFrame } from './ShellFrame';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { SKIP_LINK_LABEL } from './components/SkipLink';
import { BRAND_NAME } from './components/BrandControl';
import { HOME_ROUTE, SHELL_DESTINATIONS } from './lib/destinations';
import { PRIMARY_NAVIGATION_TOGGLE } from './lib/messages';
import { WIDE_LAYOUT_MIN_WIDTH_PX } from './state/useViewportLayout';
import {
  installViewport,
  restoreViewport,
  type ViewportStub,
} from './state/viewportLayoutTestHarness';

/**
 * The five widths Requirement 1.8 names for verification, which are also the
 * widths Requirements 1.6 and 1.7 divide at 768.
 */
const VERIFIED_WIDTHS = [360, 767, 768, 1024, 1920] as const;

/** The layout a width calls for, derived from the one declared boundary. */
function expectedLayout(width: number): 'compact' | 'wide' {
  return width >= WIDE_LAYOUT_MIN_WIDTH_PX ? 'wide' : 'compact';
}

const COMPACT_WIDTHS = VERIFIED_WIDTHS.filter((width) => expectedLayout(width) === 'compact');
const WIDE_WIDTHS = VERIFIED_WIDTHS.filter((width) => expectedLayout(width) === 'wide');

/** A Destination_Content: its own level-one heading plus one focusable control. */
function DestinationContent({ name }: { readonly name: string }): ReactElement {
  return (
    <>
      <h1>{name}</h1>
      <button type="button">Inside {name}</button>
    </>
  );
}

/**
 * Render the frame as the `/app` layout route with the four registered
 * destinations as child routes — the composition the route table assembles — so a
 * navigation swaps only the outlet and a re-render keeps the same DOM nodes.
 */
function renderShell(path: string = HOME_ROUTE): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={HOME_ROUTE}
          element={<ShellFrame navigation={(slot) => <PrimaryNavigation {...slot} />} />}
        >
          <Route index element={<DestinationContent name="Squads" />} />
          <Route path="notifications" element={<DestinationContent name="Notifications" />} />
          <Route path="settings" element={<DestinationContent name="Settings" />} />
          <Route path="profile" element={<DestinationContent name="Profile" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** Install a width and render the frame at it. */
function renderShellAt(width: number, path: string = HOME_ROUTE): ViewportStub {
  const viewport = installViewport(width);
  renderShell(path);
  return viewport;
}

/** The Primary_Navigation disclosure control, or `null` where none is rendered. */
function queryToggle(): HTMLElement | null {
  return screen.queryByRole('button', { name: PRIMARY_NAVIGATION_TOGGLE });
}

/** The Primary_Navigation disclosure control, required to exist. */
function toggle(): HTMLElement {
  return screen.getByRole('button', { name: PRIMARY_NAVIGATION_TOGGLE });
}

/** Every rendered destination control, in document order. */
function destinationControls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('a[data-destination]'));
}

/** The layout the Shell_Header reports it rendered. */
function reportedLayout(): string | null {
  return screen.getByRole('banner').getAttribute('data-layout');
}

/** The level-one heading node of the active Destination_Content. */
function contentHeading(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

afterEach(() => {
  restoreViewport();
});

describe('Shell_Frame layout at each verified viewport width', () => {
  // Requirements 1.6, 1.7 — the boundary is inclusive on the wide side, so 767 is
  // compact and 768 is already wide.
  it.each(VERIFIED_WIDTHS)('renders the %ipx layout the width calls for', (width) => {
    renderShellAt(width);

    expect(reportedLayout()).toBe(expectedLayout(width));
  });

  // Requirement 1.7 — the Wide_Layout offers exactly one route to each
  // Destination, so no disclosure control exists to offer a second.
  it.each(WIDE_WIDTHS)('renders no disclosure control at %ipx', (width) => {
    renderShellAt(width);

    expect(queryToggle()).toBeNull();
    expect(destinationControls()).toHaveLength(SHELL_DESTINATIONS.length);
  });

  // Requirement 1.6 — below the boundary the list is behind a disclosure control.
  it.each(COMPACT_WIDTHS)('renders the disclosure control at %ipx', (width) => {
    renderShellAt(width);

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(destinationControls()).toHaveLength(0);
  });
});

describe('Shell_Frame Compact_Layout', () => {
  // Requirement 1.6 — collapsed on first render of a shell route, behind a control
  // reporting the state programmatically and naming the surface it controls.
  it('renders the navigation collapsed on first render, reporting its state', () => {
    renderShellAt(360);

    const control = toggle();
    expect(control).toHaveAttribute('aria-expanded', 'false');
    const surfaceId = control.getAttribute('aria-controls');
    expect(surfaceId).not.toBeNull();
    // Collapsed means unmounted, not hidden: nothing is left in the focus order.
    expect(document.getElementById(surfaceId ?? '')).toBeNull();
    expect(destinationControls()).toHaveLength(0);
  });

  // Requirement 1.6 — the navigation landmark is still the frame's one landmark
  // while the list inside it is collapsed.
  it('keeps the one navigation landmark while the list is collapsed', () => {
    renderShellAt(360);

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation')).toContainElement(toggle());
  });

  // Requirement 1.11 — activation reverses the reported state.
  it('reverses the reported state on each activation', async () => {
    const user = userEvent.setup();
    renderShellAt(360);

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(destinationControls()).toHaveLength(0);
  });

  // Requirement 1.11 — while expanded, every Primary_Navigation control is
  // reachable and operable by keyboard. Reachability is asserted by walking the
  // Tab order from the disclosure control, which is where focus sits after the
  // activation that expanded it.
  it('renders every destination control keyboard-reachable while expanded', async () => {
    const user = userEvent.setup();
    renderShellAt(360);

    await user.click(toggle());

    const controls = destinationControls();
    expect(controls).toHaveLength(SHELL_DESTINATIONS.length);
    expect(controls.map((control) => control.textContent)).toEqual(
      SHELL_DESTINATIONS.map((destination) => destination.label),
    );

    const reached: (Element | null)[] = [];
    for (let step = 0; step < controls.length; step += 1) {
      await user.tab();
      reached.push(document.activeElement);
    }
    expect(reached).toEqual(controls);
  });

  // Requirement 1.11 — operable by keyboard alone, not only by pointer.
  it('expands from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderShellAt(360);

    toggle().focus();
    await user.keyboard('{Enter}');

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(destinationControls()).toHaveLength(SHELL_DESTINATIONS.length);
  });
});

describe('Shell_Frame Wide_Layout', () => {
  // Requirement 1.7 — every control directly reachable, and no disclosure control.
  it('renders every destination control directly, with no disclosure control', async () => {
    const user = userEvent.setup();
    renderShellAt(1024);

    const controls = destinationControls();
    expect(queryToggle()).toBeNull();
    expect(controls.map((control) => control.textContent)).toEqual(
      SHELL_DESTINATIONS.map((destination) => destination.label),
    );

    // Directly reachable: the Tab order runs skip link → brand → destinations,
    // with nothing to expand in between.
    await user.tab();
    expect(screen.getByRole('link', { name: SKIP_LINK_LABEL })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: BRAND_NAME })).toHaveFocus();
    for (const control of controls) {
      await user.tab();
      expect(control).toHaveFocus();
    }
  });
});

describe('Shell_Frame Compact_Layout collapse', () => {
  /*
   * Requirement 1.12 — activating a destination control collapses the list and
   * returns keyboard focus to the disclosure control.
   *
   * In the *composed* frame that return is immediately superseded by Requirement
   * 13.12: the navigation that follows the activation changes the Content_Region,
   * and the arriving content's level-one heading is then focused and announced. So
   * what the frame guarantees here is the collapse plus a focus position that is
   * never the unmounted control and never `<body>` — it is the new screen's
   * heading. `PrimaryNavigation`'s own suite pins the intermediate return to the
   * disclosure control, which is where that half of 1.12 is observable on its own.
   */
  it('collapses on activating a destination control and lands focus on the new content', async () => {
    const user = userEvent.setup();
    renderShellAt(360);
    await user.click(toggle());

    await user.click(screen.getByRole('link', { name: 'Settings' }));

    expect(contentHeading()).toHaveAccessibleName('Settings');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(destinationControls()).toHaveLength(0);
    // 13.12 takes over from 1.12's focus return: the arriving heading, not the
    // document body and not the link that unmounted with the surface.
    expect(contentHeading()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  // Requirement 1.12 — Escape with keyboard focus inside the Primary_Navigation
  // collapses it and returns focus to the disclosure control.
  it('collapses and returns focus on Escape from inside the navigation', async () => {
    const user = userEvent.setup();
    renderShellAt(360);
    await user.click(toggle());
    await user.tab();
    expect(destinationControls()[0]).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(destinationControls()).toHaveLength(0);
    expect(toggle()).toHaveFocus();
  });

  // Requirement 1.12 — the disclosure control is itself inside the
  // Primary_Navigation, so Escape while it holds focus collapses the list too.
  it('collapses on Escape while the disclosure control holds focus', async () => {
    const user = userEvent.setup();
    renderShellAt(360);
    await user.click(toggle());

    await user.keyboard('{Escape}');

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveFocus();
  });

  // Requirement 1.12 — collapsing does not disturb the Content_Region: the
  // navigation that follows an activation replaces the content, an Escape does
  // not.
  it('leaves the active content in place when Escape collapses the list', async () => {
    const user = userEvent.setup();
    renderShellAt(360);
    const heading = contentHeading();
    await user.click(toggle());

    await user.keyboard('{Escape}');

    expect(contentHeading()).toBe(heading);
  });
});

describe('Shell_Frame breakpoint crossing', () => {
  // Requirement 1.13 — widening past the boundary renders the Wide_Layout, keeps
  // the active Destination_Content mounted, and discards the expansion. Node
  // identity is the assertion for "kept mounted" and for "no full-document
  // reload": a reload or a remount could not preserve it.
  it('renders the Wide_Layout on widening, keeping content and discarding the expansion', async () => {
    const user = userEvent.setup();
    const viewport = renderShellAt(360);
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const heading = contentHeading();
    const banner = screen.getByRole('banner');
    const main = screen.getByRole('main');

    act(() => {
      viewport.setWidth(WIDE_LAYOUT_MIN_WIDTH_PX);
    });

    expect(reportedLayout()).toBe('wide');
    // The expansion is gone with the control that reported it (Requirement 1.7).
    expect(queryToggle()).toBeNull();
    expect(destinationControls()).toHaveLength(SHELL_DESTINATIONS.length);
    // Still the same mounted content, in the same banner and the same main.
    expect(contentHeading()).toBe(heading);
    expect(screen.getByRole('banner')).toBe(banner);
    expect(screen.getByRole('main')).toBe(main);
  });

  // Requirement 1.13 — narrowing below the boundary renders the Compact_Layout
  // with the navigation collapsed, and keeps the content mounted.
  it('renders the Compact_Layout on narrowing, keeping the content mounted', () => {
    const viewport = renderShellAt(1024);
    const heading = contentHeading();
    const main = screen.getByRole('main');

    act(() => {
      viewport.setWidth(767);
    });

    expect(reportedLayout()).toBe('compact');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(destinationControls()).toHaveLength(0);
    expect(contentHeading()).toBe(heading);
    expect(screen.getByRole('main')).toBe(main);
  });

  // Requirement 1.13 — "any previously expanded disclosure state discarded"
  // survives a round trip: the expansion does not come back with the layout that
  // held it.
  it('discards an expansion across a crossing and back', async () => {
    const user = userEvent.setup();
    const viewport = renderShellAt(360);
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      viewport.setWidth(1024);
    });
    act(() => {
      viewport.setWidth(360);
    });

    expect(reportedLayout()).toBe('compact');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(destinationControls()).toHaveLength(0);
  });

  // Requirement 1.13 — a crossing is not a navigation, so the Content_Region's
  // content is unchanged and nothing is re-announced.
  it('announces nothing on a crossing, because the content did not change', () => {
    const viewport = renderShellAt(360);
    const contentKeyBefore = screen.getByRole('main').getAttribute('data-content-key');

    act(() => {
      viewport.setWidth(1024);
    });

    expect(screen.getByRole('main').getAttribute('data-content-key')).toBe(contentKeyBefore);
    expect(screen.queryByRole('status')).toBeEmptyDOMElement();
  });

  // Requirement 1.13 — a width change that stays on one side of the boundary is
  // not a layout change, so an expansion survives it.
  it('keeps an expansion across a width change within one layout band', async () => {
    const user = userEvent.setup();
    const viewport = renderShellAt(360);
    await user.click(toggle());

    act(() => {
      viewport.setWidth(767);
    });

    expect(reportedLayout()).toBe('compact');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Shell_Frame Skip_Link Tab position', () => {
  /*
   * Requirement 13.11's second half: while it holds no keyboard focus the
   * Skip_Link has no visible presentation, yet it is still the control the first
   * Tab reaches. The "no visible presentation" half is a declared style, asserted
   * in `styles/shell.declaredStyles.test.ts` and needing manual browser
   * verification; the Tab position is behavioural and asserted here, at both
   * layouts, because the Compact_Layout inserts a disclosure control into the
   * header and must not insert it ahead of the Skip_Link.
   */
  it.each(VERIFIED_WIDTHS)('is the first Tab stop at %ipx', async (width) => {
    const user = userEvent.setup();
    renderShellAt(width);

    await user.tab();

    const link = screen.getByRole('link', { name: SKIP_LINK_LABEL });
    expect(link).toHaveFocus();
    expect(
      link.compareDocumentPosition(screen.getByRole('banner')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
