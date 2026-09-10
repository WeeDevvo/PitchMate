/**
 * Property test for the Primary_Navigation's active marking (task 10.7).
 *
 * **Property 4: Exactly one navigation control is marked current, and only for a
 * resolving path.** *For any* requested path beginning with `/app`, the primary
 * navigation marks as the current page exactly the control of the destination the
 * route resolver returns and no other control, marking no control when the
 * resolver returns the not-found outcome, and the marked control carries a
 * non-colour visual cue in addition to any colour difference.
 *
 * That is Requirement 3.5 — "SHALL mark exactly that Destination's
 * Primary_Navigation control as the current page programmatically, SHALL render a
 * non-colour visual cue on that control in addition to any colour difference, and
 * SHALL mark no other Primary_Navigation control as the current page" — together
 * with Requirement 3.10's "SHALL mark no Primary_Navigation control as the current
 * page" for a path under `/app` that resolves to nothing.
 *
 * ### The expectation is not taken from the resolver
 *
 * {@link resolveDestination} is the component's own source of truth, so asserting
 * against it would only restate the component. Every generated case therefore
 * carries the marking it was *constructed* to require, read from Requirements 3.11
 * and 3.13 rather than computed: a path built from a Destination's registered path
 * (in any ASCII case, with or without a single trailing separator, with or without
 * further whole segments beneath a nested Destination) expects that Destination's
 * control; a path built under `/app` from a segment no Destination registers, or
 * one built outside `/app` altogether, expects nothing marked at all.
 *
 * ### Both layouts
 *
 * Requirement 3.5's cue is not layout-dependent, so every case runs in the
 * Wide_Layout, where the destination controls are rendered directly, and in the
 * Compact_Layout, where the same list sits inside the header's disclosure — opened
 * first, since a collapsed surface renders no controls to mark. A third property
 * asserts the two layouts agree on the same requested path.
 *
 * ### What jsdom can and cannot see of the cue
 *
 * jsdom does cascade `styles/shell.css`, so the *non-colour* half of the cue is
 * checked from computed styles here: the marked control computes a heavier
 * `font-weight` than every unmarked control, and a `box-shadow` (the 3-pixel inset
 * bar) that no unmarked control has. Neither depends on perceiving colour, which
 * is the point of the criterion.
 *
 * What jsdom cannot resolve is `var(--nav-current)`: both `color` and the bar's
 * colour come back as the unevaluated `var()` reference, so the colour half of
 * "in addition to any colour difference" and the bar's rendered geometry are only
 * assertable from the declared stylesheet — done in the last describe block, in
 * the same source-scanning style as `styles/theme.tokens.test.ts`. That the bar is
 * actually painted 3 pixels wide inside the control's left padding, and that the
 * weight change shifts no text, still need a browser.
 *
 * Named cases (each destination's own path, one nested path, one cased and
 * trailing-slashed path, one unregistered path) live in
 * `PrimaryNavigation.test.tsx`; this file is the generator-driven property at the
 * 100-iteration floor Requirement 14.2 sets.
 *
 * Feature: app-shell, Property 4: Exactly one navigation control is marked current, and only for a resolving path
 * Validates: Requirements 3.5, 3.10
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fc from 'fast-check';

import { PrimaryNavigation } from './PrimaryNavigation';
import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  type DestinationDefinition,
  type DestinationId,
} from '../lib/destinations';
import { PRIMARY_NAVIGATION_TOGGLE } from '../lib/messages';
import { useDisclosureGroup } from '../state/useDisclosureGroup';
import type { ShellLayout } from '../state/useViewportLayout';

// The active control's presentation lives here; jsdom cascades it, so the
// non-colour cue is observable from computed styles below.
import '../styles/shell.css';

/** The surface id the Shell_Header supplies for the navigation disclosure. */
const SURFACE_ID = 'shell-primary-navigation';

/** Requirement 3.5 applies in both layouts, so every case runs in both. */
const LAYOUTS: readonly ShellLayout[] = ['compact', 'wide'];

/** Every registered Destination other than Home (the ones with a further segment). */
const NESTED_DESTINATIONS: readonly DestinationDefinition[] = SHELL_DESTINATIONS.filter(
  (destination) => destination.path !== HOME_ROUTE,
);

