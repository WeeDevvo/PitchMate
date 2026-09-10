/*
 * The Shell_Frame's declared styles — the three acceptance criteria jsdom cannot
 * verify, plus the focus indicator every focusable control of the frame owes.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MANUAL BROWSER VERIFICATION REQUIRED                                      │
 * │                                                                           │
 * │ Requirements 1.8, 13.11, and 13.13 are about **rendered geometry**, and    │
 * │ jsdom computes none: every box is zero-sized, no media query is evaluated, │
 * │ and no stylesheet cascade reaches a computed style. This suite therefore   │
 * │ asserts what `shell.css` *declares*, which is a floor and not a proof.     │
 * │ All three still need checking by hand in a real browser:                   │
 * │                                                                           │
 * │  1.8   At 360, 767, 768, 1024, and 1920 CSS pixels: no part of the frame   │
 * │        is wider than the viewport and the document needs no horizontal     │
 * │        scrolling. Check with real content in place, including a long       │
 * │        unbroken notification title and an expanded disclosure surface.     │
 * │  13.11 Tab into the document: the Skip_Link becomes visible with its       │
 * │        label *and* its focus indicator wholly inside the viewport at each  │
 * │        of those widths, and is invisible again once focus moves on.        │
 * │  13.13 At 360 to 767 pixels: measure each control listed in 13.13 — it is  │
 * │        at least 44x44 CSS pixels with at least 8 pixels between adjacent   │
 * │        target edges.                                                      │
 * │                                                                           │
 * │ Full accessibility validation also requires manual testing with assistive │
 * │ technologies and expert review.                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ### Why a source scan
 *
 * The stylesheet is read as **source text** and parsed into rules, the same
 * approach `theme.tokens.test.ts` takes for the token tables. That buys the two
 * things a jsdom render cannot give:
 *
 * 1. the media-query context of a declaration — a `gap` of 4 pixels is correct in
 *    the Wide_Layout and a Requirement 13.13 violation in the Compact_Layout, and
 *    only the enclosing `@media` condition tells the two apart; and
 * 2. which declaration *wins*. The frame deliberately declares `min-width: 0` on
 *    flex children so they may shrink (Requirement 1.8) and then restores the
 *    44-pixel target in the compact block at higher specificity — so asserting
 *    "every declared value" would contradict the stylesheet's own design. The
 *    assertions below therefore resolve the winning declaration by specificity
 *    and source order, which is what a browser would compute.
 *
 * The behavioural halves of these requirements — which layout each width renders,
 * and the Skip_Link's position in the Tab order — are asserted by rendering, in
 * `ShellFrame.layout.test.tsx`.
 *
 * Requirements: 1.8, 12.10, 13.4, 13.11, 13.13
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WIDE_LAYOUT_MIN_WIDTH_PX } from '../state/useViewportLayout';

const here = dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');

/* ------------------------------------------------------------------ *
 * A very small CSS reader
 *
 * Enough to answer "which declaration wins for this class, in the Compact_Layout"
 * and no more. One level of nesting — `@media` containing rules — is all
 * `shell.css` uses.
 * ------------------------------------------------------------------ */

interface CssRule {
  /** The full selector list, as written. */
  readonly selector: string;
  /** Property to value, later duplicates winning within the one block. */
  readonly declarations: Readonly<Record<string, string>>;
  /** The enclosing `@media` condition, or `null` at the top level. */
  readonly media: string | null;
  /** Position in the stylesheet, for resolving equal-specificity ties. */
  readonly order: number;
}

