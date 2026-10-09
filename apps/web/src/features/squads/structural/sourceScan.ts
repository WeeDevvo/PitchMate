/**
 * Shared machinery for the Squads_Feature's structural source scans (task 17).
 *
 * Requirement 20.11 makes those scans part of the product rather than a courtesy
 * check: the rules they enforce are prohibitions and universals over a directory
 * ("every module lives under `features/squads/`", "only `api/squadsApi.ts` names
 * the client", "no numeric enum literal appears anywhere in the feature"), and neither
 * a prohibition nor a universal can be demonstrated by an example. The design
 * settles the mechanism: read each file's text, strip comments and string
 * literals through the same small state machine, and fail naming the offending
 * file and specifier — the mechanism `features/app-shell/pureLogic.structural.test.ts`,
 * `features/app-shell/transportSeam.structural.test.ts`, and
 * `features/app-shell/moduleBoundaries.structural.test.ts` already established.
 *
 * The App_Shell has three such scans and three copies of that machinery. This
 * feature has five, so the machinery is declared once here and each scan states
 * only its own rules. A drifting copy of a stripper would silently weaken a scan,
 * which is the failure mode this module exists to remove.
 *
 * ### Why two strippers, and which to use
 *
 * - {@link stripComments} keeps string literals verbatim. Import specifiers,
 *   route paths, storage keys, and endpoint paths *are* string literals, so any
 *   rule about them reads through this one.
 * - {@link stripCommentsAndStrings} removes string and template literal contents
 *   too, leaving only live non-string code. Any rule about *identifiers* reads
 *   through this one, because these modules' docblocks discuss at length the very
 *   things they must not do ("this module holds no React and no DOM access"), and
 *   a scan that matched prose would flag the documentation promising compliance.
 *   Template *expressions* (`${ … }`) survive, so an identifier hidden inside an
 *   interpolation is still visible.
 *
 * ### What counts as a module of the feature
 *
 * {@link squadsModules} is the production set every scan binds: the `.ts`/`.tsx`
 * files under the feature root, excluding test files and excluding this
 * directory. Scan support is not part of the shipped feature — nothing under
 * `screens/`, `components/`, `state/`, `lib/`, or `api/` imports it, and the
 * public barrel does not name it — so holding it to the feature's own boundary
 * rules would be asserting something about the scans rather than about the
 * product.
 *
 * Test *harnesses* are deliberately **kept** in that set (`testing/`), following
 * the App_Shell's precedent: a harness sits in the feature's directories, is
 * imported by the feature's own tests, and is subject to the same containment.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.7, 20.11
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

// --- Roots -------------------------------------------------------------------

/** This module sits one level below the Squads_Feature root. */
export const squadsRoot: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** `src/features/squads` -> `src`. */
export const srcRoot: string = resolve(squadsRoot, '..', '..');

/** `apps/web` — for `index.html` and `vite.config.ts`. */
export const webRoot: string = resolve(srcRoot, '..');

/** The application-level router wiring: the feature's only admitted consumer. */
export const appWiringRoot: string = join(srcRoot, 'app');

export const appShellRoot: string = join(srcRoot, 'features', 'app-shell');
export const authRoot: string = join(srcRoot, 'features', 'auth');
export const landingRoot: string = join(srcRoot, 'features', 'landing');

/** The one shared Theme module (Requirement 18.8). */
export const themeRoot: string = join(srcRoot, 'theme');

/** This directory: scan support, not part of the shipped feature. */
export const scanSupportRoot: string = join(squadsRoot, 'structural');

// --- Path helpers ------------------------------------------------------------

/** Normalise an absolute path to forward slashes for stable comparisons. */
export function norm(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Human-readable path relative to `root`, with forward slashes. */
export function relTo(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}

/** True when `candidate` is `root` itself or nested beneath it. */
export function isWithin(root: string, candidate: string): boolean {
  const r = norm(root);
  const c = norm(candidate);
  return c === r || c.startsWith(`${r}/`);
}

/**
 * True when a resolved import target is a directory's barrel — the directory
 * itself, or its `index.ts`/`index.tsx`. A deeper path into that directory is
 * not the barrel, which is what makes "through the barrel only" checkable.
 */
export function targetsBarrelOf(root: string, resolvedTarget: string): boolean {
  const r = norm(root);
  return (
    resolvedTarget === r ||
    resolvedTarget === `${r}/index` ||
    resolvedTarget === `${r}/index.ts` ||
    resolvedTarget === `${r}/index.tsx`
  );
}

// --- File classification -----------------------------------------------------

/** True for a TypeScript source file (`.ts`/`.tsx`). */
export function isTypeScriptSource(fileName: string): boolean {
  return /\.tsx?$/.test(fileName);
}

/**
 * True for a test file, in every suffix this feature uses.
 *
 * Test *harness* modules are not test files for a scan's purposes: they are plain
 * modules sitting inside the feature's directories and are held to the same
 * boundary as anything else there.
 */
export function isTestFile(fileName: string): boolean {
  return (
    /\.test\.tsx?$/.test(fileName) ||
    /\.property\.test\.tsx?$/.test(fileName) ||
    /\.a11y\.test\.tsx?$/.test(fileName) ||
    /\.pbt\.test\.tsx?$/.test(fileName) ||
    /\.spec\.tsx?$/.test(fileName)
  );
}

/** True for a property-based test file. */
export function isPropertyTestFile(fileName: string): boolean {
  return /\.property\.test\.tsx?$/.test(fileName);
}

/** True for a module of this directory: scan support, not shipped feature code. */
export function isScanSupportModule(file: string): boolean {
  return isWithin(scanSupportRoot, file);
}

/**
 * A static asset Vite resolves to a URL string, or a stylesheet — not a module,
 * so not what a module boundary governs.
 */
export function isStaticAsset(specifier: string): boolean {
  return /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|css)$/i.test(
    specifier,
  );
}

