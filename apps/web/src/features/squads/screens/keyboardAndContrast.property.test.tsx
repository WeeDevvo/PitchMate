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
 * | a focus indication at 3:1 | every rendered control resolves a declared `:focus-visible` outline painting `var(--focus-ring)`, and that token is measured at 3:1 against every surface it can be drawn on (19.4, 19.5) |
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
 * The stylesheet holding the declared presentation of every text field of every
 * squads form — the Auth_Feature's `FormField`, which the forms render through its
 * public barrel rather than restating.
 */
const AUTH_FIELD_STYLESHEET = join(
  FEATURE_ROOT,
  '..',
  'auth',
  'components',
  'FormField.css',
);

/** The per-Theme token tables of the three features that declare the shared ten. */
const SHARED_THEME_TABLES: readonly { readonly name: string; readonly path: string }[] =
  [
    { name: 'app-shell', path: join(FEATURE_ROOT, '..', 'app-shell', 'styles', 'theme.css') },
    { name: 'auth', path: join(FEATURE_ROOT, '..', 'auth', 'styles', 'theme.css') },
    { name: 'landing', path: join(FEATURE_ROOT, '..', 'landing', 'styles', 'theme.css') },
  ];

const TOKENS_PATH = join(FEATURE_ROOT, 'styles', 'squadsTokens.css');

const tokensSource = readFileSync(TOKENS_PATH, 'utf8');

interface Stylesheet {
  /** A path relative to `features/`, so a failure names the file readably. */
  readonly name: string;
  readonly source: string;
}

const FEATURE_STYLESHEET_PATHS = stylesheetsUnder(FEATURE_ROOT);

/**
 * Every stylesheet whose declarations can reach a rendered squads screen: the
 * feature's own, plus the one shared component stylesheet its forms render
 * through.
 */
const STYLESHEETS: readonly Stylesheet[] = [
  ...FEATURE_STYLESHEET_PATHS,
  AUTH_FIELD_STYLESHEET,
].map((path) => ({
  name: relative(join(FEATURE_ROOT, '..'), path).replace(/\\/g, '/'),
  source: readFileSync(path, 'utf8'),
}));

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
  // unresolved attribute renders dark (Requirement 19.12).
  dark: tokenTable(strippedTokens, /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/),
  light: tokenTable(strippedTokens, /\[data-theme='light'\]\s*\{([^}]*)\}/),
};

/**
 * The Theme-invariant scale: spacing, radii, target sizes, and type sizes,
 * declared once on `:root` rather than duplicated into both colour tables.
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

/** The colour tokens of the tables — everything declared as a hex value. */
const COLOUR_TOKENS: readonly string[] = Object.keys(TABLES.dark).filter((token) =>
  /^#[0-9a-f]{6}$/.test(TABLES.dark[token]),
);

/* ------------------------------------------------------------------ *
 * The floors, the surfaces, and the declared pairings
 * ------------------------------------------------------------------ */

/** Text and interactive control text (Requirement 19.5). */
const TEXT_FLOOR = 4.5;

/** Focus indications, borders, and graphical state cues (Requirement 19.5). */
const NON_TEXT_FLOOR = 3;

/**
 * Every surface the feature paints, and so every background a colour can be read
 * against.
 *
 * A label chip carries an outline and text and no fill of its own, deliberately,
 * so a chip introduces no further surface: its text is read against whichever of
 * these its row or card is painted with.
 */
