/**
 * Property test for keyboard reachability and the declared contrast floors
 * (task 16.4), plus the layout residue Requirement 19.10 leaves behind.
 *
 * **Property 47: Every control is reachable in document order with a visible
 * focus indication in both themes.** *For any* rendered state of each screen and
 * for each of the dark and light Themes, every interactive control is reachable by
 * keyboard in document order, is operable by keyboard, and carries a focus
 * indication whose contrast against adjacent colours is at least 3 to 1, and every
 * text value renders at a contrast of at least 4.5 to 1 against its background,
 * computed from the declared token tables.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MANUAL BROWSER VERIFICATION REQUIRED — Requirement 19.10                  │
 * │                                                                           │
 * │ Requirement 19.10 is about **rendered geometry**: at every viewport width  │
 * │ from 360 to 1920 pixels, the rendered content width may not exceed the     │
 * │ viewport and the document may need no horizontal scrolling, verified at    │
 * │ 360, 767, 768, 1024, and 1920. jsdom computes no layout — every box is     │
 * │ zero-sized, no media query is evaluated, and no stylesheet cascade reaches │
 * │ a computed style — so this cannot be verified automatically here. What the │
 * │ last section of this file asserts instead is that the feature declares     │
 * │ **one fluid layout mode** (no breakpoint at all, so the same layout holds  │
 * │ at each of the five widths) and **no fixed width exceeding any of those    │
 * │ five widths**. That is a floor, not a proof.                              │
 * │                                                                           │
 * │ Still to be checked by hand in a real browser, at 360, 767, 768, 1024, and │
 * │ 1920 CSS pixels, in both Themes:                                          │
 * │                                                                           │
 * │  • no part of the Squads_Home, the Squad_Screen (inside the App_Shell      │
 * │    frame), or the Invite_Landing_Route is wider than the viewport, and the │
 * │    document needs no horizontal scrolling;                                │
 * │  • with real content in place: a long unbroken squad name, a long unbroken │
 * │    display name, an Invite_Link and Invite_Code (both long, opaque, and    │
 * │    unbreakable), a Player_Row carrying two admin controls, and an open     │
 * │    form or confirmation over a populated screen;                           │
 * │  • at a raised browser text size, since every type size here is relative. │
 * │                                                                           │
 * │ Requirement 19.5's contrast is computed from the **declared token tables** │
 * │ below. That catches a bad token and a bad declared composite; it cannot    │
 * │ catch a composite a browser paints differently — an inherited colour over  │
 * │ an image, a translucent overlay, a forced-colours mode. Those need a       │
 * │ browser too.                                                              │
 * │                                                                           │
 * │ Full accessibility validation also requires manual testing with assistive  │
 * │ technologies and expert review; this file establishes the automated floor, │
 * │ not the ceiling.                                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ### How the four clauses are divided
 *
 * | Clause of Property 47 | How it is asserted |
 * | --- | --- |
 * | reachable by keyboard in document order | a real Tab and Shift+Tab walk of every rendered state, compared against the tabbable elements in document order (Requirement 19.4) |
 * | operable by keyboard | every tabbable is a natively operable element, is programmatically focusable, is not `aria-hidden`, and is left again by one key press — nothing traps focus (19.4) |
 * | a focus indication at 3:1 | every rendered control resolves a declared `:focus-visible` outline painting `var(--pm-focus-ring)`, and that token is measured at 3:1 against every surface it can be drawn on (19.4, 19.5) |
 * | text at 4.5:1 | for every rendered text node, the colour token and the background token that **the declared cascade** gives it, measured in the active Theme (19.5) |
 *
 * ### Why contrast is computed from source text
 *
 * jsdom resolves neither a custom property nor a `var()` reference from an
 * imported stylesheet, and `jest-axe` disables axe's colour rules for exactly that
 * reason (see `squadsAccessibility.a11y.test.tsx`). So the token tables in
 * `styles/squadsTokens.css` are read as **source text**, the declared values are
 * parsed out of the `:root, [data-theme='dark']` and `[data-theme='light']` tables,
 * and WCAG 2.1 relative luminance and contrast ratios are computed here. The same
 * approach the App_Shell takes in `features/app-shell/styles/theme.contrast.property.test.ts`.
 *
 * The **shared theme tables** are read too: `styles/squadsTokens.css` restates the
 * ten shared token names because the Invite_Landing_Route renders outside the
 * App_Shell frame and so cannot inherit them, and a restated value can drift. Each
 * shared name is therefore compared against the App_Shell's, the Auth_Feature's,
 * and the marketing landing's own tables, so a control looks the same on an auth
 * screen, inside the shell, and on a squads screen — or this fails.
 *
 * `features/auth/components/FormField.css` is read for the same reason: every text
 * field of every squads form is the Auth_Feature's `FormField`, reached through its
 * public barrel, so the declared focus indication of those fields lives there. It
 * is read, never modified.
 *
 * ### What is not re-asserted here
 *
 * The accessible name of every control, the absence of a nested interactive
 * control, and every other automated WCAG check belong to task 16.1's audits.
 * Focus **entry** into an opened surface and its **return** to the opener belong to
 * Property 46. What a control does when activated belongs to the property that
 * owns that control. This file is about the order controls are reached in, the
 * indication they carry while focused, and the colours the tables declare.
 *
 * One surface is covered by the declared scan and not by the rendered walk: the
 * Invite_Reveal, which exists only while a `GenerateInvite` has settled, and the
 * shared fixture's mutations deliberately never settle. Its declared colours and
 * its declared focus indication are measured with everything else.
 *
 * Feature: web-squads-screens, Property 47: Every control is reachable in document
 * order with a visible focus indication in both themes
 * Validates: Requirements 19.4, 19.5, 19.10
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Theme } from '../../../theme';
import { resolveColour } from '../../../design/contrast';
import designTokens from '../../../design/tokens.json';
import {
  SCREEN_STATE_CASES,
  THEMES,
  resetTheme,
  type ScreenStateCase,
} from '../testing/squadsScreenStates';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application and unusable for a
 * screen rendered on its own. The provider is deliberately not part of the shell's
 * public barrel, so the one export is stubbed and everything else of the shell
 * stays the shell's own.
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
 * Reading the declared stylesheets
 * ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));

/** `features/squads/` — every stylesheet of the feature lives under it. */
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

/**
 * The shared component library's stylesheets. The squads screens render its
 * SquadCard, PlayerRow, Avatar, Sidebar, NavItem, TextField and Card, so their
 * declarations reach a rendered squads screen. They are read **before** the
 * feature's own sheets, as the browser loads them (each squads component imports
 * the library before its own stylesheet), so a squads rule wins a tie with the
 * library rule it refines.
 */
const UI_ROOT = join(FEATURE_ROOT, '..', '..', 'ui');