/** The second path segment each nested Destination registers, ASCII-lowercased. */
const REGISTERED_SEGMENTS: readonly string[] = NESTED_DESTINATIONS.map((destination) =>
  destination.path.slice(HOME_ROUTE.length + 1).toLowerCase(),
);

// --- The harness -------------------------------------------------------------

/**
 * Wires the component the way the Shell_Header does: the open state lives in the
 * frame's disclosure group, and the four-member controller maps onto
 * `Disclosure`'s controlled props.
 */
function Harness({ layout }: { readonly layout: ShellLayout }): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <PrimaryNavigation
      layout={layout}
      disclosure={{
        surfaceId: SURFACE_ID,
        open: open === 'navigation',
        requestOpen: () => toggle('navigation'),
        requestClose: () => close('navigation'),
      }}
    />
  );
}

/**
 * Render the navigation at `requestedPath`, expanding the compact disclosure so
 * the destination controls are present in both layouts.
 */
function renderNavigation(layout: ShellLayout, requestedPath: string): void {
  render(
    <MemoryRouter initialEntries={[requestedPath]}>
      <Harness layout={layout} />
    </MemoryRouter>,
  );

  if (layout === 'compact') {
    fireEvent.click(screen.getByRole('button', { name: PRIMARY_NAVIGATION_TOGGLE }));
  }
}

/** Every rendered destination control, in document order. */
function destinationControls(): HTMLElement[] {
  return screen.getAllByRole('link');
}

/** The `data-destination` of every element carrying `aria-current`, whatever its value. */
function ariaCurrentAttributes(): readonly { id: string | null; value: string | null }[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-current]'), (element) => ({
    id: element.getAttribute('data-destination'),
    value: element.getAttribute('aria-current'),
  }));
}

/** The `data-destination` of every control whose `data-current` reads `true`. */
function dataCurrentDestinations(): readonly (string | null)[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-current="true"]'),
    (element) => element.getAttribute('data-destination'),
  );
}

/** The numeric weight of a computed `font-weight`, with the CSS keywords folded. */
function computedWeight(element: HTMLElement): number {
  const declared = window.getComputedStyle(element).fontWeight;

  if (declared === 'bold') {
    return 700;
  }
  if (declared === 'normal' || declared === '') {
    return 400;
  }

  return Number(declared);
}

/**
 * Assert the whole of Property 4 against the current rendering.
 *
 * `expected` is the Destination the requested path was constructed to mark, or
 * `null` where it was constructed to mark nothing.
 */
function expectMarking(expected: DestinationId | null): void {
  const controls = destinationControls();

  // 3.3, 3.10: every registered Destination keeps its control either way — a
  // non-resolving path marks nothing, it does not remove the navigation.
  expect(controls).toHaveLength(SHELL_DESTINATIONS.length);

  const marked = ariaCurrentAttributes();

  // 3.5: `aria-current` is a *statement* of currency, so only the current control
  // carries it at all — never `aria-current="false"` on the others.
  for (const attribute of marked) {
    expect(attribute.value).toBe('page');
  }

  const markedIds = marked.map((attribute) => attribute.id);
  const expectedIds = expected === null ? [] : [expected];

  // 3.5, 3.10: exactly the resolved Destination's control, and no other.
  expect(markedIds).toEqual(expectedIds);
  // The same fact in the attribute form the stylesheet and the layout tests read.
  expect(dataCurrentDestinations()).toEqual(expectedIds);

  if (expected === null) {
    return;
  }

  // 3.5: the marking is accompanied by a cue that survives colour being absent
  // or overridden — a heavier weight and the inset bar, both from
  // `.shell-nav__link[aria-current='page']`.
  const markedControl = controls.find(
    (control) => control.getAttribute('data-destination') === expected,
  );
  expect(markedControl).toBeDefined();
  if (markedControl === undefined) {
    return;
  }

  const markedWeight = computedWeight(markedControl);
  const markedBar = window.getComputedStyle(markedControl).boxShadow;

  expect(markedBar).not.toBe('');
  expect(markedBar).toContain('inset');

  for (const other of controls.filter((control) => control !== markedControl)) {
    expect(computedWeight(other)).toBeLessThan(markedWeight);
    expect(window.getComputedStyle(other).boxShadow).toBe('');
  }
}

// --- Generators --------------------------------------------------------------

