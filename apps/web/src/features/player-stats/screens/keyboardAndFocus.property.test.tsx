/**
 * Property test for keyboard reachability, keyboard operability, the focus
 * indication, and where focus stands after the screen changes what it renders
 * (task 14.3).
 *
 * **Property 34: Every control is keyboard reachable with a visible focus
 * indication.** *For any* rendered condition of the Player_Stats_Screen, every
 * rendered control is reachable by sequential keyboard navigation in render
 * order, is operable by keyboard, and carries a focus indication distinguishable
 * from its unfocused state; and a change of rendered condition between loading,
 * loaded, not-found, and failed leaves focus within the main content region.
 *
 * ### How the four clauses are divided
 *
 * | Clause of Property 34 | How it is asserted |
 * | --- | --- |
 * | reachable by sequential keyboard navigation in render order | a real Tab and Shift+Tab walk of every rendered condition, compared against the tabbable elements in document order, with no positive `tabindex` anywhere (16.4) |
 * | operable by keyboard | every reachable control is a natively operable element that takes focus and is not hidden from assistive technology (16.4), **and** each of the three control kinds the feature ships is driven by a real Enter or Space press and its effect observed (16.4) |
 * | a focus indication distinguishable from the unfocused state | every reachable control resolves a declared `:focus-visible` rule painting an outline in `var(--focus-ring)` at a width a person can see, where the same element's unfocused state declares no outline at all (16.4) |
 * | a change of condition leaves focus in the main content region | the real screen driven from `loading` to each of `loaded`, `not-found`, and `failed` through its Player_Stats_Api, and from `failed` back to `loading` by activating the retry control from the keyboard (16.5) |
 *
 * ### Why the focus indication is read from source text rather than measured
 *
 * jsdom resolves neither a custom property nor a `var()` reference from an
 * imported stylesheet, and `jest-axe` disables axe's colour rules for the same
 * reason (see `playerStatsAccessibility.a11y.test.tsx`). So a computed colour or
 * a computed outline width is not available here *at all*, and asserting one
 * would assert jsdom's default rather than the feature's declaration. What is
 * read instead is the stylesheets' own text: the feature's `:focus-visible`
 * rules are parsed out, matched against each rendered control with the
 * pseudo-class removed — which is what "this rule would style this element while
 * it holds focus" means — and the outline they declare is checked for the
 * `--focus-ring` token and for an absolute width of at least 2 pixels once the
 * Theme-invariant scale is substituted in. This is the approach the
 * Squads_Feature's `screens/keyboardAndContrast.property.test.tsx` already
 * takes.
 *
 * The **contrast** of that indication — `--focus-ring` at 3:1 against every
 * surface it can be drawn on, in both Themes — is Property 35's (task 14.4,
 * `declaredStyles.property.test.ts`), computed there from the declared token
 * tables. It is deliberately not restated here: this file's business is that
 * every control *has* the indication and that nothing suppresses it, and that
 * file's is that the indication can be seen.
 *
 * ### What else is not re-asserted here
 *
 * The accessible name of every control, the absence of a nested interactive
 * control, and every other automated WCAG check belong to task 14.1's audits.
 * The heading outline belongs to Property 33. What a Pairwise_Link navigates
 * *to* belongs to Property 37, and the retry control's single-flight discipline
 * to the load machine's own tests; here they are activated only to show that a
 * keyboard reaches their behaviour at all.
 *
 * The focus seam itself — `components/surfaceFocus.ts` — is covered over
 * arbitrary *sequences* of condition changes by
 * `components/surfaceFocus.property.test.tsx`, including the rule that focus a
 * person placed outside the region is never pulled back in. This file is the
 * assembled-screen counterpart: the same claim, made through the real screen,
 * the real load machine, and a real Player_Stats_Api seam, so that the hook
 * being *wired up* is part of what is asserted.
 *
 * Full accessibility validation also requires manual testing with assistive
 * technologies and expert review; this file establishes the automated floor, not
 * the ceiling.
 *
 * Feature: web-player-stats-screen, Property 34: Every control is keyboard reachable with a visible focus indication
 * Validates: Requirements 16.4, 16.5
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import type { Theme } from '../../../theme';
import { AuthProvider } from '../../auth';
import { PLAYER_STATS_ROUTE, playerStatsPath, squadPath } from '../../squads';
import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import { MAIN_CONTENT_SELECTOR } from '../components/surfaceFocus';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import {
  MEMBERSHIP_ID,
  SCREEN_STATE_CASES,
  SQUAD_ID,
  THEMES,
  applyTheme,
  profileWith,
  resetTheme,
  sessionManagerReporting,
  type PlayerStatsScreenState,
} from '../testing/playerStatsScreenStates';
import {
  PlayerStatsScreen,
  SCREEN_CONDITION_ATTRIBUTE,
  SQUAD_RETURN_CONTROL_SELECTOR,
} from './PlayerStatsScreen';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application — the
 * Player_Stats_Route is a child of the shell's `/app` layout route — and
 * unusable for a screen rendered on its own. The provider is deliberately not
 * part of the shell's public barrel, and reaching past that barrel would breach
 * the module boundary the shell's structural scan enforces, so the one export is
 * stubbed. Everything else of the shell stays the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: (): string | null => null,
  };
});

/* ------------------------------------------------------------------ *
 * Reading the feature's declared stylesheets
 * ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));

/** `features/player-stats/` — every stylesheet of the feature lives under it. */
const FEATURE_ROOT = join(here, '..');