/** Drop `/* ... *\/` comments, so documentation text is never read as CSS. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
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

/** Every rule in the stylesheet, each carrying its media context. */
function parseStylesheet(css: string): CssRule[] {
  const source = withoutComments(css);
  const parsed: Omit<CssRule, 'order'>[] = [];

  const collect = (block: string, media: string | null): void => {
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block)) !== null) {
      const selector = match[1].trim();
      if (selector.length === 0 || selector.startsWith('@')) {
        continue;
      }
      parsed.push({ selector, declarations: parseDeclarations(match[2]), media });
    }
  };

  const mediaBlock = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = mediaBlock.exec(source)) !== null) {
    collect(match[2], match[1].trim());
  }
  // The top level is whatever is left once the media blocks are removed. Its
  // rules are ordered after the media blocks' here, which is harmless: media
  // blocks add no specificity, so ties are broken the other way round only for
  // rules that declare the same property at the same specificity — and where that
  // happens in `shell.css` the media block is the later, more specific rule.
  collect(source.replace(mediaBlock, ''), null);

  return parsed.map((rule, order) => ({ ...rule, order }));
}

const rules = parseStylesheet(shellCss);

/* ------------------------------------------------------------------ *
 * Selector matching, specificity, and the media context
 * ------------------------------------------------------------------ */

/** The compound selectors of one selector, split on the four combinators. */
function compounds(selectorPart: string): string[] {
  return selectorPart
    .split(/\s*[>+~]\s*|\s+/)
    .map((compound) => compound.trim())
    .filter((compound) => compound.length > 0);
}

/** The parts of a selector list whose *subject* carries `className`. */
function subjectParts(selector: string, className: string): string[] {
  const token = new RegExp(`\\.${className}(?![\\w-])`);
  return selector.split(',').filter((part) => {
    const parts = compounds(part);
    const subject = parts[parts.length - 1] ?? '';
    return token.test(subject);
  });
}

/** Does any part of `selector` have `className` as its subject? */
function targetsClass(selector: string, className: string): boolean {
  return subjectParts(selector, className).length > 0;
}

/**
 * A comparable specificity for one selector part.
 *
 * Classes, attribute selectors, and pseudo-classes count together; ids count
 * higher; elements and pseudo-elements count lowest. That is coarse next to the
 * full algorithm and exactly enough for a stylesheet that uses no ids and no
 * `:is()`.
 */