const UI_STYLESHEET_PATHS = readdirSync(UI_ROOT)
  .filter((name) => name.endsWith('.css'))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => join(UI_ROOT, name));

const TOKENS_PATH = join(FEATURE_ROOT, 'styles', 'squadsTokens.css');

const tokensSource = readFileSync(TOKENS_PATH, 'utf8');

interface Stylesheet {
  /** A path relative to `src/`, so a failure names the file readably. */
  readonly name: string;
  readonly source: string;
}

const FEATURE_STYLESHEET_PATHS = stylesheetsUnder(FEATURE_ROOT);

/** Every stylesheet whose declarations can reach a rendered squads screen. */
const STYLESHEETS: readonly Stylesheet[] = [
  ...UI_STYLESHEET_PATHS,
  ...FEATURE_STYLESHEET_PATHS,
].map((path) => ({
  name: relative(join(FEATURE_ROOT, '..', '..'), path).replace(/\\/g, '/'),
  source: readFileSync(path, 'utf8'),
}));

/** The feature's own stylesheets, by the same names. */
const FEATURE_SHEET_NAMES = new Set(
  FEATURE_STYLESHEET_PATHS.map((path) =>
    relative(join(FEATURE_ROOT, '..', '..'), path).replace(/\\/g, '/'),
  ),
);

/** Drop `/* ... *\/` comments, so documentation text is never read as CSS. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface CssRule {
  /** The stylesheet the rule was declared in. */
  readonly sheet: string;
  /** The full selector list, as written. */
  readonly selector: string;
  /** The selector list split into its parts. */
  readonly parts: readonly string[];
  /** Property to value, later duplicates winning within the one block. */
  readonly declarations: Readonly<Record<string, string>>;
  /** Position across the whole set, for resolving equal-specificity ties. */
  readonly order: number;
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

/**
 * Every rule of every stylesheet, in declaration order.
 *
 * One flat list rather than one per file: each class of the feature is declared in
 * exactly one stylesheet, so a cross-file specificity tie cannot arise, and a flat
 * list is what makes "which declaration wins for this element" answerable at all.
 */
const RULES: readonly CssRule[] = (() => {
  const rules: Omit<CssRule, 'order'>[] = [];

  for (const sheet of STYLESHEETS) {
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
        selector,
        parts: selector.split(',').map((part) => part.trim()),
        declarations: parseDeclarations(match[2]),
      });
    }
  }

  return rules.map((rule, order) => ({ ...rule, order }));
})();

/** The token a value reads, or `null` where it names no custom property. */
function tokenIn(value: string): string | null {
  const match = /var\(\s*(--[\w-]+)\s*\)/.exec(value);
  return match === null ? null : match[1];
}

/** Every token a value reads, in order. */
function tokensIn(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1]);
}

/* ------------------------------------------------------------------ *
 * WCAG 2.1 relative luminance and contrast ratio
 *
 * Computed here rather than read from a browser: the values under test are source
 * text, and the arithmetic is the definition given in WCAG 2.1 (Understanding
 * SC 1.4.3 / 1.4.11).
 * ------------------------------------------------------------------ */

/** The three 0..255 sRGB channels of a `#rrggbb` value. */
function channels(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    throw new Error(`not a six-digit hex colour: ${hex}`);
  }
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ];
}

/** Linearise one sRGB channel, per the WCAG 2.1 definition. */
function linearise(channel8Bit: number): number {
  const channel = channel8Bit / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The WCAG 2.1 relative luminance of a `#rrggbb` value, in 0..1. */
function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return (
    0.2126 * linearise(red) +
    0.7152 * linearise(green) +
    0.0722 * linearise(blue)
  );
}

/** The WCAG 2.1 contrast ratio between two `#rrggbb` values, in 1..21. */
function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ *
 * The declared token tables
 *
 * Colours are the design system's: every stylesheet here paints with `--pm-*`
 * tokens, whose values per Theme come from `src/design/tokens.json` (the same
 * source `tokens.css` is generated from). The feature's own table holds its
 * Theme-invariant scale only.
 * ------------------------------------------------------------------ */

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

const strippedTokens = withoutComments(tokensSource);

/** Every design-system colour token, resolved for one Theme: `--pm-<name>` to its value. */
function designTable(theme: Theme): Record<string, string> {
  return Object.fromEntries(
    designTokens.color.tokens.map((token) => [
      `--pm-${token.name}`,
      resolveColour(token.name, theme).toLowerCase(),
    ]),
  );
}

const TABLES: Readonly<Record<Theme, Record<string, string>>> = {
  dark: designTable('dark'),
  light: designTable('light'),
};

/**
 * The Theme-invariant scale: spacing, radii, target sizes, and type sizes,
 * declared once on `:root` in `styles/squadsTokens.css`.
 */
const SCALE: Record<string, string> = tokenTable(
  strippedTokens,
  /:root\s*\{([^}]*)\}/,
);

/** The declared value of `token` in `theme`, failing loudly if undeclared. */
function declared(theme: Theme, token: string): string {
  const value = TABLES[theme][token];
  expect(value, `${token} is not declared in the ${theme} table`).toBeDefined();
  return value;
}

/** The colour tokens of the tables: everything declared as a hex value. */
const COLOUR_TOKENS: readonly string[] = Object.keys(TABLES.dark).filter((token) =>
  /^#[0-9a-f]{6}$/.test(TABLES.dark[token]),
);

/** The properties through which a stylesheet paints a colour. */
const COLOUR_PROPERTIES = [
  'color',
  'background',
  'background-color',
  'border',
  'border-color',
  'border-top',
  'border-top-color',
  'outline',
] as const;

/** Every colour token the feature's own stylesheets paint with. */
const PAINTED_TOKENS: readonly string[] = [
  ...new Set(
    RULES.filter((rule) => FEATURE_SHEET_NAMES.has(rule.sheet)).flatMap((rule) =>
      COLOUR_PROPERTIES.flatMap((property) => tokensIn(rule.declarations[property] ?? '')),
    ),
  ),
]
  .filter((token) => COLOUR_TOKENS.includes(token))
  .sort();

/* ------------------------------------------------------------------ *
 * The floors, the surfaces, and the declared pairings
 * ------------------------------------------------------------------ */

/** Text and interactive control text (Requirement 19.5). */
const TEXT_FLOOR = 4.5;

/** Focus indications, borders, and graphical state cues (Requirement 19.5). */
const NON_TEXT_FLOOR = 3;

/**
 * Every surface the screens paint, and so every background a colour can be read
 * against.
 */