/** A generated requested path together with the marking it must produce. */
interface MarkingCase {
  readonly requestedPath: string;
  /** The Destination whose control must be marked, or `null` for none. */
  readonly expected: DestinationId | null;
}

/** Characters an unregistered further path segment is built from. */
const SEGMENT_CHARACTERS = ['a', 'b', 'q', 'z', '0', '7', '-'];

/** The same text with each ASCII letter independently upper- or lower-cased. */
function randomAsciiCase(value: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: value.length, maxLength: value.length })
    .map((upper) =>
      Array.from(value, (character, index) =>
        upper[index] ? character.toUpperCase() : character.toLowerCase(),
      ).join(''),
    );
}

/** Zero or one trailing separator — the only separator difference 3.13 folds. */
const foldedTrailingSlashArb: fc.Arbitrary<string> = fc.constantFrom('', '/');

/** A non-empty path segment. */
const segmentArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SEGMENT_CHARACTERS), { minLength: 1, maxLength: 8 })
  .map((characters) => characters.join(''));

/** A segment no Destination registers beneath `/app` (Requirement 3.10). */
const unregisteredSegmentArb: fc.Arbitrary<string> = segmentArb.filter(
  (segment) => !REGISTERED_SEGMENTS.includes(segment.toLowerCase()),
);

/**
 * A Destination's own registered path, in any ASCII case, with or without a
 * single trailing separator (Requirement 3.13).
 */
const exactPathArb: fc.Arbitrary<MarkingCase> = fc
  .constantFrom(...SHELL_DESTINATIONS)
  .chain((destination) =>
    fc
      .tuple(randomAsciiCase(destination.path), foldedTrailingSlashArb)
      .map(([cased, trailing]) => ({
        requestedPath: `${cased}${trailing}`,
        expected: destination.id,
      })),
  );

/**
 * A path nested beneath a non-Home Destination by one or more whole segments,
 * which Requirement 3.11 makes that Destination's — never Home's.
 */
const nestedPathArb: fc.Arbitrary<MarkingCase> = fc
  .constantFrom(...NESTED_DESTINATIONS)
  .chain((destination) =>
    fc
      .tuple(
        randomAsciiCase(destination.path),
        fc.array(segmentArb, { minLength: 1, maxLength: 3 }),
        foldedTrailingSlashArb,
      )
      .map(([cased, segments, trailing]) => ({
        requestedPath: `${cased}/${segments.join('/')}${trailing}`,
        expected: destination.id,
      })),
  );

/** Any requested path constructed to mark exactly one control. */
const resolvingPathArb: fc.Arbitrary<MarkingCase> = fc.oneof(
  { weight: 3, arbitrary: exactPathArb },
  { weight: 3, arbitrary: nestedPathArb },
);

/**
 * A path under `/app` registered by no Destination: an unregistered segment, or a
 * registered one behind an interior empty segment, which is not a whole-segment
 * match of anything (Requirements 3.10, 3.11).
 */
const nonResolvingUnderAppArb: fc.Arbitrary<MarkingCase> = fc.oneof(
  fc
    .tuple(randomAsciiCase(HOME_ROUTE), unregisteredSegmentArb, foldedTrailingSlashArb)
    .map(([home, segment, trailing]) => ({
      requestedPath: `${home}/${segment}${trailing}`,
      expected: null,
    })),
  fc
    .tuple(randomAsciiCase(HOME_ROUTE), fc.constantFrom(...REGISTERED_SEGMENTS))
    .map(([home, segment]) => ({
      requestedPath: `${home}//${segment}`,
      expected: null,
    })),
);

/**
 * A path outside `/app`: the marketing landing route, an Auth_Feature-shaped
 * route, or something that merely starts with the letters of `/app`.
 */
const outsideAppArb: fc.Arbitrary<MarkingCase> = fc
  .oneof(
    fc.constantFrom(
      '/',
      '/login',
      '/sign-up',
      '/reset-password',
      '/appx',
      '/apps/settings',
      '/appsettings',
    ),
    segmentArb
      .filter((segment) => segment.toLowerCase() !== 'app')
      .map((segment) => `/${segment}`),
    fc
      .tuple(
        segmentArb.filter((segment) => segment.toLowerCase() !== 'app'),
        fc.constantFrom(...REGISTERED_SEGMENTS),
      )
      .map(([first, second]) => `/${first}/${second}`),
  )
  .chain((path) => randomAsciiCase(path))
  .map((requestedPath) => ({ requestedPath, expected: null }));

