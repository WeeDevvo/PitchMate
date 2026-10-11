/**
 * Property test for the green painting rule (task 14.5).
 *
 * **Property 36: Green is painted only as a surface-keyed mark, never as text.**
 * *For any* element the feature paints green, the token used is the surface-keyed
 * accent token rather than the accent fill token, and no text colour resolves to
 * any green token in either Theme.
 *
 * ### Why the rule exists, in numbers
 *
 * Green is the brand's primary hue and it cannot letter anything on a light
 * surface:
 *
 * | value | on light `--bg` #ffffff | on the light card #f4f4f4 | text floor | non-text floor |
 * | --- | --- | --- | --- | --- |
 * | Pitch Green `#5bbf36` | 2.35:1 | 2.13:1 | fails 4.5 | **fails 3** |
 * | Green Dark `#3e8f24` | 4.07:1 | 3.70:1 | fails 4.5 | clears 3 |
 *
 * So two separate conclusions, and this file asserts both with the ratios in the
 * failure message rather than leaving a reader to look them up:
 *
 *  1. **Green never paints text.** Neither value reaches 4.5:1 on a light
 *     surface, so no `color` (or any other text-painting property) may resolve to
 *     a green token — in *either* Theme, because a token that letters in the dark
 *     table is the same declaration that would letter in the light one.
 *  2. **A green mark is keyed to its surface, never to the fill token.**
 *     `--accent-fill` is Pitch Green in both tables, which does not even clear the
 *     3:1 a graphical cue owes on a light surface, so nothing may paint with it at
 *     all. A green line, glyph, or shape takes a token whose value is what
 *     `greenTokenForSurface` from `src/theme` returns for the luminance of the
 *     surface it lands on — Pitch Green below 0.05, Green Dark at or above it.
 *
 * The second clause is checked *through* `greenTokenForSurface` rather than
 * against a hand-written expectation, so the one rule in the application decides
 * both what the tables declare and what this test expects of them.
 *
 * ### How "paints green" is decided
 *
 * Not from a list of token names — from the declared values. A token is green
 * when its declared hex is green-dominant, and that detector is itself put under
 * property test at the end of the file against an independent HSL hue-sector
 * oracle, so a *new* green added to the tables next month is caught by the same
 * scan. The set of (token, property) pairs the stylesheets actually paint green
 * with is then compared against a declared table, so a new green painting site
 * has to be registered here with its surface and its reason.
 *
 * ### The one `color` declaration that resolves green, and why it is not text
 *
 * `ResultBreakdown.css` paints `--player-stats-win-icon` through `color`, on the
 * `__icon` span. That span is an **icon glyph**: `aria-hidden="true"`, carrying no
 * statistic, rendered beside a letter in `--text` and a clipped word that is what
 * assistive technology announces. An icon is non-text under WCAG 1.4.11 and owes
 * 3:1, which Green Dark clears on both light surfaces. Rather than exempt the
 * declaration on trust, the allowance below is verified independently: the
 * component source must mark that element `aria-hidden="true"`, the sibling letter
 * must take `--text`, and the token must clear the non-text floor on every surface
 * in both Themes. Anything else that letters green is an offender.
 *
 * ### Why this is a source scan
 *
 * jsdom resolves neither a custom property nor a `var()` reference from an
 * imported stylesheet, so a computed style would answer nothing here. The token
 * tables and every stylesheet of the feature are read as **source text** and WCAG
 * 2.1 relative luminance and contrast ratios are computed in this file — the same
 * approach `features/squads/screens/keyboardAndContrast.property.test.tsx` and
 * `features/app-shell/styles/theme.contrast.property.test.ts` take for the same
 * reason. It catches a bad token and a bad declared pairing; a composite a browser
 * paints differently (an inherited colour over an image, a translucent overlay, a
 * forced-colours mode) still needs a browser, and full accessibility validation
 * needs manual testing with assistive technologies and expert review.
 *
 * Feature: web-player-stats-screen, Property 36: Green is painted only as a
 * surface-keyed mark, never as text
 * Validates: Requirements 15.5
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GREEN_DARK,
  GREEN_TOKEN_LUMINANCE_THRESHOLD,
  PITCH_GREEN,
  greenTokenForSurface,
  type Theme,
} from '../../../theme';

/* ------------------------------------------------------------------ *
 * Reading the declared stylesheets
 * ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));

/** `features/player-stats/` — every stylesheet of the feature lives under it. */
const FEATURE_ROOT = join(here, '..');

