/**
 * Structural tests for typed Api_Client consumption (task 9.4).
 *
 * Requirement 12.1 says the Auth_Web SHALL perform *every* backend auth call
 * through the generated `@pitchmate/api-client` package, and Requirement 12.3
 * that the client only relays input — it makes no direct network call of its
 * own. These are enforced here as a source-level invariant rather than an
 * example: the whole feature's *production* source (everything under
 * `apps/web/src/features/auth/` except test files) is scanned and asserted to
 * contain
 *
 * 1. no direct `fetch(` (or `.fetch(`) invocation and no other bare transport
 *    (`XMLHttpRequest`, `navigator.sendBeacon`, `new WebSocket`, `axios`), so
 *    the only way out to the network is the generated client; and
 * 2. a real routing seam onto the generated client — the `api/` modules import
 *    `@pitchmate/api-client` and issue their calls through the client object.
 *
 * The scan strips comments and string/template literals first (via a small
 * state machine) so that the *word* "fetch" inside documentation comments (the
 * facade's docblocks talk about "a bare `fetch`") or inside identifiers/strings
 * never produces a false positive; only a genuine `fetch(` *call* in live code
 * is flagged. Test files and test helpers are excluded because their injected
 * `fetch` fakes are the test transport, not production behaviour.
 *
 * Requirements: 12.1, 12.3, 12.5
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The auth feature root is the parent of this `api/` directory.
const apiDir = dirname(fileURLToPath(import.meta.url));
const featureRoot = join(apiDir, '..');

/** True for a test file or a test helper (excluded from the production scan). */
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
 * Remove line and block comments and single/double/template string contents from
 * TypeScript source, replacing each with whitespace so line structure and any
 * live code are preserved. Template *expressions* (`${ ... }`) are kept as live
 * code so a call hidden inside an interpolation is still visible to the scan.
 */
function stripCommentsAndStrings(source: string): string {
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

    // Single- or double-quoted string: drop its contents.
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

    // Template literal: drop the literal text but keep `${ ... }` expressions.
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

// Patterns for bare transports that would bypass the generated client.
// `\bfetch\s*\(` also matches `window.fetch(` / `globalThis.fetch(` (the `.` is
// a word boundary), which are equally "direct" and must be caught.
const DIRECT_TRANSPORT_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'fetch(', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'navigator.sendBeacon', pattern: /\bsendBeacon\s*\(/ },
  { label: 'new WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  { label: 'axios', pattern: /\baxios\b/ },
];

const productionFiles = collectProductionSources(featureRoot);

/** Human-readable path relative to the feature root for assertion messages. */
function rel(path: string): string {
  return relative(featureRoot, path).replace(/\\/g, '/');
}

describe('auth feature production source (structural scan)', () => {
  it('discovers the production source files under the feature root', () => {
    // Sanity guard: if the scan finds nothing the invariant below is vacuous.
    expect(productionFiles.length).toBeGreaterThan(0);
    const names = productionFiles.map(rel);
    expect(names).toContain('api/authApi.ts');
    expect(names).toContain('api/authMiddleware.ts');
    // Test files must not have leaked into the production set.
    expect(names.some((name) => isTestFile(name))).toBe(false);
  });

  it('contains no direct fetch call (Requirement 12.1, 12.3)', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      if (/\bfetch\s*\(/.test(code)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no other bare transport that bypasses the client (Requirement 12.1)', () => {
    const offenders: Array<{ file: string; transport: string }> = [];
    for (const file of productionFiles) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const { label, pattern } of DIRECT_TRANSPORT_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ file: rel(file), transport: label });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('auth backend calls route through the generated client facade', () => {
  it('the auth API facade imports and calls the generated @pitchmate/api-client (Requirement 12.1)', () => {
    const source = readFileSync(join(apiDir, 'authApi.ts'), 'utf8');
    // Routed through the generated package, not a hand-rolled transport.
    expect(source).toMatch(/from '@pitchmate\/api-client'/);
    // Every call is issued through the client object obtained from it.
    const code = stripCommentsAndStrings(source);
    expect(code).toMatch(/createApiClient\s*\(/);
    expect(code).toMatch(/client\.POST\s*\(/);
  });

  it('the authenticated client is built on the generated client (Requirement 12.1)', () => {
    const source = readFileSync(join(apiDir, 'authMiddleware.ts'), 'utf8');
    expect(source).toMatch(/from '@pitchmate\/api-client'/);
    const code = stripCommentsAndStrings(source);
    expect(code).toMatch(/createApiClient\s*\(/);
  });
});