const SURFACE_TOKENS = [
  // The App_Shell's Content_Region behind the Squads_Home and the Squad_Screen,
  // and the Invite_Landing_Route's own page surface outside that frame.
  '--pm-bg',
  // Squad_Cards, the Player_List and its rows, the section sidebar, every
  // Form_Panel, Confirm_Dialog and Invite_Reveal.
  '--pm-surface',
  // Controls: text fields, selects, and the bordered buttons' resting fill.
  '--pm-surface-raised',
  // A Player_Row whose Membership_State is inactive, and an unchecked switch.
  '--pm-surface-sunken',
] as const;

interface Pairing {
  /** The token carrying the text, indication, border, or cue. */
  readonly foreground: string;
  /** The token painting the surface it is read against. */
  readonly background: string;
  /** The floor this pairing owes, from what the stylesheets paint with it. */
  readonly floor: typeof TEXT_FLOOR | typeof NON_TEXT_FLOOR;
  /** What the pairing is, so the floor is justified rather than asserted. */
  readonly usage: string;
}

/** One foreground against each surface, at one floor. */
function onEverySurface(
  foreground: string,
  floor: Pairing['floor'],
  usage: string,
): Pairing[] {
  return SURFACE_TOKENS.map((background) => ({ foreground, background, floor, usage }));
}

const PAIRINGS: readonly Pairing[] = [
  // ---- Text and interactive control text: 4.5:1 (Requirement 19.5) ----
  ...onEverySurface(
    '--pm-text-primary',
    TEXT_FLOOR,
    'headings, names, values, control labels and field text on any surface',
  ),
  ...onEverySurface(
    '--pm-text-secondary',
    TEXT_FLOOR,
    'secondary text: label chips, an inactive row, statements and the sidebar links',
  ),
  ...onEverySurface(
    '--pm-text-muted',
    TEXT_FLOOR,
    'field hints, timestamps and an expired invite',
  ),
  ...onEverySurface(
    '--pm-accent-text',
    TEXT_FLOOR,
    'an active invite and the accent text the design system clears for body copy',
  ),
  ...onEverySurface('--pm-danger-text', TEXT_FLOOR, 'a revoked invite and a field error'),
  {
    foreground: '--pm-on-accent',
    background: '--pm-accent-fill',
    floor: TEXT_FLOOR,
    usage: 'the primary surface action: Ink on Pitch Green',
  },
  {
    foreground: '--pm-accent-on-subtle',
    background: '--pm-accent-subtle',
    floor: TEXT_FLOOR,
    usage: 'a squad crest, the current sidebar link, and the first avatar tint',
  },
  {
    foreground: '--pm-provisional-text',
    background: '--pm-result-draw-subtle',
    floor: TEXT_FLOOR,
    usage: 'the provisional Rating_Presentation on its tinted badge',
  },
  {
    foreground: '--pm-result-draw-text',
    background: '--pm-result-draw-subtle',
    floor: TEXT_FLOOR,
    usage: 'the second avatar tint',
  },
  {
    foreground: '--pm-info-text',
    background: '--pm-info-subtle',
    floor: TEXT_FLOOR,
    usage: 'the third avatar tint',
  },
  {
    foreground: '--pm-result-loss-text',
    background: '--pm-result-loss-subtle',
    floor: TEXT_FLOOR,
    usage: 'the fourth avatar tint',
  },
  {
    foreground: '--pm-text-primary',
    background: '--pm-surface-pressed',
    floor: TEXT_FLOOR,
    usage: 'the fifth avatar tint',
  },

  // ---- Focus indications, borders and graphical cues: 3:1 (Requirement 19.5) ----
  ...onEverySurface(
    '--pm-focus-ring',
    NON_TEXT_FLOOR,
    'the focus indication of every control, drawn just outside it',
  ),
  ...onEverySurface(
    '--pm-border-control',
    NON_TEXT_FLOOR,
    'the boundary of every bordered control and outlined label chip',
  ),
  {
    foreground: '--pm-accent-icon',
    background: '--pm-surface',
    floor: NON_TEXT_FLOOR,
    usage: "an active invite's accent edge",
  },
  {
    foreground: '--pm-provisional-text',
    background: '--pm-result-draw-subtle',
    floor: NON_TEXT_FLOOR,
    usage: "the provisional badge's outline, drawn in the text amber so it shows on the light tint",
  },
  {
    foreground: '--pm-brand-ink',
    background: '--pm-accent-fill',
    floor: NON_TEXT_FLOOR,
    usage: "a checked switch's thumb against its Pitch Green track: the state cue",
  },
  {
    foreground: '--pm-text-secondary',
    background: '--pm-surface-sunken',
    floor: NON_TEXT_FLOOR,
    usage: "an unchecked switch's thumb against its track",
  },
];

/**
 * Painted tokens no pairing measures, and why each needs none.
 *
 * - `--pm-border-subtle` draws decorative separators and card edges only; every
 *   control boundary is `--pm-border-control`, which is measured (the design
 *   system's own rule).
 * - `--pm-surface-hover` and `--pm-accent-fill-hover` are hover washes: the text
 *   on them is the resting text, and they are never the only cue of anything.
 */
const UNMEASURED_TOKENS = [
  '--pm-accent-fill-hover',
  '--pm-border-subtle',
  '--pm-surface-hover',
] as const;

/** A pairing named the way a failure should read. */
function describePairing(theme: Theme, pairing: Pairing): string {
  return `${theme}: ${pairing.foreground} ${declared(theme, pairing.foreground)} on ${pairing.background} ${declared(theme, pairing.background)} (${pairing.usage})`;
}