/** Every `.css` file under `dir`, recursively, in a stable order. */
function stylesheetsUnder(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...stylesheetsUnder(path));
    } else if (entry.name.endsWith('.css')) {
      found.push(path);
    }
  }

  return found;
}

interface Stylesheet {
  /** A path relative to `features/`, so a failure names the file readably. */
  readonly name: string;
  readonly source: string;
}

/**
 * Every stylesheet whose declarations can reach a rendered Player_Stats_Screen.
 *
 * The feature's own, and only those: every control the screen renders is the
 * feature's own component, so unlike the Squads_Feature — whose forms render the
 * Auth_Feature's `FormField` — nothing here borrows a control, and therefore no
 * other feature declares a focus indication that could apply.
 */
const STYLESHEETS: readonly Stylesheet[] = stylesheetsUnder(FEATURE_ROOT).map(
  (path) => ({
    name: relative(join(FEATURE_ROOT, '..'), path).replace(/\\/g, '/'),
    source: readFileSync(path, 'utf8'),
  }),
);

/** Drop `/* ... *\/` comments, so documentation text is never read as CSS. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface CssRule {
  /** The stylesheet the rule was declared in. */
  readonly sheet: string;
  /** The selector list split into its parts. */
  readonly parts: readonly string[];
  /** Property to value, later duplicates winning within the one block. */
  readonly declarations: Readonly<Record<string, string>>;
}

function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};

  for (const piece of body.split(';')) {
    const separator = piece.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const property = piece.slice(0, separator).trim().toLowerCase();
    const value = piece.slice(separator + 1).trim();
    if (property.length > 0 && value.length > 0) {
      declarations[property] = value;
    }
  }

  return declarations;
}

/** Every rule of the given stylesheets, in declaration order. */
function parseRules(sheets: readonly Stylesheet[]): readonly CssRule[] {
  const rules: CssRule[] = [];

  for (const sheet of sheets) {
    const source = withoutComments(sheet.source);
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
      const selector = match[1].trim().replace(/\s+/g, ' ');
      if (selector.length === 0 || selector.startsWith('@')) {
        continue;
      }
      rules.push({
        sheet: sheet.name,
        parts: selector.split(',').map((part) => part.trim()),
        declarations: parseDeclarations(match[2]),
      });
    }
  }

  return rules;
}

/** Every rule of every stylesheet of the feature, in declaration order. */
const RULES: readonly CssRule[] = parseRules(STYLESHEETS);

/** The custom properties declared inside the first block matching `selector`. */
function tokenTable(css: string, selector: RegExp): Record<string, string> {
  const block = selector.exec(css);
  expect(block, `no token table found for ${String(selector)}`).not.toBeNull();

  const table: Record<string, string> = {};
  const declaration = /--([\w-]+):\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = declaration.exec(block === null ? '' : block[1])) !== null) {
    table[`--${match[1]}`] = match[2].trim().toLowerCase();
  }

  return table;
}

/**
 * The Theme-invariant scale — spacing, radii, target sizes, and the focus ring's
 * own width and offset — declared once on `:root` in the feature's token table.
 *
 * Read so that `outline: var(--player-stats-focus-width) solid var(--focus-ring)`
 * can be measured as a length rather than taken on trust.
 */
const SCALE: Record<string, string> = tokenTable(
  withoutComments(
    readFileSync(join(FEATURE_ROOT, 'styles', 'playerStatsTokens.css'), 'utf8'),
  ),
  /:root\s*\{([^}]*)\}/,
);

/** The scale tokens substituted into a value, so its lengths are readable. */
function resolveScale(value: string): string {
  let resolved = value;

  for (let pass = 0; pass < 3 && resolved.includes('var(--'); pass += 1) {
    resolved = resolved.replace(
      /var\(\s*(--[\w-]+)\s*\)/g,
      (whole, token: string) => SCALE[token] ?? whole,
    );
  }

  return resolved;
}

/** CSS absolute length units, in pixels, at the initial 16px root font size. */
const UNIT_PX: Readonly<Record<string, number>> = {
  px: 1,
  rem: 16,
  em: 16,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 9.6 / 2.54,
};

/** Every absolute length in a value, in pixels, with the scale resolved. */
function absoluteLengthsPx(value: string): number[] {
  const lengths: number[] = [];
  const pattern = /(-?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm)(?![\w%])/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(resolveScale(value))) !== null) {
    lengths.push(Number(match[1]) * UNIT_PX[match[2]]);
  }

  return lengths;
}

/** One `:focus-visible` rule: the rule, and the parts carrying that state. */
interface FocusRule {
  readonly rule: CssRule;
  readonly parts: readonly string[];
}

/** The `:focus-visible` rules of a rule set, and what they declare. */
function focusRulesOf(rules: readonly CssRule[]): readonly FocusRule[] {
  return rules.flatMap((rule) => {
    const parts = rule.parts.filter((part) => part.includes(':focus-visible'));

    return parts.length > 0 ? [{ rule, parts }] : [];
  });
}

/** The feature's own focus rules — the four it declares. */
const FOCUS_RULES: readonly FocusRule[] = focusRulesOf(RULES);

/**
 * Selector parts a rendered element can be matched against in its **unfocused**
 * state.
 *
 * A part naming any pseudo-class or pseudo-element is excluded: `:focus-visible`
 * describes a state no element is in while the tree is merely being read, and
 * `::after` describes a box that is not an element at all.
 */