/** The one module of the feature permitted to write a colour value. */
const TOKENS_PATH = join(FEATURE_ROOT, 'styles', 'playerStatsTokens.css');

/** Both Themes, so no assertion can quietly cover only the default one. */
const THEMES: readonly Theme[] = ['dark', 'light'];

/** Text and interactive control text (Requirement 15.4). */
const TEXT_FLOOR = 4.5;

/** Focus indications, borders, and graphical marks (Requirement 15.4). */
const NON_TEXT_FLOOR = 3;

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

/** Drop `/* ... *\/` comments, so documentation text is never read as CSS. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Stylesheet {
  /** A path relative to the feature root, so a failure names the file readably. */
  readonly name: string;
  readonly source: string;
}

const STYLESHEETS: readonly Stylesheet[] = stylesheetsUnder(FEATURE_ROOT).map(
  (path) => ({
    name: relative(FEATURE_ROOT, path).replace(/\\/g, '/'),
    source: readFileSync(path, 'utf8'),
  }),
);

const tokensSource = readFileSync(TOKENS_PATH, 'utf8');

interface CssRule {
  /** The stylesheet the rule was declared in. */
  readonly sheet: string;
  /** The full selector list, as written. */
  readonly selector: string;
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
const RULES: readonly CssRule[] = STYLESHEETS.flatMap((sheet) => {
  const source = withoutComments(sheet.source);
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const rules: CssRule[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (selector.length === 0 || selector.startsWith('@')) {
      continue;
    }
    rules.push({
      sheet: sheet.name,
      selector,
      declarations: parseDeclarations(match[2]),
    });
  }

  return rules;
});

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
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/* ------------------------------------------------------------------ *
 * The declared token tables
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

const TABLES: Readonly<Record<Theme, Record<string, string>>> = {
  // The dark table is shared by `:root` and `[data-theme='dark']`, so an absent or
  // unresolved attribute renders dark (Requirement 15.3).
  dark: tokenTable(strippedTokens, /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/),
  light: tokenTable(strippedTokens, /\[data-theme='light'\]\s*\{([^}]*)\}/),
};

/** The declared value of `token` in `theme`, failing loudly if undeclared. */
function declared(theme: Theme, token: string): string {
  const value = TABLES[theme][token];
  expect(value, `${token} is not declared in the ${theme} table`).toBeDefined();
  return value;
}

/** Whether `token` is declared as a colour in both tables. */
function isColourToken(token: string): boolean {
  return THEMES.every((theme) => /^#[0-9a-f]{6}$/.test(TABLES[theme][token] ?? ''));
}

/* ------------------------------------------------------------------ *
 * Which values are green
 * ------------------------------------------------------------------ */

/**
 * Whether a `#rrggbb` value is green — its green channel strictly dominating both
 * others, which is exactly the hue sector between yellow and cyan.
 *
 * Decided from the *value* rather than from the token's name, so a green added to
 * the tables under a name nobody thought of is still caught by every scan below.
 * The detector is cross-checked against an independent HSL hue-sector oracle in
 * the last block of this file.
 */
function isGreen(hex: string): boolean {
  const [red, green, blue] = channels(hex);
  return green > red && green > blue;
}

/** Whether `token` resolves to a green value in `theme`. */
function isGreenIn(theme: Theme, token: string): boolean {
  return isColourToken(token) && isGreen(declared(theme, token));
}

/** Whether `token` resolves to a green value in either Theme. */
function isGreenToken(token: string): boolean {
  return THEMES.some((theme) => isGreenIn(theme, token));
}

/** Every token of the tables that is green in at least one Theme. */
const GREEN_TOKENS: readonly string[] = Object.keys(TABLES.dark)
  .filter((token) => isGreenToken(token))
  .sort();

/**
 * The fill token: Pitch Green in **both** tables, and so unusable even as a mark
 * on a light surface. Nothing in the feature may paint with it.
 */
const ACCENT_FILL = '--accent-fill';

/**
 * The focus indication, which is a green of the brand's highlight family rather
 * than a surface-keyed mark: Green Light on the dark surfaces and Green Dark on
 * the light ones. It is held to the 3:1 non-text floor on every surface and to the
 * never-letters rule like every other green, but not to the surface-keyed *value*,
 * because the value it takes in the dark Theme is a deliberately lighter green
 * than the one `greenTokenForSurface` returns (brand.md → Green Light).
 */
const FOCUS_RING = '--focus-ring';

/**
 * The green tokens that are surface-keyed marks, and so owe exactly the value
 * `greenTokenForSurface` returns for the surface they land on.
 */
const SURFACE_KEYED_GREEN_TOKENS: readonly string[] = GREEN_TOKENS.filter(
  (token) => token !== ACCENT_FILL && token !== FOCUS_RING,
);

/**
 * Every surface a mark of this feature can be drawn on.
 *
 * The screen renders inside the App_Shell frame, so a figure sits either directly
 * on the region behind the screen or inside a section panel; a control carries its
 * own fill. All three are measured for every green, because a mark that clears the
 * floor on one and not another is a mark that fails wherever it is actually drawn.
 */
const SURFACE_TOKENS: readonly string[] = [
  // The region behind the screen, painted by the shell's Content_Region.
  '--bg',
  // Every StatSection panel, and so the chart and the Result_Breakdown inside it.
  '--player-stats-card-surface',
  // Every control: the retry control, the back-to-squad control, a Pairwise_Link.
  '--control-bg',
];

/* ------------------------------------------------------------------ *
 * The green painting sites the feature declares
 * ------------------------------------------------------------------ */

interface GreenPaintSite {
  /** The green token painted. */
  readonly token: string;
  /** The CSS property it is painted through. */
  readonly property: string;
  /** Why this is a mark rather than text. */
  readonly reason: string;
}

/**
 * Every (token, property) pair the feature paints a green through.
 *
 * Declared as a table and compared against what the scan finds, so a new green
 * painting site cannot appear without being named here — and naming it means
 * saying why it is a mark and not text.
 */
const GREEN_PAINT_SITES: readonly GreenPaintSite[] = [
  {
    token: '--player-stats-win-icon',
    property: 'color',
    reason:
      "the Result_Breakdown's win glyph — aria-hidden, carrying no statistic, beside a letter in --text and a clipped announced word (see NON_TEXT_MARKS)",
  },
  {
    token: '--player-stats-chart-line',
    property: 'stroke',
    reason:
      "the Progression_Chart's plotted line, whose meaning is carried by its slope and restated in words by the Progression_Table",
  },
  {
    token: '--player-stats-chart-point',
    property: 'fill',
    reason:
      "the Progression_Chart's point marks, each a shape at a position and restated in words by the Progression_Table",
  },
  {
    token: FOCUS_RING,
    property: 'outline',
    reason:
      'the focus indication of every control and of the main content region — a graphical cue owing 3:1',
  },
];

/**
 * Every property that paints text, and so every property a green may not appear
 * in — bar the enumerated non-text marks below.
 */
const TEXT_PAINTING_PROPERTIES: readonly string[] = [
  'color',
  '-webkit-text-fill-color',
  'text-decoration-color',
  'text-decoration',
  'text-emphasis-color',
  'caret-color',
  'text-shadow',
];

interface NonTextMark {
  /** The stylesheet declaring it, relative to the feature root. */
  readonly sheet: string;
  /** The selector, exactly as the scan normalises it. */
  readonly selector: string;
  /** The text-painting property used, and the token it reads. */
  readonly property: string;
  readonly token: string;
  /** The component source that renders the element, relative to the feature root. */
  readonly component: string;
  /** The class the element carries, so the source check can find its tag. */
  readonly className: string;
  /** The sibling class that carries the meaning as real text. */
  readonly textCarrierClassName: string;
}

/**
 * The only elements allowed to resolve a green through a text-painting property:
 * icon glyphs that are hidden from assistive technology and sit beside a text
 * carrier.
 *
 * Each entry is verified rather than trusted — the element must in fact be
 * `aria-hidden="true"` in the component source, the sibling carrier must in fact
 * take `--text`, and the token must clear the non-text floor on every surface in
 * both Themes. A glyph that stopped being hidden, or a letter that started taking
 * the hue, fails here.
 */
const NON_TEXT_MARKS: readonly NonTextMark[] = [
  {
    sheet: 'components/ResultBreakdown.css',
    selector:
      '.player-stats-result-breakdown__item--win .player-stats-result-breakdown__icon',
    property: 'color',
    token: '--player-stats-win-icon',
    component: 'components/ResultBreakdown.tsx',
    className: 'player-stats-result-breakdown__icon',
    textCarrierClassName: 'player-stats-result-breakdown__letter',
  },
];

function isAllowedNonTextMark(
  sheet: string,
  selector: string,
  property: string,
  token: string,
): boolean {
  return NON_TEXT_MARKS.some(
    (mark) =>
      mark.sheet === sheet &&
      mark.selector === selector &&
      mark.property === property &&
      mark.token === token,
  );
}

interface TextDeclaration {
  readonly sheet: string;
  readonly selector: string;
  readonly property: string;
  readonly value: string;
  readonly token: string;
}

/** Every token read by a text-painting property, anywhere in the feature. */
function textDeclarationsOf(rules: readonly CssRule[]): readonly TextDeclaration[] {
  return rules.flatMap((rule) =>
    TEXT_PAINTING_PROPERTIES.flatMap((property) => {
      const value = rule.declarations[property];
      if (value === undefined) {
        return [];
      }
      return tokensIn(value).map((token) => ({
        sheet: rule.sheet,
        selector: rule.selector,
        property,
        value,
        token,
      }));
    }),
  );
}

const TEXT_DECLARATIONS = textDeclarationsOf(RULES);

/** Every text declaration resolving green in `theme` and not an allowed mark. */
function greenTextOffenders(
  declarations: readonly TextDeclaration[],
  theme: Theme,
): string[] {
  return declarations.flatMap((declaration) => {
    if (!isGreenIn(theme, declaration.token)) {
      return [];
    }
    if (
      isAllowedNonTextMark(
        declaration.sheet,
        declaration.selector,
        declaration.property,
        declaration.token,
      )
    ) {
      return [];
    }
    const value = declared(theme, declaration.token);
    const ratio = contrastRatio(value, declared(theme, '--bg'));
    return [
      `${declaration.sheet}: ${declaration.selector} { ${declaration.property}: ${declaration.value} } letters ${theme} green ${value} at ${ratio.toFixed(2)}:1 on --bg, below the ${TEXT_FLOOR}:1 text floor`,
    ];
  });
}

/* ------------------------------------------------------------------ *
 * Reading the component sources, for the non-text mark allowance
 * ------------------------------------------------------------------ */

/** Every JSX opening tag of a source, so a tag's attributes can be read together. */
function openingTags(source: string): string[] {
  return [...source.matchAll(/<[A-Za-z][^>]*>/g)].map((match) => match[0]);
}

function componentSource(name: string): string {
  return readFileSync(join(FEATURE_ROOT, name), 'utf8');
}

/* ------------------------------------------------------------------ *
 * Arbitraries
 * ------------------------------------------------------------------ */

const themeArb: fc.Arbitrary<Theme> = fc.constantFrom(...THEMES);
const surfaceArb: fc.Arbitrary<string> = fc.constantFrom(...SURFACE_TOKENS);
const channelArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 255 });

