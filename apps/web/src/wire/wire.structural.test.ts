/**
 * Structural rules for the shared wire-reading module.
 *
 * The squads and player-stats purity scans admit this module's barrel as the one
 * exit from a feature's pure `lib/` directory. That admission is only sound while
 * the module is itself pure, so this scan holds it to that: no React, no DOM, no
 * transport client, no feature module, no package at all — every import is a
 * sibling inside `src/wire`. The barrel re-exports and declares nothing of its
 * own, and a control shows the import rule detects a violation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const wireRoot = dirname(fileURLToPath(import.meta.url));

function norm(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Source text with block and line comments removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every module specifier a source imports or re-exports. */
function specifiersOf(source: string): string[] {
  const pattern =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
  return [...withoutComments(source).matchAll(pattern)].map((match) => match[1]);
}

/** The specifiers of `source` that leave `src/wire` or name a package. */
function foreignSpecifiers(file: string, source: string): string[] {
  return specifiersOf(source).filter((specifier) => {
    if (!specifier.startsWith('.')) return true;
    const target = norm(resolve(dirname(file), specifier));
    return !(target === norm(wireRoot) || target.startsWith(`${norm(wireRoot)}/`));
  });
}

const productionModules = readdirSync(wireRoot)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => join(wireRoot, name));

describe('the shared wire module is pure', () => {
  it('holds the primitives and the barrel', () => {
    const names = productionModules.map((file) => norm(file).split('/').pop());
    expect(names).toEqual(expect.arrayContaining(['index.ts', 'primitives.ts']));
  });

  it('imports nothing outside src/wire, package or feature', () => {
    const offenders = productionModules.flatMap((file) =>
      foreignSpecifiers(file, readFileSync(file, 'utf8')).map((specifier) => ({
        module: norm(file).split('/').pop(),
        specifier,
      })),
    );

    expect(offenders).toEqual([]);
  });

  it('detects an import that is not a sibling', () => {
    // Control: a package, the transport client, a feature module, and the shared
    // theme module are each foreign to a pure, feature-neutral reader.
    const file = join(wireRoot, 'control.ts');
    const source = [
      "import { useState } from 'react';",
      "import type { components } from '@pitchmate/api-client';",
      "import { isExampleIdentifier } from '../features/example/lib/identifiers';",
      "export { resolveTheme } from '../theme';",
      "import { ok } from './primitives';",
    ].join('\n');

    expect(foreignSpecifiers(file, source)).toEqual([
      'react',
      '@pitchmate/api-client',
      '../features/example/lib/identifiers',
      '../theme',
    ]);
  });

  it('keeps the barrel to re-exports only', () => {
    const barrel = withoutComments(readFileSync(join(wireRoot, 'index.ts'), 'utf8'));
    const statements = barrel
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((statement) => /^export\s*\{[\s\S]*\}\s*from\s*'\.\//.test(statement))).toBe(true);
  });
});
