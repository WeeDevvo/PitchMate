/**
 * Structural source scan: the App_Shell's module boundaries and entry points
 * (task 16.1).
 *
 * Requirement 15.8 makes this file part of the product rather than a courtesy
 * test. The boundary rules it enforces are stated as prohibitions — "imports only
 * through the Auth_Feature's single public entry point", "imports no module of the
 * marketing landing feature", "is imported by the application-level router wiring
 * only" — and a prohibition cannot be demonstrated by an example. So the source
 * tree is read and classified, in the same form as the Auth_Feature's own
 * `featureSelfContained.test.ts` and `api/clientConsumption.test.ts`, and a
 * violation fails the web test suite rather than waiting for review.
 *
 * ### What is scanned, and what counts as production
 *
 * Every `.ts`/`.tsx` file under `apps/web/src`, split into the App_Shell root,
 * the Auth_Feature root, the marketing landing root, and everything else. Test
 * files (`*.test.ts(x)`, `*.spec.ts(x)`) are excluded from the App_Shell's
 * *outbound* scan — a test may read the wiring it enforces, which is why this very
 * file imports `src/app/appRouter.tsx` for the route-table checks while no shell
 * module does. Test harness modules (`*TestHarness.ts`) are deliberately **kept**
 * in the scan: they sit in the shell's directories and are subject to the same
 * boundary.
 *
 * Specifiers are read from `import`/`export … from`/dynamic `import()`/`require()`
 * in comment-stripped source, so a module path mentioned in a docblock — and these
 * modules mention plenty — never produces a false positive. Relative specifiers
 * are resolved against the importing file, so a `../../auth/lib/theme` reaching in
 * from a sibling directory is recognised for what it is. Static asset specifiers
 * (`.png`, `.svg`, `.css`, fonts) are not modules and are excluded — see
 * {@link isStaticAsset}.
 *
 * ### The five invariants
 *
 * 1. **Containment and one public entry point** (Requirements 1.10, 15.4). The
 *    feature is rooted at `apps/web/src/features/app-shell/`, carries an
 *    `index.ts` at that root, and every module the design's layout names is
 *    present inside it. No shell module resolves an import to a path outside the
 *    root other than the two the requirements permit (below), so no part of the
 *    shell is assembled from a module living elsewhere. The barrel itself
 *    re-exports shell modules only.
 * 2. **The Auth_Feature through its barrel only** (Requirement 15.3). Every shell
 *    import that lands inside `features/auth/` lands on the auth barrel, never a
 *    deeper module path — and at least one does, so the invariant is not vacuous.
 * 3. **No marketing landing import** (Requirements 15.3, 15.7). No shell import
 *    resolves into `features/landing/`; the Theme work the landing feature also
 *    needs comes from the shared `src/theme` module instead.
 * 4. **One-way dependency direction** (Requirement 15.4). No file under the
 *    Auth_Feature root and no file under the marketing landing root imports the
 *    shell at all, and every file outside the shell that *does* import it imports
 *    the barrel and lives under `src/app/` — the application-level router wiring.
 * 5. **Every route path registered exactly once** (Requirement 15.6). The real
 *    assembled application route table is flattened the way `react-router` matches
 *    it and asserted to carry no duplicate path, to carry every Auth_Feature route
 *    path — the failure this requirement exists for, `/login` resolving to no
 *    registered route — and to carry the landing route, every Destination path,
 *    the shell's `/app/*` miss, and the one application catch-all.
 *
 * Invariant 5 is the structural counterpart of Property 37, which mounts each
 * path and asserts the screen it reaches. This one needs no rendering: it asks
 * only what the table registers, so a path registered twice or a feature path left
 * off fails here regardless of what any screen renders.
 *
 * Requirements: 1.10, 15.3, 15.4, 15.6, 15.8
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';

import {
  AUTH_ROUTE_PATHS,
  type AuthApiFacade,
  type SessionManager,
} from '../auth';
import { SHELL_DESTINATIONS } from './lib/destinations';
import { createAppRoutes } from '../../app/appRouter';
import { APP_CATCH_ALL_ROUTE, LANDING_ROUTE } from '../../app/appRoutePaths';

// --- Roots -------------------------------------------------------------------

/** This file sits at the App_Shell feature root. */
const shellRoot = dirname(fileURLToPath(import.meta.url));
/** `src/features/app-shell` -> `src`. */
const srcRoot = resolve(shellRoot, '..', '..');
const authRoot = join(srcRoot, 'features', 'auth');
const landingRoot = join(srcRoot, 'features', 'landing');
const themeRoot = join(srcRoot, 'theme');
/** The application-level router wiring — the shell's only permitted consumer. */
const appWiringRoot = join(srcRoot, 'app');

