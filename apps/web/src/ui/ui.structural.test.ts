/**
 * Structural rules for the shared component library.
 *
 * Features may import `src/ui` through its barrel, which is only sound while the
 * library stays feature-neutral: its modules import React, React DOM, each other
 * and the design-system logo files, and nothing else (no feature, no transport
 * client, no wire or theme module). Its stylesheets take every colour from a
 * `--pm-*` design token, never a literal, and every token they read exists. The
 * barrel only re-exports. Each rule has a control showing it detects a violation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const uiRoot = dirname(fileURLToPath(import.meta.url));
const logosRoot = resolve(uiRoot, '../design/logos');
const tokensCss = readFileSync(resolve(uiRoot, '../design/tokens.css'), 'utf8');

const PACKAGES = new Set(['react', 'react-dom']);

function norm(path: string): string {
  return path.replace(/\\/g, '/');
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function specifiersOf(source: string): string[] {
  const pattern =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
  return [...withoutComments(source).matchAll(pattern)].map((match) => match[1]);
}

/** Specifiers that are neither an allowed package, a sibling, nor a logo file. */
function foreignSpecifiers(file: string, source: string): string[] {
  return specifiersOf(source).filter((specifier) => {
    if (!specifier.startsWith('.')) return !PACKAGES.has(specifier);
    const target = norm(resolve(dirname(file), specifier));
    const inside = (root: string) => target.startsWith(`${norm(root)}/`);
    return !(norm(dirname(target)) === norm(uiRoot) || inside(logosRoot));
  });
}

/** Colour literals: hex, rgb(), hsl() and named greys a stylesheet might hard-code. */
function colourLiterals(css: string): string[] {
  return [...withoutComments(css).matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![\w-])(?:white|black)(?![\w-])/gi)].map(
    (match) => match[0],
  );
}

/** Custom properties a stylesheet reads that neither tokens.css nor the sheet itself declares. */
function undeclaredProperties(css: string): string[] {
  const source = withoutComments(css);
  const declared = new Set(
    [...`${tokensCss}\n${source}`.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
  return [...source.matchAll(/var\((--[a-z0-9-]+)/g)]
    .map((match) => match[1])
    .filter((name) => !declared.has(name));
}

const entries = readdirSync(uiRoot);
const modules = entries
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => join(uiRoot, name));
const stylesheets = entries.filter((name) => name.endsWith('.css')).map((name) => join(uiRoot, name));

describe('the shared component library', () => {
  it('has modules and stylesheets to scan', () => {
    expect(modules.length).toBeGreaterThan(10);
    expect(stylesheets.length).toBeGreaterThan(10);
  });

  it('imports only React, its own modules and the logo files', () => {
    const offenders = modules.flatMap((file) =>
      foreignSpecifiers(file, readFileSync(file, 'utf8')).map((specifier) => ({
        module: norm(file).split('/').pop(),
        specifier,
      })),
    );

    expect(offenders).toEqual([]);
  });

  it('detects an import from outside the library', () => {
    const file = join(uiRoot, 'control.tsx');
    const source = [
      "import { useState } from 'react';",
      "import { createPortal } from 'react-dom';",
      "import type { components } from '@pitchmate/api-client';",
      "import { useAuth } from '../features/auth';",
      "import { readUuid } from '../wire';",
      "import { resolveTheme } from '../theme';",
      "import mark from '../design/logos/pitchmate-mark-green.png';",
      "import { Icon } from './Icon';",
      "import './Button.css';",
    ].join('\n');

    expect(foreignSpecifiers(file, source)).toEqual([
      '@pitchmate/api-client',
      '../features/auth',
      '../wire',
      '../theme',
    ]);
  });

  it('takes every colour from a design token', () => {
    const offenders = stylesheets.flatMap((file) =>
      colourLiterals(readFileSync(file, 'utf8')).map((literal) => ({ sheet: norm(file).split('/').pop(), literal })),
    );

    expect(offenders).toEqual([]);
  });

  it('detects a colour literal', () => {
    expect(colourLiterals('.a { white-space: nowrap; color: #5bbf36; background: rgba(0, 0, 0, 0.5); border-color: white; }')).toEqual([
      '#5bbf36',
      'rgba(',
      'white',
    ]);
  });

  it('reads only tokens that exist', () => {
    const offenders = stylesheets.flatMap((file) =>
      undeclaredProperties(readFileSync(file, 'utf8')).map((name) => ({ sheet: norm(file).split('/').pop(), name })),
    );

    expect(offenders).toEqual([]);
  });

  it('detects a token that does not exist', () => {
    expect(undeclaredProperties('.a { --local: 1px; color: var(--pm-text-primary); width: var(--local); gap: var(--pm-nope); }')).toEqual(['--pm-nope']);
  });

  it('keeps the barrel to re-exports only', () => {
    const barrel = withoutComments(readFileSync(join(uiRoot, 'index.ts'), 'utf8'));
    const statements = barrel
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((statement) => /^export\s*\{[\s\S]*\}\s*from\s*'\.\//.test(statement))).toBe(true);
  });
});
