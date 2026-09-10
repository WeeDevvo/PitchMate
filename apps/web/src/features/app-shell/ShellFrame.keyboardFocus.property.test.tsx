/**
 * Property test for the Shell_Frame's keyboard focus behaviour (task 10.8).
 *
 * **Property 35: Keyboard focus reaches everything, escapes everything, and open
 * surfaces stay put.** *For any* rendered shell route, the first focusable control
 * is the skip link, activating it moves focus to the content region such that the
 * next Tab press enters the content region and reaches no header control; and *for
 * any* open disclosure surface, every control of that surface falls in the focus
 * order immediately after the control that opened it and before every following
 * frame control, focus is confined within neither surface, a Tab press from the
 * surface's last control moves focus to the next focusable control outside it, a
 * Shift+Tab press from its first control moves focus to the control that opened it,
 * the surface stays open in both cases, and focus can be moved away from every
 * interactive control of the frame using the keyboard alone.
 *
 * Four acceptance criteria at once:
 *
 * | Criterion | What it asks | Where it is asserted |
 * | --- | --- | --- |
 * | 13.1 | the Skip_Link is the first focusable control, before the header in document order, and activating it lands focus in the Content_Region so the next Tab reaches a control inside it and none of the header | {@link expectSkipLinkIsFirstTabStop} + {@link expectSkipLinkLandsInContentRegion} |
 * | 13.3 | every interactive control of the frame is reachable and operable by keyboard alone, in a focus order following the visual reading order | {@link expectNoPositiveTabIndex} + {@link expectTabOrderIsDocumentOrder} |
 * | 13.5 | focus can be moved away from every control using the keyboard alone — nothing traps it | {@link expectTabOrderIsDocumentOrder} (every control is left by one Tab, including the last) |
 * | 13.6 | an open surface's controls sit immediately after its trigger and before every following frame control, focus is confined within neither surface, Tab from its last control leaves it, Shift+Tab from its first returns to the trigger, and the surface stays open both ways | {@link expectSurfaceControlsFollowTheirTrigger}, {@link expectTabLeavesSurfaceOpen}, {@link expectShiftTabReturnsToTriggerLeavingSurfaceOpen} |
 *
 * Escape closing the surface and returning focus to its trigger is asserted in
 * {@link expectEscapeClosesAndReturnsFocus} — the other half of "escapes
 * everything", and the behaviour Requirements 5.3, 8.5, and 1.11 each name for
 * their own surface.
 *
 * ### Why this mounts the real frame
 *
 * This is the one property in the shell that is genuinely about the *whole* frame
 * rather than about a component: the claim is a statement about one focus order
 * spanning the skip link, the header's brand, navigation, notification, and
 * account controls, an open surface's own controls, and the Content_Region. A
 * stand-in anywhere in that chain would move the very thing under test, so every
 * participant here is the production component — `ShellFrame`, `SkipLink`,
 * `ContentRegion`, `ShellHeader`, `PrimaryNavigation`, `NotificationIndicator`,
 * `NotificationPanel`, `AccountMenu`, and `Disclosure` — wired exactly as the
 * route table will wire them (task 14.5), over the real notification state machine
 * and a stub transport.
 *
 * Only the Content_Region's children are synthetic, because Requirement 3.7 makes
 * them a later feature's business; they contribute at least one focusable control,
 * which is what Requirement 13.1's "the next Tab press reaches the first focusable
 * control inside the Content_Region" needs to be checkable at all.
 *
 * ### What is generated
 *
 * - **The layout**, since the Compact_Layout collapses the Primary_Navigation
 *   behind a disclosure control and the Wide_Layout renders its four controls
 *   directly (Requirements 1.6, 1.7) — two different focus orders.
 * - **Which surface is open**: none, the compact Primary_Navigation, the
 *   Notification_Panel, or the Account_Menu. The navigation surface is generated
 *   only for the Compact_Layout, where it exists.
 * - **The requested path**, which decides which navigation control is marked
 *   current and which must change nothing about the focus order.
 * - **How many Notification_Records the panel displays**, so the panel's control
 *   count varies — including 0, where the Mark_All_Read_Control is `disabled` and
 *   therefore *not* in the focus order, which is the case most likely to break a
 *   naive "first control of the surface" assumption.
 * - **How many controls the content contributes**, so the tail of the order is not
 *   a fixed length.
 *
 * ### How a Tab press is driven
 *
 * `userEvent`'s `tab()` resolves the destination from the live DOM — the focusable
 * elements in document order, with negative `tabindex` excluded and positive
 * `tabindex` sorted ahead. That is what makes {@link expectNoPositiveTabIndex} part
 * of this property rather than a stylistic aside: the frame's focus order equals its
 * document order *because* nothing carries a positive `tabindex`, so the absence is
 * asserted alongside the traversal rather than assumed by it.
 *
 * The traversal itself is a real key-by-key walk, so a component that installed a
 * Tab handler to confine focus — the thing Requirement 13.6 forbids — would show up
 * as a visited sequence that diverges from document order or that never leaves the
 * surface.
 *
 * Feature: app-shell, Property 35: Keyboard focus reaches everything, escapes
 * everything, and open surfaces stay put
 * Validates: Requirements 13.1, 13.3, 13.5, 13.6
 */
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import fc from 'fast-check';

