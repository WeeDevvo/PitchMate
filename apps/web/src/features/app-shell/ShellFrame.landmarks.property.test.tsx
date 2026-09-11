/**
 * Property test for the Shell_Frame's landmark set, heading structure, and
 * graphics (task 10.6).
 *
 * **Property 3: Every rendered shell route has one banner, one navigation, one
 * main, one `h1`, and described graphics.** *For any* rendered shell route and any
 * content kind in the region (supplied destination content, the unavailable state,
 * the `/app` not-found indication, the session-ended indication), the rendering
 * contains exactly one banner landmark, exactly one navigation landmark within the
 * frame, exactly one main landmark, and exactly one level-one heading, that
 * heading is outside the header, every subordinate heading is at most one level
 * below the nearest preceding heading, and every image or icon carries a text
 * alternative or is hidden from assistive technology with its meaning carried by
 * adjacent text.
 *
 * That is four acceptance criteria at once:
 *
 * | Criterion | What it asks | Where it is asserted |
 * | --- | --- | --- |
 * | 1.5 | exactly one banner, one navigation within the frame, one main, per rendered shell route | {@link expectLandmarkSet} |
 * | 1.9 | no level-one heading within the Shell_Frame, so the route's one `h1` belongs to the content | {@link expectSingleLevelOneHeading} |
 * | 13.2 | exactly one `h1` per route, contributed by the content or by a boundary state, none in the header, and every subordinate heading no more than one level below the nearest preceding heading | {@link expectSingleLevelOneHeading} + {@link expectHeadingOutlineIsWellFormed} |
 * | 13.9 | a text alternative for every image and icon, empty where adjacent text already carries the meaning | {@link expectEveryGraphicIsDescribedOrDecorative} |
 *
 * ### What is generated
 *
 * Two independent axes, because the frame's structure must not depend on either:
 *
 * 1. **The requested path.** Every registered Destination path, paths nested
 *    beneath the nested Destinations, and paths under `/app` that resolve to
 *    nothing — each optionally case-folded, trailing-slashed, or carrying a query
 *    string or fragment, since Requirement 3.13 calls those equivalent. Resolution
 *    changes which navigation control is marked current (Property 4's subject, task
 *    10.7); it must change nothing about the landmark or heading counts.
 * 2. **The content kind.** The four kinds the property names — arbitrary supplied
 *    Destination_Content, the real {@link SettingsDestination}, the real
 *    {@link DestinationUnavailable} for any of the four registered Destinations,
 *    the real {@link ShellNotFound}, and the real {@link SessionEndedNotice}.
 *
 * Plus which header surface is open, so an expanded compact Primary_Navigation —
 * real markup, mounted inside the frame's one `<nav>` — is covered rather than
 * only the collapsed case.
 *
 * ### The synthetic content, and what it is really testing
 *
 * The `supplied` content kind generates a well-formed outline: one `h1` followed
 * by subordinate headings each at most one level below the previous. Asserting
 * that a well-formed outline is well-formed would prove nothing on its own — so
 * the assertion is stronger than the property's minimum: the rendered document's
 * heading outline must equal the *generated* outline exactly. Any heading the
 * frame, the header, the navigation, or the Content_Region's announcer contributed
 * would show up as an extra level and fail. That is Requirement 1.9 stated as an
 * equality rather than as a count.
 *
 * The four real content kinds carry outlines the shell itself owns, so for those
 * the count and the level-step check are genuine assertions about production
 * components.
 *
 * ### The notification and account slots
 *
 * `NotificationPanel` and `AccountMenu` are being written under tasks 11.3 and
 * 12.2 and do not exist yet, so the harness fills those two slots with stand-ins:
 * a {@link Disclosure} with a plain `<button>` trigger and one focusable control
 * inside, which is the shape both real surfaces take. The stand-ins contribute no
 * landmark, no heading, and no graphic, so the frame's own counts are what is
 * measured. The real surfaces inherit the property through
 * {@link ShellHeader}, which owns both landmarks itself, and the accessibility
 * audits in task 14.6 cover them once they land.
 *
 * The graphics check is deliberately *not* fed harness-invented images either. The
 * only graphic in the rendering is the brand logo the real {@link BrandControl}
 * renders, and {@link expectEveryGraphicIsDescribedOrDecorative} asserts at least
 * one graphic was found — so the check cannot pass by scanning nothing.
 *
 * Per-example structural assertions live in `ShellFrame.test.tsx`; this file is
 * the generator-driven property at the 100-iteration floor Requirement 14.2 sets.
 *
 * Feature: app-shell, Property 3: Every rendered shell route has one banner, one
 * navigation, one main, one `h1`, and described graphics
 * Validates: Requirements 1.5, 1.9, 13.2, 13.9
 */
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fc from 'fast-check';