// Feature: web-player-stats-screen, Property 36: Green is painted only as a surface-keyed mark, never as text
// Validates: Requirements 15.5
describe('Property 36 — the ratios the rule rests on', () => {
  it('parses both tables, the stylesheets, and the greens', () => {
    // Guards everything below: a parse that found nothing would pass vacuously.
    expect(STYLESHEETS.length).toBeGreaterThan(8);
    expect(RULES.length).toBeGreaterThan(40);
    expect(TEXT_DECLARATIONS.length).toBeGreaterThan(20);
    expect(Object.keys(TABLES.dark).sort()).toEqual(Object.keys(TABLES.light).sort());

    // The two values the shared rule can return are both present in the tables,
    // and the token table's greens are exactly the six this file reasons about.
    expect(GREEN_TOKENS).toEqual([
      '--accent-fill',
      '--accent-text',
      '--focus-ring',
      '--player-stats-chart-line',
      '--player-stats-chart-point',
      '--player-stats-win-icon',
    ]);
    expect(SURFACE_KEYED_GREEN_TOKENS).toEqual([
      '--accent-text',
      '--player-stats-chart-line',
      '--player-stats-chart-point',
      '--player-stats-win-icon',
    ]);
  });

  it('computes the canonical ratios, so the arithmetic itself is checked', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio(PITCH_GREEN, PITCH_GREEN)).toBeCloseTo(1, 5);
  });

  it('measures both greens below the text floor on every light surface', () => {
    // The reason the whole property exists, stated in numbers: Pitch Green reaches
    // 2.35:1 on the light background and Green Dark 4.07:1, so neither clears the
    // 4.5:1 a text value owes — in the Theme a person is most likely reading in.
    for (const surface of SURFACE_TOKENS) {
      const background = declared('light', surface);

      const pitchGreen = contrastRatio(PITCH_GREEN, background);
      const greenDark = contrastRatio(GREEN_DARK, background);

      expect(
        pitchGreen,
        `Pitch Green ${PITCH_GREEN} on light ${surface} ${background} is ${pitchGreen.toFixed(2)}:1, which is why it may not paint text (floor ${TEXT_FLOOR}:1)`,
      ).toBeLessThan(TEXT_FLOOR);

      expect(
        greenDark,
        `Green Dark ${GREEN_DARK} on light ${surface} ${background} is ${greenDark.toFixed(2)}:1, which is why it may not paint text either (floor ${TEXT_FLOOR}:1)`,
      ).toBeLessThan(TEXT_FLOOR);

      // And the other half of the rule: Green Dark is still a usable *mark* there,
      // while Pitch Green is not — which is what makes the choice surface-keyed
      // rather than a matter of taste.
      expect(
        greenDark,
        `Green Dark ${GREEN_DARK} on light ${surface} ${background} is ${greenDark.toFixed(2)}:1, below the ${NON_TEXT_FLOOR}:1 non-text floor`,
      ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);

      expect(
        pitchGreen,
        `Pitch Green ${PITCH_GREEN} on light ${surface} ${background} is ${pitchGreen.toFixed(2)}:1 — if that cleared ${NON_TEXT_FLOOR}:1 the fill token would be usable as a mark and this rule would be unnecessary`,
      ).toBeLessThan(NON_TEXT_FLOOR);
    }
  });
});