import { AuthProvider, type AuthState, type SessionManager } from '../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  NotificationCallOutcome,
  NotificationsApi,
} from './api/notificationsApi';
import { AccountMenu } from './components/AccountMenu';
import { Disclosure } from './components/Disclosure';
import { NotificationIndicator } from './components/NotificationIndicator';
import { NotificationPanel } from './components/NotificationPanel';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { SKIP_LINK_LABEL } from './components/SkipLink';
import { HOME_ROUTE, SHELL_DESTINATIONS } from './lib/destinations';
import { ACCOUNT_MENU_LABEL, PRIMARY_NAVIGATION_TOGGLE } from './lib/messages';
import type { NotificationRecord } from './lib/notificationParsing';
import { NotificationCentreProvider } from './state/NotificationCentreContext';
import { SquadScopeProvider } from './state/SquadScopeContext';
import { WIDE_LAYOUT_QUERY, type ShellLayout } from './state/useViewportLayout';
import { ShellFrame } from './ShellFrame';

// --- The generated axes ------------------------------------------------------

/** The header surface a person has opened, if any. */
type OpenSurface = 'navigation' | 'notifications' | 'account';

/** One generated shell rendering. */
interface FrameCase {
  readonly layout: ShellLayout;
  /** The open surface, or `null` while every surface is closed. */
  readonly surface: OpenSurface | null;
  readonly path: string;
  /** How many Notification_Records the panel has to display. */
  readonly recordCount: number;
  /** How many focusable controls the Destination_Content contributes. */
  readonly contentControls: number;
}

const layoutArb: fc.Arbitrary<ShellLayout> = fc.constantFrom('compact', 'wide');

/**
 * Registered Destination paths, plus one under `/app` that resolves to nothing.
 *
 * Resolution decides which navigation control is marked current (Property 4's
 * subject); it must change nothing about the focus order, which is what including
 * the non-resolving path checks.
 */
const pathArb: fc.Arbitrary<string> = fc.constantFrom(
  ...SHELL_DESTINATIONS.map((destination) => destination.path),
  `${HOME_ROUTE}/not-a-destination`,
);

/**
 * 0, 1, and 3 records.
 *
 * 0 matters most: the Mark_All_Read_Control is then `disabled` (Requirement 6.9)
 * and so absent from the focus order, which makes the panel's *first* focusable
 * control the one after it.
 */
const recordCountArb: fc.Arbitrary<number> = fc.constantFrom(0, 1, 3);

