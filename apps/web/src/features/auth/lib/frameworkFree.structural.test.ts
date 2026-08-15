/**
 * Structural boundary test for the pure logic layer (task 20.1).
 *
 * Requirement 15.1 says the Auth_Web SHALL implement its error-prone logic —
 * Email_Address validation, Password_Policy validation, URL token extraction,
 * Redirect_Target resolution, Access_Token expiry evaluation, and
 * backend-error-to-message mapping — as pure functions that depend on *neither
 * React nor the DOM*, so they stay browserless-testable and the presentational
 * components stay thin. This test enforces that boundary as a source-level
 * invariant rather than an example: every production module under
 * `apps/web/src/features/auth/lib/` is scanned and asserted to
 *
 * 1. import nothing from React (`react`, `react-dom`, or any `react/*` /
 *    `react-dom/*` sub-path), whether via `import`, dynamic `import()`, or
 *    `require`; and
 * 2. reference no DOM/BOM global (`window`, `document`, `navigator`,
 *    `localStorage`, `sessionStorage`, `history`, `location`) and no DOM-typed
 *    API (`HTMLElement`, `Element`, `Node`, `Document`, `Window`, `Event`, …)
 *    that would couple the module to a browser.
 *
 * Mirroring `api/clientConsumption.test.ts`, the scan strips comments and
 * string/template literals through a small state machine before matching, so
 * that the *words* "React"/"window"/"document" inside the modules' extensive
 * docblocks (they repeatedly promise "no React, no DOM, no `window` access")
 * or inside string content never produce a false positive. Import specifiers,
 * however, live in string literals — so React-import detection runs against a
 * comments-only-stripped copy that preserves those specifiers while still
 * discarding any import-shaped text hiding in a comment.
 *
 * Requirements: 15.1
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// This test lives in the `lib/` directory it guards.
const libDir = dirname(fileURLToPath(import.meta.url));

/** True for a test file (excluded from the production scan). */
function isTestFile(fileName: string): boolean {
  return (
    /\.test\.tsx?$/.test(fileName) ||
    /\.pbt\.test\.tsx?$/.test(fileName) ||
    /\.property\.test\.tsx?$/.test(fileName) ||
    /\.spec\.tsx?$/.test(fileName)
  );
}

/** True for a TypeScript source file we should scan. */
function isTypeScriptSource(fileName: string): boolean {
  return /\.tsx?$/.test(fileName);
}

/** Recursively collect the production `.ts`/`.tsx` files under `dir`. */
function collectProductionSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectProductionSources(full));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!isTypeScriptSource(entry.name) || isTestFile(entry.name)) {
      continue;
    }
    found.push(full);
  }
  return found;
}

/**
 * Remove `//` and block comments from TypeScript source, replacing each with
 * whitespace so line structure and any live code (including string literals,
 * which carry import specifiers) are preserved.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // Line comment: skip to end of line.
    if (c === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }

    // Block comment: skip to closing */.
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    // Single- or double-quoted string: preserved verbatim (import specifiers).
    if (c === "'" || c === '"') {
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

/**
 * Remove comments *and* string/template literal contents, replacing each with
 * whitespace so only live, non-string code remains. Template *expressions*
 * (`${ ... }`) are kept so a global hidden inside an interpolation is still
 * visible to the scan.
 */
function stripCommentsAndStrings(source: string): string {
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

/**
 * Matches an import of React from an `import`/`import()`/`require` in any form:
 * `import … from 'react'`, `import 'react-dom/client'`, `require('react')`,
 * `await import('react/jsx-runtime')`. The specifier lives in a string literal,
 * so this runs against the comments-only-stripped source.
 */
const REACT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]react(?:-dom)?(?:\/[^'"]*)?['"]/;

// DOM/BOM globals and DOM-typed APIs that would couple a pure module to a
// browser. Matched with word boundaries against fully-stripped code so that
// ECMAScript globals used by the logic (`Error`, `TypeError`, `Number`,
// `URLSearchParams`, `decodeURIComponent`, …) are never mistaken for DOM APIs.
const DOM_REFERENCE_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'window', pattern: /\bwindow\b/ },
  { label: 'document', pattern: /\bdocument\b/ },
  { label: 'navigator', pattern: /\bnavigator\b/ },
  { label: 'localStorage', pattern: /\blocalStorage\b/ },
  { label: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { label: 'history', pattern: /\bhistory\b/ },
  { label: 'location', pattern: /\blocation\b/ },
  { label: 'HTML*Element type', pattern: /\bHTML[A-Za-z]*Element\b/ },
  { label: 'Element type', pattern: /\bElement\b/ },
  { label: 'Node type', pattern: /\bNode\b/ },
  { label: 'Document type', pattern: /\bDocument\b/ },
  { label: 'Window type', pattern: /\bWindow\b/ },
  { label: 'Event type', pattern: /\b(?:Mouse|Keyboard|Pointer|Focus|Input|Touch)?Event\b/ },
  { label: 'EventTarget', pattern: /\bEventTarget\b/ },
  { label: 'NodeList', pattern: /\bNodeList\b/ },
  { label: 'DOMParser', pattern: /\bDOMParser\b/ },
];

const productionFiles = collectProductionSources(libDir);

/** Human-readable path relative to the lib root for assertion messages. */
function rel(path: string): string {
  return relative(libDir, path).replace(/\\/g, '/');
}

describe('pure logic layer stays framework-free (structural scan)', () => {
  it('discovers the production source files under lib/', () => {
    // Sanity guard: if the scan finds nothing the invariants below are vacuous.
    expect(productionFiles.length).toBeGreaterThan(0);
    const names = productionFiles.map(rel);
    // Spot-check the named pure functions from Requirement 15.1 are present.
    expect(names).toContain('emailValidation.ts');
    expect(names).toContain('passwordPolicy.ts');
    expect(names).toContain('tokenFromUrl.ts');
    expect(names).toContain('redirectTarget.ts');
    expect(names).toContain('accessTokenExpiry.ts');
    expect(names).toContain('errorMapping.ts');
    // The scan must not have swept up any test files.
    expect(names.some((name) => isTestFile(name))).toBe(false);
  });

  it('imports nothing from React (Requirement 15.1)', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (REACT_IMPORT_PATTERN.test(code)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('references no DOM/BOM global or DOM-typed API (Requirement 15.1)', () => {
    const offenders: Array<{ file: string; reference: string }> = [];
    for (const file of productionFiles) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const { label, pattern } of DOM_REFERENCE_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ file: rel(file), reference: label });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