// Feature: web-player-stats-screen, Property 36: Green is painted only as a surface-keyed mark, never as text
// Validates: Requirements 15.5
describe('Property 36 — every green mark is the surface-keyed token', () => {
  it('declares each green mark as the value greenTokenForSurface returns for the surface it lands on', () => {
    fc.assert(
      fc.property(
        themeArb,
        fc.constantFrom(...SURFACE_KEYED_GREEN_TOKENS),
        surfaceArb,
        (theme, token, surface) => {
          const background = declared(theme, surface);
          const expected = greenTokenForSurface(relativeLuminance(background));
          const value = declared(theme, token);
          const ratio = contrastRatio(value, background);

          expect(
            value,
            `${theme} ${token} is ${value}, but ${surface} ${background} has luminance ${relativeLuminance(background).toFixed(4)} (boundary ${GREEN_TOKEN_LUMINANCE_THRESHOLD}), so greenTokenForSurface selects ${expected} — ${value} would be ${ratio.toFixed(2)}:1 there`,
          ).toBe(expected.toLowerCase());
        },
      ),
      { numRuns: 300 },
    );
  });

  it('clears the non-text floor for every green mark on every surface in both Themes', () => {
    fc.assert(
      fc.property(
        themeArb,
        fc.constantFrom(...GREEN_TOKENS.filter((token) => token !== ACCENT_FILL)),
        surfaceArb,
        (theme, token, surface) => {
          const value = declared(theme, token);
          const background = declared(theme, surface);
          const ratio = contrastRatio(value, background);

          expect(
            ratio,
            `${theme} ${token} ${value} on ${surface} ${background} is ${ratio.toFixed(2)}:1, below the ${NON_TEXT_FLOOR}:1 a green mark owes`,
          ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('paints green through exactly the declared sites, each a mark rather than text', () => {
    const found = new Set<string>();

    for (const rule of RULES) {
      for (const [property, value] of Object.entries(rule.declarations)) {
        for (const token of tokensIn(value)) {
          if (isGreenToken(token)) {
            found.add(`${token}|${property}`);
          }
        }
      }
    }

    expect([...found].sort()).toEqual(
      GREEN_PAINT_SITES.map((site) => `${site.token}|${site.property}`).sort(),
    );

    // Every declared site names a real green token, so the table cannot drift into
    // registering something the tables no longer call green.
    for (const site of GREEN_PAINT_SITES) {
      expect(isGreenToken(site.token), `${site.token}: ${site.reason}`).toBe(true);
    }
  });
});

// Feature: web-player-stats-screen, Property 36: Green is painted only as a surface-keyed mark, never as text
// Validates: Requirements 15.5
describe('Property 36 — green never paints text', () => {
  it('resolves no text colour to a green token in either Theme', () => {
    fc.assert(
      fc.property(themeArb, fc.constantFrom(...TEXT_DECLARATIONS), (theme, declaration) => {
        expect(greenTextOffenders([declaration], theme)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('reports no offender across the whole feature in either Theme', () => {
    for (const theme of THEMES) {
      expect(greenTextOffenders(TEXT_DECLARATIONS, theme)).toEqual([]);
    }
  });

  it('holds each exempt glyph to being a hidden mark beside a text carrier', () => {
    // The exemption is for icon glyphs, which are non-text under WCAG 1.4.11. That
    // is a claim about the rendered element, so it is checked against the component
    // source rather than assumed from the class name.
    expect(NON_TEXT_MARKS.length).toBeGreaterThan(0);

    for (const mark of NON_TEXT_MARKS) {
      const source = componentSource(mark.component);
      const tags = openingTags(source).filter((tag) =>
        tag.includes(`"${mark.className}"`),
      );

      expect(
        tags.length,
        `${mark.component} renders no element carrying ${mark.className}`,
      ).toBeGreaterThan(0);

      for (const tag of tags) {
        expect(
          tag,
          `${mark.component}: ${mark.className} resolves green through ${mark.property}, so it must be hidden from assistive technology`,
        ).toContain('aria-hidden="true"');
      }

      // The meaning is carried as real text beside the glyph, in the body text
      // colour — the half of Requirement 15.5 the exemption depends on.
      const carrier = RULES.find(
        (rule) =>
          rule.sheet === mark.sheet &&
          rule.selector === `.${mark.textCarrierClassName}`,
      );

      expect(
        carrier,
        `${mark.sheet} declares no rule for .${mark.textCarrierClassName}`,
      ).toBeDefined();
      expect(carrier?.declarations.color).toBe('var(--text)');
      expect(source).toContain(mark.textCarrierClassName);

      // And the glyph itself clears the floor a non-text mark owes, everywhere.
      for (const theme of THEMES) {
        for (const surface of SURFACE_TOKENS) {
          const value = declared(theme, mark.token);
          const background = declared(theme, surface);
          const ratio = contrastRatio(value, background);

          expect(
            ratio,
            `${theme} ${mark.token} ${value} on ${surface} ${background} is ${ratio.toFixed(2)}:1, below the ${NON_TEXT_FLOOR}:1 an icon mark owes`,
          ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
        }
      }
    }
  });
});

// Feature: web-player-stats-screen, Property 36: Green is painted only as a surface-keyed mark, never as text
// Validates: Requirements 15.5
describe('Property 36 — the accent fill token paints nothing', () => {
  it('measures the fill token below the non-text floor on every light surface', () => {
    fc.assert(
      fc.property(surfaceArb, (surface) => {
        const fill = declared('light', ACCENT_FILL);
        const background = declared('light', surface);
        const ratio = contrastRatio(fill, background);

        expect(
          ratio,
          `${ACCENT_FILL} ${fill} on light ${surface} ${background} is ${ratio.toFixed(2)}:1 — it is Pitch Green in both tables, so it clears neither the ${NON_TEXT_FLOOR}:1 a mark owes nor the ${TEXT_FLOOR}:1 text owes`,
        ).toBeLessThan(NON_TEXT_FLOOR);
      }),
      { numRuns: 100 },
    );
  });

  it('is read by no declaration of any stylesheet of the feature', () => {
    const fill = declared('light', ACCENT_FILL);

    const offenders = RULES.flatMap((rule) =>
      Object.entries(rule.declarations).flatMap(([property, value]) =>
        tokensIn(value).includes(ACCENT_FILL)
          ? [
              `${rule.sheet}: ${rule.selector} { ${property}: ${value} } paints ${fill}, which is ${contrastRatio(fill, declared('light', '--bg')).toFixed(2)}:1 on the light background`,
            ]
          : [],
      ),
    );

    expect(offenders).toEqual([]);

    // The token stays declared in both tables for parity with the other three
    // feature tables, so the absence above is a painting rule and not an omission.
    for (const theme of THEMES) {
      expect(declared(theme, ACCENT_FILL)).toBe(PITCH_GREEN.toLowerCase());
    }
  });
});

// Feature: web-player-stats-screen, Property 36: Green is painted only as a surface-keyed mark, never as text
// Validates: Requirements 15.5
describe('Property 36 — the scan is not vacuous', () => {
  it('detects green by hue, agreeing with an independent HSL oracle', () => {
    fc.assert(
      fc.property(channelArb, channelArb, channelArb, (red, green, blue) => {
        const hex = `#${[red, green, blue]
          .map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')}`;

        // The oracle: the HSL hue sector strictly between yellow (60 degrees) and
        // cyan (180), on a colour with some saturation. Derived from the standard
        // hue formula rather than from the detector under test.
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const hue =
          max === min
            ? null
            : max === red
              ? (60 * (((green - blue) / (max - min) + 6) % 6) + 360) % 360
              : max === green
                ? 60 * (2 + (blue - red) / (max - min))
                : 60 * (4 + (red - green) / (max - min));

        const inGreenSector = hue !== null && hue > 60 && hue < 180;

        expect(isGreen(hex), `${hex} hue ${hue === null ? 'none' : hue.toFixed(1)}`).toBe(
          inGreenSector,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('calls both tokens the shared rule can return green, and the tables’ other hues not green', () => {
    expect(isGreen(PITCH_GREEN)).toBe(true);
    expect(isGreen(GREEN_DARK)).toBe(true);

    // The amber, red, blue, and grey values of the tables are not green — so the
    // green scans above are not quietly covering the whole table.
    const nonGreen = Object.keys(TABLES.dark).filter(
      (token) => isColourToken(token) && !isGreenToken(token),
    );
    expect(nonGreen.length).toBeGreaterThan(8);
    for (const token of nonGreen) {
      for (const theme of THEMES) {
        expect(isGreen(declared(theme, token)), `${theme} ${token}`).toBe(false);
      }
    }
  });

  it('resolves a different green per Theme, so the surface-keyed rule is doing work', () => {
    // If `greenTokenForSurface` answered the same for every surface the feature
    // paints, the value assertion above would be comparing a constant and would
    // pass for a hand-picked hex. Both answers are in fact reached.
    const answers = new Set(
      THEMES.flatMap((theme) =>
        SURFACE_TOKENS.map((surface) =>
          greenTokenForSurface(relativeLuminance(declared(theme, surface))),
        ),
      ),
    );

    expect([...answers].sort()).toEqual([GREEN_DARK, PITCH_GREEN].sort());
  });

  it('reports a planted green text colour, at a selector and at a property', () => {
    const planted: readonly CssRule[] = [
      {
        sheet: 'components/Planted.css',
        selector: '.player-stats-planted__label',
        declarations: { color: 'var(--accent-text)' },
      },
      {
        sheet: 'components/Planted.css',
        selector: '.player-stats-planted__link',
        declarations: {
          'text-decoration-color': 'var(--player-stats-chart-line)',
        },
      },
    ];

    for (const theme of THEMES) {
      expect(greenTextOffenders(textDeclarationsOf(planted), theme)).toHaveLength(2);
    }
  });

  it('reports a green lettered at the exempt glyph’s own sibling', () => {
    // The exemption is keyed to the exact selector, property, and token — so the
    // letter beside the glyph cannot borrow it.
    const planted: readonly CssRule[] = [
      {
        sheet: 'components/ResultBreakdown.css',
        selector:
          '.player-stats-result-breakdown__item--win .player-stats-result-breakdown__letter',
        declarations: { color: 'var(--player-stats-win-icon)' },
      },
    ];

    for (const theme of THEMES) {
      expect(greenTextOffenders(textDeclarationsOf(planted), theme)).toHaveLength(1);
    }
  });

  it('reports a planted use of the fill token', () => {
    const planted: readonly CssRule[] = [
      {
        sheet: 'components/Planted.css',
        selector: '.player-stats-planted__mark',
        declarations: { stroke: 'var(--accent-fill)' },
      },
    ];

    const offenders = planted.flatMap((rule) =>
      Object.entries(rule.declarations).flatMap(([property, value]) =>
        tokensIn(value).includes(ACCENT_FILL) ? [`${rule.selector} ${property}`] : [],
      ),
    );

    expect(offenders).toHaveLength(1);
  });
});