/** At least one, so the Tab after a skip has somewhere inside `<main>` to land. */
const contentControlsArb: fc.Arbitrary<number> = fc.constantFrom(1, 2);

/** The surfaces that exist in a given layout — the compact navigation, or not. */
function openableSurfaces(layout: ShellLayout): readonly OpenSurface[] {
  return layout === 'compact'
    ? ['navigation', 'notifications', 'account']
    : ['notifications', 'account'];
}

/** Any rendering, with any surface open or none. */
const frameCaseArb: fc.Arbitrary<FrameCase> = layoutArb.chain((layout) =>
  fc.record({
    layout: fc.constant(layout),
    surface: fc.constantFrom<OpenSurface | null>(null, ...openableSurfaces(layout)),
    path: pathArb,
    recordCount: recordCountArb,
    contentControls: contentControlsArb,
  }),
);

/** Any rendering with exactly one surface open. */
const openFrameCaseArb: fc.Arbitrary<FrameCase & { readonly surface: OpenSurface }> =
  layoutArb.chain((layout) =>
    fc.record({
      layout: fc.constant(layout),
      surface: fc.constantFrom(...openableSurfaces(layout)),
      path: pathArb,
      recordCount: recordCountArb,
      contentControls: contentControlsArb,
    }),
  );

/** Where the Escape key press originates (Requirements 5.3, 8.5, 1.11). */
type EscapeOrigin = 'trigger' | 'surface';

const escapeOriginArb: fc.Arbitrary<EscapeOrigin> = fc.constantFrom(
  'trigger',
  'surface',
);

// --- The layout stub ---------------------------------------------------------

const originalMatchMedia = window.matchMedia;

/**
 * Report the generated layout to `useViewportLayout`.
 *
 * jsdom answers every media query non-matching, which would pin the frame to the
 * Compact_Layout; the Wide_Layout's four directly-rendered navigation controls are
 * a different focus order, so both need to be reachable.
 */
function installLayout(layout: ShellLayout): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: layout === 'wide' && query === WIDE_LAYOUT_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

// --- The transport and session stubs ----------------------------------------

/** The creation instant every generated record carries. */
const CREATED_AT_MS = Date.UTC(2025, 2, 12, 18, 0, 0);

/** Five minutes later, so every relative time label lands in the minutes band. */
const NOW_MS = CREATED_AT_MS + 5 * 60_000;

/** A squad identity the Notification_Records carry; no Squad_Scope is active. */
const SQUAD_IDENTITY = '22222222-2222-4222-8222-222222222222';

/**
 * A minimal authenticated `SessionManager`.
 *
 * `AuthProvider` reads only `getState()` and `subscribe()`, and nothing here
 * performs a session transition. It reports `authenticated`, which is the only
 * state in which the notification centre runs.
 */
function authenticatedSessionManager(): SessionManager {
  return {
    bootstrap: vi.fn((): AuthState => 'authenticated'),
    establish: vi.fn(),
    getState: vi.fn((): AuthState => 'authenticated'),
    getAccessTokenForRequest: vi.fn(async () => ({ token: 'stub' })),
    signOut: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
  } as unknown as SessionManager;
}

/** `count` well-formed unread Notification_Records, newest first once ordered. */
function notifications(count: number): NotificationRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    notificationId: `0000000${index}-1111-4111-8111-1111111111${String(index).padStart(2, '0')}`,
    type: { kind: 'catalogued', value: 'match-confirmed' } as const,
    squadId: SQUAD_IDENTITY,
    title: `Notification ${index + 1}`,
    body: `Body ${index + 1}`,
    createdAtMs: CREATED_AT_MS - index * 1_000,
    readState: 'unread' as const,
  }));
}

/**
 * A Notifications_Api that answers every call at once, so the panel reaches its
 * loaded state within a microtask flush.
 *
 * *When* calls are issued is `state/useNotificationCentre.*`'s subject; what this
 * property needs is a settled panel with a known number of controls in it.
 */