import { DestinationUnavailable } from './DestinationUnavailable';
import { SessionEndedNotice } from './SessionEndedNotice';
import { SettingsDestination } from './SettingsDestination';
import { ShellFrame } from './ShellFrame';
import { ShellNotFound } from './ShellNotFound';
import { Disclosure } from './components/Disclosure';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { ShellThemeProvider } from './components/ShellThemeProvider';
import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  type DestinationId,
} from './lib/destinations';
import { createInMemoryAppearanceStorage } from '../../theme';

// --- The generated axes ------------------------------------------------------

/** Every registered Destination route path (Requirement 3.1). */
const REGISTERED_PATHS: readonly string[] = SHELL_DESTINATIONS.map(
  (destination) => destination.path,
);

/**
 * The Destinations that admit nested paths — everything but Home, which matches
 * its own path exactly (see `lib/routeResolution.ts`).
 */
const NESTABLE_PATHS: readonly string[] = REGISTERED_PATHS.filter(
  (path) => path !== HOME_ROUTE,
);

/**
 * Segments that are not registered Destination segments, so a path built from
 * them under `/app` resolves to nothing (Requirement 3.10). Held apart from the
 * registry deliberately: a segment slipping in here that later became a
 * Destination would quietly turn the non-resolving family into a resolving one.
 */
const UNREGISTERED_SEGMENTS: readonly string[] = [
  'squads',
  'matches',
  'teams',
  'not-a-destination',
  'settingsx',
  'x',
  '2024',
];

/** Every registered id, for the Unavailable_State's generated subject. */
const DESTINATION_IDS: readonly DestinationId[] = SHELL_DESTINATIONS.map(
  (destination) => destination.id,
);

/**
 * The equivalences Requirement 3.13 states over a requested path. Applied on top
 * of every generated path, so the frame's structure is checked against the same
 * route arriving in each of its accepted spellings.
 */
const PATH_VARIANTS: readonly ((path: string) => string)[] = [
  (path) => path,
  (path) => path.toUpperCase(),
  (path) => `${path}/`,
  (path) => `${path}?from=elsewhere`,
  (path) => `${path}#section`,
];

const unregisteredSegmentArb = fc.constantFrom(...UNREGISTERED_SEGMENTS);

/** A path that resolves to a registered Destination, exactly. */
const registeredPathArb = fc.constantFrom(...REGISTERED_PATHS);

/** A path nested beneath a nested Destination, which resolves to that Destination. */
const nestedPathArb = fc
  .tuple(
    fc.constantFrom(...NESTABLE_PATHS),
    fc.array(unregisteredSegmentArb, { minLength: 1, maxLength: 3 }),
  )
  .map(([base, segments]) => `${base}/${segments.join('/')}`);

/** A path under `/app` that resolves to no registered Destination. */
const nonResolvingPathArb = fc.oneof(
  fc
    .array(unregisteredSegmentArb, { minLength: 1, maxLength: 3 })
    .map((segments) => `${HOME_ROUTE}/${segments.join('/')}`),
  // An interior empty segment matches nothing, however registered the rest is.
  fc.constantFrom(`${HOME_ROUTE}//settings`, `${HOME_ROUTE}//`, `${HOME_ROUTE}/`.repeat(2)),
);

/** Any shell path, in any of its equivalent spellings. */
const shellPathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(registeredPathArb, nestedPathArb, nonResolvingPathArb),
    fc.constantFrom(...PATH_VARIANTS),
  )
  .map(([path, variant]) => variant(path));

/**
 * A well-formed heading outline for synthetic Destination_Content: one level-one
 * heading, then subordinate headings each at most one level below the previous
 * and never above level six.
 */