// --- File collection ---------------------------------------------------------

/** Recursively collect the files under `dir` matching `extensions`, tests included. */
export function collectSources(
  dir: string,
  extensions: readonly string[] = ['.ts', '.tsx'],
): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Never descend into installed packages or build output.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...collectSources(full, extensions));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!extensions.some((extension) => entry.name.endsWith(extension))) continue;
    found.push(full);
  }
  return found;
}

/** As {@link collectSources}, with test files excluded. */
export function collectProductionSources(
  dir: string,
  extensions: readonly string[] = ['.ts', '.tsx'],
): string[] {
  return collectSources(dir, extensions).filter(
    (file) => !isTestFile(relTo(dir, file)),
  );
}

/** Recursively collect the property-test files under `dir`. */
export function collectPropertyTests(dir: string): string[] {
  return collectSources(dir).filter((file) =>
    isPropertyTestFile(relTo(dir, file)),
  );
}

/** Every `.ts`/`.tsx` file under the feature root, tests and scan support included. */
export function squadsSources(): string[] {
  return collectSources(squadsRoot);
}

/**
 * The feature's production modules: everything under the root but the test files
 * and this scan-support directory. This is the set the boundary rules bind.
 */
export function squadsModules(): string[] {
  return collectProductionSources(squadsRoot).filter(
    (file) => !isScanSupportModule(file),
  );
}

/** The feature's stylesheets, the token table included. */
export function squadsStyles(): string[] {
  return collectSources(squadsRoot, ['.css']);
}

/** Every `.ts`/`.tsx` file under `apps/web/src`, tests included. */
export function srcSources(): string[] {
  return collectSources(srcRoot);
}

// --- Strippers ---------------------------------------------------------------

/**
 * Remove `//` and block comments, keeping string and template literals verbatim
 * so module specifiers and path literals survive for matching.
 */
export function stripComments(source: string): string {
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
        if (source[i] === '\\') {
          out += source[i];
          if (i + 1 < n) out += source[i + 1];
          i += 2;
          continue;
        }
        out += source[i];
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

/**
 * Remove comments *and* string/template literal contents, leaving only live,
 * non-string code. Template *expressions* (`${ … }`) are kept, so an identifier
 * hidden inside an interpolation is still visible to a scan.
 */
export function stripCommentsAndStrings(source: string): string {
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

    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += ' ';
      continue;
    }

    if (c === '`') {
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '`') {
          i += 1;
          break;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            if (depth > 0) out += source[i];
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      out += ' ';
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/** Remove CSS comments, preserving declarations. */
export function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Read a file and drop its comments, string literals preserved. */
export function readWithoutComments(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/** Read a file and drop its comments and its string contents. */
export function readCodeOnly(file: string): string {
  return stripCommentsAndStrings(readFileSync(file, 'utf8'));
}

// --- Imports -----------------------------------------------------------------

/** Every specifier of `import`/`export … from`/`import()`/`require()`. */
export function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const pattern =
    /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    found.push(match[2]);
  }
  return found;
}

/**
 * Resolve a specifier to an absolute path inside `apps/web/src`, or `null` for a
 * package specifier (`react`, `@pitchmate/api-client`, …) that names no source
 * file of this application.
 *
 * A relative specifier resolves against the importing file, so a
 * `../../auth/lib/theme` reaching in from a sibling directory is recognised for
 * what it is. A specifier carrying a workspace-style `src/…`, `features/…`,
 * `app/…`, or `theme/…` segment is anchored under the src root, so an alias
 * cannot slip a deep import past a scan.
 */
export function resolveWithinSrc(
  specifier: string,
  importingFile: string,
): string | null {
  if (specifier.startsWith('.')) {
    return norm(resolve(dirname(importingFile), specifier));
  }
  const anchored = /(?:^|\/)((?:features|app|theme)\/.*)$/.exec(norm(specifier));
  return anchored === null ? null : norm(resolve(srcRoot, anchored[1]));
}

/** A specifier paired with the in-app module path it resolves to. */
export interface ResolvedImport {
  /** The specifier as written, for a failure message. */
  readonly specifier: string;
  /** The resolved absolute path, normalised to forward slashes. */
  readonly target: string;
}

/** Every in-app module target of `file`, paired with the specifier that wrote it. */
export function inAppImports(file: string): ResolvedImport[] {
  const resolved: ResolvedImport[] = [];
  for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
    if (isStaticAsset(specifier)) continue;
    const target = resolveWithinSrc(specifier, file);
    if (target !== null) {
      resolved.push({ specifier, target });
    }
  }
  return resolved;
}

