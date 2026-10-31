/**
 * The Shell_Frame across viewport widths.
 *
 * The design system's top bar is the same at every width — the brand control,
 * then the bell and the account menu, with no row of destination links — so what
 * varies with the width is only the layout the header reports (`data-layout`,
 * which the stylesheet keys its target sizes on) and what a breakpoint crossing
 * does: it discards an open header surface, positioned for the old layout, while
 * the banner, the Content_Region and the active Destination_Content stay mounted.
 * Node identity is the assertion for "kept mounted" and for "no full-document
 * reload": a reload or a remount could not preserve it.
 *
 * The viewport is stubbed with `viewportLayoutTestHarness`, installed before the
 * render because `useViewportLayout` reads the width on its first render.
 *
 * Feature: app-shell
 */
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ShellFrame } from './ShellFrame';
import type { ShellHeaderSlotProps } from './components/ShellHeader';
import { BRAND_NAME } from './components/BrandControl';
import { HOME_ROUTE } from './lib/destinations';
import { WIDE_LAYOUT_MIN_WIDTH_PX } from './state/useViewportLayout';
import {
  installViewport,
  restoreViewport,
  type ViewportStub,
} from './state/viewportLayoutTestHarness';

/** The five widths Requirement 1.8 names for verification. */
const VERIFIED_WIDTHS = [360, 767, 768, 1024, 1920] as const;

/** The layout a width calls for, derived from the one declared boundary. */
function expectedLayout(width: number): 'compact' | 'wide' {
  return width >= WIDE_LAYOUT_MIN_WIDTH_PX ? 'wide' : 'compact';
}

/** A Destination_Content: its own level-one heading plus one focusable control. */
function DestinationContent({ name }: { readonly name: string }): ReactElement {
  return (
    <>
      <h1>{name}</h1>
      <button type="button">Inside {name}</button>
    </>
  );
}

/** A header surface trigger standing in for the Account_Menu: it reports the disclosure's state. */
function AccountSlot({ disclosure }: ShellHeaderSlotProps): ReactElement {
  return (
    <button
      type="button"
      aria-expanded={disclosure.open}
      aria-controls={disclosure.surfaceId}
      onClick={disclosure.requestOpen}
    >
      Account menu
    </button>
  );
}

/** Install a width and render the frame at it as the `/app` layout route. */
function renderShellAt(width: number): ViewportStub {
  const viewport = installViewport(width);
  render(
    <MemoryRouter initialEntries={[HOME_ROUTE]}>
      <Routes>
        <Route
          path={HOME_ROUTE}
          element={<ShellFrame account={(slot) => <AccountSlot {...slot} />} />}
        >
          <Route index element={<DestinationContent name="Squads" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return viewport;
}

/** The layout the Shell_Header reports it rendered. */
function reportedLayout(): string | null {
  return screen.getByRole('banner').getAttribute('data-layout');
}

function accountTrigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Account menu' });
}

afterEach(() => {
  restoreViewport();
});

describe('Shell_Frame at each verified viewport width', () => {
  it.each(VERIFIED_WIDTHS)('renders the brand and the header surfaces, and no navigation, at %ipx', (width) => {
    renderShellAt(width);

    expect(reportedLayout()).toBe(expectedLayout(width));
    const banner = screen.getByRole('banner');
    expect(banner).toContainElement(screen.getByRole('link', { name: BRAND_NAME }));
    expect(banner).toContainElement(accountTrigger());
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('Shell_Frame breakpoint crossing', () => {
  it('discards an open surface on widening, keeping the banner and the content mounted', async () => {
    const user = userEvent.setup();
    const viewport = renderShellAt(360);
    await user.click(accountTrigger());
    expect(accountTrigger()).toHaveAttribute('aria-expanded', 'true');
    const heading = screen.getByRole('heading', { level: 1 });
    const banner = screen.getByRole('banner');
    const main = screen.getByRole('main');

    act(() => {
      viewport.setWidth(WIDE_LAYOUT_MIN_WIDTH_PX);
    });

    expect(reportedLayout()).toBe('wide');
    expect(accountTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
    expect(screen.getByRole('banner')).toBe(banner);
    expect(screen.getByRole('main')).toBe(main);
  });

  it('discards an open surface on narrowing, keeping the content mounted', async () => {
    const user = userEvent.setup();
    const viewport = renderShellAt(1024);
    await user.click(accountTrigger());
    const heading = screen.getByRole('heading', { level: 1 });

    act(() => {
      viewport.setWidth(767);
    });

    expect(reportedLayout()).toBe('compact');
    expect(accountTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
  });
});