function stubNotificationsApi(records: readonly NotificationRecord[]): NotificationsApi {
  return {
    list: () =>
      Promise.resolve<NotificationCallOutcome>({ kind: 'success', value: [...records] }),
    unreadCount: () =>
      Promise.resolve<CountCallOutcome>({ kind: 'success', value: records.length }),
    markRead: () =>
      Promise.resolve<AcknowledgementOutcome>({ kind: 'success', value: undefined }),
    markAllRead: () => Promise.resolve<CountCallOutcome>({ kind: 'success', value: 0 }),
  };
}

// --- The rendered harness ----------------------------------------------------

/** The synthetic Destination_Content: one `h1` and `count` focusable controls. */
function SuppliedContent({ count }: { readonly count: number }): ReactElement {
  return (
    <div>
      <h1>Squads</h1>
      {Array.from({ length: count }, (_, index) => (
        <button key={index} type="button">
          {`Content control ${index + 1}`}
        </button>
      ))}
    </div>
  );
}

/** Flush the microtasks the stub transport's calls settle in. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Render one whole shell route with every real participant in the focus order,
 * wired the way the shell's route table will wire them (task 14.5).
 */
async function renderShellRoute(frameCase: FrameCase): Promise<HTMLElement> {
  installLayout(frameCase.layout);

  const api = stubNotificationsApi(notifications(frameCase.recordCount));

  const { container } = render(
    <MemoryRouter initialEntries={[frameCase.path]}>
      <AuthProvider manager={authenticatedSessionManager()}>
        <SquadScopeProvider>
          <NotificationCentreProvider
            api={api}
            signOut={vi.fn()}
            // Well outside anything this test spans, so the poll loop never
            // re-enters while a traversal is in progress.
            pollIntervalSeconds={600}
            now={() => NOW_MS}
          >
            <ShellFrame
              navigation={(props) => <PrimaryNavigation {...props} />}
              notifications={({ disclosure }) => (
                <Disclosure
                  id={disclosure.surfaceId}
                  open={disclosure.open}
                  onRequestOpen={disclosure.requestOpen}
                  onRequestClose={disclosure.requestClose}
                  trigger={(triggerProps) => <NotificationIndicator {...triggerProps} />}
                >
                  <NotificationPanel
                    onNavigate={() => disclosure.requestClose('activate')}
                  />
                </Disclosure>
              )}
              account={({ disclosure }) => (
                <AccountMenu disclosure={disclosure} signOut={vi.fn(async () => {})} />
              )}
            >
              <SuppliedContent count={frameCase.contentControls} />
            </ShellFrame>
          </NotificationCentreProvider>
        </SquadScopeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );

  // The centre's mount call settles here rather than mid-traversal.
  await flush();

  return container;
}

/** How each surface's trigger is found, by the accessible name it carries. */
const TRIGGER_NAME: Readonly<Record<OpenSurface, RegExp>> = {
  navigation: new RegExp(`^${PRIMARY_NAVIGATION_TOGGLE}$`),
  // The Notification_Indicator's name carries the Unread_Count, so it is matched
  // on its fixed opening rather than on the whole string.
  notifications: /^Notifications, /,
  account: new RegExp(`^${ACCOUNT_MENU_LABEL}$`),
};

/** The control that opens a surface. */
function triggerFor(surface: OpenSurface): HTMLElement {
  return screen.getByRole('button', { name: TRIGGER_NAME[surface] });
}

/** The open surface element a trigger controls, or `null` while it is closed. */
function surfaceOf(trigger: HTMLElement): HTMLElement | null {
  const id = trigger.getAttribute('aria-controls');
  return id === null ? null : document.getElementById(id);
}