// --- Re-exports --------------------------------------------------------------

/** One `export … from '…'` statement, as a barrel scan reads it. */
export interface ReExport {
  /** The specifier the names come from. */
  readonly specifier: string;
  /** The names as exported — the alias, where one is written. */
  readonly names: readonly string[];
  /** True for `export * from …` / `export * as ns from …`, which names nothing. */
  readonly isStar: boolean;
}

/**
 * Every `export … from '…'` of a module.
 *
 * A star export is reported with `isStar` and no names, because it widens a
 * surface without saying what by — which is precisely what a barrel scan needs to
 * be able to reject. `type` modifiers are dropped: a type crossing the boundary
 * is part of the exported surface just as a value is.
 */
export function reExports(source: string): ReExport[] {
  const code = stripComments(source);
  const pattern =
    /\bexport\s*(\*(?:\s*as\s+[\w$]+)?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/g;
  const found: ReExport[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const isStar = match[1].startsWith('*');
    const names = isStar
      ? []
      : (match[2] ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .map((entry) => {
            const withoutModifier = entry.replace(/^type\s+/, '');
            const aliased = /\bas\s+([\w$]+)\s*$/.exec(withoutModifier);
            return aliased === null ? withoutModifier.trim() : aliased[1];
          });

    found.push({ specifier: match[3], names, isStar });
  }

  return found;
}

// --- Property-test iteration counts ------------------------------------------

/**
 * The 100-iteration floor Requirement 20.1 sets: "a property-based test
 * executing at least 100 generated cases".
 */
export const MINIMUM_PROPERTY_RUNS = 100;

/**
 * The source slice of every `fc.assert( … )` call in `code`, found by walking
 * balanced parentheses.
 *
 * `code` must already have had its strings stripped — pass the output of
 * {@link readCodeOnly} or {@link stripCommentsAndStrings} — so that no
 * parenthesis inside a literal can unbalance the walk.
 */
export function fcAssertCalls(code: string): string[] {
  const calls: string[] = [];
  const opener = /\bfc\s*\.\s*assert\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(code)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') depth -= 1;
      i += 1;
    }
    calls.push(code.slice(match.index, i));
  }

  return calls;
}

/**
 * The smallest number bound to `identifier` in `fileCode` by a `= <number>`, or
 * `null` when the identifier is bound to no numeric literal.
 *
 * Both `const RUNS = 300` and a parameter default `runs = 300` are read, because
 * a file that states its property once and runs it per shape carries the count as
 * a defaulted parameter rather than as a constant. The *smallest* binding is
 * taken so that a second, lower binding of the same name cannot be missed.
 */
function smallestNumericBinding(
  identifier: string,
  fileCode: string,
): number | null {
  const pattern = new RegExp(
    `\\b${identifier}\\s*(?::[^=;,)]+)?=\\s*([\\d_]+)`,
    'g',
  );
  let smallest: number | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(fileCode)) !== null) {
    const value = Number(match[1].replace(/_/g, ''));
    if (smallest === null || value < smallest) smallest = value;
  }

  return smallest;
}

/**
 * The iteration counts a single `fc.assert` call configures.
 *
 * Three spellings are read: a numeric literal (`{ numRuns: 300 }`), an
 * identifier (`{ numRuns: RUNS }`), and the shorthand (`{ numRuns }`) a driver
 * uses when it takes the count as a parameter. An identifier is resolved through
 * {@link smallestNumericBinding}, so a shared floor constant or a defaulted
 * parameter is honoured rather than reported as unreadable. Anything else yields
 * `null` — the scan cannot see through it, and a count it cannot read is exactly
 * the drift the 100-iteration floor exists to catch.
 *
 * A per-call parameter overrides any `fc.configureGlobal` default, so a call that
 * states its own `numRuns` cannot be lowered from elsewhere. That is why a scan
 * insists every call state one rather than trusting a global: the empty array
 * this returns for a call that configures nothing is a finding, not a pass.
 *
 * **Known limit.** Where the count arrives as a defaulted parameter, a call site
 * passing a lower literal is beyond a text scan's reach; the declared default is
 * what is read.
 */
export function configuredRuns(
  call: string,
  fileCode: string,
): Array<number | null> {
  const found: Array<number | null> = [];
  // `numRuns: <token>`, or the shorthand `numRuns` followed by `,` or `}`.
  const pattern = /\bnumRuns\s*(?::\s*([A-Za-z_$][\w$]*|[\d_]+)|(?=\s*[,}]))/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(call)) !== null) {
    const token = match[1] ?? 'numRuns';
    if (/^[\d_]+$/.test(token)) {
      found.push(Number(token.replace(/_/g, '')));
      continue;
    }

    found.push(smallestNumericBinding(token, fileCode));
  }

  return found;
}
