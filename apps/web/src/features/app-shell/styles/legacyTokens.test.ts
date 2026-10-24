/*
 * The shell's stylesheets on the design system.
 *
 * `shell.css` reads only design-system `--pm-*` tokens that exist, plus the
 * layout tokens it declares itself, and writes no colour value. `legacyTokens.css`
 * keeps the ten unprefixed names the not-yet-migrated features inside the frame
 * still read, each an alias of an existing design token, and the pairings those
 * features draw with them still meet WCAG 2.1 AA in both themes. jsdom computes
 * no custom properties, so both are checked as source text, and contrast is
 * computed from `src/design/tokens.json`.
 *
 * Requirements: 12.8, 12.9, 12.10, 13.4
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokenContrast, type DesignTheme } from '../../../design/contrast';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const shellCss = read('shell.css');
const legacyCss = read('legacyTokens.css');
const designTokens = new Set(
  [...read('../../../design/tokens.css').matchAll(/(--pm-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);

/** The ten names the auth feature established, which squads, matches and player stats read. */
const LEGACY_NAMES = [
  '--bg',
  '--surface',
  '--text',
  '--muted-text',
  '--control-bg',
  '--control-text',
  '--control-border',
  '--accent-fill',
  '--accent-text',
  '--focus-ring',
];

const aliases = Object.fromEntries(
  [...legacyCss.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);

/** The design token a legacy name aliases, without its `--pm-` prefix. */
function aliased(name: string): string {
  const target = /^var\(--pm-([a-z0-9-]+)\)$/.exec(aliases[name] ?? '');
  if (target === null) throw new Error(`${name} is not an alias of a --pm- token`);
  return target[1];
}

describe('shell.css', () => {
  const read = [...shellCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]);
  const ownLayoutTokens = new Set([...shellCss.matchAll(/(--shell-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));

  it('reads tokens', () => {
    expect(read.length).toBeGreaterThan(50);
  });

  it('reads only design tokens that exist, or its own layout tokens', () => {
    expect(read.filter((name) => !designTokens.has(name) && !ownLayoutTokens.has(name))).toEqual([]);
  });

  it('reads none of the legacy names', () => {
    expect(read.filter((name) => LEGACY_NAMES.includes(name))).toEqual([]);
  });

  it('writes no colour value', () => {
    expect(shellCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(shellCss).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });
});

describe('legacyTokens.css', () => {
  it('declares exactly the ten legacy names, once, on the frame', () => {
    expect(Object.keys(aliases).sort()).toEqual([...LEGACY_NAMES].sort());
    expect(legacyCss.trim()).toMatch(/^\.shell-frame\s*\{[^}]*\}$/);
  });

  it.each(LEGACY_NAMES)('aliases %s to a design token that exists', (name) => {
    expect(designTokens.has(`--pm-${aliased(name)}`)).toBe(true);
  });

  const TEXT_PAIRS = [
    ['--text', '--bg'],
    ['--text', '--surface'],
    ['--text', '--control-bg'],
    ['--muted-text', '--bg'],
    ['--muted-text', '--surface'],
    ['--muted-text', '--control-bg'],
    ['--control-text', '--control-bg'],
    ['--accent-text', '--bg'],
    ['--accent-text', '--surface'],
    ['--accent-text', '--control-bg'],
  ] as const;

  const NON_TEXT_PAIRS = [
    ['--control-border', '--control-bg'],
    ['--control-border', '--bg'],
    ['--focus-ring', '--bg'],
    ['--focus-ring', '--surface'],
    ['--focus-ring', '--control-bg'],
  ] as const;

  describe.each<DesignTheme>(['dark', 'light'])('in the %s theme', (theme) => {
    it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (foreground, background) => {
      expect(tokenContrast(aliased(foreground), aliased(background), theme)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(NON_TEXT_PAIRS)('%s on %s is at least 3:1', (foreground, background) => {
      expect(tokenContrast(aliased(foreground), aliased(background), theme)).toBeGreaterThanOrEqual(3);
    });
  });
});