function unfocusedParts(rule: CssRule): readonly string[] {
  return rule.parts.filter((part) => !part.includes(':'));
}

/** One declared focus indication: where it was written, and its outline. */
interface FocusIndication {
  /** `sheet: selector`, so a failure names the declaration. */
  readonly where: string;
  /** The declared `outline` value, as written. */
  readonly outline: string;
}

/**
 * The declared focus indications that apply to a rendered element.
 *
 * The element is matched against each `:focus-visible` part with that
 * pseudo-class removed, which is what "this rule would style this element while
 * it holds focus" means. An element with no such rule would fall back to the
 * user-agent ring — drawn in a colour no table declares, which on the dark Theme
 * is exactly the invisible-focus failure Requirement 16.4 rules out.
 */
function declaredFocusIndications(
  element: Element,
  focusRules: readonly FocusRule[] = FOCUS_RULES,
): FocusIndication[] {
  const found: FocusIndication[] = [];

  for (const { rule, parts } of focusRules) {
    const outline = rule.declarations.outline;
    if (outline === undefined) {
      continue;
    }
    for (const part of parts) {
      const withoutState = part.replaceAll(':focus-visible', '');
      if (withoutState.includes(':')) {
        continue;
      }
      if (element.matches(withoutState)) {
        found.push({ where: `${rule.sheet}: ${part}`, outline });
      }
    }
  }

  return found;
}

/**
 * The `outline` values declared for an element in its **unfocused** state.
 *
 * This is the other half of "distinguishable from its unfocused state": the
 * indication is a change, so an element that already carried the same outline
 * unfocused would change nothing on focus, and one carrying `outline: none`
 * unfocused at a higher specificity would be a suppressed ring. Either is a
 * fault, and both are invisible to an assertion that only looks at the focus
 * rule.
 */
