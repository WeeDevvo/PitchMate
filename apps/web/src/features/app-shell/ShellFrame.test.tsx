/**
 * Unit tests for the Shell_Frame's structure and its three shipped controls.
 *
 * What is pinned here:
 *
 *   - the landmark set of a rendered shell route: exactly one banner, exactly one
 *     navigation, exactly one main (Requirement 1.5), with the header outside and
 *     before the content region (Requirement 1.2);
 *   - the frame contributes no level-one heading, so the route's single `h1`
 *     belongs to the content (Requirements 1.9, 13.2);
 *   - the Skip_Link is the first Tab stop, names the content region, and moves
 *     focus into it — after which the next Tab reaches the first control inside
 *     the content and none of the header's (Requirement 13.1);
 *   - the brand control navigates to the Home_Destination client-side, keeping the
 *     header's DOM node mounted, and the arriving content is focused and announced
 *     (Requirements 1.3, 1.4, 13.12);
 *   - the header's three surface slots render where the frame says they do, and
 *     an unsupplied slot leaves the landmark set intact.
 *
 * The property tests for landmarks and headings (10.6), keyboard focus (10.8),
 * and content-region changes (10.9), and the declared-style assertions for
 * Requirements 1.8, 13.11, and 13.13 (10.10), are separate tasks.
 *
 * Feature: app-shell
 */
import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ShellFrame, type ShellFrameProps } from './ShellFrame';
import { SKIP_LINK_LABEL } from './components/SkipLink';
import { BRAND_NAME } from './components/BrandControl';
import { PRIMARY_NAVIGATION_LABEL } from './components/ShellHeader';
import { HOME_ROUTE, SETTINGS_ROUTE } from './lib/destinations';

/** Render the frame standalone with supplied content, as a screen would host it. */
function renderFrame(
  props: ShellFrameProps = {},
  initialPath: string = SETTINGS_ROUTE,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ShellFrame {...props} />
    </MemoryRouter>,
  );
}

/**
 * Render the frame as the `/app` layout route with two child destinations, which
 * is how the route table composes it — so a navigation swaps only the outlet.
 */