/** Any requested path constructed to mark nothing at all. */
const nonResolvingPathArb: fc.Arbitrary<MarkingCase> = fc.oneof(
  { weight: 3, arbitrary: nonResolvingUnderAppArb },
  { weight: 2, arbitrary: outsideAppArb },
);

/** Every kind of requested path, resolving or not. */
const anyPathArb: fc.Arbitrary<MarkingCase> = fc.oneof(
  { weight: 3, arbitrary: resolvingPathArb },
  { weight: 2, arbitrary: nonResolvingPathArb },
);

const layoutArb: fc.Arbitrary<ShellLayout> = fc.constantFrom(...LAYOUTS);

// --- Properties -------------------------------------------------------------

describe('PrimaryNavigation — Property 4 (exactly one control marked current)', () => {
  // Feature: app-shell, Property 4: Exactly one navigation control is marked current, and only for a resolving path
  // Validates: Requirements 3.5
  it('marks exactly the resolving destination, with a non-colour cue, in both layouts', () => {
    fc.assert(
      fc.property(resolvingPathArb, layoutArb, ({ requestedPath, expected }, layout) => {
        renderNavigation(layout, requestedPath);
        try {
          expectMarking(expected);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  }, 60_000);

  // Feature: app-shell, Property 4: Exactly one navigation control is marked current, and only for a resolving path
  // Validates: Requirements 3.10
  it('marks no control at all for a path that resolves to no destination, in both layouts', () => {
    fc.assert(
      fc.property(nonResolvingPathArb, layoutArb, ({ requestedPath, expected }, layout) => {
        expect(expected).toBeNull();

        renderNavigation(layout, requestedPath);
        try {
          expectMarking(null);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  }, 60_000);

  // Feature: app-shell, Property 4: Exactly one navigation control is marked current, and only for a resolving path
  // Validates: Requirements 3.5, 3.10
  it('marks the same control in the compact and wide layouts for the same requested path', () => {
    fc.assert(
      fc.property(anyPathArb, ({ requestedPath }) => {
        const markedIn = (layout: ShellLayout): readonly (string | null)[] => {
          renderNavigation(layout, requestedPath);
          try {
            return ariaCurrentAttributes().map((attribute) => attribute.id);
          } finally {
            cleanup();
          }
        };

        expect(markedIn('compact')).toEqual(markedIn('wide'));
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});

// --- The declared cue -------------------------------------------------------

const shellCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../styles/shell.css'),
  'utf8',
);

/** Drop `/* ... *\/` comments, so documentation text is never read as CSS. */
const shellCssSource = shellCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block of a rule, by its exact selector text. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.[\]'*+?^${}()|\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(shellCssSource);

  expect(match, `no rule declared for ${selector}`).not.toBeNull();

  return (match?.[1] ?? '').trim();
}

describe('PrimaryNavigation — the declared active cue (3.5)', () => {
  // Requirement 3.5 — the cue is keyed on the same attribute the property above
  // asserts, so a control cannot be marked without receiving it.
  it('keys the active presentation on the current-page marking itself', () => {
    expect(shellCssSource).toContain(".shell-nav__link[aria-current='page']");
  });

  // Requirement 3.5 — a non-colour cue *in addition to* the colour difference:
  // the colour token is there, and so are two things that are not colour.
  it('declares a heavier weight and an inset bar alongside the colour change', () => {
    const active = declarations(".shell-nav__link[aria-current='page']");
    const base = declarations('.shell-nav__link');

    // The colour half — unresolvable in jsdom, which returns the `var()` text.
    expect(active).toMatch(/color:\s*var\(--nav-current\)/);
    // The non-colour half: a heavier weight than the unmarked control's...
    expect(/font-weight:\s*700/.test(active)).toBe(true);
    expect(/font-weight:\s*500/.test(base)).toBe(true);
    // ...and a bar inset into the control's own left padding, so it is a shape
    // rather than a colour. Its rendered geometry needs a browser to verify.
    expect(active).toMatch(/box-shadow:\s*inset\s+3px\s+0\s+0\s+0\s+var\(--nav-current\)/);
  });
});