function unfocusedOutlines(
  element: Element,
  rules: readonly CssRule[] = RULES,
): string[] {
  const found: string[] = [];

  for (const rule of rules) {
    const outline = rule.declarations.outline;
    if (outline === undefined) {
      continue;
    }
    for (const part of unfocusedParts(rule)) {
      if (element.matches(part)) {
        found.push(`${rule.sheet}: ${part} { outline: ${outline} }`);
      }
    }
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * The keyboard order
 * ------------------------------------------------------------------ */

/**
 * The elements `user-event`'s own Tab implementation considers focusable, so the
 * expected order and the walked order are drawn from one definition.
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

/** The elements Enter or Space operates without a script of the feature's own. */
const NATIVELY_OPERABLE_TAGS = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'] as const;

/**
 * The tabbable elements of `root`, in document order — which for this screen is
 * **render order**: it renders no portal, and the assertion below that nothing
 * carries a positive `tabindex` is what rules out the one other way the two
 * could differ.
 *
 * A negative `tabindex` is excluded: the main content region carries one so that
 * the focus seam can place focus on it without ever adding a tab stop.
 *
 * The result is sorted by document position rather than trusted to come out of
 * `querySelectorAll` that way: jsdom returns a comma-separated selector list's
 * matches grouped **per selector** when the context node is an element, which
 * would quietly invert the very order under test.
 */
function tabbables(root: ParentNode): HTMLElement[] {
  const matches = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !(Number(element.getAttribute('tabindex')) < 0));

  return matches.sort((a, b) => {
    if (a === b) {
      return 0;
    }

    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      ? -1
      : 1;
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

  return `${element.tagName.toLowerCase()}.${element.className || '(no class)'}[${name.slice(0, 40)}]`;
}

/**
 * Labels for a focus order that stay unique even where two controls carry the
 * same element type and the same accessible name — which is real here: the four
 * Pairwise_Sections render the same two display names, so two controls can be
 * indistinguishable by description. Labelling each with its document-order
 * position makes every comparison an identity comparison that still reads as a
 * diff.
 */
interface FocusOrder {
  readonly order: readonly HTMLElement[];
  label(element: Element | null): string;
  labels(elements: readonly (Element | null)[]): string[];
}

function focusOrderOf(container: HTMLElement): FocusOrder {
  const order = tabbables(container);
  const labels = new Map<Element, string>();
  order.forEach((element, index) => {
    labels.set(element, `${String(index)}:${describeElement(element)}`);
  });

  const label = (element: Element | null): string => {
    if (element === null) {
      return 'null';
    }

    return labels.get(element) ?? `outside:${describeElement(element)}`;
  };

  return { order, label, labels: (elements) => elements.map(label) };
}

/** Drop keyboard focus, so a traversal starts from the top of the document. */
function releaseFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

/**
 * Press Tab (or Shift+Tab) `count` times, reporting where focus landed each
 * time.
 *
 * The interactor is set up with no inter-event delay: a traversal of every
 * condition of the screen is thousands of key presses, and the default delay is
 * a real timer between each one. Nothing here depends on that delay — the
 * presses are independent, and every assertion reads the DOM after the press it
 * follows.
 */
async function walk(
  keyboard: UserEvent,
  count: number,
  shift: boolean,
): Promise<(Element | null)[]> {
  const visited: (Element | null)[] = [];

  for (let step = 0; step < count; step += 1) {
    await keyboard.tab({ shift });
    visited.push(document.activeElement);
  }

  return visited;
}

/* ------------------------------------------------------------------ *
 * The three clauses, as assertions over one rendered condition
 * ------------------------------------------------------------------ */

/**
 * Requirement 16.4: no control carries a positive `tabindex`.
 *
 * This is what makes the feature's focus order *be* its render order — a
 * positive value would hoist a control ahead of everything else — so it is
 * asserted rather than assumed by the traversal.
 */
function positiveTabIndexOffences(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[tabindex]'))
    .filter((element) => Number(element.getAttribute('tabindex')) > 0)
    .map(describeElement);
}

/**
 * Requirement 16.4: every control is reached by Tab in render order and by
 * Shift+Tab in the reverse of it, and focus leaves every control — including the
 * last — by a single press, so nothing traps it.
 *
 * The forward walk is one press longer than the order, so the press *from* the
 * final control is asserted too: that is where a focus trap would show itself.
 */
async function expectTabOrderIsRenderOrder(
  keyboard: UserEvent,
  focus: FocusOrder,
  label: string,
): Promise<void> {
  const expected = focus.order;

  releaseFocus();
  const forward = await walk(keyboard, expected.length + 1, false);

  expect(focus.labels(forward.slice(0, expected.length)), label).toEqual(
    focus.labels(expected),
  );
  expect(
    forward[expected.length],
    `${label}: focus did not leave the last control`,
  ).not.toBe(expected[expected.length - 1]);

  releaseFocus();
  const backward = await walk(keyboard, expected.length + 1, true);

  expect(focus.labels(backward.slice(0, expected.length)), label).toEqual(
    focus.labels([...expected].reverse()),
  );
  expect(
    backward[expected.length],
    `${label}: focus did not leave the first control`,
  ).not.toBe(expected[0]);
}

/**
 * Requirement 16.4: every reachable control is operable by keyboard.
 *
 * Operability is the platform's for a native control, so what is asserted here
 * is that every control *is* one: a natively operable element, exposed to
 * assistive technology, that takes focus when asked. A `div` carrying an
 * `onClick` and a `tabindex` would satisfy the traversal above and none of this.
 *
 * That the platform behaviour really reaches the feature's handlers is asserted
 * separately, by driving each control kind with a real Enter or Space press —
 * see {@link ACTIVATIONS}.
 */
function keyboardOperabilityOffences(focus: FocusOrder, label: string): string[] {
  const offenders: string[] = [];

  for (const control of focus.order) {
    const where = `${label}: ${focus.label(control)}`;

    if (
      !NATIVELY_OPERABLE_TAGS.includes(
        control.tagName as (typeof NATIVELY_OPERABLE_TAGS)[number],
      )
    ) {
      offenders.push(`${where} is not a natively operable element`);
    }
    if (control.getAttribute('aria-hidden') === 'true') {
      offenders.push(`${where} is aria-hidden yet reachable`);
    }
    if (control.tagName === 'A' && (control.getAttribute('href') ?? '') === '') {
      offenders.push(`${where} is an anchor with no address to follow`);
    }
    if (control.parentElement?.closest('[aria-hidden="true"]') != null) {
      offenders.push(`${where} is inside an aria-hidden subtree`);
    }

    // Only meaningful for a mounted tree: a detached element takes no focus.
    if (control.isConnected) {
      control.focus();
      if (document.activeElement !== control) {
        offenders.push(`${where} did not take focus when asked`);
      }
    }
  }

  return offenders;
}

/**
 * Requirement 16.4: every reachable control carries a declared focus indication
 * — an outline in `var(--focus-ring)`, at least 2 pixels wide, that the same
 * element does not already carry while unfocused.
 *
 * The indication's **contrast** against the surfaces it can be drawn on is
 * Property 35's, computed from the declared token tables, so every control
 * resolving to that one token inherits the proved result.
 */
function focusIndicationOffences(focus: FocusOrder, label: string): string[] {
  const offenders: string[] = [];

  for (const control of focus.order) {
    const where = `${label}: ${focus.label(control)}`;
    const indications = declaredFocusIndications(control);

    if (indications.length === 0) {
      offenders.push(
        `${where} declares no :focus-visible outline, so it would fall back to the user-agent ring`,
      );
      continue;
    }

    for (const { outline } of indications) {
      if (!outline.includes('var(--focus-ring)')) {
        offenders.push(`${where} paints its indication with ${outline}`);
      }
      // A hairline ring is not a visible indication at every zoom level.
      if (Math.max(...absoluteLengthsPx(outline), 0) < 2) {
        offenders.push(`${where} declares a sub-2px indication: ${outline}`);
      }
    }

    // Distinguishable from the unfocused state: nothing declares an outline on
    // this element outside its focus rule, so the ring is an appearance rather
    // than a repaint — and nothing suppresses it with `outline: none`.
    for (const unfocused of unfocusedOutlines(control)) {
      offenders.push(
        `${where} already declares an outline while unfocused: ${unfocused}`,
      );
    }
  }

  return offenders;
}

/* ------------------------------------------------------------------ *
 * The rendered property
 * ------------------------------------------------------------------ */

/** One generated rendering: a named condition, mounted in one Theme. */
interface RenderedCase {
  readonly state: PlayerStatsScreenState;
  readonly theme: Theme;
}

const RENDERED_CASES: readonly RenderedCase[] = SCREEN_STATE_CASES.flatMap((state) =>
  THEMES.map((theme) => ({ state, theme })),
);

/**
 * Everything the first three clauses of Property 34 claim about one rendered
 * condition in one Theme, reporting how many controls that condition offered.
 */
async function expectReachableAndIndicated(
  renderedCase: RenderedCase,
): Promise<number> {
  const label = `${renderedCase.state.name} in the ${renderedCase.theme} Theme`;
  const rendered = await renderedCase.state.render(renderedCase.theme);
  const focus = focusOrderOf(rendered.container);

  expect(positiveTabIndexOffences(rendered.container), label).toEqual([]);
  expect(keyboardOperabilityOffences(focus, label)).toEqual([]);
  expect(focusIndicationOffences(focus, label)).toEqual([]);

  if (focus.order.length > 0) {
    await expectTabOrderIsRenderOrder(userEvent.setup({ delay: null }), focus, label);
  }

  return focus.order.length;
}

/** Unmount and clear the applied Theme between generated runs. */
function tearDown(): void {
  cleanup();
  resetTheme();
}

afterEach(() => {
  resetTheme();
});

// Feature: web-player-stats-screen, Property 34: Every control is keyboard reachable with a visible focus indication
// Validates: Requirements 16.4
describe('Property 34 — every rendered condition, in both Themes', () => {
  it('reaches every control in render order, operable, with a declared focus indication', async () => {
    const visited = new Set<string>();
    const controlCounts = new Map<string, number>();

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...RENDERED_CASES), async (renderedCase) => {
        visited.add(`${renderedCase.state.name}|${renderedCase.theme}`);
        try {
          controlCounts.set(
            renderedCase.state.name,
            await expectReachableAndIndicated(renderedCase),
          );
        } finally {
          // `cleanup` runs per test, not per generated run, and the Tab walk
          // reads the whole document — so a tree left mounted would have the
          // next run walking the previous one's controls as well as its own.
          tearDown();
        }
      }),
      {
        numRuns: 100,
        // Every condition in both Themes, run before the randomised draws, so
        // the property's "for any rendered condition" is exhaustive rather than
        // sampled.
        examples: RENDERED_CASES.map((renderedCase) => [renderedCase] as const),
      },
    );

    // And proved to be exhaustive, rather than assumed from the option above.
    expect(visited.size).toBe(RENDERED_CASES.length);

    // Non-vacuity: the traversal asserts nothing about a condition that offers
    // no control, and **every** condition of this screen offers at least the way
    // back to the squad (Requirement 1.6) — so a condition that stopped
    // rendering one would fail here rather than pass silently.
    expect(
      [...controlCounts]
        .filter(([, count]) => count === 0)
        .map(([name]) => name),
    ).toEqual([]);

    // And the richest condition really is walked control by control: four
    // populated Pairwise_Sections of two entries each, plus the way out.
    expect(controlCounts.get('loaded, pairwise populated')).toBe(9);
  }, 240_000);
});