const suppliedOutlineArb: fc.Arbitrary<readonly number[]> = fc
  .array(fc.constantFrom(-2, -1, 0, 1), { maxLength: 5 })
  .map((deltas) => {
    const levels: number[] = [1];
    let previous = 1;
    for (const delta of deltas) {
      // At most one level below the previous heading, never above six, never
      // another level-one — which is what "subordinate" means.
      const level = Math.min(previous + 1, 6, Math.max(2, previous + delta));
      levels.push(level);
      previous = level;
    }
    return levels;
  });

/** What the Content_Region carries. */
type GeneratedContent =
  | { readonly kind: 'supplied'; readonly outline: readonly number[] }
  | { readonly kind: 'settings' }
  | { readonly kind: 'unavailable'; readonly destinationId: DestinationId }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'session-ended' };

const contentArb: fc.Arbitrary<GeneratedContent> = fc.oneof(
  fc.record({ kind: fc.constant('supplied' as const), outline: suppliedOutlineArb }),
  fc.constant({ kind: 'settings' as const }),
  fc.record({
    kind: fc.constant('unavailable' as const),
    destinationId: fc.constantFrom(...DESTINATION_IDS),
  }),
  fc.constant({ kind: 'not-found' as const }),
  fc.constant({ kind: 'session-ended' as const }),
);

/** Which header surface a person has opened, if any. */
type OpenSurface = 'navigation' | 'notifications' | 'account' | null;

const openSurfaceArb: fc.Arbitrary<OpenSurface> = fc.constantFrom(
  null,
  'navigation',
  'notifications',
  'account',
);

/** The heading outline a generated `supplied` content actually renders. */
function outlineOf(content: GeneratedContent): readonly number[] | null {
  return content.kind === 'supplied' ? content.outline : null;
}

// --- The rendered harness ----------------------------------------------------

const NOTIFICATIONS_TRIGGER = 'Notifications';
const ACCOUNT_TRIGGER = 'Account menu';
const NAVIGATION_TRIGGER = 'Menu';

/**
 * Render the generated content kind.
 *
 * The four boundary and destination kinds are the real production components; the
 * `supplied` kind stands for the injected Destination_Content a later feature
 * provides (Requirement 3.7), which the shell never sees the source of.
 */
function ContentFor({ content }: { readonly content: GeneratedContent }): ReactElement {
  switch (content.kind) {
    case 'supplied':
      return (
        <div>
          {content.outline.map((level, index) => {
            const Heading = `h${level}` as 'h1';
            return <Heading key={index}>{`Section ${index + 1}`}</Heading>;
          })}
          <button type="button">Inside content</button>
        </div>
      );
    case 'settings':
      return <SettingsDestination />;
    case 'unavailable':
      return <DestinationUnavailable destinationId={content.destinationId} />;
    case 'not-found':
      return <ShellNotFound />;
    case 'session-ended':
      return <SessionEndedNotice />;
  }
}

/**
 * A stand-in for a header surface still to be written (tasks 11.3, 12.2): the
 * shape both real ones take — a `Disclosure` over a plain `<button>` trigger with
 * one focusable control inside — and nothing else, so it contributes no landmark,
 * no heading, and no graphic of its own.
 */
function SurfaceStandIn({
  label,
  surfaceId,
  open,
  onRequestOpen,
  onRequestClose,
}: {
  readonly label: string;
  readonly surfaceId: string;
  readonly open: boolean;
  readonly onRequestOpen: () => void;
  readonly onRequestClose: () => void;
}): ReactElement {
  return (
    <Disclosure
      id={surfaceId}
      open={open}
      onRequestOpen={onRequestOpen}
      onRequestClose={onRequestClose}
      trigger={(triggerProps) => (
        <button type="button" {...triggerProps}>
          {label}
        </button>
      )}
    >
      <button type="button">{`${label} item`}</button>
    </Disclosure>
  );
}

/**
 * Render a whole shell route: the frame with its real header, real
 * Primary_Navigation, stand-in notification and account surfaces, and the
 * generated content in the Content_Region.
 */
