/*
 * The shell's token tables resolve everything the shell's stylesheet asks for.
 *
 * `styles/shell.css` writes no colour of its own: every colour is a
 * `var(--token)` reference resolved from the per-Theme tables in
 * `styles/theme.css` (Requirements 12.8, 13.4). Two things can silently break
 * that arrangement, and jsdom cannot catch either — it does not compute custom
 * properties from an imported stylesheet:
 *
 *   1. a `var(--token)` reference the tables do not declare, which resolves to
 *      nothing and paints the browser default;
 *   2. a token declared in one Theme but not the other, which paints correctly
 *      in one Theme and falls back in the other.
 *
 * So the tables and the references are compared as **source text**: the tokens
 * `shell.css` refers to (minus the layout tokens it declares for itself) must
 * each appear in the dark table *and* the light table.
 *
 * Contrast of the declared values is a separate concern, asserted by the
 * contrast property test (task 13.6).
 *
 * Requirements: 12.8, 12.9, 12.10, 12.11, 13.4
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(join(here, 'theme.css'), 'utf8');
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');

/** Drop `/* ... *\/` comments, so documentation text is never mistaken for CSS. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The custom properties declared inside the first block matching `selector`. */
function tokenTable(css: string, selector: RegExp): Record<string, string> {
  const block = css.match(selector);
  expect(block, `no token table found for ${String(selector)}`).not.toBeNull();
  const table: Record<string, string> = {};
  const declaration = /--([\w-]+):\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(block![1])) !== null) {
    table[`--${match[1]}`] = match[2].trim().toLowerCase();
  }
  return table;
}

function names(pattern: RegExp, css: string): Set<string> {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    found.add(`--${match[1]}`);
  }
  return found;
}

const themeSource = withoutComments(themeCss);
const shellSource = withoutComments(shellCss);

// The dark table is shared by `:root` and `[data-theme='dark']` so an absent or
// unresolved attribute renders dark (Requirements 12.1, 12.13).
const dark = tokenTable(themeSource, /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/);
const light = tokenTable(themeSource, /\[data-theme='light'\]\s*\{([^}]*)\}/);

/** Every token `shell.css` reads. */
const referenced = names(/var\(\s*--([\w-]+)/g, shellSource);

/** Every token `shell.css` declares for itself — its layout tokens. */
const declaredLocally = names(/--([\w-]+):/g, shellSource);

/** What the token tables owe: referenced but not self-declared. */
const required = [...referenced].filter((token) => !declaredLocally.has(token));

/** The five tokens the shell adds to the shape the auth feature established. */
const SHELL_TOKENS = [
  '--shell-surface',
  '--badge-bg',
  '--badge-text',
  '--unread-cue',
  '--nav-current',
] as const;

/** The ten tokens shared with the auth and landing tables. */
const SHARED_TOKENS = [
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
] as const;

describe('shell theme token tables', () => {
  it('declares both Theme tables, dark applied to :root as well', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(0);
    expect(Object.keys(light).length).toBeGreaterThan(0);
  });

  it('declares the same set of tokens in both Themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it.each([...SHARED_TOKENS, ...SHELL_TOKENS])(
    'declares %s in both Themes',
    (token) => {
      expect(dark[token]).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[token]).toMatch(/^#[0-9a-f]{6}$/);
    },
  );

  it('finds tokens referenced by shell.css to check (guards the scan itself)', () => {
    expect(required.length).toBeGreaterThanOrEqual(SHELL_TOKENS.length);
    // The layout tokens shell.css declares for itself are excluded, not required
    // of the Theme tables.
    expect(required).not.toContain('--shell-gutter');
    expect(required).not.toContain('--shell-touch-target');
  });

  it('resolves every token shell.css references, in both Themes', () => {
    const unresolvedInDark = required.filter((token) => !(token in dark));
    const unresolvedInLight = required.filter((token) => !(token in light));
    expect(unresolvedInDark).toEqual([]);
    expect(unresolvedInLight).toEqual([]);
  });

  it('writes no colour value in shell.css — the tables are the only place', () => {
    expect(shellSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(shellSource).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });
});
