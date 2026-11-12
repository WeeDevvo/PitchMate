/**
 * Structural rules for the Matches_Feature, each run over the real sources and
 * over a planted violation, so a green result means the code complies rather
 * than that the detector matched nothing.
 *
 * 1. **One transport facade.** Only `api/matchesApi.ts` uses
 *    `@pitchmate/api-client` as a value; `lib/wireEnums.ts` may import its types.
 * 2. **Barrels only.** Every import that leaves the feature reaches the barrel of
 *    the app-shell, auth or squads feature, or the shared `src/theme` and
 *    `src/wire` modules, and nothing reaches into the feature except through its
 *    barrel.
 * 3. **Pure lib.** Nothing under `lib/` imports React or touches the DOM.
 * 4. **No rating internals.** No production module names μ or σ.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const featureRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(featureRoot, '..', '..');

function norm(path: string): string {
  return path.replace(/\\/g, '/');
}

function isWithin(root: string, candidate: string): boolean {
  const r = norm(root);
  const c = norm(candidate);
  return c === r || c.startsWith(`${r}/`);
}

function isTestSupport(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || isWithin(join(featureRoot, 'testing'), file);
}

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return collect(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

interface ImportStatement {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

function importsOf(source: string): ImportStatement[] {
  const pattern = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/gm;
  return [...withoutComments(source).matchAll(pattern)].map((match) => ({
    specifier: match[3],
    typeOnly: match[2] !== undefined,
  }));
}

const productionModules = collect(featureRoot).filter((file) => !isTestSupport(file));
const sources = new Map(productionModules.map((file) => [file, readFileSync(file, 'utf8')]));

function featureRel(file: string): string {
  return norm(file).slice(norm(featureRoot).length + 1);
}

/* 1. One transport facade -------------------------------------------------- */

function clientValueImporters(modules: ReadonlyMap<string, string>): string[] {
  return [...modules]
    .filter(([file, source]) =>
      importsOf(source).some(
        ({ specifier, typeOnly }) =>
          specifier === '@pitchmate/api-client' &&
          !typeOnly &&
          featureRel(file) !== 'api/matchesApi.ts',
      ),
    )
    .map(([file]) => featureRel(file));
}

/* 2. Barrels only ------------------------------------------------------------ */

// The shared component library is admitted at its barrel (ADR 0004).
const ADMITTED_BARRELS = ['features/app-shell', 'features/auth', 'features/squads', 'wire', 'theme', 'ui'].map(
  (dir) => norm(join(srcRoot, dir)),
);

function isAdmittedTarget(target: string): boolean {
  return ADMITTED_BARRELS.some(
    (barrel) => target === barrel || target === `${barrel}/index` || target === `${barrel}/index.ts`,
  );
}

function outwardOffenders(modules: ReadonlyMap<string, string>): string[] {
  const offenders: string[] = [];
  for (const [file, source] of modules) {
    for (const { specifier } of importsOf(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = norm(resolve(dirname(file), specifier));
      if (isWithin(featureRoot, target) || isAdmittedTarget(target)) continue;
      offenders.push(`${featureRel(file)} -> ${specifier}`);
    }
  }
  return offenders;
}

/* 3 and 4. Pure lib, no rating internals ------------------------------------ */

function reactOrDomInLib(modules: ReadonlyMap<string, string>): string[] {
  return [...modules]
    .filter(([file]) => featureRel(file).startsWith('lib/'))
    .filter(([, source]) => {
      const code = withoutComments(source);
      return (
        importsOf(code).some(({ specifier }) => /^react(-dom|-router-dom)?$/.test(specifier)) ||
        /\b(document|window|localStorage)\s*\./.test(code)
      );
    })
    .map(([file]) => featureRel(file));
}

function ratingInternals(modules: ReadonlyMap<string, string>): string[] {
  return [...modules]
    .filter(([, source]) => /\b(mu|sigma)\b|[μσ]/i.test(withoutComments(source)))
    .map(([file]) => featureRel(file));
}

function planted(rel: string, source: string): ReadonlyMap<string, string> {
  return new Map([[join(featureRoot, rel), source]]);
}

describe('the Matches_Feature structure', () => {
  it('scans the production modules it claims to', () => {
    const names = productionModules.map(featureRel);
    expect(names).toEqual(
      expect.arrayContaining(['index.ts', 'api/matchesApi.ts', 'lib/wireEnums.ts', 'matchesRoutes.tsx']),
    );
    expect(names.some((name) => name.startsWith('testing/') || name.endsWith('.test.ts'))).toBe(false);
  });

  it('uses the generated client as a value in the facade only', () => {
    expect(clientValueImporters(sources)).toEqual([]);
    expect(
      clientValueImporters(
        planted('state/control.ts', "import { createApiClient } from '@pitchmate/api-client';"),
      ),
    ).toEqual(['state/control.ts']);
    expect(
      clientValueImporters(
        planted('lib/control.ts', "import type { components } from '@pitchmate/api-client';"),
      ),
    ).toEqual([]);
  });

  it('leaves the feature only through admitted barrels', () => {
    expect(outwardOffenders(sources)).toEqual([]);
    expect(
      outwardOffenders(
        new Map([
          ...planted('lib/a.ts', "import { squadPath } from '../../example/lib/routePaths';"),
          ...planted('lib/b.ts', "import { createAppRouter } from '../../../app/appRouter';"),
          ...planted('lib/c.ts', "import { readUuid } from '../../../wire/primitives';"),
        ]),
      ),
    ).toEqual([
      'lib/a.ts -> ../../example/lib/routePaths',
      'lib/b.ts -> ../../../app/appRouter',
      'lib/c.ts -> ../../../wire/primitives',
    ]);
    expect(
      outwardOffenders(
        planted('screens/ok.tsx', "import { useAuth } from '../../auth';\nimport { readUuid } from '../../../wire';"),
      ),
    ).toEqual([]);
  });

  it('is reached from outside through its barrel only', () => {
    const outside = collect(srcRoot).filter((file) => !isWithin(featureRoot, file));
    const deep = outside.flatMap((file) =>
      importsOf(readFileSync(file, 'utf8'))
        .map(({ specifier }) => specifier)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => norm(resolve(dirname(file), specifier)))
        .filter((target) => isWithin(featureRoot, target) && target !== norm(featureRoot))
        .map((target) => `${norm(file).slice(norm(srcRoot).length + 1)} -> ${target}`),
    );
    expect(deep).toEqual([]);
  });

  it('keeps lib free of React and the DOM', () => {
    expect(reactOrDomInLib(sources)).toEqual([]);
    expect(reactOrDomInLib(planted('lib/x.ts', "import { useState } from 'react';"))).toEqual([
      'lib/x.ts',
    ]);
    expect(reactOrDomInLib(planted('lib/y.ts', 'export const width = window.innerWidth;'))).toEqual([
      'lib/y.ts',
    ]);
  });

  it('names no rating internal', () => {
    expect(ratingInternals(sources)).toEqual([]);
    expect(ratingInternals(planted('lib/z.ts', 'export const sigma = 1;'))).toEqual(['lib/z.ts']);
  });
});