function renderShellRoute(path: string, content: GeneratedContent): HTMLElement {
  const { container } = render(
    <ShellThemeProvider storage={createInMemoryAppearanceStorage()}>
      <MemoryRouter initialEntries={[path]}>
        <ShellFrame
          navigation={(props) => <PrimaryNavigation {...props} />}
          notifications={({ disclosure }) => (
            <SurfaceStandIn
              label={NOTIFICATIONS_TRIGGER}
              surfaceId={disclosure.surfaceId}
              open={disclosure.open}
              onRequestOpen={disclosure.requestOpen}
              onRequestClose={() => disclosure.requestClose('activate')}
            />
          )}
          account={({ disclosure }) => (
            <SurfaceStandIn
              label={ACCOUNT_TRIGGER}
              surfaceId={disclosure.surfaceId}
              open={disclosure.open}
              onRequestOpen={disclosure.requestOpen}
              onRequestClose={() => disclosure.requestClose('activate')}
            />
          )}
        >
          <ContentFor content={content} />
        </ShellFrame>
      </MemoryRouter>
    </ShellThemeProvider>,
  );

  return container;
}

/** The accessible name of the trigger that opens each generated surface. */
const TRIGGER_LABEL: Record<Exclude<OpenSurface, null>, string> = {
  navigation: NAVIGATION_TRIGGER,
  notifications: NOTIFICATIONS_TRIGGER,
  account: ACCOUNT_TRIGGER,
};

/**
 * Open a header surface the way a pointer does — `pointerdown` then `click`, so
 * the outside-pointer close of any other surface interleaves as it really would.
 */
function openSurface(surface: Exclude<OpenSurface, null>): void {
  const trigger = screen.getByRole('button', { name: TRIGGER_LABEL[surface] });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 1.5: exactly one banner, exactly one navigation *within the frame*,
 * exactly one main.
 *
 * Counted from the roles assistive technology resolves and, for the navigation,
 * confirmed to be inside the banner — which is where {@link ShellHeader} owns it,
 * and so where "within the Shell_Frame" is satisfied.
 */
function expectLandmarkSet(): void {
  const banners = screen.getAllByRole('banner');
  const navigations = screen.getAllByRole('navigation');
  const mains = screen.getAllByRole('main');

  expect(banners).toHaveLength(1);
  expect(navigations).toHaveLength(1);
  expect(mains).toHaveLength(1);

  const [banner] = banners;
  const [navigation] = navigations;
  const [main] = mains;

  expect(banner).toContainElement(navigation);
  // 1.2: the header sits outside the content region, so neither contains the other.
  expect(banner).not.toContainElement(main);
  expect(main).not.toContainElement(banner);
}

/**
 * Requirements 1.9 and 13.2: exactly one level-one heading per rendered shell
 * route, contributed by the content, none inside the header.
 */
function expectSingleLevelOneHeading(): void {
  const levelOne = screen.getAllByRole('heading', { level: 1 });
  expect(levelOne).toHaveLength(1);

  const [heading] = levelOne;
  const banner = screen.getByRole('banner');

  // 1.9: the frame contributes none, so the route's one `h1` is outside the header…
  expect(banner).not.toContainElement(heading);
  expect(banner.querySelector('h1')).toBeNull();
  // …and inside the main landmark, where the content is rendered (Requirement 1.2).
  expect(screen.getByRole('main')).toContainElement(heading);
}

/** Every heading in the rendering, in document order, as its level. */
function headingLevels(container: HTMLElement): readonly number[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]'),
  ).map((heading) => {
    const explicit = heading.getAttribute('aria-level');
    if (explicit !== null) {
      return Number.parseInt(explicit, 10);
    }
    return Number.parseInt(heading.tagName.slice(1), 10);
  });
}

/**
 * Requirement 13.2: every subordinate heading is at a level no more than one
 * greater than the level of the nearest preceding heading, and the outline opens
 * at level one.
 */
function expectHeadingOutlineIsWellFormed(container: HTMLElement): readonly number[] {
  const levels = headingLevels(container);

  expect(levels.length).toBeGreaterThan(0);
  expect(levels[0]).toBe(1);

  for (let index = 1; index < levels.length; index += 1) {
    expect(levels[index]).toBeLessThanOrEqual(levels[index - 1] + 1);
    expect(levels[index]).toBeGreaterThan(1);
  }

  return levels;
}

/** Whether `element`, or any ancestor of it, is hidden from assistive technology. */
function isHiddenFromAssistiveTechnology(element: Element): boolean {
  return element.closest('[aria-hidden="true"]') !== null;
}