function specificity(selectorPart: string): number {
  const ids = (selectorPart.match(/#[\w-]+/g) ?? []).length;
  const classes = (selectorPart.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selectorPart.match(/::[\w-]+/g) ?? []).length;
  return ids * 10_000 + classes * 100 + elements;
}

/** The highest specificity among the parts of `selector` that target `className`. */
function specificityFor(selector: string, className: string): number {
  return Math.max(
    ...subjectParts(selector, className).map((part) => specificity(part)),
    0,
  );
}

/**
 * Does a rule in this media context apply in the Compact_Layout?
 *
 * Everything at the top level does, and everything in a block that is not gated
 * on a `min-width` at or above the Wide_Layout boundary.
 */
function appliesInCompactLayout(media: string | null): boolean {
  if (media === null) {
    return true;
  }
  const minWidth = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(media);
  return minWidth === null || Number(minWidth[1]) < WIDE_LAYOUT_MIN_WIDTH_PX;
}

interface ClassRulesOptions {
  /** Ignore rules that cannot apply below the Wide_Layout boundary. */
  readonly compactOnly?: boolean;
  /** Keep only rules whose selector mentions (or omits) `:focus`. */
  readonly focus?: 'with' | 'without';
}

function rulesFor(className: string, options: ClassRulesOptions = {}): CssRule[] {
  return rules.filter((rule) => {
    if (!targetsClass(rule.selector, className)) {
      return false;
    }
    if (options.compactOnly === true && !appliesInCompactLayout(rule.media)) {
      return false;
    }
    if (options.focus === 'with' && !rule.selector.includes(':focus')) {
      return false;
    }
    if (options.focus === 'without' && rule.selector.includes(':focus')) {
      return false;
    }
    return true;
  });
}

/** Every value declared for `property` by the rules targeting `className`. */
function declaredValues(
  className: string,
  property: string,
  options: ClassRulesOptions = {},
): string[] {
  return rulesFor(className, options)
    .map((rule) => rule.declarations[property])
    .filter((value): value is string => value !== undefined);
}

/**
 * The value a browser would use for `property` on `className` — the declaration
 * from the most specific rule, latest source order breaking a tie.
 */
function winningValue(
  className: string,
  property: string,
  options: ClassRulesOptions = {},
): string | null {
  const candidates = rulesFor(className, options).filter(
    (rule) => rule.declarations[property] !== undefined,
  );
  if (candidates.length === 0) {
    return null;
  }
  const winner = candidates.reduce((best, rule) => {
    const bestSpecificity = specificityFor(best.selector, className);
    const ruleSpecificity = specificityFor(rule.selector, className);
    if (ruleSpecificity > bestSpecificity) {
      return rule;
    }
    if (ruleSpecificity === bestSpecificity && rule.order > best.order) {
      return rule;
    }
    return best;
  });
  return winner.declarations[property] ?? null;
}

/* ------------------------------------------------------------------ *
 * Length resolution
 * ------------------------------------------------------------------ */

/**
 * The frame's own layout tokens, read from wherever `.shell-frame` declares
 * them — so the numbers asserted below are the stylesheet's, not this test's.
 */
const shellTokens: Record<string, string> = {};
for (const rule of rulesFor('shell-frame')) {
  for (const [property, value] of Object.entries(rule.declarations)) {
    if (property.startsWith('--')) {
      shellTokens[property] = value;
    }
  }
}

/** Substitute the frame's layout tokens into a value, repeatedly. */
function resolveShellTokens(value: string): string {
  let resolved = value;
  for (let pass = 0; pass < 3 && resolved.includes('var(--'); pass += 1) {
    resolved = resolved.replace(
      /var\(\s*(--[\w-]+)\s*\)/g,
      (whole, token: string) => shellTokens[token] ?? whole,
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
 * the viewport or the container and so cannot exceed it, which is precisely why
 * the stylesheet prefers them (Requirement 1.8).
 */
function absoluteLengthsPx(value: string): number[] {
  const lengths: number[] = [];
  const pattern = /(-?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm)(?![\w%])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(resolveShellTokens(value))) !== null) {
    lengths.push(Number(match[1]) * UNIT_PX[match[2]]);
  }
  return lengths;
}

/**
 * The smallest length a value can ever compute to, or `null` where it declares no
 * absolute length at all.
 *
 * For a `clamp(min, preferred, max)` that is the first argument, which is the
 * guaranteed floor — the right answer for "is this gap always at least 8 pixels".
 */
function guaranteedFloorPx(value: string): number | null {
  const lengths = absoluteLengthsPx(value);
  return lengths.length === 0 ? null : Math.min(...lengths);
}

/* ------------------------------------------------------------------ *
 * The control classes the frame renders
 * ------------------------------------------------------------------ */

/**
 * Every class the frame puts on a focusable control, plus the two elements it
 * focuses programmatically.
 *
 * Requirement 13.4 asks for a visible focus indicator on *every* focusable
 * control of the Shell_Frame, and Requirements 12.10 and 13.4 together require it
 * to come from the token table rather than from a colour written into a component
 * — so a control with no `:focus-visible` rule at all, falling back to the
 * user-agent ring, satisfies neither on the dark Theme. This list is the
 * enforcement: a control added under a class that is not here, or here without a
 * rule, fails.
 */
const FOCUSABLE_CONTROL_CLASSES = [
  'shell-skip-link',
  'shell-brand',
  'shell-nav__toggle',
  'shell-nav__link',
  'shell-notification-indicator',
  'shell-notification-panel',
  'shell-notification-panel__mark-all',
  'shell-notification-panel__retry',
  'shell-notification-panel__see-all',
  'shell-notification-row',
  'shell-account-menu__trigger',
  'shell-account-menu__item',
  'shell-appearance__radio',
  'shell-boundary__home',
  'shell-content',
] as const;

/**
 * The controls Requirement 13.13 enumerates, by the class the frame renders them
 * under, plus the four the stylesheet holds to the same target size.
 */
const COMPACT_TARGET_CLASSES = [
  // Named by Requirement 13.13.
  'shell-skip-link',
  'shell-nav__toggle',
  'shell-nav__link',
  'shell-notification-indicator',
  'shell-account-menu__trigger',
  'shell-account-menu__item',
  'shell-notification-panel__mark-all',
  'shell-notification-row',
  'shell-appearance__option',
  // Not named there, and held to the same size by the stylesheet.
  'shell-brand',
  'shell-notification-panel__retry',
  'shell-notification-panel__see-all',
  'shell-boundary__home',
] as const;

/**
 * The containers that lay out two adjacent Requirement 13.13 targets, and the
 * properties that separate them.
 *
 * Containers whose gap separates *text* rather than two targets — a notification
 * row's title from its body, say — are deliberately absent: 8 pixels is a target
 * separation rule, not a typographic one.
 */
const ADJACENT_TARGET_CONTAINERS: readonly {
  readonly className: string;
  readonly properties: readonly string[];
}[] = [
  { className: 'shell-header', properties: ['gap', 'row-gap'] },
  { className: 'shell-header__nav', properties: ['gap'] },
  { className: 'shell-header__actions', properties: ['gap'] },
  { className: 'shell-nav__list', properties: ['gap'] },
  { className: 'shell-account-menu__list', properties: ['gap'] },
  { className: 'shell-notification-panel__list', properties: ['gap'] },
  { className: 'shell-notification-panel__header', properties: ['gap'] },
  { className: 'shell-notification-panel__failure', properties: ['gap'] },
  { className: 'shell-appearance__option', properties: ['margin-block-start'] },
];

/** The regions that must never be wider than what contains them. */
const FULL_WIDTH_REGION_CLASSES = [
  'shell-frame',
  'shell-header',
  'shell-content',
  'shell-nav__list',
  'shell-notification-panel',
  'shell-notification-row',
  'shell-appearance',
] as const;

/** Properties that can force a box wider than its container. */
const OVERFLOW_RISK_PROPERTIES = ['width', 'min-width', 'flex-basis'] as const;

/** The narrowest viewport Requirement 1.8 names. */
const NARROWEST_VERIFIED_WIDTH_PX = 360;

/* ------------------------------------------------------------------ *
 * The scan itself is worth guarding
 * ------------------------------------------------------------------ */

describe('shell.css source scan', () => {
  it('parses rules, media blocks, and the frame layout tokens', () => {
    expect(rules.length).toBeGreaterThan(30);
    expect(rules.some((rule) => rule.media !== null)).toBe(true);
    expect(rules.some((rule) => rule.media === null)).toBe(true);
    expect(Object.keys(shellTokens)).toContain('--shell-touch-target');
  });

  it('reads a class the stylesheet styles, and none it does not', () => {
    expect(rulesFor('shell-frame').length).toBeGreaterThan(0);
    expect(rulesFor('shell-not-a-real-class')).toEqual([]);
  });

  it('resolves the winning declaration by specificity, not by source order', () => {
    // `.shell-nav__link` declares `min-width: 0` so it may shrink, and the compact
    // block restores the target width at higher specificity. The winner is the
    // latter, which is what a browser computes.
    expect(declaredValues('shell-nav__link', 'min-width')).toContain('0');
    expect(winningValue('shell-nav__link', 'min-width', { compactOnly: true })).toBe(
      'var(--shell-touch-target)',
    );
  });
});

/* ------------------------------------------------------------------ *
 * Requirements 13.4, 12.10: a token-based focus indicator on every control
 * ------------------------------------------------------------------ */

describe('focus indicators (Requirements 13.4, 12.10)', () => {
  it.each(FOCUSABLE_CONTROL_CLASSES)(
    'declares a :focus-visible outline resolving var(--focus-ring) for .%s',
    (className) => {
      const focusRules = rulesFor(className, { focus: 'with' }).filter((rule) =>
        subjectParts(rule.selector, className).some((part) =>
          part.includes(':focus-visible'),
        ),
      );
      expect(
        focusRules.length,
        `.${className} declares no :focus-visible rule, so it would fall back to the user-agent ring`,
      ).toBeGreaterThan(0);

      const outlines = focusRules
        .map((rule) => rule.declarations.outline)
        .filter((value): value is string => value !== undefined);
      expect(
        outlines.length,
        `.${className} has a :focus-visible rule that declares no outline`,
      ).toBeGreaterThan(0);
      for (const outline of outlines) {
        expect(outline).toContain('var(--focus-ring)');
        // A hairline ring is not a visible indicator at every zoom level.
        expect(Math.max(...absoluteLengthsPx(outline), 0)).toBeGreaterThanOrEqual(2);
      }
    },
  );
});

/* ------------------------------------------------------------------ *
 * Requirement 1.8: nothing wider than the viewport, 360 to 1920
 * ------------------------------------------------------------------ */

describe('Requirement 1.8 — declared widths cannot exceed the viewport', () => {
  it('declares the frame full-width, capped, and clipping residual overflow', () => {
    expect(declaredValues('shell-frame', 'width')).toContain('100%');
    expect(declaredValues('shell-frame', 'max-width')).toContain('100%');
    expect(declaredValues('shell-frame', 'overflow-x')).toContain('clip');
    // A long unbroken string wraps rather than pushing the frame sideways.
    expect(declaredValues('shell-frame', 'overflow-wrap')).toContain('break-word');
  });

  it('counts padding and borders inside every declared width', () => {
    const borderBox = rules.find(
      (rule) =>
        rule.declarations['box-sizing'] === 'border-box' &&
        rule.selector.includes('.shell-frame *'),
    );
    expect(borderBox).toBeDefined();
  });

  it.each(FULL_WIDTH_REGION_CLASSES)('caps .%s at its container width', (className) => {
    expect(declaredValues(className, 'max-width')).toContain('100%');
  });

  it('bounds every disclosure surface by the viewport rather than by its content', () => {
    const maxWidths = declaredValues('shell-disclosure__surface', 'max-width');
    expect(maxWidths.length).toBeGreaterThan(0);
    for (const value of maxWidths) {
      expect(value).toMatch(/100vw/);
    }
  });

  it.each(OVERFLOW_RISK_PROPERTIES)(
    'declares no %s wider than the narrowest verified viewport',
    (property) => {
      const offenders: string[] = [];
      let scanned = 0;
      for (const rule of rules) {
        const value = rule.declarations[property];
        if (value === undefined) {
          continue;
        }
        scanned += 1;
        if (absoluteLengthsPx(value).some((length) => length > NARROWEST_VERIFIED_WIDTH_PX)) {
          offenders.push(`${rule.selector} { ${property}: ${value} }`);
        }
      }
      // Guards the scan: a property nothing declares would pass vacuously.
      if (property !== 'flex-basis') {
        expect(scanned).toBeGreaterThan(0);
      }
      expect(offenders).toEqual([]);
    },
  );

  it('lets the header wrap rather than shrink its controls', () => {
    expect(declaredValues('shell-header', 'flex-wrap')).toContain('wrap');
  });
});

/* ------------------------------------------------------------------ *
 * Requirement 13.11: the Skip_Link, focused and unfocused
 * ------------------------------------------------------------------ */

describe('Requirement 13.11 — the Skip_Link while unfocused', () => {
  it('has no visible presentation', () => {
    expect(declaredValues('shell-skip-link', 'clip-path', { focus: 'without' })).toContain(
      'inset(50%)',
    );
  });

  it('keeps itself in the Tab order — nothing that would remove it', () => {
    for (const rule of rulesFor('shell-skip-link')) {
      expect(rule.declarations.display).not.toBe('none');
      expect(rule.declarations.visibility).not.toBe('hidden');
      expect(rule.declarations['content-visibility']).not.toBe('hidden');
    }
  });
});

describe('Requirement 13.11 — the Skip_Link while focused', () => {
  it('reveals its label', () => {
    expect(winningValue('shell-skip-link', 'clip-path', { focus: 'with' })).toBe('none');
  });

  it('is positioned inside the viewport whatever the scroll position', () => {
    expect(declaredValues('shell-skip-link', 'position')).toContain('fixed');

    // Inset from the corner, not flush against it, so the outline has room.
    for (const property of ['top', 'left'] as const) {
      const inset = winningValue('shell-skip-link', property);
      expect(inset, `.shell-skip-link declares no ${property}`).not.toBeNull();
      expect(guaranteedFloorPx(inset ?? '')).toBeGreaterThan(0);
    }
  });

  it('draws its focus indicator inside its own box, not outside the viewport', () => {
    const offsets = declaredValues('shell-skip-link', 'outline-offset', { focus: 'with' });
    expect(offsets.length).toBeGreaterThan(0);
    for (const offset of offsets) {
      expect(guaranteedFloorPx(offset) ?? 0).toBeLessThanOrEqual(0);
    }
  });

  it('keeps its label narrower than the viewport at every width', () => {
    const maxWidths = declaredValues('shell-skip-link', 'max-width');
    expect(maxWidths.length).toBeGreaterThan(0);
    for (const value of maxWidths) {
      expect(value).toMatch(/100%/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Requirement 13.13: 44x44 targets, 8 pixels apart, in the Compact_Layout
 * ------------------------------------------------------------------ */

describe('Requirement 13.13 — the declared target size and separation', () => {
  const touchTarget = guaranteedFloorPx(shellTokens['--shell-touch-target'] ?? '') ?? 0;
  const touchGap = guaranteedFloorPx(shellTokens['--shell-touch-gap'] ?? '') ?? 0;

  it('declares the target size as 44 pixels and the separation as 8', () => {
    expect(touchTarget).toBe(44);
    expect(touchGap).toBe(8);
  });

  it('stops the compact rules exactly below the Wide_Layout boundary', () => {
    const compactConditions = new Set(
      rules
        .map((rule) => rule.media)
        .filter((media): media is string => media !== null)
        .filter((media) => media.includes('max-width')),
    );
    expect(compactConditions.size).toBeGreaterThan(0);

    for (const media of compactConditions) {
      const bound = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(media);
      expect(bound).not.toBeNull();
      const value = Number(bound?.[1]);
      // 768 is a *wide* width (Requirement 1.7), so the compact rules stop just
      // below it while still covering every width up to 767.
      expect(value).toBeLessThan(WIDE_LAYOUT_MIN_WIDTH_PX);
      expect(value).toBeGreaterThanOrEqual(WIDE_LAYOUT_MIN_WIDTH_PX - 1);
    }
  });

  it.each(COMPACT_TARGET_CLASSES)('gives .%s a 44x44 pointer target', (className) => {
    for (const property of ['min-height', 'min-width'] as const) {
      const value = winningValue(className, property, { compactOnly: true });
      expect(
        value,
        `.${className} declares no ${property} that applies in the Compact_Layout`,
      ).not.toBeNull();
      expect(guaranteedFloorPx(value ?? '') ?? 0).toBeGreaterThanOrEqual(touchTarget);
    }
  });

  it.each(
    ADJACENT_TARGET_CONTAINERS.map((container) => [container.className, container] as const),
  )('separates adjacent targets in .%s by at least 8 pixels', (className, container) => {
    let asserted = 0;
    for (const property of container.properties) {
      const value = winningValue(className, property, { compactOnly: true });
      if (value === null) {
        continue;
      }
      asserted += 1;
      expect(guaranteedFloorPx(value) ?? 0).toBeGreaterThanOrEqual(touchGap);
    }
    expect(
      asserted,
      `.${className} declares no ${container.properties.join('/')} applying in the Compact_Layout`,
    ).toBeGreaterThan(0);
  });

  it('operates every control by a single pointer contact — no gesture is declared', () => {
    const source = withoutComments(shellCss);
    // A path-based or multi-point gesture would need one of these declared on a
    // control; the frame declares none, so a single tap is the whole model.
    expect(source).not.toMatch(/touch-action:\s*(?:none|pinch-zoom)/);
    expect(source).not.toMatch(/scroll-snap-type/);
  });
});