/** Normalise an absolute path to forward slashes for stable comparisons. */
function norm(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Human-readable path relative to the src root, for assertion messages. */
function relToSrc(path: string): string {
  return relative(srcRoot, path).replace(/\\/g, '/');
}

/** True when `candidate` is `root` itself or nested beneath it. */
function isWithin(root: string, candidate: string): boolean {
  const r = norm(root);
  const c = norm(candidate);
  return c === r || c.startsWith(`${r}/`);
}

// --- File collection ---------------------------------------------------------

/** True for a TypeScript source file (`.ts`/`.tsx`). */
function isTypeScriptSource(fileName: string): boolean {
  return /\.tsx?$/.test(fileName);
}

/**
 * True for a test file.
 *
 * Test *harness* modules (`*TestHarness.ts`) are not test files for this scan's
 * purposes: they are plain modules sitting inside the shell's directories and are
 * held to the same boundary as anything else there.
 */
function isTestFile(fileName: string): boolean {
  return /\.(?:test|spec)\.tsx?$/.test(fileName);
}

/** Recursively collect the `.ts`/`.tsx` files under `dir`. */
function collectSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Never descend into build output.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...collectSources(full));
      continue;
    }
    if (entry.isFile() && isTypeScriptSource(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const allSources = collectSources(srcRoot);
const shellSources = allSources.filter((file) => isWithin(shellRoot, file));
/** The shell's own modules, tests aside — what the outbound rules bind. */
const shellModules = shellSources.filter(
  (file) => !isTestFile(relative(shellRoot, file)),
);
const outsideShellSources = allSources.filter(
  (file) => !isWithin(shellRoot, file),
);

// --- Import specifiers -------------------------------------------------------

/**
 * Remove `//` and block comments, replacing a block with a single space so line
 * structure survives. String and template literals are preserved verbatim,
 * because that is where module specifiers live.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        out += source[i];
        if (source[i] === '\\') {
          if (i + 1 < n) out += source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/** Every specifier referenced by `import`/`export … from`/`import()`/`require()`. */
function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  const patterns = [
    // import ... from '...'   and   export ... from '...'
    /\bfrom\s*['"]([^'"]+)['"]/g,
    // bare side-effect import '...'
    /\bimport\s+['"]([^'"]+)['"]/g,
    // dynamic import('...')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // require('...')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Resolve a specifier to an absolute path inside `apps/web/src`, or `null` for a
 * package specifier (`react`, `@pitchmate/api-client`, …) that names no source
 * file of this app.
 *
 * A relative specifier resolves against the importing file. A specifier carrying
 * a workspace-style `src/...`, `features/...`, `app/...`, or `theme/...` segment
 * is anchored under the src root, so an alias cannot slip a deep import past the
 * scan.
 */
function resolveWithinSrc(
  specifier: string,
  importingFile: string,
): string | null {
  if (specifier.startsWith('.')) {
    return norm(resolve(dirname(importingFile), specifier));
  }
  const anchored = /(?:^|\/)((?:features|app|theme)\/.*)$/.exec(norm(specifier));
  return anchored === null ? null : norm(resolve(srcRoot, anchored[1]));
}

/** True when a resolved path is a directory's barrel (the directory or its index). */
function targetsBarrelOf(root: string, resolvedTarget: string): boolean {
  const r = norm(root);
  return (
    resolvedTarget === r ||
    resolvedTarget === `${r}/index` ||
    resolvedTarget === `${r}/index.ts` ||
    resolvedTarget === `${r}/index.tsx`
  );
}

/**
 * A static asset Vite resolves to a URL string — an image, a font, a stylesheet.
 *
 * These are not modules, so they are not what the module boundary governs. The
 * brand logo in `src/assets/` is shared by the Shell_Header's brand control and
 * the landing page's own header; it is owned by neither feature, and importing it
 * creates no dependency on a feature's implementation. Excluding it keeps the
 * scan's subject the module graph the requirements are written about.
 */
function isStaticAsset(specifier: string): boolean {
  return /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|css)$/i.test(
    specifier,
  );
}

/** Every in-app module target of `file`, paired with the specifier that wrote it. */
function inAppImports(
  file: string,
): Array<{ readonly specifier: string; readonly target: string }> {
  const source = readFileSync(file, 'utf8');
  const resolved: Array<{ specifier: string; target: string }> = [];
  for (const specifier of importSpecifiers(source)) {
    if (isStaticAsset(specifier)) continue;
    const target = resolveWithinSrc(specifier, file);
    if (target !== null) {
      resolved.push({ specifier, target });
    }
  }
  return resolved;
}

// --- 1. Containment and one public entry point (Requirements 1.10, 15.4) -----

describe('App_Shell containment and public entry point (Requirements 1.10, 15.4)', () => {
  it('is rooted at apps/web/src/features/app-shell', () => {
    expect(norm(shellRoot).endsWith('apps/web/src/features/app-shell')).toBe(
      true,
    );
  });

  it('discovers the shell modules to scan', () => {
    // Sanity guard: an empty scan would make every invariant below vacuous.
    expect(shellModules.length).toBeGreaterThan(0);
    expect(outsideShellSources.length).toBeGreaterThan(0);
  });

  it('houses every module of the feature inside the feature root', () => {
    // The surfaces the design's module layout names. Each must be present under
    // the root — a shell module living anywhere else fails here.
    const present = new Set(shellSources.map((file) => norm(file)));
    const required = [
      'index.ts',
      'shellRoutes.tsx',
      'ShellFrame.tsx',
      'RouteGuard.tsx',
      'DestinationUnavailable.tsx',
      'ShellNotFound.tsx',
      'SessionEndedNotice.tsx',
      'SettingsDestination.tsx',
      'api/notificationsApi.ts',
      'components/ShellHeader.tsx',
      'components/PrimaryNavigation.tsx',
      'components/ContentRegion.tsx',
      'components/NotificationPanel.tsx',
      'components/AccountMenu.tsx',
      'components/ShellThemeProvider.tsx',
      'lib/destinations.ts',
      'lib/routeResolution.ts',
      'lib/messages.ts',
      'state/useNotificationCentre.ts',
      'state/useSignOut.ts',
    ];

    const missing = required.filter(
      (file) => !present.has(norm(join(shellRoot, file))),
    );
    expect(missing).toEqual([]);
  });

  it('exposes exactly one public entry point at the feature root', () => {
    const barrel = readFileSync(join(shellRoot, 'index.ts'), 'utf8');
    expect(barrel.length).toBeGreaterThan(0);
    // The entry point the application router mounts the whole shell through.
    expect(barrel).toContain('createShellRoutes');

    // No second barrel: `index.ts`/`index.tsx` exists at the root and nowhere
    // else under it, so a consumer has one place to import from.
    const indexes = shellSources
      .map((file) => relative(shellRoot, file).replace(/\\/g, '/'))
      .filter((file) => /(?:^|\/)index\.tsx?$/.test(file));
    expect(indexes).toEqual(['index.ts']);
  });

  it('re-exports shell modules only from the public entry point', () => {
    const barrelPath = join(shellRoot, 'index.ts');
    const escaping = inAppImports(barrelPath)
      .filter(({ target }) => !isWithin(shellRoot, target))
      .map(({ specifier }) => specifier);
    expect(escaping).toEqual([]);
  });

  it('resolves no shell import outside the feature root beyond the auth barrel and the shared theme module (Requirements 15.3, 15.7)', () => {
    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const file of shellModules) {
      for (const { specifier, target } of inAppImports(file)) {
        if (isWithin(shellRoot, target)) continue;
        // The two permitted outward edges: the Auth_Feature's public barrel
        // (Requirement 15.3) and the shared Theme module (Requirement 15.7).
        if (targetsBarrelOf(authRoot, target)) continue;
        if (isWithin(themeRoot, target)) continue;
        offenders.push({ file: relToSrc(file), specifier });
      }
    }
    expect(offenders).toEqual([]);
  });
});

// --- 2 & 3. Auth barrel only, no landing import (Requirement 15.3) -----------

describe('App_Shell imports the Auth_Feature through its barrel only (Requirement 15.3)', () => {
  const authImports = shellModules.flatMap((file) =>
    inAppImports(file)
      .filter(({ target }) => isWithin(authRoot, target))
      .map(({ specifier, target }) => ({ file: relToSrc(file), specifier, target })),
  );

  it('imports the Auth_Feature at all', () => {
    // Guard: the shell consumes the Auth_State, the Log_In_Route, and the
    // Live_Region from the auth barrel, so an empty set means the scan broke
    // rather than that the boundary is clean.
    expect(authImports.length).toBeGreaterThan(0);
  });

  it('reaches no deeper module path of the Auth_Feature', () => {
    const offenders = authImports
      .filter(({ target }) => !targetsBarrelOf(authRoot, target))
      .map(({ file, specifier }) => ({ file, specifier }));
    expect(offenders).toEqual([]);
  });
});

describe('App_Shell imports no module of the marketing landing feature (Requirement 15.3)', () => {
  it('resolves no import into features/landing', () => {
    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const file of shellModules) {
      for (const { specifier, target } of inAppImports(file)) {
        if (isWithin(landingRoot, target)) {
          offenders.push({ file: relToSrc(file), specifier });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// --- 4. One-way dependency direction (Requirement 15.4) ---------------------

describe('the dependency direction runs one way to the App_Shell (Requirement 15.4)', () => {
  /** Every file outside the shell that resolves an import into the shell root. */
  const inboundImports = outsideShellSources.flatMap((file) =>
    inAppImports(file)
      .filter(({ target }) => isWithin(shellRoot, target))
      .map(({ specifier, target }) => ({ file, specifier, target })),
  );

  it('is imported from outside at all', () => {
    // Guard: the application router mounts the shell, so an empty set means the
    // resolution broke rather than that nothing reaches in.
    expect(inboundImports.length).toBeGreaterThan(0);
  });

  it('is imported by neither the Auth_Feature nor the marketing landing feature', () => {
    const offenders = inboundImports
      .filter(
        ({ file }) => isWithin(authRoot, file) || isWithin(landingRoot, file),
      )
      .map(({ file, specifier }) => ({ file: relToSrc(file), specifier }));
    expect(offenders).toEqual([]);
  });

  it('is imported only through its public entry point', () => {
    const offenders = inboundImports
      .filter(({ target }) => !targetsBarrelOf(shellRoot, target))
      .map(({ file, specifier }) => ({ file: relToSrc(file), specifier }));
    expect(offenders).toEqual([]);
  });

  it('is imported by the application-level router wiring only', () => {
    const offenders = inboundImports
      .filter(({ file }) => !isWithin(appWiringRoot, file))
      .map(({ file, specifier }) => ({ file: relToSrc(file), specifier }));
    expect(offenders).toEqual([]);
  });
});

// --- 5. Route registration (Requirement 15.6) -------------------------------

/** Join a parent's resolved path with a relative child path segment. */
function joinRoutePath(parentPath: string, childPath: string): string {
  return `${parentPath.replace(/\/$/, '')}/${childPath}`;
}

/**
 * Every path the assembled table registers, one entry per matchable route.
 *
 * A layout route with children contributes through its children, a pathless
 * layout route contributes its parent's path, and an index child contributes the
 * path of the route it indexes — which is how `react-router` matches each of
 * them. So `/app` registered as the shell's layout route plus its index child is
 * one registration, not two.
 */
function registeredPaths(
  routes: readonly RouteObject[],
  parentPath = '',
): string[] {
  const paths: string[] = [];

  for (const route of routes) {
    const ownPath =
      route.path === undefined
        ? parentPath
        : route.path.startsWith('/') || parentPath === ''
          ? route.path
          : joinRoutePath(parentPath, route.path);

    if (route.children === undefined || route.children.length === 0) {
      paths.push(ownPath);
    } else {
      paths.push(...registeredPaths(route.children, ownPath));
    }
  }

  return paths;
}

/**
 * A Session_Manager stand-in.
 *
 * The table is only flattened here, never rendered, so nothing observes a
 * transition. Supplying one keeps the scan off browser storage and away from the
 * refresh scheduling the real model would start.
 */
function stubSessionManager(): SessionManager {
  return {
    bootstrap: () => 'authenticated',
    getState: () => 'authenticated',
    subscribe: () => () => {},
  } as unknown as SessionManager;
}

/** An inert auth backend facade — no call is issued while assembling the table. */
function stubAuthApi(): AuthApiFacade {
  return {} as unknown as AuthApiFacade;
}

/** An inert Authenticated_Api_Client — no notification call is issued either. */
function stubApiClient(): PitchMateApiClient {
  return {} as unknown as PitchMateApiClient;
}

describe('the application router registers every route path exactly once (Requirement 15.6)', () => {
  const declared = registeredPaths(
    createAppRoutes({
      sessionManager: stubSessionManager(),
      authApi: stubAuthApi(),
      apiClient: stubApiClient(),
    }),
  );

  it('registers no path more than once', () => {
    const seen = new Map<string, number>();
    for (const path of declared) {
      seen.set(path, (seen.get(path) ?? 0) + 1);
    }
    const duplicated = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({ path, count }));
    expect(duplicated).toEqual([]);
  });

  it('registers every Auth_Feature route path, including /login', () => {
    // The failure this requirement exists for: the auth table was built and
    // never mounted, so `/login` resolved to no registered route.
    expect(AUTH_ROUTE_PATHS.length).toBeGreaterThan(0);
    const unregistered = AUTH_ROUTE_PATHS.filter(
      (path) => !declared.includes(path),
    );
    expect(unregistered).toEqual([]);
    expect(declared).toContain('/login');
  });

  it('registers the landing route, every Destination, the shell miss, and one catch-all', () => {
    expect(declared).toContain(LANDING_ROUTE);

    expect(SHELL_DESTINATIONS.length).toBeGreaterThan(0);
    const unregistered = SHELL_DESTINATIONS.map(({ path }) => path).filter(
      (path) => !declared.includes(path),
    );
    expect(unregistered).toEqual([]);

    // The `/app/...` miss (Requirement 3.10) and the application-level
    // not-found (Requirement 15.9) are different paths, each registered once.
    expect(declared.filter((path) => path === '/app/*')).toHaveLength(1);
    expect(
      declared.filter((path) => path === APP_CATCH_ALL_ROUTE),
    ).toHaveLength(1);
  });
});