/** Whether the element is explicitly marked as carrying no meaning of its own. */
function isMarkedDecorative(graphic: Element): boolean {
  const role = graphic.getAttribute('role');
  if (role === 'presentation' || role === 'none') {
    return true;
  }
  if (isHiddenFromAssistiveTechnology(graphic)) {
    return true;
  }
  // 13.9: an empty text alternative is the stated way to say "the adjacent text
  // already carries this". A *missing* `alt` is not that, and is not accepted.
  const alt = graphic.getAttribute('alt');
  return alt !== null && alt.trim().length === 0;
}

/** Whether the element carries a non-empty text alternative. */
function hasTextAlternative(graphic: Element, container: HTMLElement): boolean {
  const label = graphic.getAttribute('aria-label');
  if (label !== null && label.trim().length > 0) {
    return true;
  }

  const labelledBy = graphic.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const described = labelledBy
      .split(/\s+/)
      .filter((id) => id.length > 0)
      .map((id) => container.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .some((text) => text.length > 0);
    if (described) {
      return true;
    }
  }

  const alt = graphic.getAttribute('alt');
  if (alt !== null && alt.trim().length > 0) {
    return true;
  }

  // An `<svg>` names itself with a `<title>` child.
  const title = graphic.tagName.toLowerCase() === 'svg' ? graphic.querySelector('title') : null;
  return (title?.textContent?.trim().length ?? 0) > 0;
}

/** Every image, icon, and drawing surface in the rendering. */
const GRAPHIC_SELECTOR = 'img, svg, canvas, [role="img"]';

/**
 * Requirement 13.9: every image and icon carries a text alternative, or an empty
 * one where adjacent text already conveys its meaning.
 *
 * The `expect(...).toBeGreaterThan(0)` matters as much as the filter: the frame's
 * brand logo is always rendered, so a scan finding nothing would mean the selector
 * had stopped matching and the check had become vacuous.
 */
function expectEveryGraphicIsDescribedOrDecorative(container: HTMLElement): void {
  const graphics = Array.from(container.querySelectorAll(GRAPHIC_SELECTOR));
  expect(graphics.length).toBeGreaterThan(0);

  const undescribed = graphics.filter(
    (graphic) => !hasTextAlternative(graphic, container) && !isMarkedDecorative(graphic),
  );

  expect(undescribed.map((graphic) => graphic.outerHTML)).toEqual([]);
}

// --- The property ------------------------------------------------------------

afterEach(() => {
  // `ShellThemeProvider` applies the resolved Theme to the document element, which
  // outlives an unmount.
  document.documentElement.removeAttribute('data-theme');
});

describe('ShellFrame — Property 3 (one banner, one navigation, one main, one h1, described graphics)', () => {
  // Feature: app-shell, Property 3: Every rendered shell route has one banner, one navigation, one main, one `h1`, and described graphics
  // Validates: Requirements 1.5, 1.9, 13.2, 13.9
  it('holds for any shell path, any content kind, and any open header surface', () => {
    fc.assert(
      fc.property(
        shellPathArb,
        contentArb,
        openSurfaceArb,
        (path, content, surface) => {
          const container = renderShellRoute(path, content);
          try {
            expectLandmarkSet();
            expectSingleLevelOneHeading();
            expectHeadingOutlineIsWellFormed(container);
            expectEveryGraphicIsDescribedOrDecorative(container);

            if (surface !== null) {
              // The same claims must survive a surface being opened — most of all
              // the compact Primary_Navigation, whose expanded list is real markup
              // rendered inside the frame's one `<nav>`.
              openSurface(surface);

              expectLandmarkSet();
              expectSingleLevelOneHeading();
              expectHeadingOutlineIsWellFormed(container);
              expectEveryGraphicIsDescribedOrDecorative(container);
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: app-shell, Property 3: Every rendered shell route has one banner, one navigation, one main, one `h1`, and described graphics
  // Validates: Requirements 1.9, 13.2
  it('contributes no heading of its own to supplied destination content', () => {
    fc.assert(
      fc.property(shellPathArb, suppliedOutlineArb, (path, outline) => {
        const content: GeneratedContent = { kind: 'supplied', outline };
        const container = renderShellRoute(path, content);
        try {
          // Stronger than the property's minimum: the rendered outline equals the
          // one the content declared, so the frame, the header, the navigation, and
          // the Content_Region's announcer added no heading at any level.
          expect(headingLevels(container)).toEqual(outlineOf(content));
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);
});
