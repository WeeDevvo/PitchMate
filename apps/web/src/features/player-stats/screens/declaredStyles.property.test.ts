/**
 * Property test for the two declared Theme tables and the contrast floors
 * (task 14.4), plus the layout residue Requirement 15.7 leaves behind.
 *
 * **Property 35: Both theme tables are complete and meet the contrast floors.**
 * *For any* colour token the feature paints, a value is declared in both the dark
 * and the light theme table; and *for any* declared text pairing the ratio is at
 * least 4.5 to 1, and *for any* declared focus indication and non-text mark at
 * least 3 to 1, computed from the declared tables.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MANUAL BROWSER VERIFICATION REQUIRED — Requirement 15.7                   │
 * │                                                                           │
 * │ Requirement 15.7 is about **rendered geometry**: the Player_Stats_Screen   │
 * │ renders in a single fluid layout mode with no fixed width exceeding 360    │
 * │ pixels, so that nothing overflows horizontally between 360 and 1920 pixels │
 * │ of viewport width. jsdom computes no layout — every box is zero-sized, no  │
 * │ media query is evaluated, and no stylesheet cascade reaches a computed     │
 * │ style — so the geometry cannot be verified automatically here. What the    │
 * │ last section of this file asserts instead is that the feature declares     │
 * │ **one fluid layout mode** (no breakpoint at all, so the same declarations  │
 * │ apply at each of the five widths) and **no fixed width exceeding any of**  │
 * │ **360, 767, 768, 1024, and 1920 pixels**. That is a floor, not a proof.    │
 * │                                                                           │
 * │ Still to be checked by hand in a real browser, at 360, 767, 768, 1024, and │
 * │ 1920 CSS pixels, in both Themes:                                          │
 * │                                                                           │
 * │  • no part of the Player_Stats_Screen — inside the App_Shell frame — is    │
 * │    wider than the viewport, and the document needs no horizontal           │
 * │    scrolling;                                                             │
 * │  • with real content in place: a long unbroken Player_Display_Name in the  │
 * │    level-one heading and in a Pairwise_Section's name cell, a four-figure   │
 * │    Display_Rating, a 500-point Progression_Chart and its table, and the    │
 * │    four-column record grid at its narrowest;                              │
 * │  • at a raised browser text size, since every type size here is relative   │
 * │    and every chart dimension is a stroke rather than a width.              │
 * │                                                                           │
 * │ Requirement 15.4's contrast is computed from the **declared token tables** │
 * │ below. That catches a bad token and a bad declared composite; it cannot    │
 * │ catch a composite a browser paints differently — a token painted over an   │
 * │ unexpected surface, an inherited colour over an image, a translucent       │
 * │ overlay, a forced-colours mode. Those need a browser too.                 │
 * │                                                                           │
 * │ Full accessibility validation also requires manual testing with assistive  │
 * │ technologies and expert review; this file establishes the automated floor, │
 * │ not the ceiling.                                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ### Why contrast is computed from source text
 *
 * jsdom resolves neither a custom property nor a `var()` reference from an
 * imported stylesheet, and `jest-axe` disables axe's colour-category rules for
 * exactly that reason. So every stylesheet of the feature is read as **source
 * text**, the design-system tokens it paints with (`--pm-*`) are resolved for
 * each Theme from `src/design/tokens.json`, the scale is read from
 * `styles/playerStatsTokens.css`, and WCAG 2.1 relative luminance and contrast
 * ratios are computed here, the same mechanism the squads
 * `screens/keyboardAndContrast.property.test.tsx` uses.
 *
 * Every colour the stylesheets paint is measured against the surfaces it lands
 * on, greens included. The design system's text green clears the text floor in
 * both Themes, so there is no separate green rule: a green the stylesheets paint
 * is a pairing here like any other colour.
 *
 * ### What is not asserted here
 *
 * The accessible name of every control and every other automated WCAG check
 * belong to task 14.1's audits; the heading outline to Property 33; keyboard
 * reachability and the rendered focus indication to Property 34. This file is
 * about what the tables declare and what the stylesheets declare about width.
 *
 * Feature: web-player-stats-screen, Property 35: Both theme tables are complete
 * and meet the contrast floors
 * Validates: Requirements 15.3, 15.4, 15.7
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveColour } from '../../../design/contrast';
import designTokens from '../../../design/tokens.json';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Theme } from '../../../theme';

/** Both Themes, so every table below is measured twice (Requirement 15.3). */
const THEMES: readonly Theme[] = ['dark', 'light'];