const SURFACE_TOKENS = [
  // The App_Shell's Content_Region behind the Squads_Home and the Squad_Screen,
  // and the Invite_Landing_Route's own page surface outside that frame.
  '--bg',
  // The Squad_Card, the Player_Row, the section panels, the invite entries, and
  // every Form_Panel, Confirm_Dialog, and Invite_Reveal.
  '--squads-card-surface',
  // A Player_Row whose Membership_State is inactive.
  '--squads-inactive-surface',
  // Every control: buttons, links styled as controls, selects, and text fields.
  '--control-bg',
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

const PAIRINGS: readonly Pairing[] = [
  // ---- Text and interactive control text: 4.5:1 (Requirement 19.5) ----
  {
    foreground: '--text',
    background: '--bg',
    floor: TEXT_FLOOR,
    usage:
      "each screen's level-one heading, the Squad_Screen's section headings and caller-role value, the Admin_Section's headings, and the Invite_Landing_Route's own text",
  },
  {
    foreground: '--text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage:
      "a Squad_Card's name, an active Player_Row's name, a Placeholder_Section's heading, a surface heading and statement, a Display_Rating, an invite entry's instants, and every form field's label and validation message",
  },
  {
    foreground: '--text',
    background: '--squads-inactive-surface',
    floor: TEXT_FLOOR,
    usage:
      "a Display_Rating on an inactive Player_Row, which states its own colour rather than inheriting the row's mute",
  },
  {
    foreground: '--muted-text',
    background: '--bg',
    floor: TEXT_FLOOR,
    usage:
      'the Squads_Empty_State statements, the loading statement, the no-players statement, the Not_Found_Treatment body, and the Invite_Landing_Route messages',
  },
  {
    foreground: '--muted-text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage:
      "a Squad_Card's role and state labels, a Placeholder_Section's statement, the invite entry labels and the does-not-expire label, the Invite_Reveal's field labels, and the Rating_Unavailable label",
  },
  {
    foreground: '--muted-text',
    background: '--squads-inactive-surface',
    floor: TEXT_FLOOR,
    usage:
      'a Former_Player label and a Rating_Unavailable label on an inactive Player_Row',
  },
  {
    foreground: '--control-text',
    background: '--control-bg',
    floor: TEXT_FLOOR,
    usage:
      "every control's own label: the Squads_Home entry points, the retry control, the Not_Found_Treatment home control, the Player_Row admin controls, the invite generate and revoke controls, the Feature_Toggle switches, the surface actions, the Invite_Landing_Route controls, and the text a person types into a form field",
  },
  {
    foreground: '--squads-inactive-text',
    background: '--squads-inactive-surface',
    floor: TEXT_FLOOR,
    usage:
      "an inactive Player_Row's name and the labels that inherit its colour — one of three cues for that state, never the only one",
  },
  {
    foreground: '--squads-provisional-text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage: 'the Provisional_Band label on an active Player_Row',
  },
  {
    foreground: '--squads-provisional-text',
    background: '--squads-inactive-surface',
    floor: TEXT_FLOOR,
    usage: 'the Provisional_Band label on an inactive Player_Row',
  },
  {
    foreground: '--squads-guest-text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage: 'the Guest_Flag label on an active Player_Row',
  },
  {
    foreground: '--squads-guest-text',
    background: '--squads-inactive-surface',
    floor: TEXT_FLOOR,
    usage: 'the Guest_Flag label on an inactive Player_Row',
  },
  {
    foreground: '--squads-invite-active-text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage: "an active Invite_State's word, on the invite entry surface",
  },
  {
    foreground: '--squads-invite-revoked-text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage: "a revoked Invite_State's word, on the invite entry surface",
  },
  {
    foreground: '--squads-invite-expired-text',
    background: '--squads-card-surface',
    floor: TEXT_FLOOR,
    usage: "an expired Invite_State's word, on the invite entry surface",
  },

  // ---- Focus indications, borders, and graphical cues: 3:1 (19.5) ----
  {
    foreground: '--focus-ring',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage:
      'the focus indication of a control drawn against the region behind the screen',
  },
  {
    foreground: '--focus-ring',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      'the focus indication of a control on a card, a Player_Row, an invite entry, or an open surface',
  },
  {
    foreground: '--focus-ring',
    background: '--squads-inactive-surface',
    floor: NON_TEXT_FLOOR,
    usage: "the focus indication of an inactive Player_Row's controls",
  },
  {
    foreground: '--focus-ring',
    background: '--control-bg',
    floor: NON_TEXT_FLOOR,
    usage:
      "the focus indication offset from a bordered control, whose own fill is one of its adjacent colours",
  },
  {
    foreground: '--control-border',
    background: '--control-bg',
    floor: NON_TEXT_FLOOR,
    usage: "every bordered control's edge against its own fill",
  },
  {
    foreground: '--control-border',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage:
      "a control's edge where the region behind the screen is what lies beyond it",
  },
  {
    foreground: '--control-border',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      "a control's edge where a card, a Player_Row, an invite entry, or an open surface lies beyond it",
  },
  {
    foreground: '--control-border',
    background: '--squads-inactive-surface',
    floor: NON_TEXT_FLOOR,
    usage: "an inactive Player_Row's admin control edges",
  },
  {
    foreground: '--squads-card-border',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage:
      'the edge of a Squad_Card, a Player_Row, a Placeholder_Section, an invite entry, or an open surface against the region behind it',
  },
  {
    foreground: '--squads-card-border',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage: 'that same edge against the surface it encloses',
  },
  {
    foreground: '--squads-card-border',
    background: '--squads-inactive-surface',
    floor: NON_TEXT_FLOOR,
    usage: "an inactive Player_Row's edge against its own muted fill",
  },
  {
    foreground: '--squads-chip-border',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      "every label chip's outline — the role and state labels, the membership labels, the Rating_Presentation chips, the Invite_State chip, and the Invite_Code",
  },
  {
    foreground: '--squads-chip-border',
    background: '--squads-inactive-surface',
    floor: NON_TEXT_FLOOR,
    usage: "a label chip's outline on an inactive Player_Row",
  },
  {
    foreground: '--squads-provisional-border',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage: "the Provisional_Band chip's outline and its badge ring",
  },
  {
    foreground: '--squads-provisional-border',
    background: '--squads-inactive-surface',
    floor: NON_TEXT_FLOOR,
    usage: 'that same outline on an inactive Player_Row',
  },
  {
    foreground: '--squads-invite-active-accent',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      "an active Invite_State chip's outline — the graphical cue that keeps the hue in the light Theme, where the word itself must take the text token",
  },
  {
    foreground: '--accent-text',
    background: '--control-bg',
    floor: NON_TEXT_FLOOR,
    usage:
      "the primary surface action's accent edge, a checked Feature_Toggle's accent edge and knob, and the acknowledgement box's accent — against the control's own fill",
  },
  {
    foreground: '--accent-text',
    background: '--bg',
    floor: NON_TEXT_FLOOR,
    usage:
      'green accent emphasis and icons against the region behind the screen — never text, see the boundary assertions below',
  },
  {
    foreground: '--accent-text',
    background: '--squads-card-surface',
    floor: NON_TEXT_FLOOR,
    usage:
      "green accent emphasis and icons on a card or an open surface — the primary action's edge where the surface behind it is what lies beyond",
  },
  {
    foreground: '--accent-text',
    background: '--squads-inactive-surface',
    floor: NON_TEXT_FLOOR,
    usage: 'green accent emphasis and icons on an inactive Player_Row',
  },
];

/**
 * The tokens the tables declare and no pairing measures.
 *
 * Both are declared so that this feature's tables carry the **same ten shared
 * token names** the App_Shell's and the Auth_Feature's do — the
 * Invite_Landing_Route renders outside the shell frame and inherits nothing — and
 * the feature paints with neither:
 *
 * - `--surface` is the shell's own panel surface; a squads surface takes
 *   `--squads-card-surface`.
 * - `--accent-fill` is Pitch Green in **both** Themes, which reaches only 2.35:1
 *   on white. Nothing here fills with green (`surfaces.css` says why: no token is
 *   declared for text on green), and a green *line or shape* on a surface takes
 *   the surface-keyed `--accent-text` instead, so it clears the 3:1 floor in the
 *   light Theme too. The boundary assertions below hold the stylesheets to that.
 */
const UNMEASURED_TOKENS = ['--accent-fill', '--surface'] as const;

/** A pairing named the way a failure should read. */
function describePairing(theme: Theme, pairing: Pairing): string {
  return `${theme}: ${pairing.foreground} ${declared(theme, pairing.foreground)} on ${pairing.background} ${declared(theme, pairing.background)} (${pairing.usage})`;
}

// Feature: web-squads-screens, Property 47: Every control is reachable in document order with a visible focus indication in both themes
// Validates: Requirements 19.5
describe('Property 47 — the declared token tables meet the contrast floors in both Themes', () => {
  it('parses both tables and the Theme-invariant scale', () => {
    expect(Object.keys(TABLES.dark).sort()).toEqual(Object.keys(TABLES.light).sort());
    expect(COLOUR_TOKENS.length).toBeGreaterThan(15);
    expect(SCALE['--squads-touch-target']).toBe('44px');
    expect(SCALE['--squads-focus-width']).toBe('3px');
    // The scale block declares no colour, and the colour tables declare no scale.
    expect(Object.keys(SCALE).some((token) => token in TABLES.dark)).toBe(false);
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

  it('measures every colour token the tables declare', () => {
    // Guards the pairing table itself: a token added to `squadsTokens.css` with no
    // pairing here would otherwise pass by never being measured.
    const unmeasured = COLOUR_TOKENS.filter(
      (token) =>
        !PAIRINGS.some(
          (pairing) => pairing.foreground === token || pairing.background === token,
        ),
    );

    expect(unmeasured.sort()).toEqual([...UNMEASURED_TOKENS]);
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
});

/* ------------------------------------------------------------------ *
 * The shared theme tables, and the two green boundaries
 * ------------------------------------------------------------------ */

describe('Property 47 — the restated shared tokens and the green boundaries', () => {
  it('declares the shared token names with the shared values, in both Themes', () => {
    // `squadsTokens.css` restates the shared ten because the Invite_Landing_Route
    // renders outside the App_Shell frame and inherits nothing from it. A restated
    // value can drift, so each is compared against the tables that also declare it.
    let compared = 0;

    for (const { name, path } of SHARED_THEME_TABLES) {
      const source = withoutComments(readFileSync(path, 'utf8'));
      const tables: Readonly<Record<Theme, Record<string, string>>> = {
        dark: tokenTable(source, /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/),
        light: tokenTable(source, /\[data-theme='light'\]\s*\{([^}]*)\}/),
      };

      for (const theme of THEMES) {
        for (const [token, value] of Object.entries(tables[theme])) {
          if (!(token in TABLES[theme])) {
            continue;
          }
          compared += 1;
          expect(
            declared(theme, token),
            `${theme} ${token} is ${declared(theme, token)} here and ${value} in features/${name}/styles/theme.css`,
          ).toBe(value);
        }
      }
    }

    // Guards the comparison: a parse that found no shared name would pass vacuously.
    expect(compared).toBeGreaterThan(30);
  });

  it('declares the green token the surface luminance rule selects', () => {
    // Green is chosen from the surface rather than from the Theme, so each table's
    // `--accent-text` is what the shared rule returns for that table's own
    // background luminance. Pitch Green below the boundary, Green Dark at or above.
    for (const theme of THEMES) {
      const luminance = relativeLuminance(declared(theme, '--bg'));
      const expected = luminance >= 0.05 ? '#3e8f24' : '#5bbf36';

      expect(declared(theme, '--accent-text'), `${theme} --accent-text`).toBe(expected);
    }
  });

  it('paints no text with --accent-text, which cannot reach the text floor on a light surface', () => {
    // Green Dark reaches 4.07:1 on white and 3.70:1 on the card surface — above the
    // 3:1 bar for icons, large text, and accents, below the 4.5:1 bar for text and
    // interactive control labels. So the token is an accent, never a text colour,
    // exactly as `squadsTokens.css` documents.
    expect(
      contrastRatio(declared('light', '--accent-text'), declared('light', '--bg')),
    ).toBeLessThan(TEXT_FLOOR);

    const offenders = RULES.flatMap((rule) =>
      ['color', 'border-top-color'].flatMap((property) => {
        const value = rule.declarations[property];
        return value !== undefined && tokensIn(value).includes('--accent-text')
          ? [`${rule.sheet}: ${rule.selector} { ${property}: ${value} }`]
          : [];
      }),
    );

    expect(offenders).toEqual([]);
  });

  it('paints nothing with --accent-fill, which cannot reach the non-text floor on a light surface', () => {
    // Pitch Green is 2.35:1 on white, so a green line or shape drawn with the fill
    // token would be a graphical cue below the 3:1 floor in the light Theme. A green
    // line on a surface takes the surface-keyed `--accent-text` instead.
    expect(
      contrastRatio(declared('light', '--accent-fill'), declared('light', '--control-bg')),
    ).toBeLessThan(NON_TEXT_FLOOR);

    const offenders = RULES.flatMap((rule) =>
      Object.entries(rule.declarations).flatMap(([property, value]) =>
        tokensIn(value).includes('--accent-fill')
          ? [`${rule.sheet}: ${rule.selector} { ${property}: ${value} }`]
          : [],
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('writes no colour literal outside the token table', () => {
    // Requirement 18.9's other half, and the precondition for every measurement
    // above: a colour written into a component stylesheet would be a colour no
    // table declares and no pairing measures.
    const offenders = STYLESHEETS.filter(
      (sheet) => sheet.name !== 'squads/styles/squadsTokens.css',
    ).flatMap((sheet) => {
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
 * The ratios the token table documents about itself
 * ------------------------------------------------------------------ */

interface DocumentedRow {
  readonly theme: Theme;
  readonly foreground: string;
  readonly foregroundValue: string;
  /** The background tokens, in the order the row's ratios are written. */
  readonly backgrounds: readonly string[];
  readonly ratios: readonly number[];
  readonly floor: number;
}

/**
 * The contrast rows written in `squadsTokens.css`'s header comment.
 *
 * Two shapes, e.g.
 *
 * ```text
 *   DARK  (--bg #141414, card #1e1e1e, inactive #232323):
 *     --text                        #f5f5f5  16.90 / 15.29 / 14.42  (>= 4.5)
 *     --control-text  #f5f5f5 vs --control-bg #1e1e1e      = 15.29  (>= 4.5)
 * ```
 *
 * Parsed from the **raw** source, since they live inside the comment the token
 * parsing strips, and line by line, so a row can never borrow a number from its
 * neighbour.
 */
function documentedRows(): readonly DocumentedRow[] {
  const darkAt = tokensSource.indexOf('DARK  (');
  const lightAt = tokensSource.indexOf('LIGHT (');
  const endAt = tokensSource.indexOf('### Why', lightAt);
  expect(darkAt).toBeGreaterThan(-1);
  expect(lightAt).toBeGreaterThan(darkAt);
  expect(endAt).toBeGreaterThan(lightAt);

  const sections: readonly (readonly [Theme, string])[] = [
    ['dark', tokensSource.slice(darkAt, lightAt)],
    ['light', tokensSource.slice(lightAt, endAt)],
  ];

  const rows: DocumentedRow[] = [];

  for (const [theme, section] of sections) {
    const lines = section.split('\n');

    // The section's own opening names the three surfaces its columns measure
    // against, so the columns are read from the file rather than assumed here.
    const heading =
      /\(--bg\s+(#[0-9a-f]{6}),\s*card\s+(#[0-9a-f]{6}),\s*inactive\s+(#[0-9a-f]{6})\)/i.exec(
        lines[0],
      );
    expect(heading, `the ${theme} section names no surfaces`).not.toBeNull();
    const surfaces = ['--bg', '--squads-card-surface', '--squads-inactive-surface'];
    if (heading !== null) {
      for (const [index, surface] of surfaces.entries()) {
        expect(declared(theme, surface), `${theme} ${surface}`).toBe(
          heading[index + 1].toLowerCase(),
        );
      }
    }

    for (const line of lines.slice(1)) {
      const against =
        /--([\w-]+)\s+(#[0-9a-f]{6})\s+vs\s+--([\w-]+)\s+#[0-9a-f]{6}\s*=\s*([\d.]+)\s*\(>=\s*([\d.]+)\)/i.exec(
          line,
        );
      if (against !== null) {
        rows.push({
          theme,
          foreground: `--${against[1]}`,
          foregroundValue: against[2].toLowerCase(),
          backgrounds: [`--${against[3]}`],
          ratios: [Number.parseFloat(against[4])],
          floor: Number.parseFloat(against[5]),
        });
        continue;
      }

      const columns =
        /--([\w-]+)\s+(#[0-9a-f]{6})\s+([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)\s*\(>=\s*([\d.]+)\)/i.exec(
          line,
        );
      if (columns !== null) {
        rows.push({
          theme,
          foreground: `--${columns[1]}`,
          foregroundValue: columns[2].toLowerCase(),
          backgrounds: surfaces,
          ratios: [3, 4, 5].map((group) => Number.parseFloat(columns[group])),
          floor: Number.parseFloat(columns[6]),
        });
      }
    }
  }

  return rows;
}

const DOCUMENTED = documentedRows();

describe('Property 47 — the token table’s own documented ratios', () => {
  it('finds rows for both Themes (guards the parser itself)', () => {
    expect(DOCUMENTED.filter((row) => row.theme === 'dark').length).toBeGreaterThan(14);
    expect(DOCUMENTED.filter((row) => row.theme === 'light').length).toBeGreaterThan(14);
  });

  it('documents the declared value, the computed ratio, and a floor it clears', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DOCUMENTED), (row) => {
        const label = `${row.theme}: ${row.foreground} vs ${row.backgrounds.join(' / ')}`;

        // The hex written in the comment is the hex in the table.
        expect(declared(row.theme, row.foreground), label).toBe(row.foregroundValue);

        // The documented floor is one of the two the requirement defines.
        expect([NON_TEXT_FLOOR, TEXT_FLOOR], label).toContain(row.floor);

        for (const [index, background] of row.backgrounds.entries()) {
          const computed = contrastRatio(
            declared(row.theme, row.foreground),
            declared(row.theme, background),
          );

          // The documented ratio is the computed one, to the two decimal places it
          // is written to…
          expect(
            Number.parseFloat(computed.toFixed(2)),
            `${label} documents ${row.ratios[index]}:1 against ${background} but it computes to ${computed.toFixed(2)}:1`,
          ).toBeCloseTo(row.ratios[index], 2);

          // …and it clears the floor the row claims for itself.
          expect(computed, `${label} against ${background}`).toBeGreaterThanOrEqual(
            row.floor,
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it('holds for every documented row exhaustively', () => {
    const failures = DOCUMENTED.flatMap((row) =>
      row.backgrounds.flatMap((background, index) => {
        const value = declared(row.theme, row.foreground);
        const computed = contrastRatio(value, declared(row.theme, background));
        const label = `${row.theme}: ${row.foreground} vs ${background}`;

        if (value !== row.foregroundValue) {
          return [`${label} documents ${row.foregroundValue}, table declares ${value}`];
        }
        if (Number.parseFloat(computed.toFixed(2)) !== row.ratios[index]) {
          return [
            `${label} documents ${row.ratios[index]}:1, computes ${computed.toFixed(2)}:1`,
          ];
        }
        if (computed < row.floor) {
          return [`${label} is ${computed.toFixed(2)}:1, below its own ${row.floor}:1`];
        }
        return [];
      }),
    );

    expect(failures).toEqual([]);
  });

  it('documents every colour token it declares', () => {
    // A token added to the tables without a row in the header comment would be a
    // token whose contrast nobody wrote down.
    const undocumented = COLOUR_TOKENS.filter(
      (token) =>
        !UNMEASURED_TOKENS.includes(token as (typeof UNMEASURED_TOKENS)[number]) &&
        !DOCUMENTED.some((row) => row.foreground === token) &&
        !SURFACE_TOKENS.includes(token as (typeof SURFACE_TOKENS)[number]),
    );

    expect(undocumented.sort()).toEqual([]);
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

  return '--text';
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
  return '--bg';
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
 * indication painting `var(--focus-ring)`, at a width a person can see.
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
      if (!outline.includes('var(--focus-ring)')) {
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
  const measured = new Set(
    PAIRINGS.flatMap((pairing) => [pairing.foreground, pairing.background]),
  );
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
      <button class="squads-home__entry-point">Create squad</button>
      <button class="squads-not-a-real-control">Unstyled</button>
    `);
    const [styled, unstyled] = Array.from(tree.querySelectorAll('button'));

    const indications = declaredFocusIndications(styled);
    expect(indications).toHaveLength(1);
    expect(outlineOf(indications[0])).toContain('var(--focus-ring)');
    expect(absoluteLengthsPx(outlineOf(indications[0]))).toContain(3);

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
      expect(textColourToken(name)).toBe('--squads-inactive-text');
      expect(surfaceTokenBehind(name)).toBe('--squads-inactive-surface');
      expect(textColourToken(guest)).toBe('--squads-guest-text');
      expect(surfaceTokenBehind(guest)).toBe('--squads-inactive-surface');
    }

    // And an element nothing paints falls back to the documented default: the text
    // and the surface of the region each screen renders inside.
    const bare = fragment('<p>outside any painted region</p>').querySelector('p');
    expect(bare).not.toBeNull();
    if (bare !== null) {
      expect(textColourToken(bare)).toBe('--text');
      expect(surfaceTokenBehind(bare)).toBe('--bg');
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
      expect.stringContaining('--squads-provisional-text'),
    ]);
    // The badge carries no words, so nothing is measured against it.
    expect(rendersOwnText(tree.querySelectorAll('span')[1])).toBe(false);
  });

  it('reports a colour no pairing measures', () => {
    const tree = fragment(
      '<button class="squads-feature-toggles__switch" aria-checked="true">On</button>',
    );

    expect(unmeasuredColourOffences(tree, 'the guard')).toEqual([]);

    // The same control painted with the fill token — the state this file's boundary
    // assertions keep the stylesheets out of — would be reported rather than
    // measured, because no pairing names that token.
    const measured = new Set(
      PAIRINGS.flatMap((pairing) => [pairing.foreground, pairing.background]),
    );
    expect(measured.has('--accent-text')).toBe(true);
    expect(measured.has('--accent-fill')).toBe(false);
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
  'squads-card__name',
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