/** Open a surface the way a person does, and let its calls settle. */
async function openSurface(user: UserEvent, surface: OpenSurface): Promise<HTMLElement> {
  await user.click(triggerFor(surface));
  await flush();

  const trigger = triggerFor(surface);
  const opened = surfaceOf(trigger);
  if (opened === null) {
    throw new Error(`The ${surface} surface did not open.`);
  }
  return opened;
}

// --- Reading the focus order -------------------------------------------------

/**
 * The elements a Tab press can reach, mirroring the selector browsers and
 * `userEvent` both use.
 *
 * Stated here rather than imported so the expected order is computed
 * independently of the traversal it is compared against.
 */
const FOCUSABLE_SELECTOR = [
  'input:not([type=hidden]):not([disabled])',
  'button:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  'a[href]',
  '[tabindex]:not([disabled])',
  'details > summary',
].join(', ');

/**
 * The tabbable elements of `root`, in document order.
 *
 * A negative `tabindex` is excluded: such an element is focusable
 * programmatically but absent from the Tab order, which is exactly what the
 * Content_Region and the Notification_Panel root use it for.
 *
 * The result is sorted by document position rather than trusted to come out of
 * `querySelectorAll` that way. jsdom returns a comma-separated selector list's
 * matches grouped *per selector* when the context node is an element rather than
 * the document, which would put every `<button>` of the frame ahead of the Skip_Link
 * and quietly invert the order this file is here to assert.
 */
function tabbables(root: ParentNode): HTMLElement[] {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !(Number(element.getAttribute('tabindex')) < 0),
  );

  return matches.sort((a, b) => {
    if (a === b) {
      return 0;
    }
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
  });
}

/** A description of an element that is useful in a failure message. */
function describeElement(element: Element | null): string {
  if (element === null) {
    return 'null';
  }
  if (element === document.body) {
    return 'body';
  }
  const name = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
  return `${element.tagName.toLowerCase()}[${name.slice(0, 40)}]`;
}

/** The visited sequence, described, for comparison in a readable form. */
function describeAll(elements: readonly (Element | null)[]): string[] {
  return elements.map(describeElement);
}

/**
 * The frame's focus order, with a label per element that stays unique even where
 * two controls carry the same element type and the same accessible name.
 *
 * That case is real and it matters: the Account_Menu's Profile and Settings
 * controls are `<a>` elements named "Profile" and "Settings", and so are two of the
 * Primary_Navigation's. Comparing a traversal against an expected order by
 * description alone would let a swap between those two pairs pass. Labelling each
 * element with its document-order position as well makes every comparison below an
 * identity comparison that still reads as a diff rather than as a wall of HTML.
 */
interface FocusOrder {
  /** Every tabbable control of the frame, in document order. */
  readonly order: readonly HTMLElement[];
  /** The unique label of one element, for an identity comparison. */
  label(element: Element | null): string;
  /** The labels of a visited sequence. */
  labels(elements: readonly (Element | null)[]): string[];
}

/** Read the frame's focus order and its labels, as the DOM currently stands. */
function focusOrderOf(container: HTMLElement): FocusOrder {
  const order = tabbables(container);
  const labels = new Map<Element, string>();
  order.forEach((element, index) => {
    labels.set(element, `${index}:${describeElement(element)}`);
  });

  const label = (element: Element | null): string => {
    if (element === null) {
      return 'null';
    }
    // Anything the Tab order does not contain — `<body>`, the Content_Region — is
    // named without a position, and asserted by identity where it is asserted.
    return labels.get(element) ?? `outside:${describeElement(element)}`;
  };

  return { order, label, labels: (elements) => elements.map(label) };
}

/** Press Tab (or Shift+Tab) `count` times, reporting where focus landed each time. */
async function walk(
  user: UserEvent,
  count: number,
  shift: boolean,
): Promise<(Element | null)[]> {
  const visited: (Element | null)[] = [];
  for (let step = 0; step < count; step += 1) {
    await user.tab({ shift });
    visited.push(document.activeElement);
  }
  return visited;
}