/* ------------------------------------------------------------------ *
 * Driving the real screen
 * ------------------------------------------------------------------ */

/** The control standing in for the App_Shell frame's own, outside the screen. */
const OUTSIDE_CONTROL_TESTID = 'outside-the-screen';

/** Where the driven tree reports the path it is on. */
const PATH_PROBE_TESTID = 'current-path';

/** A `GetPlayerProfile` call this test settles when it chooses to. */
interface DeferredApi {
  readonly api: PlayerStatsApi;
  /** How many calls have been issued. */
  issued(): number;
  /** Settle the oldest call awaiting a response, and apply the update. */
  settle(outcome: CallResult<PlayerProfile>): Promise<void>;
}

/** One macrotask, with every resulting React update applied. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * A Player_Stats_Api whose calls hang until this test settles them.
 *
 * The fixture's `createStubApi` answers from a list fixed before the mount,
 * which is what a *condition* needs; a *change* of condition needs the moment of
 * settling to be ours, so that focus can be placed while the call is still in
 * flight and the change observed from there.
 */
function createDeferredApi(): DeferredApi {
  const awaiting: ((outcome: CallResult<PlayerProfile>) => void)[] = [];
  let issued = 0;

  return {
    api: {
      getPlayerProfile() {
        issued += 1;

        return new Promise<CallResult<PlayerProfile>>((resolve) => {
          awaiting.push(resolve);
        });
      },
    },
    issued: () => issued,
    async settle(outcome) {
      const resolve = awaiting.shift();

      if (resolve === undefined) {
        throw new Error('no GetPlayerProfile call awaits a response');
      }

      resolve(outcome);
      await tick();
    },
  };
}

/** The path the driven tree is on, read from the router itself. */
function PathProbe(): ReactElement {
  const location = useLocation();

  return <span data-testid={PATH_PROBE_TESTID}>{location.pathname}</span>;
}

/** One driven mount of the real screen. */
interface DrivenScreen extends DeferredApi {
  readonly container: HTMLElement;
  readonly user: UserEvent;
  /** The condition the screen reports, from its own attribute. */
  condition(): string | null;
  /** The main content region the focus seam places focus into. */
  region(): HTMLElement;
  /** The control outside the screen, standing in for the shell frame's own. */
  outsideControl(): HTMLElement;
  /** The path the router is on. */
  path(): string;
}

/** Find one element, failing with what was looked for rather than on `null`. */
function require1(container: ParentNode, selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector);

  if (found === null) {
    throw new Error(`the driven screen rendered no ${selector}`);
  }

  return found;
}

/**
 * Mount the real Player_Stats_Screen with a call awaiting a response — the
 * `loading` condition — inside a real router and a real `AuthProvider`, with a
 * control outside the screen and a probe reporting the path.
 */