/* ------------------------------------------------------------------ *
 * Reading the declared stylesheets
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


const TOKENS_NAME = 'player-stats/styles/playerStatsTokens.css';

const TOKENS_PATH = join(FEATURE_ROOT, 'styles', 'playerStatsTokens.css');

/** The design-system tokens the stylesheets read their colours from. */
const DESIGN_TOKENS_PATH = join(FEATURE_ROOT, '..', '..', 'design', 'tokens.css');

const tokensSource = readFileSync(TOKENS_PATH, 'utf8');

interface Stylesheet {
  /** A path relative to `features/`, so a failure names the file readably. */
  readonly name: string;
  readonly source: string;
}

/**
 * Every stylesheet whose declarations can reach the rendered screen.
 *
 * The feature's own, and only those: the screen renders inside the App_Shell
 * frame, whose stylesheets this feature neither owns nor may restate, and it
 * renders no component borrowed from another feature.
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
  /** The full selector list, as written, with runs of whitespace collapsed. */
  readonly selector: string;
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

/** Every rule of every stylesheet of the feature, in declaration order. */
const RULES: readonly CssRule[] = (() => {
  const rules: CssRule[] = [];

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

  return rules;
})();

/** Every custom property a value reads, in order. */
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
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The WCAG 2.1 relative luminance of a `#rrggbb` value, in 0..1. */
function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue);
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
 * declared once on `:root` in `styles/playerStatsTokens.css`.
 */
const SCALE: Record<string, string> = tokenTable(strippedTokens, /:root\s*\{([^}]*)\}/);