/** Drop keyboard focus, so a traversal starts from the top of the document. */
function releaseFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 13.3: no control carries a positive `tabindex`.
 *
 * This is what makes the frame's focus order *be* its document order — a positive
 * value would hoist a control ahead of the skip link and ahead of everything else,
 * breaking Requirements 13.1 and 13.6 at once — so it is asserted rather than
 * assumed by the traversal below.
 */
function expectNoPositiveTabIndex(container: HTMLElement): void {
  const positive = Array.from(container.querySelectorAll<HTMLElement>('[tabindex]')).filter(
    (element) => Number(element.getAttribute('tabindex')) > 0,
  );

  expect(describeAll(positive)).toEqual([]);
}

/**
 * Requirement 13.6: neither surface declares itself modal.
 *
 * `aria-modal` would tell assistive technology that content outside the surface is
 * inert, which is the opposite of the focus order the requirement describes.
 */
function expectNoModalSurface(container: HTMLElement): void {
  expect(describeAll(Array.from(container.querySelectorAll('[aria-modal]')))).toEqual([]);
}

/**
 * Requirement 13.1: the Skip_Link is rendered before the Shell_Header in document
 * order and is the control the first Tab press reaches.
 */
async function expectSkipLinkIsFirstTabStop(
  user: UserEvent,
  focus: FocusOrder,
): Promise<HTMLElement> {
  const skipLink = screen.getByRole('link', { name: SKIP_LINK_LABEL });
  const banner = screen.getByRole('banner');

  // Before the header in document order…
  expect(
    Boolean(skipLink.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING),
  ).toBe(true);
  expect(banner).not.toContainElement(skipLink);

  // …and therefore the first control a Tab press reaches, which is also position 0
  // of the frame's focus order.
  expect(focus.label(skipLink)).toBe(`0:${describeElement(skipLink)}`);

  releaseFocus();
  await user.tab();
  expect(focus.label(document.activeElement)).toBe(focus.label(skipLink));

  return skipLink;
}

/**
 * Requirement 13.1: activating the Skip_Link moves focus to the Content_Region,
 * such that the next Tab press reaches the first focusable control inside that
 * region and no control of the Shell_Header.
 *
 * Activation is by Enter on the focused link — keyboard alone, which is the point
 * of the control.
 */
async function expectSkipLinkLandsInContentRegion(
  user: UserEvent,
  focus: FocusOrder,
  skipLink: HTMLElement,
): Promise<void> {
  skipLink.focus();
  await user.keyboard('{Enter}');

  const main = screen.getByRole('main');
  const banner = screen.getByRole('banner');

  // Focus is on the region itself, which is focusable but absent from the Tab
  // order — so it is compared by identity, with the description for the diff.
  expect(describeElement(document.activeElement)).toBe(describeElement(main));
  expect(document.activeElement === main).toBe(true);

  const insideContent = tabbables(main);
  expect(insideContent.length).toBeGreaterThan(0);

  await user.tab();

  expect(focus.label(document.activeElement)).toBe(focus.label(insideContent[0]));
  expect(main).toContainElement(document.activeElement as HTMLElement);
  // The header was skipped over entirely, which is the whole purpose.
  expect(banner).not.toContainElement(document.activeElement as HTMLElement);
}

/**
 * Requirements 13.3 and 13.5: every interactive control of the frame is reached by
 * Tab in document order and by Shift+Tab in the reverse of it, and focus leaves
 * every control — including the last — by a single key press.
 *
 * The forward walk is one press longer than the order, so the press *from* the
 * final control is asserted too: that is where a focus trap at the end of the
 * document would show itself.
 */
