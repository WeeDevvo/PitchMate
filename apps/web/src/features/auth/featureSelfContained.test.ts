/**
 * Structural test: the auth feature is a self-contained module (task 20.2).
 *
 * Requirement 1.8 says the Auth_Web SHALL define all authentication screens as a
 * self-contained feature module under the directory `apps/web/src/features/auth/`.
 * "Self-contained" is enforced here as two source-level invariants rather than an
 * example:
 *
 *   1. Containment — the auth feature root really is `apps/web/src/features/auth/`
 *      and every authentication screen (the five screens, the not-found fallback,
 *      and the route table) lives inside that root, exported through the public
 *      `index.ts` barrel.
 *
 *   2. Encapsulation — no source file *outside* the feature root reaches into the
 *      feature's internal modules. Anything consuming the auth feature must import
 *      from the feature's public barrel (`features/auth` or `features/auth/index`),
 *      never a deep path such as `features/auth/lib/...` or `features/auth/session/...`.
 *      This keeps the module's surface at the barrel and stops implementation files
 *      leaking out into the rest of the app.
 *
 * The encapsulation scan strips comments first (via a small state machine) so a
 * path mentioned in documentation never produces a false positive; only genuine
 * `import`/`export ... from`/dynamic-`import()`/`require()` specifiers in live code
 * are classified. Relative specifiers are resolved against the importing file so a
 * `../auth/lib/theme` from a sibling feature is correctly recognised as reaching in.
 *
 * Requirements: 1.8
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// This test file lives at the auth feature root.
const featureRoot = dirname(fileURLToPath(import.meta.url))
// The web app source root is two levels up (`src/features/auth` -> `src`).
const srcRoot = resolve(featureRoot, '..', '..')

/** Normalise an absolute path to forward slashes for stable comparisons. */
function norm(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Human-readable path relative to the src root for assertion messages. */
function relToSrc(path: string): string {
  return relative(srcRoot, path).replace(/\\/g, '/')
}

/** True for a TypeScript source file (`.ts`/`.tsx`). */
function isTypeScriptSource(fileName: string): boolean {
  return /\.tsx?$/.test(fileName)
}

/** Recursively collect the `.ts`/`.tsx` files under `dir`. */
function collectSources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Never descend into build output.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      found.push(...collectSources(full))
      continue
    }
    if (entry.isFile() && isTypeScriptSource(entry.name)) {
      found.push(full)
    }
  }
  return found
}

/** True when `child` is the feature root itself or nested beneath it. */
function isWithinFeature(child: string): boolean {
  const root = norm(featureRoot)
  const c = norm(child)
  return c === root || c.startsWith(`${root}/`)
}

/**
 * Remove `//` and block comments from TypeScript source, replacing each with a
 * space so line structure and any string literals (which carry the import
 * specifiers we care about) are preserved.
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    // Line comment.
    if (c === '/' && next === '/') {
      i += 2
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    // Block comment.
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      out += ' '
      continue
    }
    // Preserve string / template literals verbatim (they hold specifiers).
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out += c
      i += 1
      while (i < n) {
        out += source[i]
        if (source[i] === '\\') {
          if (i + 1 < n) out += source[i + 1]
          i += 2
          continue
        }
        if (source[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    out += c
    i += 1
  }
  return out
}

/** All module specifiers referenced by `import`/`export ... from`/`import()`/`require()`. */
function importSpecifiers(source: string): string[] {
  const code = stripComments(source)
  const specifiers: string[] = []
  const patterns = [
    // import ... from '...'   and   export ... from '...'
    /\bfrom\s*['"]([^'"]+)['"]/g,
    // bare side-effect import '...'
    /\bimport\s+['"]([^'"]+)['"]/g,
    // dynamic import('...')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // require('...')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(code)) !== null) {
      specifiers.push(match[1])
    }
  }
  return specifiers
}

/**
 * Resolve a specifier to an absolute path *iff* it points into the auth feature,
 * returning `null` otherwise. Handles both relative specifiers (resolved against
 * the importing file's directory) and any specifier containing `features/auth`.
 */
function resolveAuthTarget(specifier: string, importingFile: string): string | null {
  let absolute: string
  if (specifier.startsWith('.')) {
    absolute = resolve(dirname(importingFile), specifier)
  } else if (norm(specifier).includes('features/auth')) {
    // A workspace/alias style path — anchor it under src for comparison.
    const idx = norm(specifier).indexOf('features/auth')
    absolute = resolve(srcRoot, norm(specifier).slice(idx))
  } else {
    return null
  }
  return isWithinFeature(absolute) ? norm(absolute) : null
}

/** True when the resolved auth target is the public barrel (root or `/index`). */
function targetsBarrel(resolvedTarget: string): boolean {
  const root = norm(featureRoot)
  return (
    resolvedTarget === root ||
    resolvedTarget === `${root}/index` ||
    resolvedTarget === `${root}/index.ts` ||
    resolvedTarget === `${root}/index.tsx`
  )
}

describe('auth feature location and containment (Requirement 1.8)', () => {
  it('is rooted at apps/web/src/features/auth', () => {
    expect(norm(featureRoot).endsWith('apps/web/src/features/auth')).toBe(true)
  })

  it('exposes a public barrel at the feature root', () => {
    const barrel = readFileSync(join(featureRoot, 'index.ts'), 'utf8')
    expect(barrel.length).toBeGreaterThan(0)
  })

  it('houses every authentication screen inside the feature root', () => {
    // Each authentication surface named by the design must live under the root
    // and be re-exported from the barrel, so the feature is complete in one place.
    const screenFiles = [
      'SignUpScreen.tsx',
      'LogInScreen.tsx',
      'ResetRequestScreen.tsx',
      'ResetConfirmScreen.tsx',
      'VerifyEmailScreen.tsx',
      'AuthNotFound.tsx',
      'authRoutes.tsx',
    ]
    const featureSources = new Set(
      collectSources(featureRoot).map((f) => norm(f)),
    )
    for (const file of screenFiles) {
      expect(featureSources.has(norm(join(featureRoot, file)))).toBe(true)
    }

    const barrel = readFileSync(join(featureRoot, 'index.ts'), 'utf8')
    for (const exported of [
      'SignUpScreen',
      'LogInScreen',
      'ResetRequestScreen',
      'ResetConfirmScreen',
      'VerifyEmailScreen',
      'AuthNotFound',
      'createAuthRoutes',
    ]) {
      expect(barrel).toContain(exported)
    }
  })
})

describe('auth feature encapsulation — external code imports only the barrel (Requirement 1.8)', () => {
  const allSources = collectSources(srcRoot)
  const externalSources = allSources.filter((f) => !isWithinFeature(f))

  it('discovers web source files outside the auth feature to scan', () => {
    // Sanity guard: if this were empty the invariant below would be vacuous.
    expect(externalSources.length).toBeGreaterThan(0)
  })

  it('never reaches into an internal auth module from outside the feature', () => {
    const offenders: Array<{ file: string; specifier: string }> = []
    for (const file of externalSources) {
      const source = readFileSync(file, 'utf8')
      for (const specifier of importSpecifiers(source)) {
        const target = resolveAuthTarget(specifier, file)
        if (target !== null && !targetsBarrel(target)) {
          offenders.push({ file: relToSrc(file), specifier })
        }
      }
    }
    // Any offender means an outside file imports an auth implementation module
    // directly instead of going through `features/auth` (the public barrel).
    expect(offenders).toEqual([])
  })
})