// Feature: web-squads-screens, Property 47: Every control is reachable in document order with a visible focus indication in both themes
// Validates: Requirements 19.5
describe('Property 47 — the declared pairings meet the contrast floors in both Themes', () => {
  it('resolves both design tables and the Theme-invariant scale', () => {
    expect(Object.keys(TABLES.dark).sort()).toEqual(Object.keys(TABLES.light).sort());
    expect(COLOUR_TOKENS.length).toBeGreaterThan(15);
    expect(SCALE['--squads-touch-target']).toBe('44px');
    expect(SCALE['--squads-focus-width']).toBe('2px');
    // The scale declares no colour.
    expect(Object.keys(SCALE).some((token) => token in TABLES.dark)).toBe(false);
    expect(Object.values(SCALE).some((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toBe(false);
  });

  it('computes the canonical ratios, so the arithmetic itself is checked', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#5bbf36', '#5bbf36')).toBeCloseTo(1, 5);
  });

  it('meets each pairing’s floor in both Themes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...THEMES),
        fc.constantFrom(...PAIRINGS),
        (theme, pairing) => {
          const ratio = contrastRatio(
            declared(theme, pairing.foreground),
            declared(theme, pairing.background),
          );

          expect(
            ratio,
            `${describePairing(theme, pairing)} is ${ratio.toFixed(2)}:1, below ${pairing.floor}:1`,
          ).toBeGreaterThanOrEqual(pairing.floor);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds for every pairing in both Themes exhaustively', () => {
    // The pairing space is finite and small, so it is also checked whole: a
    // generator that never happened to draw a pairing would prove nothing about it.
    const failures: string[] = [];

    for (const theme of THEMES) {
      for (const pairing of PAIRINGS) {
        const ratio = contrastRatio(
          declared(theme, pairing.foreground),
          declared(theme, pairing.background),
        );
        if (ratio < pairing.floor) {
          failures.push(
            `${describePairing(theme, pairing)} = ${ratio.toFixed(2)}:1 < ${pairing.floor}:1`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('measures every colour token the feature’s stylesheets paint', () => {
    // Guards the pairing table itself: a token a stylesheet starts painting with
    // and no pairing measures would otherwise pass by never being measured.
    expect(PAINTED_TOKENS.length).toBeGreaterThan(10);
    const unmeasured = PAINTED_TOKENS.filter(
      (token) =>
        !PAIRINGS.some(
          (pairing) => pairing.foreground === token || pairing.background === token,
        ),
    );

    expect(unmeasured).toEqual([...UNMEASURED_TOKENS]);
  });

  it('measures every surface a colour can be read against', () => {
    // The other half of the same guard: a surface no pairing uses as a background
    // would leave the colours read on it unmeasured.
    for (const surface of SURFACE_TOKENS) {
      expect(
        PAIRINGS.some((pairing) => pairing.background === surface),
        `no pairing measures anything against ${surface}`,
      ).toBe(true);
    }
  });

  it('writes no colour literal in any stylesheet that reaches a screen', () => {
    // Requirement 18.9's other half, and the precondition for every measurement
    // above: a colour written into a stylesheet would be a colour no table
    // declares and no pairing measures.
    const offenders = STYLESHEETS.flatMap((sheet) => {
      const source = withoutComments(sheet.source);
      const literals = [
        ...source.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi),
      ].map((match) => match[0]);
      return literals.map((literal) => `${sheet.name}: ${literal}`);
    });

    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The declared cascade, for the rendered assertions
 * ------------------------------------------------------------------ */

/**
 * A comparable specificity for one selector part.
 *
 * Classes, attribute selectors, and pseudo-classes count together; ids count
 * higher; elements and pseudo-elements count lowest. Coarse next to the full
 * algorithm and exactly enough for stylesheets that use no id and no `:is()`.
 */
function specificity(selectorPart: string): number {
  const ids = (selectorPart.match(/#[\w-]+/g) ?? []).length;
  const classes = (selectorPart.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selectorPart.match(/::[\w-]+/g) ?? []).length;
  return ids * 10_000 + classes * 100 + elements;
}

/**
 * Selector parts a rendered element can be matched against.
 *
 * A part naming a pseudo-class or a pseudo-element is excluded: `:focus-visible`
 * describes a state no element is in while the tree is merely being read, and
 * `::after` describes a box that is not an element at all. Focus styles are
 * asserted separately, from the source, further down.
 */
function matchableParts(rule: CssRule): readonly string[] {
  return rule.parts.filter((part) => !part.includes(':'));
}

/** Rules that could apply to a static element, with their matchable parts. */
const MATCHABLE_RULES: readonly CssRule[] = RULES.filter(
  (rule) => matchableParts(rule).length > 0,
);

/**
 * The value a browser would use for `property` on `element` — the declaration from
 * the most specific matching rule, latest declaration order breaking a tie.
 *
 * Matching is `Element.matches`, so jsdom's own selector engine decides, including
 * for the attribute-conditional rules that carry this feature's state styling
 * (`[data-membership-state='inactive']`, `[data-rating-kind='provisional']`, and
 * the three `[data-squads-invite-state]` values).
 */
function winningValue(element: Element, property: string): string | undefined {
  let winner: { readonly value: string; readonly rank: number; readonly order: number } | null =
    null;

  for (const rule of MATCHABLE_RULES) {
    const value = rule.declarations[property];
    if (value === undefined) {
      continue;
    }
    for (const part of matchableParts(rule)) {
      if (!element.matches(part)) {
        continue;
      }
      const rank = specificity(part);
      if (
        winner === null ||
        rank > winner.rank ||
        (rank === winner.rank && rule.order > winner.order)
      ) {
        winner = { value, rank, order: rule.order };
      }
    }
  }

  return winner === null ? undefined : winner.value;
}

/**
 * The colour token an element's text is painted with.
 *
 * Inheritance is walked rather than assumed: a Player_Row's name declares
 * `color: inherit` and takes the row's own token, which is what makes an inactive
 * row's whole line mute together. A declaration of `inherit` or of `currentColor`
 * is therefore not an answer — the walk continues past it.
 *
 * Where nothing on the way up declares a colour, the answer is `--text`: the
 * Squads_Home and the Squad_Screen render inside the App_Shell's Content_Region,
 * which paints `--text` on `--bg`, and the Invite_Landing_Route declares both on
 * its own root.
 */
function textColourToken(element: Element): string {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const token = tokenIn(winningValue(node, 'color') ?? '');
    if (token !== null) {
      return token;
    }
  }

  return '--pm-text-primary';
}

/**
 * The surface token an element's text is read against — the nearest declared
 * background at or above it.
 *
 * `background: none` declares no token and is therefore transparent, so the walk
 * continues past it, which is exactly how a Player_Row's navigation control reads
 * against the row rather than against a fill of its own.
 */
function surfaceTokenBehind(element: Element): string {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    for (const property of ['background', 'background-color']) {
      const token = tokenIn(winningValue(node, property) ?? '');
      if (token !== null) {
        return token;
      }
    }
  }

  // As above: the region behind both in-shell screens, and the page surface the
  // Invite_Landing_Route paints for itself.
  return '--pm-bg';
}

/**
 * Does this element render text of its own?
 *
 * Only a direct text child counts: a container's `textContent` includes its
 * descendants' words, which are painted with those descendants' colours.
 */
function rendersOwnText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  );
}

/* ------------------------------------------------------------------ *
 * Reading the focus order
 * ------------------------------------------------------------------ */

/**
 * The elements a Tab press can reach, mirroring the selector browsers and
 * `userEvent` both use.
 *
 * Stated here rather than imported, so the expected order is computed
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

/** The elements Enter or Space operates without a script of the feature's own. */
const NATIVELY_OPERABLE_TAGS = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'] as const;

/**
 * The tabbable elements of `root`, in document order.
 *
 * A negative `tabindex` is excluded: such an element is focusable programmatically
 * but absent from the Tab order, which is what the feature's surface roots use it
 * for.
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
  const name =
    element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
  return `${element.tagName.toLowerCase()}.${element.className || '(no class)'}[${name.slice(0, 40)}]`;
}

/**
 * Labels for a focus order that stay unique even where two controls carry the same
 * element type and the same accessible name — which is real here: a Player_Row's
 * two admin controls repeat down the list, and so do the invite entries' revoke
 * controls. Labelling each element with its document-order position makes every
 * comparison an identity comparison that still reads as a diff.
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
    labels.set(element, `${index}:${describeElement(element)}`);
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
 * Press Tab (or Shift+Tab) `count` times, reporting where focus landed each time.
 *
 * `keyboard` is an interactor of this file's own rather than the fixture's, set up
 * with no inter-event delay: a traversal of every state of three screens is
 * thousands of key presses, and the default delay is a real timer between each one.
 * Nothing here depends on that delay — the presses are independent, and every
 * assertion reads the DOM after the press it follows.
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
 * The declared focus indication of a rendered control
 * ------------------------------------------------------------------ */

/** The focus rules of the stylesheets: `:focus-visible` and what it declares. */
const FOCUS_RULES: readonly { readonly rule: CssRule; readonly parts: readonly string[] }[] =
  RULES.flatMap((rule) => {
    const parts = rule.parts.filter((part) => part.includes(':focus-visible'));
    return parts.length > 0 ? [{ rule, parts }] : [];
  });

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

/**
 * Every absolute length in a value, in pixels.
 *
 * Percentages, `vw`, and `vh` are deliberately not returned: they are relative to
 * the viewport or to the container and so cannot exceed it, which is precisely why
 * the stylesheets prefer them (Requirement 19.10).
 */
function absoluteLengthsPx(value: string): number[] {
  const lengths: number[] = [];
  const pattern = /(-?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm)(?![\w%])/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(resolveScale(value))) !== null) {
    lengths.push(Number(match[1]) * UNIT_PX[match[2]]);
  }

  return lengths;
}

/**
 * The declared focus indications that apply to a rendered element, as
 * `selector { outline }` pairs.
 *
 * The element is matched against each `:focus-visible` part with that pseudo-class
 * removed, which is what "this rule would style this element while it holds focus"
 * means. An element with no such rule would fall back to the user-agent ring — a
 * ring drawn in a colour no table declares, which on the dark Theme is exactly the
 * invisible-focus failure Requirement 19.4 rules out.
 */
function declaredFocusIndications(element: Element): string[] {
  const found: string[] = [];

  for (const { rule, parts } of FOCUS_RULES) {
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
        found.push(`${rule.sheet}: ${part} { outline: ${outline} }`);
      }
    }
  }

  return found;
}

/** The outline value of a declared indication, for measuring its width. */
function outlineOf(indication: string): string {
  const match = /outline:\s*([^}]+)\}/.exec(indication);
  return match === null ? '' : match[1].trim();
}

/* ------------------------------------------------------------------ *
 * The rendered property
 * ------------------------------------------------------------------ */

/** One generated rendering: a named state, mounted in one Theme. */
interface RenderedCase {
  readonly state: ScreenStateCase;
  readonly theme: Theme;
}

const RENDERED_CASES: readonly RenderedCase[] = SCREEN_STATE_CASES.flatMap((state) =>
  THEMES.map((theme) => ({ state, theme })),
);

/**
 * Requirement 19.4: no control carries a positive `tabindex`.
 *
 * This is what makes the feature's focus order *be* its document order — a
 * positive value would hoist a control ahead of everything else — so it is
 * asserted rather than assumed by the traversal.
 */
function positiveTabIndexOffences(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[tabindex]'))
    .filter((element) => Number(element.getAttribute('tabindex')) > 0)
    .map(describeElement);
}

/**
 * Requirement 19.4: every control is reached by Tab in document order and by
 * Shift+Tab in the reverse of it, and focus leaves every control — including the
 * last — by a single press, so nothing traps it.
 *
 * The forward walk is one press longer than the order, so the press *from* the
 * final control is asserted too: that is where a focus trap would show itself.
 */
async function expectTabOrderIsDocumentOrder(
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
  expect(forward[expected.length], `${label}: focus did not leave the last control`).not.toBe(
    expected[expected.length - 1],
  );

  releaseFocus();
  const backward = await walk(keyboard, expected.length + 1, true);

  expect(focus.labels(backward.slice(0, expected.length)), label).toEqual(
    focus.labels([...expected].reverse()),
  );
  expect(backward[expected.length], `${label}: focus did not leave the first control`).not.toBe(
    expected[0],
  );
}

/**
 * Requirement 19.4: every reachable control is operable by keyboard.
 *
 * Operability is the platform's for a native control, so what is asserted is that
 * every control *is* one: a natively operable element, exposed to assistive
 * technology, that takes focus when asked. A `div` carrying a click handler and a
 * `tabindex` would satisfy the traversal above and none of this.
 *
 * What each control *does* when activated belongs to the property that owns it,
 * and its accessible name to the audits of task 16.1.
 */
function keyboardOperabilityOffences(focus: FocusOrder, label: string): string[] {
  const offenders: string[] = [];

  for (const control of focus.order) {
    const where = `${label}: ${focus.label(control)}`;

    if (!NATIVELY_OPERABLE_TAGS.includes(control.tagName as (typeof NATIVELY_OPERABLE_TAGS)[number])) {
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
 * Requirements 19.4 and 19.5: every reachable control carries a declared focus
 * indication painting `var(--pm-focus-ring)`, at a width a person can see.
 *
 * The 3 to 1 contrast of that indication against each surface it can be drawn on
 * is proved once, for the one token, by the pairing assertions above — so every
 * control resolving to that token inherits the proved result.
 */
function focusIndicationOffences(focus: FocusOrder, label: string): string[] {
  const offenders: string[] = [];

  for (const control of focus.order) {
    const indications = declaredFocusIndications(control);
    const where = `${label}: ${focus.label(control)}`;

    if (indications.length === 0) {
      offenders.push(
        `${where} declares no :focus-visible outline, so it would fall back to the user-agent ring`,
      );
      continue;
    }

    for (const indication of indications) {
      const outline = outlineOf(indication);
      if (!outline.includes('var(--pm-focus-ring)')) {
        offenders.push(`${where} paints its indication with ${outline}`);
      }
      // A hairline ring is not a visible indication at every zoom level.
      if (Math.max(...absoluteLengthsPx(outline), 0) < 2) {
        offenders.push(`${where} declares a sub-2px indication: ${outline}`);
      }
    }
  }

  return offenders;
}

/**
 * Requirement 19.5: every text value renders at 4.5 to 1 against its background,
 * in the Theme under test.
 *
 * Both sides come from the declared cascade **as composed in this tree** rather
 * than from a table of intended pairings: the colour is the one the rules give
 * this element, walked through `inherit`, and the background is the nearest
 * declared surface above it. That is what catches a composite — a hued chip landing
 * on the muted surface of an inactive Player_Row, say — rather than only a bad
 * token.
 *
 * `floor` is the requirement's 4.5 everywhere but in the guard below, which raises
 * it to prove that the reader really finds a tree's text and really measures it.
 */
function textContrastOffences(
  container: HTMLElement,
  theme: Theme,
  label: string,
  floor: number = TEXT_FLOOR,
): { readonly offences: readonly string[]; readonly measured: number } {
  const offenders: string[] = [];
  let measured = 0;

  for (const element of container.querySelectorAll('*')) {
    if (!rendersOwnText(element)) {
      continue;
    }

    const colourToken = textColourToken(element);
    const surfaceToken = surfaceTokenBehind(element);
    const ratio = contrastRatio(
      declared(theme, colourToken),
      declared(theme, surfaceToken),
    );
    measured += 1;

    if (ratio < floor) {
      offenders.push(
        `${label}: ${describeElement(element)} renders ${colourToken} ${declared(theme, colourToken)} on ${surfaceToken} ${declared(theme, surfaceToken)} at ${ratio.toFixed(2)}:1`,
      );
    }
  }

  return { offences: offenders, measured };
}

/**
 * Every colour a rendered element resolves is one the pairing table measures.
 *
 * The bridge between the two halves of this file: a component painted with a token
 * no pairing measures would pass every assertion above by never being measured at
 * all.
 */
function unmeasuredColourOffences(container: HTMLElement, label: string): string[] {
  // Measured, or one of the decorative and hover tokens the table says need no
  // pairing, and why.
  const measured = new Set<string>([
    ...PAIRINGS.flatMap((pairing) => [pairing.foreground, pairing.background]),
    ...UNMEASURED_TOKENS,
  ]);
  const offenders: string[] = [];

  for (const element of container.querySelectorAll('*')) {
    for (const property of [
      'color',
      'background',
      'background-color',
      'border',
      'border-color',
      'outline',
    ]) {
      const value = winningValue(element, property);
      if (value === undefined) {
        continue;
      }
      for (const token of tokensIn(value)) {
        if (token in TABLES.dark && !measured.has(token)) {
          offenders.push(
            `${label}: ${describeElement(element)} reads unmeasured ${token} for ${property}`,
          );
        }
      }
    }
  }

  return offenders;
}

/**
 * The two states that offer nothing to operate: each is awaiting a first response
 * and renders a heading and a busy statement, and neither the Player_List nor the
 * Admin_Section nor any control exists yet.
 *
 * Named rather than tolerated, so a state that *should* offer a control and stops
 * doing so fails here instead of passing vacuously — and so a new control-free
 * surface has to be declared deliberately.
 */
const CONTROL_FREE_STATES = [
  'the Invite_Landing_Route redeeming',
  'the Squad_Screen awaiting the first response',
] as const;

/**
 * Everything Property 47 claims about one rendered state in one Theme, reporting
 * how many controls that state offered.
 */
async function expectPropertyHolds(renderedCase: RenderedCase): Promise<number> {
  const label = `${renderedCase.state.name} in the ${renderedCase.theme} Theme`;
  const rendered = await renderedCase.state.render(renderedCase.theme);
  const focus = focusOrderOf(rendered.container);

  expect(positiveTabIndexOffences(rendered.container)).toEqual([]);
  expect(keyboardOperabilityOffences(focus, label)).toEqual([]);
  expect(focusIndicationOffences(focus, label)).toEqual([]);
  expect(unmeasuredColourOffences(rendered.container, label)).toEqual([]);

  const text = textContrastOffences(rendered.container, renderedCase.theme, label);
  expect(text.offences).toEqual([]);
  // Guards the measurement: a state whose text nobody measured would pass silently.
  expect(text.measured, `${label} rendered no text to measure`).toBeGreaterThan(0);

  if (focus.order.length > 0) {
    await expectTabOrderIsDocumentOrder(
      userEvent.setup({ delay: null }),
      focus,
      label,
    );
  }

  return focus.order.length;
}

/** Unmount and clear the applied Theme between generated runs. */
function tearDown(): void {
  cleanup();
  resetTheme();
}

/** A detached tree, for checking the readers themselves rather than a screen. */
function fragment(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('the rendered checks are not vacuous', () => {
  /*
   * The counterpart to every clean rendered assertion below: each reader has to
   * report the fault it exists to find. Without this, a reader that matched nothing
   * — a mistyped pseudo-class, a selector list split the wrong way — would let every
   * state pass while proving nothing at all.
   */

  it('finds the declared focus indication of a real control, and none for an unstyled one', () => {
    const tree = fragment(`
      <button class="squads-card">Thursday Ballers</button>
      <button class="squads-not-a-real-control">Unstyled</button>
    `);
    const [styled, unstyled] = Array.from(tree.querySelectorAll('button'));

    const indications = declaredFocusIndications(styled);
    expect(indications).toHaveLength(1);
    expect(outlineOf(indications[0])).toContain('var(--pm-focus-ring)');
    expect(absoluteLengthsPx(outlineOf(indications[0]))).toContain(2);

    expect(declaredFocusIndications(unstyled)).toEqual([]);
  });

  it('reports a control that is not a natively operable element, and an unindicated one', () => {
    const tree = fragment(`
      <div tabindex="0">A control that is not one</div>
      <button class="squads-not-a-real-control">Unstyled</button>
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
      <button class="squads-home__entry-point" aria-hidden="true">Hidden</button>
      <div aria-hidden="true">
        <button class="squads-home__entry-point">Inside something hidden</button>
      </div>
      <a class="squads-invite-landing__control" href="">Nowhere</a>
    `);

    expect(keyboardOperabilityOffences(focusOrderOf(tree), 'the guard')).toEqual([
      expect.stringContaining('is aria-hidden yet reachable'),
      expect.stringContaining('is inside an aria-hidden subtree'),
      expect.stringContaining('is an anchor with no address to follow'),
    ]);
  });

  it('excludes a negative tabindex from the order and reports a positive one', () => {
    const tree = fragment(`
      <div tabindex="-1">the surface's fallback focus target</div>
      <button tabindex="2">hoisted</button>
    `);

    expect(focusOrderOf(tree).order.map((element) => element.tagName)).toEqual(['BUTTON']);
    expect(positiveTabIndexOffences(tree)).toHaveLength(1);
  });

  it('resolves a colour through inherit and a background through a state selector', () => {
    // The composite that matters most, and the one no table of intended pairings
    // states: a hued chip on the muted surface of an inactive Player_Row. The name
    // beside it declares `color: inherit`, so it takes the row's muted token, while
    // the chip declares its own.
    const tree = fragment(`
      <div class="squads-player-row" data-membership-state="inactive">
        <button class="squads-player-row__open">
          <span class="squads-player-row__name">Kay</span>
        </button>
        <span class="squads-membership-labels">
          <span
            class="squads-membership-labels__label"
            data-squads-membership-label="guest"
          >Guest</span>
        </span>
      </div>
    `);

    const name = tree.querySelector('.squads-player-row__name');
    const guest = tree.querySelector('[data-squads-membership-label="guest"]');
    expect(name).not.toBeNull();
    expect(guest).not.toBeNull();

    if (name !== null && guest !== null) {
      expect(textColourToken(name)).toBe('--pm-text-secondary');
      expect(surfaceTokenBehind(name)).toBe('--pm-surface-sunken');
      expect(textColourToken(guest)).toBe('--pm-text-secondary');
      expect(surfaceTokenBehind(guest)).toBe('--pm-surface-sunken');
    }

    // And an element nothing paints falls back to the documented default: the text
    // and the surface of the region each screen renders inside.
    const bare = fragment('<p>outside any painted region</p>').querySelector('p');
    expect(bare).not.toBeNull();
    if (bare !== null) {
      expect(textColourToken(bare)).toBe('--pm-text-primary');
      expect(surfaceTokenBehind(bare)).toBe('--pm-bg');
    }
  });

  it('finds a tree’s text and reports it against a floor it cannot clear', () => {
    // Every declared composite the feature contains clears 4.5:1 — that is the point
    // of the token tables — so the reader is proved to *measure* rather than proved
    // to complain: raising the floor beyond any attainable ratio must report every
    // text-bearing element, and only those.
    const tree = fragment(
      '<span class="squads-rating" data-rating-kind="provisional">' +
        '<span class="squads-rating__badge"></span>' +
        '<span class="squads-rating__text">No settled rating yet</span>' +
        '</span>',
    );

    const clean = textContrastOffences(tree, 'light', 'the guard');
    expect(clean.offences).toEqual([]);
    // Only the words are measured: the chip holds elements, and the badge is a ring.
    expect(clean.measured).toBe(1);

    const impossible = textContrastOffences(tree, 'light', 'the guard', 21.1);
    expect(impossible.offences).toEqual([
      expect.stringContaining('--pm-provisional-text'),
    ]);
    // The badge carries no words, so nothing is measured against it.
    expect(rendersOwnText(tree.querySelectorAll('span')[1])).toBe(false);
  });

  it('reports a colour no pairing measures', () => {
    const tree = fragment(
      '<button class="squads-feature-toggles__switch" aria-checked="true">On</button>',
    );

    expect(unmeasuredColourOffences(tree, 'the guard')).toEqual([]);

    // A design-system element the squads screens never render, painted with a token
    // no pairing names, is reported rather than measured.
    const bibs = fragment('<span class="pm-bib">Bibs</span>');
    expect(unmeasuredColourOffences(bibs, 'the guard')).toEqual([
      expect.stringContaining('--pm-on-bib'),
      expect.stringContaining('--pm-bib '),
    ]);
  });
});

afterEach(() => {
  resetTheme();
});

// Feature: web-squads-screens, Property 47: Every control is reachable in document order with a visible focus indication in both themes
// Validates: Requirements 19.4, 19.5
describe('Property 47 — every rendered state, in both Themes', () => {
  it('reaches every control in document order, operable, indicated, and legible', async () => {
    const visited = new Set<string>();
    const controlCounts = new Map<string, number>();

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...RENDERED_CASES), async (renderedCase) => {
        visited.add(`${renderedCase.state.name}|${renderedCase.theme}`);
        try {
          controlCounts.set(
            renderedCase.state.name,
            await expectPropertyHolds(renderedCase),
          );
        } finally {
          // `cleanup` runs per test, not per generated run, and the fixture's own
          // guards read the document — so a tree left mounted would have the next
          // run reading the previous one's surfaces.
          tearDown();
        }
      }),
      {
        numRuns: 100,
        // Every state in both Themes, run before the randomised draws, so the
        // property's "for any rendered state" is exhaustive rather than sampled.
        examples: RENDERED_CASES.map((renderedCase) => [renderedCase] as const),
      },
    );

    // And proved to be exhaustive, rather than assumed from the option above.
    expect(visited.size).toBe(RENDERED_CASES.length);

    // The traversal asserts nothing about a state that offers no control, so which
    // states those are is pinned rather than left to chance.
    const controlFree = [...controlCounts]
      .filter(([, count]) => count === 0)
      .map(([name]) => name)
      .sort();

    expect(controlFree).toEqual([...CONTROL_FREE_STATES]);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 * The layout residue (Requirement 19.10)
 * ------------------------------------------------------------------ */

/** The five widths Requirement 19.10 names for verification. */
const VERIFIED_WIDTHS = [360, 767, 768, 1024, 1920] as const;

/**
 * The properties that can force a box wider than what contains it.
 *
 * `max-width` is deliberately absent: it caps a width and can never create one, so
 * the 40rem readable measure the feature bounds prose to is not an overflow risk
 * at 360 pixels — it simply stops applying.
 */
const OVERFLOW_RISK_PROPERTIES = [
  'width',
  'min-width',
  'flex-basis',
  'grid-template-columns',
] as const;

/** Every declaration of a width-ish property, with where it was written. */
const WIDTH_DECLARATIONS: readonly {
  readonly sheet: string;
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}[] = RULES.flatMap((rule) =>
  OVERFLOW_RISK_PROPERTIES.flatMap((property) => {
    const value = rule.declarations[property];
    return value === undefined
      ? []
      : [{ sheet: rule.sheet, selector: rule.selector, property, value }];
  }),
);

/**
 * The declared layout mode, region by region.
 *
 * The feature declares **no breakpoint at all** — see the assertion below — so
 * this one arrangement is what renders at 360 pixels and at 1920 alike: each
 * screen root fills its column and is capped at it, padding and borders are
 * counted inside every declared width, rows of controls wrap rather than shrink,
 * and free text breaks rather than widening its line.
 */
const LAYOUT_MODE: readonly {
  readonly className: string;
  readonly declarations: Readonly<Record<string, string>>;
  readonly what: string;
}[] = [
  {
    className: 'squads-home',
    declarations: { 'box-sizing': 'border-box', width: '100%', 'max-width': '100%' },
    what: 'the Squads_Home fills the App_Shell content region and is capped at it',
  },
  {
    className: 'squad-screen',
    declarations: { 'box-sizing': 'border-box', width: '100%', 'max-width': '100%' },
    what: 'the Squad_Screen likewise',
  },
  {
    className: 'squads-invite-landing',
    declarations: { 'box-sizing': 'border-box' },
    what: 'the Invite_Landing_Route paints the page itself, its gutter counted inside its own box',
  },
  {
    className: 'squads-invite-landing__surface',
    declarations: {
      'box-sizing': 'border-box',
      width: '100%',
      'max-width': 'var(--squads-measure)',
    },
    what: 'its column fills the page and is bounded by the readable measure, not by the viewport',
  },
  {
    className: 'squads-home__cards',
    declarations: {
      'grid-template-columns':
        'repeat( auto-fill, minmax(min(var(--squads-card-min-width), 100%), 1fr) )',
    },
    what: 'the Squad_Card grid collapses to one column rather than holding a track wider than the viewport',
  },
];

/** Regions that lay out two or more controls on one line, so they must wrap. */
const WRAPPING_ROWS = [
  'squads-home__entry-points',
  'squads-failure__actions',
  'squads-surface__actions',
  'squads-invite-landing__controls',
  'squads-player-row',
  'squads-invite-entry',
  'squads-invite-entry__facts',
  'squads-membership-labels',
  'squads-card__labels',
  'squads-feature-toggles__item',
] as const;

/** Nodes rendering a person's own words, which may arrive as one long token. */
const FREE_TEXT_NODES = [
  'squads-home__heading',
  'squad-screen__heading',
  'squads-invite-landing__heading',
  'squads-invite-landing__message',
  'pm-squadcard__name',
  'squads-player-row__name',
  'squads-placeholder__heading',
  'squads-placeholder__statement',
  'squads-invite-reveal__link',
  'squads-invite-reveal__code',
  'squads-invite-entry__instant',
] as const;

/** Every rule whose subject carries `className`. */
function rulesTargeting(className: string): readonly CssRule[] {
  const token = new RegExp(`\\.${className}(?![\\w-])`);

  return RULES.filter((rule) =>
    rule.parts.some((part) => {
      const compounds = part.split(/\s*[>+~]\s*|\s+/).filter((piece) => piece.length > 0);
      const subject = compounds[compounds.length - 1] ?? '';
      return token.test(subject);
    }),
  );
}

/** Every value declared for `property` by the rules targeting `className`. */
function declaredValues(className: string, property: string): string[] {
  return rulesTargeting(className)
    .map((rule) => rule.declarations[property])
    .filter((value): value is string => value !== undefined);
}

// Feature: web-squads-screens, Property 47: Every control is reachable in document order with a visible focus indication in both themes
// Validates: Requirements 19.10
describe('Requirement 19.10 — the declared layout mode and the absence of fixed widths', () => {
  it('declares one fluid layout mode, with no breakpoint between the five widths', () => {
    // No `@media`, `@container`, or `@supports` anywhere in the feature: the same
    // declarations apply at 360 pixels and at 1920, so what is asserted below about
    // "the layout" is asserted about the layout at every one of the five widths
    // rather than at one of them. The component library is held to its own rules:
    // its one padding step and its reduced-motion shimmer change no layout mode.
    const gated = STYLESHEETS.filter((sheet) => FEATURE_SHEET_NAMES.has(sheet.name)).flatMap((sheet) => {
      const source = withoutComments(sheet.source);
      return [...source.matchAll(/@(media|container|supports)[^{]*/g)].map(
        (match) => `${sheet.name}: ${match[0].trim()}`,
      );
    });

    expect(gated).toEqual([]);
  });

  it('declares no fixed width exceeding any of the five verified viewport widths', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VERIFIED_WIDTHS),
        fc.constantFrom(...WIDTH_DECLARATIONS),
        (width, declaration) => {
          const lengths = absoluteLengthsPx(declaration.value);
          const widest = Math.max(...lengths, 0);

          expect(
            widest,
            `at ${width}px, ${declaration.sheet}: ${declaration.selector} { ${declaration.property}: ${declaration.value} } declares ${widest}px`,
          ).toBeLessThanOrEqual(width);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds for every width-ish declaration at every one of the five widths', () => {
    // Guards the scan as well as the stylesheets: a property nothing declares would
    // pass vacuously, and a generator that never drew 360 would prove nothing about
    // the narrowest viewport.
    expect(WIDTH_DECLARATIONS.length).toBeGreaterThan(5);

    const narrowest = Math.min(...VERIFIED_WIDTHS);
    const offenders = WIDTH_DECLARATIONS.filter((declaration) =>
      absoluteLengthsPx(declaration.value).some((length) => length > narrowest),
    ).map(
      (declaration) =>
        `${declaration.sheet}: ${declaration.selector} { ${declaration.property}: ${declaration.value} }`,
    );

    expect(offenders).toEqual([]);
  });

  it('counts padding and borders inside every declared width', () => {
    // Without `border-box`, a region declaring `width: 100%` and a gutter is wider
    // than its container by twice that gutter — the commonest source of a
    // horizontal scrollbar at 360 pixels.
    //
    // Scoped to the feature's own stylesheets. The one shared stylesheet in the set
    // (`auth/components/FormField.css`, the text field every squads form renders
    // through) declares `width: 100%` and a padding and takes `border-box` from the
    // frame it renders inside — `.shell-frame *` — which is a declaration this
    // feature neither owns nor may restate.
    const zero = /^0(?:[a-z%]*)?(?:\s+0(?:[a-z%]*)?)*$/;

    const offenders = RULES.filter((rule) => {
      if (!rule.sheet.startsWith('squads/')) {
        return false;
      }
      const padded = Object.entries(rule.declarations).some(
        ([property, value]) => property.startsWith('padding') && !zero.test(value),
      );
      const sized = ['width', 'min-width', 'max-width'].some((property) => {
        const value = rule.declarations[property];
        return value !== undefined && value !== 'auto' && !zero.test(value);
      });
      return padded && sized && rule.declarations['box-sizing'] !== 'border-box';
    }).map((rule) => `${rule.sheet}: ${rule.selector}`);

    expect(offenders).toEqual([]);
  });

  it.each(LAYOUT_MODE)('declares the layout mode of .$className — $what', ({
    className,
    declarations,
  }) => {
    for (const [property, value] of Object.entries(declarations)) {
      expect(
        declaredValues(className, property).map((declared_) =>
          declared_.replace(/\s+/g, ' '),
        ),
        `.${className} declares no ${property}`,
      ).toContain(value);
    }
  });

  it.each(WRAPPING_ROWS)('lets .%s wrap rather than shrink its controls', (className) => {
    expect(declaredValues(className, 'flex-wrap')).toContain('wrap');
  });

  it.each(FREE_TEXT_NODES)('breaks the free text in .%s rather than widening it', (className) => {
    const declared_ = declaredValues(className, 'overflow-wrap');

    expect(declared_.length, `.${className} declares no overflow-wrap`).toBeGreaterThan(0);
    for (const value of declared_) {
      expect(['break-word', 'anywhere']).toContain(value);
    }
  });
});