async function driveScreen(theme: Theme): Promise<DrivenScreen> {
  const deferred = createDeferredApi();

  applyTheme(theme);
  const user = userEvent.setup({ delay: null });
  const { container } = render(
    <AuthProvider manager={sessionManagerReporting('authenticated')}>
      <MemoryRouter initialEntries={[playerStatsPath(SQUAD_ID, MEMBERSHIP_ID)]}>
        {/* Outside the screen, and before it, so a position taken here is one
            the screen's focus seam must leave alone. */}
        <button type="button" data-testid={OUTSIDE_CONTROL_TESTID}>
          Outside the screen
        </button>
        <PathProbe />
        <Routes>
          <Route
            path={PLAYER_STATS_ROUTE}
            element={<PlayerStatsScreen api={deferred.api} />}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  // The mount effect issues the call; the second tick applies nothing, and is
  // what makes "still awaiting a response" an observed state rather than a hope.
  await tick();
  await tick();

  const driven: DrivenScreen = {
    ...deferred,
    container,
    user,
    condition: () =>
      require1(container, `[${SCREEN_CONDITION_ATTRIBUTE}]`).getAttribute(
        SCREEN_CONDITION_ATTRIBUTE,
      ),
    region: () => require1(container, MAIN_CONTENT_SELECTOR),
    outsideControl: () =>
      require1(container, `[data-testid="${OUTSIDE_CONTROL_TESTID}"]`),
    path: () =>
      require1(container, `[data-testid="${PATH_PROBE_TESTID}"]`).textContent ?? '',
  };

  expect(driven.issued()).toBe(1);
  expect(driven.condition()).toBe('loading');

  return driven;
}

/** Press Enter, or Space, on whatever holds focus. */
async function press(user: UserEvent, key: 'enter' | 'space'): Promise<void> {
  await user.keyboard(key === 'enter' ? '{Enter}' : ' ');
  await tick();
}

/* ------------------------------------------------------------------ *
 * Keyboard operability, driven control kind by control kind
 * ------------------------------------------------------------------ */

/** The three control kinds the Player_Stats_Screen renders. */
type ControlKind = 'retry' | 'squad-return' | 'pairwise-link';

/** One activation to drive: a control kind, and the key pressed on it. */
interface Activation {
  readonly kind: ControlKind;
  readonly key: 'enter' | 'space';
}

/**
 * Every control kind the screen renders, with the keys its element type is
 * operated by.
 *
 * The retry control and a Pairwise_Link are native `<button>`s, which both Enter
 * and Space activate. The way back to the squad is a `<Link>`, and therefore an
 * anchor, which Enter follows and Space does not — that is the platform's
 * behaviour for a link, not a gap: Space scrolls the page. Asserting a Space
 * activation of the anchor would be asserting something no browser does.
 */
const ACTIVATIONS: readonly Activation[] = [
  { kind: 'retry', key: 'enter' },
  { kind: 'retry', key: 'space' },
  { kind: 'pairwise-link', key: 'enter' },
  { kind: 'pairwise-link', key: 'space' },
  { kind: 'squad-return', key: 'enter' },
];

/**
 * Requirement 16.4: the control kind is reached from the keyboard and its
 * behaviour happens.
 *
 * Each kind is driven in the condition that renders it, and the effect asserted
 * is the one that control exists for — a further call for the retry, a
 * navigation for the two links. The retry additionally asserts Requirement
 * 16.5's claim at the transition it causes: activating it moves the screen from
 * `failed` to `loading`, which unmounts the very control just pressed, and focus
 * must not be left on the document body.
 */
async function expectKeyboardOperable(activation: Activation): Promise<void> {
  const label = `${activation.kind} by ${activation.key}`;
  const driven = await driveScreen('dark');

  if (activation.kind === 'retry') {
    await driven.settle({ kind: 'transport-failure' });
    expect(driven.condition(), label).toBe('failed');

    const retry = require1(driven.container, '.player-stats-failure__retry');
    retry.focus();
    expect(retry, label).toHaveFocus();

    await press(driven.user, activation.key);

    // The one thing the retry control does (Requirement 2.8).
    expect(driven.issued(), label).toBe(2);
    expect(driven.condition(), label).toBe('loading');

    // 16.5: the failure body went with the retry, so the pressed control no
    // longer exists; a keyboard user is left inside the screen all the same.
    expect(retry.isConnected, `${label}: the retry control was not replaced`).toBe(
      false,
    );
    expect(driven.region().contains(document.activeElement), label).toBe(true);

    return;
  }

  if (activation.kind === 'squad-return') {
    const link = require1(driven.container, SQUAD_RETURN_CONTROL_SELECTOR);
    link.focus();
    expect(link, label).toHaveFocus();

    await press(driven.user, activation.key);

    // 1.6: the way out, followed from the keyboard with no pointer involved.
    expect(driven.path(), label).toBe(squadPath(SQUAD_ID));

    return;
  }

  // A Pairwise_Link, which exists only once a profile is held.
  await driven.settle({ kind: 'success', value: profileWith({}) });
  expect(driven.condition(), label).toBe('loaded');

  const pairwise = require1(
    driven.container,
    '[data-player-stats-pairwise-link="true"]',
  );
  const target = pairwise.getAttribute('data-player-stats-path');
  expect(target, label).not.toBeNull();

  pairwise.focus();
  expect(pairwise, label).toHaveFocus();

  await press(driven.user, activation.key);

  // 10.6: that entry's own profile, in this squad — reached by keyboard alone.
  expect(driven.path(), label).toBe(target);
  // The route pattern is the same one, so the screen stays mounted and the new
  // subject is loaded rather than the old one's profile left on screen.
  expect(driven.issued(), label).toBe(2);
}

// Feature: web-player-stats-screen, Property 34: Every control is keyboard reachable with a visible focus indication
// Validates: Requirements 16.4, 16.5
describe('Property 34 — every control kind is operated from the keyboard', () => {
  it('activates each control kind by the keys its element type answers', async () => {
    const driven = new Set<string>();

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ACTIVATIONS), async (activation) => {
        driven.add(`${activation.kind}|${activation.key}`);
        try {
          await expectKeyboardOperable(activation);
        } finally {
          tearDown();
        }
      }),
      {
        numRuns: 100,
        examples: ACTIVATIONS.map((activation) => [activation] as const),
      },
    );

    expect(driven.size).toBe(ACTIVATIONS.length);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 * Where focus stands after a change of rendered condition (16.5)
 * ------------------------------------------------------------------ */

/** One change of rendered condition, reached by settling the call in flight. */
interface ConditionChange {
  /** The condition the screen reports afterwards. */
  readonly to: 'loaded' | 'not-found' | 'failed';
  /** What the Player_Stats_Api answers to get there. */
  readonly outcome: CallResult<PlayerProfile>;
}

/**
 * The three changes a settling call can produce from `loading` — which is every
 * change Requirement 16.5 enumerates that an arriving response can cause. The
 * fourth, `failed` back to `loading`, is caused by a person activating the retry
 * control and is driven in {@link expectKeyboardOperable}.
 */
const CONDITION_CHANGES: readonly ConditionChange[] = [
  { to: 'loaded', outcome: { kind: 'success', value: profileWith({}) } },
  { to: 'not-found', outcome: { kind: 'not-found' } },
  { to: 'failed', outcome: { kind: 'transport-failure' } },
];

/** Where a keyboard user stands at the moment the condition changes. */
type FocusPlacement = 'inside' | 'body' | 'outside';

const FOCUS_PLACEMENTS: readonly FocusPlacement[] = ['inside', 'body', 'outside'];

/** One generated transition: a change, a placement before it, and a Theme. */
interface TransitionCase {
  readonly change: ConditionChange;
  readonly placement: FocusPlacement;
  readonly theme: Theme;
}

const TRANSITION_CASES: readonly TransitionCase[] = CONDITION_CHANGES.flatMap(
  (change) =>
    FOCUS_PLACEMENTS.flatMap((placement) =>
      THEMES.map((theme) => ({ change, placement, theme })),
    ),
);

/**
 * Requirement 16.5: a change of rendered condition leaves a keyboard user's
 * position within the main content region.
 *
 * Both halves of that are asserted, because both are the requirement. A position
 * *inside* the screen — or one dropped to the document body, which is what a
 * browser reports once the focused control has been unmounted — ends inside the
 * region. A position a person took *outside* the screen, in the App_Shell
 * frame's own controls, is left exactly where they put it: dragging them into
 * the body would destroy a position just as surely as dropping them onto
 * `<body>` would.
 */
async function expectFocusSurvives(transition: TransitionCase): Promise<void> {
  const { change, placement, theme } = transition;
  const label = `loading to ${change.to} with focus ${placement} in the ${theme} Theme`;
  const driven = await driveScreen(theme);

  const inside = require1(driven.container, SQUAD_RETURN_CONTROL_SELECTOR);
  const outside = driven.outsideControl();

  if (placement === 'inside') {
    inside.focus();
    expect(inside, label).toHaveFocus();
  } else if (placement === 'outside') {
    outside.focus();
    expect(outside, label).toHaveFocus();
  } else {
    releaseFocus();
    expect(document.activeElement, label).toBe(document.body);
  }

  await driven.settle(change.outcome);

  expect(driven.condition(), label).toBe(change.to);

  if (placement === 'outside') {
    expect(document.activeElement, `${label}: a chosen position was moved`).toBe(
      outside,
    );

    return;
  }

  const active = document.activeElement;
  expect(active, `${label}: focus was dropped to the document body`).not.toBe(
    document.body,
  );
  expect(
    driven.region().contains(active),
    `${label}: focus landed on ${describeElement(active)}, outside the main content region`,
  ).toBe(true);
}

// Feature: web-player-stats-screen, Property 34: Every control is keyboard reachable with a visible focus indication
// Validates: Requirements 16.5
describe('Property 34 — a change of rendered condition keeps a keyboard position', () => {
  it('leaves focus inside the main content region for every change that lost it', async () => {
    const covered = new Set<string>();

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TRANSITION_CASES), async (transition) => {
        covered.add(
          `${transition.change.to}|${transition.placement}|${transition.theme}`,
        );
        try {
          await expectFocusSurvives(transition);
        } finally {
          tearDown();
        }
      }),
      {
        numRuns: 100,
        examples: TRANSITION_CASES.map((transition) => [transition] as const),
      },
    );

    expect(covered.size).toBe(TRANSITION_CASES.length);
  }, 180_000);

  it('really does unmount the control that held focus, for every change', async () => {
    // Non-vacuity for the property above: if a change of condition reused the
    // control a person was standing on, focus would never be lost and the claim
    // would hold for a reason that has nothing to do with the focus seam.
    for (const change of CONDITION_CHANGES) {
      const driven = await driveScreen('dark');

      try {
        const held = require1(driven.container, SQUAD_RETURN_CONTROL_SELECTOR);
        held.focus();

        await driven.settle(change.outcome);

        expect(
          held.isConnected,
          `the ${change.to} condition reused the control that held focus`,
        ).toBe(false);
      } finally {
        tearDown();
      }
    }
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * The readers themselves
 * ------------------------------------------------------------------ */

/** A detached tree, for checking the readers rather than a screen. */
function fragment(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;

  return host;
}

describe('the rendered checks are not vacuous', () => {
  /*
   * The counterpart to every clean assertion above: each reader has to report
   * the fault it exists to find. Without this, a reader that matched nothing — a
   * mistyped pseudo-class, a selector list split the wrong way — would let every
   * condition pass while proving nothing at all.
   */

  it('finds the feature’s declared focus indications, and none for an unstyled control', () => {
    // Every control the screen renders, by class, and one that is not the
    // feature's at all.
    for (const className of [
      'player-stats-failure__retry',
      'player-stats-squad-link',
      'player-stats-pairwise__link',
    ]) {
      const control = require1(
        fragment(`<button class="${className}">Control</button>`),
        'button',
      );
      const indications = declaredFocusIndications(control);

      expect(indications, className).toHaveLength(1);
      expect(indications[0].outline, className).toContain('var(--focus-ring)');
      // The declared width, read through the Theme-invariant scale rather than
      // assumed: `var(--player-stats-focus-width)` resolves to 3px.
      expect(absoluteLengthsPx(indications[0].outline), className).toContain(3);
      expect(unfocusedOutlines(control), className).toEqual([]);
    }

    expect(
      declaredFocusIndications(
        require1(fragment('<button class="not-a-real-control">x</button>'), 'button'),
      ),
    ).toEqual([]);
  });

  it('resolves the focus width from the feature’s own scale', () => {
    expect(SCALE['--player-stats-focus-width']).toBe('3px');
    expect(resolveScale('var(--player-stats-focus-width) solid var(--focus-ring)')).toBe(
      '3px solid var(--focus-ring)',
    );
  });

  it('reports a control that is not a natively operable element, and an unindicated one', () => {
    const tree = fragment(`
      <div tabindex="0">A control that is not one</div>
      <button class="not-a-real-control">Unstyled</button>
    `);
    const focus = focusOrderOf(tree);

    expect(focus.order).toHaveLength(2);
    expect(keyboardOperabilityOffences(focus, 'the guard')).toEqual([
      expect.stringContaining('is not a natively operable element'),
    ]);
    expect(focusIndicationOffences(focus, 'the guard')).toEqual([
      expect.stringContaining('declares no :focus-visible outline'),
      expect.stringContaining('declares no :focus-visible outline'),
    ]);
  });

  it('reports an aria-hidden control, one inside a hidden subtree, and an addressless anchor', () => {
    const tree = fragment(`
      <button class="player-stats-failure__retry" aria-hidden="true">Hidden</button>
      <div aria-hidden="true">
        <button class="player-stats-failure__retry">Inside something hidden</button>
      </div>
      <a class="player-stats-squad-link" href="">Nowhere</a>
    `);

    expect(keyboardOperabilityOffences(focusOrderOf(tree), 'the guard')).toEqual([
      expect.stringContaining('is aria-hidden yet reachable'),
      expect.stringContaining('is inside an aria-hidden subtree'),
      expect.stringContaining('is an anchor with no address to follow'),
    ]);
  });

  it('excludes a negative tabindex from the order and reports a positive one', () => {
    // The main content region is exactly the first of these: a programmatic
    // focus target that is never a tab stop.
    const tree = fragment(`
      <div tabindex="-1" data-player-stats-main="true">the region</div>
      <button tabindex="2">hoisted</button>
    `);

    expect(focusOrderOf(tree).order.map((element) => element.tagName)).toEqual([
      'BUTTON',
    ]);
    expect(positiveTabIndexOffences(tree)).toHaveLength(1);
  });

  it('reports a suppressed ring and an indication that is not a change', () => {
    // The two faults a focus-rule-only reader cannot see, each proved against a
    // rule set written here: the feature declares neither, which is why the
    // reader has to be shown a stylesheet that does.
    const control = require1(
      fragment('<button class="player-stats-failure__retry">Try again</button>'),
      'button',
    );

    // The feature's own rules declare no unfocused outline for it.
    expect(unfocusedOutlines(control)).toEqual([]);

    const suppressing = parseRules([
      {
        name: 'the guard',
        source: `
          .player-stats-failure__retry { outline: none; }
          .player-stats-failure__retry:focus-visible { outline: 3px solid var(--focus-ring); }
        `,
      },
    ]);

    expect(unfocusedOutlines(control, suppressing)).toEqual([
      'the guard: .player-stats-failure__retry { outline: none }',
    ]);

    // And a focus rule that paints with the wrong thing, or too thin a ring, is
    // read for what it declares rather than for the fact that it exists.
    const wrong = focusRulesOf(
      parseRules([
        {
          name: 'the guard',
          source: '.player-stats-failure__retry:focus-visible { outline: 1px solid red; }',
        },
      ]),
    );
    const [indication] = declaredFocusIndications(control, wrong);

    expect(indication.outline).toBe('1px solid red');
    expect(indication.outline.includes('var(--focus-ring)')).toBe(false);
    expect(Math.max(...absoluteLengthsPx(indication.outline), 0)).toBeLessThan(2);
  });
});