function renderRoutedFrame(initialPath: string = SETTINGS_ROUTE): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={HOME_ROUTE} element={<ShellFrame />}>
          <Route
            index
            element={
              <>
                <h1>Squads</h1>
                <button type="button">Create squad</button>
              </>
            }
          />
          <Route path="settings" element={<h1>Settings</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function skipLink(): HTMLElement {
  return screen.getByRole('link', { name: SKIP_LINK_LABEL });
}

describe('ShellFrame landmarks', () => {
  // Requirement 1.5 — exactly one of each landmark on a rendered shell route.
  it('renders exactly one banner, one navigation, and one main landmark', () => {
    renderFrame({ children: <h1>Settings</h1> });

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('navigation')).toHaveAccessibleName(PRIMARY_NAVIGATION_LABEL);
  });

  // Requirement 1.2 — the header is outside the content region and before it.
  it('renders the header outside and before the content region', () => {
    renderFrame({ children: <h1>Settings</h1> });

    const header = screen.getByRole('banner');
    const main = screen.getByRole('main');

    expect(header).not.toContainElement(main);
    expect(main).not.toContainElement(header);
    expect(
      header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Requirement 1.2 — the active content is rendered inside the content region.
  it('renders the supplied content inside the content region', () => {
    renderFrame({ children: <h1>Settings</h1> });

    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Settings' }),
    );
  });

  // Requirements 1.9, 13.2 — the frame contributes no `h1` of its own.
  it('renders no level-one heading of its own', () => {
    renderFrame({ children: <p>Body with no heading</p> });

    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByRole('banner').querySelector('h1')).toBeNull();
  });

  it('renders no level-one heading in the header while the content has one', () => {
    renderFrame({ children: <h1>Settings</h1> });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner').querySelector('h1')).toBeNull();
  });
});

describe('ShellFrame skip link', () => {
  // Requirement 13.1 — first in document order, and so the first Tab stop.
  it('is the first focusable control of the frame', async () => {
    const user = userEvent.setup();
    renderFrame({
      children: (
        <>
          <h1>Settings</h1>
          <button type="button">Inside content</button>
        </>
      ),
    });

    await user.tab();

    expect(skipLink()).toHaveFocus();
    expect(
      skipLink().compareDocumentPosition(screen.getByRole('banner')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('names the content region as its target', () => {
    renderFrame({ children: <h1>Settings</h1> });

    const target = screen.getByRole('main').getAttribute('id');
    expect(target).not.toBeNull();
    expect(skipLink()).toHaveAttribute('href', `#${target ?? ''}`);
  });

  // Requirement 13.1 — activation moves focus to the content region, and the
  // next Tab reaches the first control inside it rather than any header control.
  it('moves focus to the content region, and the next Tab enters the content', async () => {
    const user = userEvent.setup();
    renderFrame({
      children: (
        <>
          <h1>Settings</h1>
          <button type="button">Inside content</button>
        </>
      ),
    });

    await user.click(skipLink());
    expect(screen.getByRole('main')).toHaveFocus();

    await user.tab();

    const insideContent = screen.getByRole('button', { name: 'Inside content' });
    expect(insideContent).toHaveFocus();
    expect(screen.getByRole('banner')).not.toContainElement(insideContent);
  });

  it('is operable by keyboard alone', async () => {
    const user = userEvent.setup();
    renderFrame({ children: <h1>Settings</h1> });

    await user.tab();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('ShellFrame brand control', () => {
  // Requirement 1.4 — a text alternative naming PitchMate.
  it('names PitchMate and targets the Home_Destination', () => {
    renderFrame({ children: <h1>Settings</h1> });

    const brand = screen.getByRole('link', { name: BRAND_NAME });
    expect(screen.getByRole('banner')).toContainElement(brand);
    expect(brand).toHaveAttribute('href', HOME_ROUTE);
  });

  // Requirement 13.9 — the logo's meaning is carried by the adjacent text, so it
  // takes an empty text alternative and is not announced twice.
  it('renders the brand logo with an empty text alternative', () => {
    renderFrame({ children: <h1>Settings</h1> });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const logo = screen.getByRole('banner').querySelector('img');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('alt', '');
  });

  // Requirements 1.3, 1.4 — client-side navigation: the content region's children
  // are replaced and the header keeps the very same DOM node, which a
  // full-document reload or a frame remount could not do.
  it('navigates to the Home_Destination without remounting the header', async () => {
    const user = userEvent.setup();
    renderRoutedFrame();
    const headerBefore = screen.getByRole('banner');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: BRAND_NAME }));

    expect(screen.getByRole('heading', { level: 1, name: 'Squads' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBe(headerBefore);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  // Requirement 13.12 — the arriving content's heading is focused and announced.
  it('focuses and announces the arriving destination heading', async () => {
    const user = userEvent.setup();
    renderRoutedFrame();

    await user.click(screen.getByRole('link', { name: BRAND_NAME }));

    expect(screen.getByRole('heading', { level: 1, name: 'Squads' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Squads');
  });
});

describe('ShellFrame header slots', () => {
  /** A slot that renders a trigger, as the real surfaces will. */
  function control(label: string): ReactElement {
    return (
      <button type="button">
        {label}
      </button>
    );
  }

  it('renders the navigation slot inside the one navigation landmark', () => {
    renderFrame({
      children: <h1>Settings</h1>,
      navigation: () => control('Squads'),
    });

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation')).toContainElement(
      screen.getByRole('button', { name: 'Squads' }),
    );
  });

  it('passes the current layout and a closed disclosure to the navigation slot', () => {
    renderFrame({
      children: <h1>Settings</h1>,
      navigation: ({ layout, disclosure }) => (
        <button type="button" data-layout={layout} data-open={String(disclosure.open)}>
          Menu
        </button>
      ),
    });

    const trigger = screen.getByRole('button', { name: 'Menu' });
    // jsdom reports every media query as non-matching, so the frame renders the
    // Compact_Layout there (see state/useViewportLayout.ts).
    expect(trigger).toHaveAttribute('data-layout', 'compact');
    expect(trigger).toHaveAttribute('data-open', 'false');
  });

  it('renders the notification and account slots in the header, after the navigation', () => {
    renderFrame({
      children: <h1>Settings</h1>,
      notifications: () => control('Notifications'),
      account: () => control('Account menu'),
    });

    const header = screen.getByRole('banner');
    const navigation = screen.getByRole('navigation');
    const indicator = screen.getByRole('button', { name: 'Notifications' });
    const account = screen.getByRole('button', { name: 'Account menu' });

    expect(header).toContainElement(indicator);
    expect(header).toContainElement(account);
    expect(navigation).not.toContainElement(indicator);
    expect(
      navigation.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      indicator.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('gives each slot a distinct surface id', () => {
    const surfaceIds: string[] = [];
    renderFrame({
      children: <h1>Settings</h1>,
      navigation: ({ disclosure }) => {
        surfaceIds.push(disclosure.surfaceId);
        return null;
      },
      notifications: ({ disclosure }) => {
        surfaceIds.push(disclosure.surfaceId);
        return null;
      },
      account: ({ disclosure }) => {
        surfaceIds.push(disclosure.surfaceId);
        return null;
      },
    });

    expect(new Set(surfaceIds).size).toBe(3);
  });

  it('leaves the landmark set intact when no slot is supplied', () => {
    renderFrame({ children: <h1>Settings</h1> });

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