async function expectTabOrderIsDocumentOrder(
  user: UserEvent,
  focus: FocusOrder,
): Promise<void> {
  const expected = focus.order;
  expect(expected.length).toBeGreaterThan(0);

  releaseFocus();
  const forward = await walk(user, expected.length + 1, false);

  expect(focus.labels(forward.slice(0, expected.length))).toEqual(focus.labels(expected));
  // 13.5: the press from the last control moved focus off it rather than pinning
  // it there.
  expect(forward[expected.length]).not.toBe(expected[expected.length - 1]);

  releaseFocus();
  const backward = await walk(user, expected.length + 1, true);

  expect(focus.labels(backward.slice(0, expected.length))).toEqual(
    focus.labels([...expected].reverse()),
  );
  expect(backward[expected.length]).not.toBe(expected[0]);
}

/**
 * Requirement 13.6: every control of the open surface falls in the focus order
 * immediately after the control that opened it, and before every focusable control
 * of the frame that follows that control.
 *
 * Asserted as one contiguous run in the frame's whole focus order, which is the
 * strongest form of the claim: nothing of the frame is interleaved with the
 * surface, and nothing of the surface sits outside the run.
 */
function expectSurfaceControlsFollowTheirTrigger(
  focus: FocusOrder,
  trigger: HTMLElement,
  surface: HTMLElement,
): readonly HTMLElement[] {
  const surfaceControls = tabbables(surface);
  expect(surfaceControls.length).toBeGreaterThan(0);

  const { order } = focus;
  const triggerIndex = order.indexOf(trigger);
  expect(triggerIndex).toBeGreaterThanOrEqual(0);

  const run = order.slice(triggerIndex + 1, triggerIndex + 1 + surfaceControls.length);
  expect(focus.labels(run)).toEqual(focus.labels(surfaceControls));

  // And nothing after the run belongs to the surface, so the run really is all of it.
  const after = order.slice(triggerIndex + 1 + surfaceControls.length);
  expect(focus.labels(after.filter((element) => surface.contains(element)))).toEqual([]);

  return surfaceControls;
}

/**
 * Requirement 13.6: a Tab press from the last control of the open surface moves
 * focus to the next focusable control of the document outside that surface, and
 * leaves the surface open.
 */
async function expectTabLeavesSurfaceOpen(
  user: UserEvent,
  focus: FocusOrder,
  trigger: HTMLElement,
  surface: HTMLElement,
  surfaceControls: readonly HTMLElement[],
): Promise<void> {
  const last = surfaceControls[surfaceControls.length - 1];
  const expectedNext = focus.order[focus.order.indexOf(last) + 1];
  expect(expectedNext).toBeDefined();

  last.focus();
  await user.tab();

  expect(surface.contains(document.activeElement)).toBe(false);
  expect(focus.label(document.activeElement)).toBe(focus.label(expectedNext));
  // 13.6: focus leaving is not a reason to close — these are disclosures, and the
  // surface a person opened is still there when they come back to it.
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(surfaceOf(trigger)).not.toBeNull();
}

/**
 * Requirement 13.6: a Shift+Tab press from the first control of the open surface
 * moves focus to the control that opened it, and leaves the surface open.
 */
async function expectShiftTabReturnsToTriggerLeavingSurfaceOpen(
  user: UserEvent,
  focus: FocusOrder,
  trigger: HTMLElement,
  surfaceControls: readonly HTMLElement[],
): Promise<void> {
  surfaceControls[0].focus();
  await user.tab({ shift: true });

  expect(focus.label(document.activeElement)).toBe(focus.label(trigger));
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(surfaceOf(trigger)).not.toBeNull();
}

/**
 * "Escapes everything": an Escape key press closes the open surface and returns
 * keyboard focus to the control that opened it, whether the press originated on a
 * control inside the surface or on the trigger itself (Requirements 5.3, 8.5, 1.11).
 */