/** Every design-system token, colour or not: the type, space and size scale too. */
const DESIGN_TOKENS = new Set(
  [...withoutComments(readFileSync(DESIGN_TOKENS_PATH, 'utf8')).matchAll(/(--pm-[\w-]+)\s*:/g)].map(
    (match) => match[1],
  ),
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

/** Every custom property the feature paints, outside the token table itself. */
const PAINTED_TOKENS: readonly string[] = [
  ...new Set(
    RULES.filter((rule) => rule.sheet !== TOKENS_NAME).flatMap((rule) =>
      Object.values(rule.declarations).flatMap((value) => tokensIn(value)),
    ),
  ),
].sort();

/** The painted tokens that are colours. */
const PAINTED_COLOURS: readonly string[] = PAINTED_TOKENS.filter((token) =>
  COLOUR_TOKENS.includes(token),
);

/* ------------------------------------------------------------------ *
 * The floors, the surfaces, and the declared pairings
 * ------------------------------------------------------------------ */

/** Text and interactive control text (Requirement 15.4). */
const TEXT_FLOOR = 4.5;

/** Focus indications, borders, and graphical cues (Requirement 15.4). */
const NON_TEXT_FLOOR = 3;

/**
 * Every surface the feature paints or renders onto, and so every background a
 * colour can be read against.
 */
const SURFACE_TOKENS = [
  // The App_Shell's Content_Region behind the screen.
  '--pm-bg',
  // The stat tiles, panels and cards, and the leaderboard list.
  '--pm-surface',
  // Controls: the failure notice's retry, the not-found way out.
  '--pm-surface-raised',
  // The chosen statistic in the leaderboard switcher.
  '--pm-accent-fill',
] as const;

interface Pairing {
  readonly foreground: string;
  readonly background: string;
  readonly floor: typeof TEXT_FLOOR | typeof NON_TEXT_FLOOR;
  readonly usage: string;
}

/** One foreground against each of the screen's neutral surfaces, at one floor. */
function onNeutralSurfaces(foreground: string, floor: Pairing['floor'], usage: string): Pairing[] {
  return ['--pm-bg', '--pm-surface', '--pm-surface-raised'].map((background) => ({
    foreground,
    background,
    floor,
    usage,
  }));
}

const PAIRINGS: readonly Pairing[] = [
  // ---- Text: 4.5:1 (Requirement 15.4) ----
  ...onNeutralSurfaces('--pm-text-primary', TEXT_FLOOR, 'headings, figures, names and values'),
  ...onNeutralSurfaces('--pm-text-secondary', TEXT_FLOOR, 'labels, statements and secondary text'),
  ...onNeutralSurfaces(
    '--pm-result-win-text',
    TEXT_FLOOR,
    'the win glyph beside its letter and its word',
  ),
  ...onNeutralSurfaces(
    '--pm-result-draw-text',
    TEXT_FLOOR,
    'the draw glyph beside its letter and its word',
  ),
  ...onNeutralSurfaces(
    '--pm-result-loss-text',
    TEXT_FLOOR,
    'the loss glyph beside its letter and its word',
  ),
  ...onNeutralSurfaces(
    '--pm-provisional-text',
    TEXT_FLOOR,
    'the provisional Rating_Condition, beside its "~" and its word',
  ),
  {
    foreground: '--pm-on-accent',
    background: '--pm-accent-fill',
    floor: TEXT_FLOOR,
    usage: 'the chosen statistic in the leaderboard switcher: Ink on Pitch Green',
  },
  ...(['win', 'draw', 'loss'] as const).map((outcome) => ({
    foreground: '--pm-on-result',
    background: `--pm-result-${outcome}`,
    floor: TEXT_FLOOR,
    usage: `the record bar's ${outcome} segment: its mark, count and letter in Ink on the ${outcome} fill`,
  })),

  // ---- Focus indications, borders and graphical cues: 3:1 (Requirement 15.4) ----
  ...onNeutralSurfaces('--pm-focus-ring', NON_TEXT_FLOOR, 'every control’s focus indication'),
  {
    foreground: '--pm-on-accent',
    background: '--pm-accent-fill',
    floor: NON_TEXT_FLOOR,
    usage: 'the focus indication of the chosen statistic’s radio, drawn in Ink on its fill',
  },
  ...onNeutralSurfaces(
    '--pm-border-control',
    NON_TEXT_FLOOR,
    'the boundary of every control and the link underline',
  ),
  ...onNeutralSurfaces(
    '--pm-provisional-text',
    NON_TEXT_FLOOR,
    'the provisional badge’s outline',
  ),
  ...onNeutralSurfaces(
    '--pm-text-secondary',
    NON_TEXT_FLOOR,
    'the Rating_Condition shapes drawn in the secondary text colour',
  ),
];

/**
 * Painted tokens no pairing measures, and why each needs none.
 *
 * - `--pm-border-subtle` draws decorative separators and card edges only; every
 *   control boundary is `--pm-border-control`, which is measured (the design
 *   system's own rule).
 */
const UNMEASURED_TOKENS = ['--pm-border-subtle'] as const;

/** A pairing named the way a failure should read. */
function describePairing(theme: Theme, pairing: Pairing): string {
  return `${theme}: ${pairing.foreground} ${declared(theme, pairing.foreground)} on ${pairing.background} ${declared(theme, pairing.background)} (${pairing.usage})`;
}

// Feature: web-player-stats-screen, Property 35: Both theme tables are complete and meet the contrast floors
// Validates: Requirements 15.3
describe('Property 35 — the tables declare every token the feature paints', () => {
  it('resolves both design tables and the Theme-invariant scale', () => {
    expect(Object.keys(TABLES.dark).sort()).toEqual(Object.keys(TABLES.light).sort());
    expect(COLOUR_TOKENS.length).toBeGreaterThan(15);
    expect(SCALE['--player-stats-touch-target']).toBe('44px');
    // The scale declares no colour and restates no design token.
    expect(Object.keys(SCALE).some((token) => DESIGN_TOKENS.has(token))).toBe(false);
    expect(Object.values(SCALE).some((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toBe(false);
  });

  it('declares every custom property the feature paints', () => {
    // Requirement 15.3's first clause: a `var()` the stylesheets read and no table
    // declares resolves to nothing in a browser, which is a colour no Theme chose
    // and no assertion below measures.
    expect(PAINTED_TOKENS.length).toBeGreaterThan(25);

    const undeclared = PAINTED_TOKENS.filter((token) => !(token in SCALE) && !DESIGN_TOKENS.has(token));

    expect(undeclared).toEqual([]);
  });

  it('declares every painted colour token in both Themes', () => {
    const missing = PAINTED_COLOURS.flatMap((token) =>
      THEMES.filter((theme) => !(token in TABLES[theme])).map(
        (theme) => `${token} is absent from the ${theme} table`,
      ),
    );

    expect(PAINTED_COLOURS.length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });

  it('detects a painted property no table declares (guards the scan)', () => {
    const fabricated = tokensIn('color: var(--player-stats-nothing-declares-this)');

    expect(fabricated).toEqual(['--player-stats-nothing-declares-this']);
    expect(
      fabricated.filter((token) => !(token in SCALE) && !DESIGN_TOKENS.has(token)),
    ).toEqual(['--player-stats-nothing-declares-this']);
  });

  it('writes no colour literal in any stylesheet', () => {
    // The precondition for every measurement below: a colour written into a
    // stylesheet would be a colour no table declares and no pairing measures.
    const offenders = STYLESHEETS.flatMap((sheet) => {
      const source = withoutComments(sheet.source);
      return [...source.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi)].map(
        (match) => `${sheet.name}: ${match[0]}`,
      );
    });

    expect(offenders).toEqual([]);
  });
});

// Feature: web-player-stats-screen, Property 35: Both theme tables are complete and meet the contrast floors
// Validates: Requirements 15.4
describe('Property 35 — the declared pairings meet the contrast floors in both Themes', () => {
  it('computes the canonical ratios, so the arithmetic itself is checked', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#5bbf36', '#5bbf36')).toBeCloseTo(1, 5);
  });

  it('meets each pairing’s floor in both Themes', () => {
    fc.assert(
      fc.property(fc.constantFrom(...THEMES), fc.constantFrom(...PAIRINGS), (theme, pairing) => {
        const ratio = contrastRatio(declared(theme, pairing.foreground), declared(theme, pairing.background));

        expect(
          ratio,
          `${describePairing(theme, pairing)} is ${ratio.toFixed(2)}:1, below ${pairing.floor}:1`,
        ).toBeGreaterThanOrEqual(pairing.floor);
      }),
      { numRuns: 300 },
    );
  });

  it('holds for every pairing in both Themes exhaustively', () => {
    const failures: string[] = [];

    for (const theme of THEMES) {
      for (const pairing of PAIRINGS) {
        const ratio = contrastRatio(declared(theme, pairing.foreground), declared(theme, pairing.background));
        if (ratio < pairing.floor) {
          failures.push(`${describePairing(theme, pairing)} = ${ratio.toFixed(2)}:1 < ${pairing.floor}:1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('measures every colour token the feature paints', () => {
    // Guards the pairing table itself: a colour a stylesheet starts painting with
    // and no pairing measures would otherwise pass by never being measured.
    const unmeasured = PAINTED_COLOURS.filter(
      (token) => !PAIRINGS.some((pairing) => pairing.foreground === token || pairing.background === token),
    );

    expect(unmeasured).toEqual([...UNMEASURED_TOKENS]);
  });

  it('measures every surface a colour can be read against', () => {
    for (const surface of SURFACE_TOKENS) {
      expect(
        PAIRINGS.some((pairing) => pairing.background === surface),
        `no pairing measures anything against ${surface}`,
      ).toBe(true);
    }
  });

  it('would report a pairing below its floor (guards the measurement)', () => {
    // Non-vacuity: the fill amber is below even the non-text floor on the light
    // surface, which is why the outline takes the text amber, and the
    // measurement says so.
    expect(contrastRatio(declared('light', '--pm-provisional'), declared('light', '--pm-surface'))).toBeLessThan(
      NON_TEXT_FLOOR,
    );
    expect(PAIRINGS.some((pairing) => pairing.foreground === '--pm-provisional')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The layout residue (Requirement 15.7)
 * ------------------------------------------------------------------ */

/** The five widths task 14.4 names for verification. */
const VERIFIED_WIDTHS = [360, 767, 768, 1024, 1920] as const;

/** Resolve the Theme-invariant scale into a value, so a token's length is read. */
function resolveScale(value: string): string {
  let resolved = value;

  // Two passes: a scale token's value may itself read another one.
  for (let pass = 0; pass < 2; pass += 1) {
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
 * the stylesheets prefer them (Requirement 15.7).
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
 * this one arrangement is what renders at 360 pixels and at 1920 alike: the screen
 * root and each panel fill their column and are capped at it, padding and borders
 * are counted inside every declared width, every grid collapses to a single track
 * rather than holding one wider than the viewport, rows of items wrap rather than
 * shrink, and free text breaks rather than widening its line.
 */
const LAYOUT_MODE: readonly {
  readonly className: string;
  readonly declarations: Readonly<Record<string, string>>;
  readonly what: string;
}[] = [
  {
    className: 'player-stats-screen',
    declarations: {
      'box-sizing': 'border-box',
      width: '100%',
      'max-width': '100%',
      'min-width': '0',
    },
    what: 'the screen fills the App_Shell content region, is capped at it, and may shrink below its content',
  },
  {
    className: 'player-stats-main',
    declarations: { width: '100%' },
    what: 'the main content region fills the screen column',
  },
  {
    className: 'player-stats-section',
    declarations: { 'box-sizing': 'border-box', width: '100%' },
    what: 'every `StatSection` panel fills the column with its gutter counted inside its own box',
  },
  {
    className: 'player-stats-record__figures',
    declarations: {
      'grid-template-columns':
        'repeat( auto-fit, minmax(var(--player-stats-stat-min-width), 1fr) )',
    },
    what: 'the record grid tracks from a 9rem minimum and drops to one column rather than holding a track wider than the viewport',
  },
  {
    className: 'player-stats-rich__figures',
    declarations: {
      'grid-template-columns':
        'repeat( auto-fit, minmax(min(100%, var(--player-stats-stat-min-width)), 1fr) )',
    },
    what: 'the rich-stats grid does the same, with its minimum additionally capped at the container width',
  },
  {
    className: 'player-stats-progression-chart',
    declarations: { width: '100%' },
    what: 'the chart scales to its container and states no width of its own',
  },
  {
    className: 'player-stats-progression-table',
    declarations: { width: '100%' },
    what: 'the progression table fills its panel',
  },
  {
    className: 'player-stats-pairwise__table',
    declarations: { width: '100%' },
    what: 'each Pairwise_Section table likewise',
  },
];

/** Regions laying two or more items on one line, so they must wrap. */
const WRAPPING_ROWS = [
  'player-stats-identity__labels',
  'player-stats-rating__presentation',
  'player-stats-result-breakdown',
  'player-stats-failure__actions',
] as const;

/** Nodes rendering a person's own words, which may arrive as one long token. */
const FREE_TEXT_NODES = [
  'player-stats-screen__heading',
  'player-stats-identity__name',
  'player-stats-rating__text',
  'player-stats-pairwise__link',
] as const;

/** Every rule whose subject carries `className`. */
function rulesTargeting(className: string): readonly CssRule[] {
  const token = new RegExp(`\\.${className}(?![\\w-])`);

  return RULES.filter((rule) =>
    rule.parts.some((part) => {
      const compounds = part
        .split(/\s*[>+~]\s*|\s+/)
        .filter((piece) => piece.length > 0);
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

/** A value that is zero in every component, so a padding of it adds nothing. */
const ZERO_VALUE = /^0(?:[a-z%]*)?(?:\s+0(?:[a-z%]*)?)*$/;

/**
 * Rules whose declared box could overflow its container for want of `border-box`.
 *
 * A rule qualifies when it declares a non-zero padding **and** a width that fills
 * its container or states an absolute length — the case where the padding is added
 * outside the declared width and the box ends up wider than what holds it. A
 * shrink-to-fit hint like the `width: 1%` on a collapsed table cell is not such a
 * case: the cell grows to its content either way and the hint only decides which
 * column keeps the remainder.
 */
function borderBoxOffenders(rules: readonly CssRule[]): {
  readonly considered: readonly string[];
  readonly offenders: readonly string[];
} {
  const considered: string[] = [];
  const offenders: string[] = [];

  for (const rule of rules) {
    const padded = Object.entries(rule.declarations).some(
      ([property, value]) => property.startsWith('padding') && !ZERO_VALUE.test(value),
    );
    if (!padded) {
      continue;
    }

    const sized = ['width', 'min-width', 'max-width'].some((property) => {
      const value = rule.declarations[property];
      if (value === undefined || value === 'auto' || ZERO_VALUE.test(value)) {
        return false;
      }
      return value.includes('100%') || absoluteLengthsPx(value).length > 0;
    });
    if (!sized) {
      continue;
    }

    const name = `${rule.sheet}: ${rule.selector}`;
    considered.push(name);
    if (rule.declarations['box-sizing'] !== 'border-box') {
      offenders.push(name);
    }
  }

  return { considered, offenders };
}

// Feature: web-player-stats-screen, Property 35: Both theme tables are complete and meet the contrast floors
// Validates: Requirements 15.7
describe('Requirement 15.7 — the declared layout mode and the absence of fixed widths', () => {
  it('declares one fluid layout mode, with no breakpoint between the five widths', () => {
    // No `@media`, `@container`, or `@supports` anywhere in the feature: the same
    // declarations apply at 360 pixels and at 1920, so what is asserted below about
    // "the layout" is asserted about the layout at every one of the five widths
    // rather than at one of them.
    const gated = STYLESHEETS.flatMap((sheet) => {
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

    // The scale tokens a width reads are resolved rather than skipped, so the
    // 10rem grid minimum is measured as the 160 pixels it is.
    expect(absoluteLengthsPx('minmax(var(--player-stats-stat-min-width), 1fr)')).toEqual(
      [160],
    );
    // And a fixed width above the narrowest viewport would be detected.
    expect(absoluteLengthsPx('420px').some((length) => length > narrowest)).toBe(true);
  });

  it('counts padding and borders inside every declared width', () => {
    // Without `border-box`, a region declaring `width: 100%` and a gutter is wider
    // than its container by twice that gutter — the commonest source of a
    // horizontal scrollbar at 360 pixels.
    const { considered, offenders } = borderBoxOffenders(RULES);

    expect(offenders).toEqual([]);
    // Non-vacuity: the panel that declares both is in fact examined…
    expect(considered.join('\n')).toContain('.player-stats-section');
    // …and a rule declaring both without `border-box` would be reported.
    expect(
      borderBoxOffenders([
        {
          sheet: 'fabricated',
          selector: '.player-stats-fabricated',
          parts: ['.player-stats-fabricated'],
          declarations: { padding: '1rem', width: '100%' },
        },
      ]).offenders,
    ).toEqual(['fabricated: .player-stats-fabricated']);
  });

  it.each(LAYOUT_MODE)(
    'declares the layout mode of .$className — $what',
    ({ className, declarations }) => {
      for (const [property, value] of Object.entries(declarations)) {
        expect(
          declaredValues(className, property).map((value_) =>
            value_.replace(/\s+/g, ' '),
          ),
          `.${className} declares no ${property}`,
        ).toContain(value);
      }
    },
  );

  it.each(WRAPPING_ROWS)('lets .%s wrap rather than shrink its items', (className) => {
    expect(declaredValues(className, 'flex-wrap')).toContain('wrap');
  });

  it.each(FREE_TEXT_NODES)(
    'breaks the free text in .%s rather than widening it',
    (className) => {
      const values = declaredValues(className, 'overflow-wrap');

      expect(values.length, `.${className} declares no overflow-wrap`).toBeGreaterThan(
        0,
      );
      for (const value of values) {
        expect(['break-word', 'anywhere']).toContain(value);
      }
    },
  );
});