async function expectEscapeClosesAndReturnsFocus(
  user: UserEvent,
  focus: FocusOrder,
  trigger: HTMLElement,
  surfaceControls: readonly HTMLElement[],
  origin: EscapeOrigin,
): Promise<void> {
  if (origin === 'surface') {
    surfaceControls[0].focus();
  } else {
    trigger.focus();
  }

  await user.keyboard('{Escape}');
  await flush();

  // The trigger element survives the close — only the surface unmounts — so the
  // same node is asserted against rather than re-queried.
  expect(surfaceOf(trigger)).toBeNull();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // Focus is back where the person left it, not stranded on `<body>`.
  expect(focus.label(document.activeElement)).toBe(focus.label(trigger));
}

// --- The property ------------------------------------------------------------

/** A keyboard driver with no artificial delay, so 100 runs stay quick. */
function keyboardUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

describe('ShellFrame — Property 35 (keyboard focus reaches, escapes, and leaves surfaces open)', () => {
  // Feature: app-shell, Property 35: Keyboard focus reaches everything, escapes everything, and open surfaces stay put
  // Validates: Requirements 13.1, 13.3
  it('makes the skip link the first Tab stop and lands focus in the content region', async () => {
    await fc.assert(
      fc.asyncProperty(frameCaseArb, async (frameCase) => {
        const container = await renderShellRoute(frameCase);
        const user = keyboardUser();
        try {
          if (frameCase.surface !== null) {
            await openSurface(user, frameCase.surface);
          }

          expectNoPositiveTabIndex(container);
          expectNoModalSurface(container);

          const focus = focusOrderOf(container);
          const skipLink = await expectSkipLinkIsFirstTabStop(user, focus);
          await expectSkipLinkLandsInContentRegion(user, focus, skipLink);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  // Feature: app-shell, Property 35: Keyboard focus reaches everything, escapes everything, and open surfaces stay put
  // Validates: Requirements 13.3, 13.5, 13.6
  it('reaches every frame control by Tab and Shift+Tab in document order, with an open surface run immediately after its trigger', async () => {
    await fc.assert(
      fc.asyncProperty(frameCaseArb, async (frameCase) => {
        const container = await renderShellRoute(frameCase);
        const user = keyboardUser();
        try {
          let opened: { trigger: HTMLElement; surface: HTMLElement } | null = null;
          if (frameCase.surface !== null) {
            const surface = await openSurface(user, frameCase.surface);
            opened = { trigger: triggerFor(frameCase.surface), surface };
          }

          expectNoPositiveTabIndex(container);
          expectNoModalSurface(container);

          const focus = focusOrderOf(container);
          await expectTabOrderIsDocumentOrder(user, focus);

          if (opened !== null) {
            expectSurfaceControlsFollowTheirTrigger(focus, opened.trigger, opened.surface);
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  // Feature: app-shell, Property 35: Keyboard focus reaches everything, escapes everything, and open surfaces stay put
  // Validates: Requirements 13.5, 13.6
  it('lets focus tab out of an open surface without closing it, and closes it on Escape with focus returned', async () => {
    await fc.assert(
      fc.asyncProperty(openFrameCaseArb, escapeOriginArb, async (frameCase, origin) => {
        const container = await renderShellRoute(frameCase);
        const user = keyboardUser();
        try {
          const surface = await openSurface(user, frameCase.surface);
          const trigger = triggerFor(frameCase.surface);

          expectNoModalSurface(container);

          const focus = focusOrderOf(container);
          const surfaceControls = expectSurfaceControlsFollowTheirTrigger(
            focus,
            trigger,
            surface,
          );

          // 13.6: out of the surface, and back to the trigger, both leaving it open.
          await expectTabLeavesSurfaceOpen(user, focus, trigger, surface, surfaceControls);
          await expectShiftTabReturnsToTriggerLeavingSurfaceOpen(
            user,
            focus,
            trigger,
            surfaceControls,
          );

          // Only then does Escape close it, with focus back on the trigger.
          await expectEscapeClosesAndReturnsFocus(
            user,
            focus,
            trigger,
            surfaceControls,
            origin,
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
