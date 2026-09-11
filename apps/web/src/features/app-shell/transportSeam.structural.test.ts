/**
 * Structural source scan for the transport seam, the session boundary, and
 * token usage (task 16.3).
 *
 * Requirement 15.8 makes these checks part of the product rather than a
 * discretionary test: the rules they enforce are about the *shape of the source
 * tree*, so review is the only other enforcement mechanism and review forgets.
 * The scan follows the pattern the auth feature already established in
 * `features/auth/api/clientConsumption.test.ts` and
 * `features/auth/lib/frameworkFree.structural.test.ts` — read the production
 * source, strip what is not live code, match, and name the offending file.
 *
 * What is enforced, and why each rule needs a source scan rather than a test
 * that exercises behaviour:
 *
 * | Rule | Requirement |
 * |---|---|
 * | Only `api/notificationsApi.ts` performs transport | 11.3 |
 * | No Api_Client construction in the shell; the injected client is used | 11.1 |
 * | Request path, method, and query types come from the generated contract | 11.2 |
 * | No token, refresh, expiry, or session-storage identifier in the shell | 9.2, 15.2 |
 * | No shell-local `'/login'` or Redirect_Capture parameter-name literal | 2.6 |
 * | Exactly one Appearance_Preference storage key and one pre-paint bootstrap, with all three features importing the shared theme module | 12.13, 15.7 |
 * | No hex colour literal in shell source outside the token table | 12.8 |
 *
 * ### Scanning technique
 *
 * Two strippers run over each TypeScript file before matching, for the same
 * reason the auth scans use two:
 *
 * - **Comments only** (`stripComments`) — keeps string literals, because import
 *   specifiers and route-path literals *are* string literals. Used for the
 *   import, endpoint-path, `'/login'`, and storage-key checks.
 * - **Comments and string contents** (`stripCommentsAndStrings`) — leaves only
 *   live non-string code. Used for the identifier checks, because these modules'
 *   docblocks talk at length about the very things they must not do ("this
 *   module holds no token, expiry, or session logic of its own"), and a scan
 *   that matched prose would flag the documentation promising compliance.
 *
 * CSS is stripped of `/* … *\/` comments for the same reason: the shell's token
 * table documents its computed contrast ratios in hex.
 *
 * ### Scope notes
 *
 * The transport, client-construction, request-shape, session-identifier,
 * `'/login'`, and hex-colour rules are scoped to `features/app-shell/`: each
 * cites a requirement about the App_Shell. The theme rules are scoped to the
 * whole of `apps/web/src` (plus `index.html` and `vite.config.ts`), because
 * "exactly one storage key and one bootstrap" is a statement about the *web
 * application*, which is what makes it checkable at all.
 *
 * The hex-colour rule is deliberately not extended across `apps/web/src`. The
 * auth and landing token tables declare the same brand hex values by design, and
 * `src/theme/themeResolution.ts` declares Pitch Green and Green Dark as
 * constants because Requirement 12.11 names those two literals. A whole-source
 * hex ban would either contradict 12.11 or degrade into an allowlist of every
 * stylesheet, which enforces nothing. Requirement 12.8 is a statement about the
 * Shell_Frame, and that is the scope asserted here.
 *
 * Requirements: 2.6, 9.2, 11.1, 11.2, 11.3, 12.8, 12.13, 15.2, 15.7, 15.8
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// This test lives at the root of the feature it guards.
const shellRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(shellRoot, '..', '..');
const webRoot = join(srcRoot, '..');

const themeRoot = join(srcRoot, 'theme');
const authRoot = join(srcRoot, 'features', 'auth');
const landingRoot = join(srcRoot, 'features', 'landing');

/** The one module permitted to touch transport, relative to the shell root. */
const TRANSPORT_MODULE = 'api/notificationsApi.ts';

/** The shell's per-Theme token table — the one place hex literals may appear. */
const TOKEN_TABLE = 'styles/theme.css';

// --- File discovery ---------------------------------------------------------

/** True for a test file (excluded from every production scan). */
function isTestFile(fileName: string): boolean {
  return (
    /\.test\.tsx?$/.test(fileName) ||
    /\.pbt\.test\.tsx?$/.test(fileName) ||
    /\.property\.test\.tsx?$/.test(fileName) ||
    /\.a11y\.test\.tsx?$/.test(fileName) ||
    /\.spec\.tsx?$/.test(fileName)
  );
}

/** Recursively collect the production files under `dir` matching `extensions`. */
function collectProductionSources(
  dir: string,
  extensions: readonly string[] = ['.ts', '.tsx'],
): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectProductionSources(full, extensions));
      continue;
    }
    if (!entry.isFile() || isTestFile(entry.name)) {
      continue;
    }
    if (!extensions.some((extension) => entry.name.endsWith(extension))) {
      continue;
    }
    found.push(full);
  }
  return found;
}

/** Human-readable path relative to `root`, with forward slashes. */
function rel(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}

// --- Strippers --------------------------------------------------------------

/**
 * Remove `//` and block comments from TypeScript source, replacing each with
 * whitespace so line structure and all live code — including string literals,
 * which carry import specifiers and route paths — are preserved.
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
      continue;
    }

    // Quoted string: preserved verbatim.
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
 * non-string code. Template *expressions* (`${ … }`) are kept so an identifier
 * hidden inside an interpolation is still visible to the scan.
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

/** Remove `/* … *\/` comments from CSS, preserving declarations. */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Collect every import/require specifier of a TypeScript module. */
function importSpecifiers(source: string): string[] {
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

// --- The scanned sets -------------------------------------------------------

const shellSources = collectProductionSources(shellRoot);
const shellStyles = collectProductionSources(shellRoot, ['.css']);
const srcSources = collectProductionSources(srcRoot);

/** The shell's production TypeScript, excluding the one transport module. */
const shellSourcesOutsideTransport = shellSources.filter(
  (file) => rel(shellRoot, file) !== TRANSPORT_MODULE,
);

const transportModulePath = join(shellRoot, 'api', 'notificationsApi.ts');

/** Read a file and drop its comments (string literals preserved). */
function liveCodeWithStrings(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/** Read a file and drop its comments and string contents. */
function liveCodeOnly(file: string): string {
  return stripCommentsAndStrings(readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// The scanned set is discovered, not listed. If discovery breaks, every
// invariant below becomes vacuously true — so it is asserted first.
// ---------------------------------------------------------------------------

describe('the scan covers the shell and the shared theme module', () => {
  it('discovers the shell production source, the transport module included', () => {
    const names = shellSources.map((file) => rel(shellRoot, file));
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain(TRANSPORT_MODULE);
    expect(names).toContain('shellRoutes.tsx');
    expect(names).toContain('RouteGuard.tsx');
    expect(names).toContain('components/ShellThemeProvider.tsx');
    // No test file may leak into a production scan.
    expect(names.filter((name) => isTestFile(name))).toEqual([]);
  });

  it('discovers the shell stylesheets, the token table included', () => {
    const names = shellStyles.map((file) => rel(shellRoot, file));
    expect(names).toContain(TOKEN_TABLE);
    expect(names).toContain('styles/shell.css');
  });

  it('discovers the shared theme module and the other two features', () => {
    const names = srcSources.map((file) => rel(srcRoot, file));
    expect(names).toContain('theme/themeResolution.ts');
    expect(names).toContain('theme/appearancePreference.ts');
    expect(names).toContain('theme/themeBootstrap.ts');
    expect(names).toContain('features/auth/lib/theme.ts');
    expect(names).toContain('features/landing/lib/theme.ts');
  });
});

// ---------------------------------------------------------------------------
// Requirement 11.3 — one transport seam.
// ---------------------------------------------------------------------------

/**
 * Bare transports that would bypass the generated client entirely.
 * `\bfetch\s*\(` also catches `window.fetch(` and `globalThis.fetch(`, since a
 * `.` is a word boundary.
 */
const BARE_TRANSPORT_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'fetch(', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'sendBeacon(', pattern: /\bsendBeacon\s*\(/ },
  { label: 'new WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  { label: 'new EventSource', pattern: /\bnew\s+EventSource\b/ },
  { label: 'axios', pattern: /\baxios\b/ },
];

describe('only the Notifications_Api facade performs transport (Requirement 11.3)', () => {
  it('no shell module makes a bare network call, the facade included', () => {
    const offenders: Array<{ file: string; transport: string }> = [];
    for (const file of shellSources) {
      const code = liveCodeOnly(file);
      for (const { label, pattern } of BARE_TRANSPORT_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ file: rel(shellRoot, file), transport: label });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell module outside the facade calls an Api_Client method', () => {
    // `client.GET(…)` / `client.POST(…)` and friends: the generated client's
    // whole surface. Anywhere but the facade this is transport leaking upwards.
    const clientMethodCall = /\.\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/;
    const offenders: string[] = [];
    for (const file of shellSourcesOutsideTransport) {
      if (clientMethodCall.test(liveCodeOnly(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell module outside the facade names a notification endpoint path', () => {
    // A path literal outside the facade means a second module knows the wire
    // contract, which is the thing the single seam exists to prevent.
    const endpointLiteral = /(['"`])\/notifications(?:[/?#]|\1)/;
    const offenders: string[] = [];
    for (const file of shellSourcesOutsideTransport) {
      if (endpointLiteral.test(liveCodeWithStrings(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the facade routes every call through the generated client', () => {
    const code = liveCodeOnly(transportModulePath);
    expect(liveCodeWithStrings(transportModulePath)).toMatch(
      /from '@pitchmate\/api-client'/,
    );
    expect(code).toMatch(/client\.GET\s*\(/);
    expect(code).toMatch(/client\.POST\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Requirement 11.1 — the client is injected, never constructed.
// ---------------------------------------------------------------------------

const CLIENT_CONSTRUCTION_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'createApiClient(', pattern: /\bcreateApiClient\s*\(/ },
  {
    label: 'createAuthenticatedApiClient(',
    pattern: /\bcreateAuthenticatedApiClient\s*\(/,
  },
  { label: 'createClient(', pattern: /\bcreateClient\s*\(/ },
  { label: 'createFetchClient(', pattern: /\bcreateFetchClient\s*\(/ },
];

describe('the shell constructs no Api_Client of its own (Requirement 11.1)', () => {
  it('no shell module calls an Api_Client factory', () => {
    const offenders: Array<{ file: string; factory: string }> = [];
    for (const file of shellSources) {
      const code = liveCodeOnly(file);
      for (const { label, pattern } of CLIENT_CONSTRUCTION_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ file: rel(shellRoot, file), factory: label });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every shell import of the generated package is type-only', () => {
    // A value import of `@pitchmate/api-client` is the only way to construct a
    // client; keeping every import type-only makes construction impossible.
    const valueImport =
      /^\s*import\s+(?!type\b)[^;]*?from\s*['"]@pitchmate\/api-client['"]/m;
    const offenders: string[] = [];
    for (const file of shellSources) {
      if (valueImport.test(liveCodeWithStrings(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the facade receives the client as a parameter', () => {
    const code = liveCodeOnly(transportModulePath);
    expect(code).toMatch(
      /function\s+createNotificationsApi\s*\(\s*client\s*:\s*PitchMateApiClient/,
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 11.2 — request shapes come from the generated contract.
// ---------------------------------------------------------------------------

describe('request shapes derive from the generated contract (Requirement 11.2)', () => {
  const facadeCode = liveCodeWithStrings(transportModulePath);

  it('the facade derives its query and path types from `operations`', () => {
    expect(facadeCode).toMatch(/import\s+type\s*\{[^}]*\boperations\b/);
    for (const operation of [
      'ListNotifications',
      'GetUnreadNotificationCount',
      'MarkAllNotificationsRead',
    ]) {
      expect(facadeCode).toContain(
        `operations['${operation}']['parameters']['query']`,
      );
    }
    expect(facadeCode).toContain(
      "operations['MarkNotificationRead']['parameters']['path']",
    );
  });

  it('the facade hand-writes no primitive type for an identity the contract types', () => {
    // `squadId` and `notificationId` must be `ListQuery['squadId']` and
    // `MarkReadPath['notificationId']`, not a re-declared `string`.
    const handWritten = /\b(?:squadId|notificationId)\s*\??\s*:\s*(?:string|number)\b/;
    const offenders: string[] = [];
    for (const file of collectProductionSources(join(shellRoot, 'api'))) {
      if (handWritten.test(liveCodeOnly(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell module declares a wire-shape type of its own', () => {
    // A `…Dto`, `…Payload`, `…RequestBody`, or `…ResponseBody` declaration is a
    // hand-written duplicate of something the generated contract already says.
    const wireShapeDeclaration =
      /\b(?:type|interface)\s+(\w*(?:Dto|Payload|RequestBody|ResponseBody|ApiRequest|ApiResponse))\b/;
    const offenders: Array<{ file: string; declaration: string }> = [];
    for (const file of shellSources) {
      const match = wireShapeDeclaration.exec(liveCodeOnly(file));
      if (match !== null) {
        offenders.push({ file: rel(shellRoot, file), declaration: match[1] });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell module writes an HTTP method as a literal', () => {
    // The generated client's methods carry the verb; a `'POST'` literal in the
    // shell means someone is describing a request the generated types describe.
    const methodLiteral = /(['"`])(?:GET|POST|PUT|PATCH|DELETE|HEAD)\1/;
    const offenders: string[] = [];
    for (const file of shellSources) {
      if (methodLiteral.test(liveCodeWithStrings(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Requirements 9.2, 15.2 — no session or token logic in the shell.
// ---------------------------------------------------------------------------

/**
 * Identifiers that would mean the shell is reading, renewing, evaluating, or
 * persisting a session itself rather than delegating to the Auth_Feature.
 *
 * The list is of *identifiers*, matched against fully stripped code. It
 * deliberately does not ban the words "session", "token", or "refresh" outright:
 * the shell legitimately renders a `SessionEndedNotice`, selects a green
 * *token* from surface luminance, and queues a count *refresh* — none of which
 * is session logic. What is banned is the vocabulary of holding a credential.
 */
const SESSION_LOGIC_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: 'access token identifier', pattern: /\baccess_?[Tt]oken\b/ },
  { label: 'refresh token identifier', pattern: /\brefresh_?[Tt]oken\b/ },
  { label: 'id token identifier', pattern: /\bid_?[Tt]oken\b/ },
  { label: 'bearer token identifier', pattern: /\bbearer[_A-Za-z]*\b/i },
  { label: 'Authorization header', pattern: /\bauthorization\b/i },
  { label: 'token expiry evaluation', pattern: /\bexpires(?:At|In)[A-Za-z]*\b/ },
  { label: 'token expiry evaluation', pattern: /\b[A-Za-z]*[Ee]xpiry\b/ },
  // Substring rather than whole-word: `decodeJwt` and `jwtPayload` are exactly
  // the shapes this rule is about, and neither carries a word boundary at "jwt".
  { label: 'JWT handling', pattern: /jwt/i },
  { label: 'base64 token decoding', pattern: /\b(?:atob|btoa)\s*\(/ },
  { label: 'browser storage access', pattern: /\b(?:localStorage|sessionStorage)\b/ },
  { label: 'cookie access', pattern: /\bcookie\b/i },
  { label: 'session manager or store', pattern: /\bSession(?:Manager|Store)\b/ },
  { label: 'refresh scheduling', pattern: /\b(?:scheduleRefresh|refreshSession)\b/ },
  {
    label: 'token retrieval hook',
    pattern: /\bgetAccessTokenForRequest\b/,
  },
];

describe('the shell holds no session, token, or storage logic (Requirements 9.2, 15.2)', () => {
  it('no shell module references a credential or session-persistence identifier', () => {
    const offenders: Array<{ file: string; identifier: string }> = [];
    for (const file of shellSources) {
      const code = liveCodeOnly(file);
      for (const { label, pattern } of SESSION_LOGIC_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push({ file: rel(shellRoot, file), identifier: label });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shell reaches storage only through the shared appearance store', () => {
    // The one value the shell persists is the Appearance_Preference, and it does
    // that through `src/theme`'s store rather than a storage global of its own.
    const provider = join(shellRoot, 'components', 'ShellThemeProvider.tsx');
    expect(importSpecifiers(readFileSync(provider, 'utf8'))).toContain(
      '../../../theme',
    );
    const code = liveCodeOnly(provider);
    expect(code).toMatch(/\breadAppearancePreference\s*\(/);
    expect(code).toMatch(/\bwriteAppearancePreference\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Requirement 2.6 — the Log_In_Route and Redirect_Capture name come from auth.
// ---------------------------------------------------------------------------

describe('Redirect_Capture holds no shell-local copies (Requirement 2.6)', () => {
  it('no shell module writes the Log_In_Route path as a literal', () => {
    const loginLiteral = /(['"`])\/login(?![A-Za-z0-9-])/;
    const offenders: string[] = [];
    for (const file of shellSources) {
      if (loginLiteral.test(liveCodeWithStrings(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell module writes the Redirect_Capture parameter name as a literal', () => {
    const redirectLiteral = /(['"`])redirect(?:_?[Tt]o|_?[Uu]ri|_?[Uu]rl)?\1/;
    const offenders: string[] = [];
    for (const file of shellSources) {
      if (redirectLiteral.test(liveCodeWithStrings(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Route_Guard takes both values from the Auth_Feature barrel', () => {
    const guard = join(shellRoot, 'RouteGuard.tsx');
    const code = liveCodeWithStrings(guard);
    expect(code).toMatch(
      /import\s*\{[^}]*\bLOG_IN_ROUTE\b[^}]*\}\s*from\s*['"]\.\.\/auth['"]/s,
    );
    expect(code).toMatch(
      /import\s*\{[^}]*\bREDIRECT_PARAM_NAME\b[^}]*\}\s*from\s*['"]\.\.\/auth['"]/s,
    );
  });

  it('the pure Redirect_Capture takes the route and parameter name as arguments', () => {
    const capture = join(shellRoot, 'lib', 'redirectCapture.ts');
    expect(liveCodeOnly(capture)).toMatch(
      /function\s+loginRedirectTarget\s*\([^)]*\bloginRoute\b[^)]*\bparamName\b/s,
    );
  });
});

// ---------------------------------------------------------------------------
// Requirements 12.13, 15.7 — one storage key, one bootstrap, one shared module.
// ---------------------------------------------------------------------------

/** Files declaring `name` as a `const`, across the whole of `src`. */
function declarationsOf(name: string): string[] {
  const pattern = new RegExp(`\\bconst\\s+${name}\\b\\s*(?::[^=]*)?=`);
  return srcSources
    .filter((file) => pattern.test(liveCodeWithStrings(file)))
    .map((file) => rel(srcRoot, file));
}

/** Files declaring `name` as a function, across the whole of `src`. */
function functionDeclarationsOf(name: string): string[] {
  const pattern = new RegExp(`\\bfunction\\s+${name}\\s*[(<]`);
  return srcSources
    .filter((file) => pattern.test(liveCodeWithStrings(file)))
    .map((file) => rel(srcRoot, file));
}

describe('exactly one Appearance_Preference storage key exists (Requirements 12.5, 15.7)', () => {
  it('the key literal is written in one module only', () => {
    const declaring = srcSources
      .filter((file) => liveCodeWithStrings(file).includes("'pitchmate.appearance'"))
      .map((file) => rel(srcRoot, file));
    expect(declaring).toEqual(['theme/appearancePreference.ts']);
  });

  it('the key constant is declared once, in the shared theme module', () => {
    expect(declarationsOf('APPEARANCE_STORAGE_KEY')).toEqual([
      'theme/appearancePreference.ts',
    ]);
  });

  it('the read and write of the preference are declared once each', () => {
    expect(functionDeclarationsOf('readAppearancePreference')).toEqual([
      'theme/appearancePreference.ts',
    ]);
    expect(functionDeclarationsOf('writeAppearancePreference')).toEqual([
      'theme/appearancePreference.ts',
    ]);
  });
});

describe('exactly one pre-paint theme bootstrap exists (Requirement 12.13)', () => {
  it('the bootstrap source is declared once, in the shared theme module', () => {
    expect(declarationsOf('THEME_BOOTSTRAP_SOURCE')).toEqual([
      'theme/themeBootstrap.ts',
    ]);
  });

  it('the Theme resolution is declared once, in the shared theme module', () => {
    expect(functionDeclarationsOf('resolveTheme')).toEqual([
      'theme/themeResolution.ts',
    ]);
    expect(functionDeclarationsOf('interpretStoredPreference')).toEqual([
      'theme/themeResolution.ts',
    ]);
    expect(functionDeclarationsOf('greenTokenForSurface')).toEqual([
      'theme/themeResolution.ts',
    ]);
  });

  it('index.html carries no hand-written bootstrap script', () => {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
    // Every `<script>` in the document must load a file; an inline script would
    // be a second bootstrap declaration.
    const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];
    const inline = scriptTags.filter((tag) => !/\bsrc\s*=/.test(tag));
    expect(inline).toEqual([]);
  });

  it('the build injects the one declared bootstrap into the document head', () => {
    const config = liveCodeWithStrings(join(webRoot, 'vite.config.ts'));
    expect(config).toMatch(
      /import\s*\{[^}]*\bTHEME_BOOTSTRAP_SOURCE\b[^}]*\}\s*from\s*['"]\.\/src\/theme\/themeBootstrap['"]/s,
    );
    expect(config).toMatch(/\btransformIndexHtml\b/);
    expect(config).toMatch(/children:\s*THEME_BOOTSTRAP_SOURCE/);
  });
});

describe('all three features import the shared theme module (Requirement 15.7)', () => {
  const SHARED_THEME_SPECIFIER = /^(?:\.\.\/)+theme(?:\/|$)/;

  const features: ReadonlyArray<{ readonly label: string; readonly root: string }> = [
    { label: 'app-shell', root: shellRoot },
    { label: 'auth', root: authRoot },
    { label: 'landing', root: landingRoot },
  ];

  it('each feature imports it, and none re-implements it', () => {
    for (const { label, root } of features) {
      const files = collectProductionSources(root);
      const importers = files.filter((file) =>
        importSpecifiers(readFileSync(file, 'utf8')).some((specifier) =>
          SHARED_THEME_SPECIFIER.test(specifier),
        ),
      );
      expect(
        importers.map((file) => rel(root, file)),
        `${label} must import the shared theme module`,
      ).not.toEqual([]);
    }
  });

  it('the shared theme module lives outside all three features', () => {
    const themeFiles = collectProductionSources(themeRoot).map((file) =>
      rel(srcRoot, file),
    );
    expect(themeFiles.length).toBeGreaterThan(0);
    for (const file of themeFiles) {
      expect(file.startsWith('features/')).toBe(false);
    }
  });

  it('the shared theme module imports no feature module', () => {
    // The dependency runs one way: features depend on the theme module, never
    // the reverse, or "one shared module" would be a cycle rather than a floor.
    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const file of collectProductionSources(themeRoot)) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (/features\//.test(specifier)) {
          offenders.push({ file: rel(srcRoot, file), specifier });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Requirement 12.8 — colour comes from the token table, not from components.
// ---------------------------------------------------------------------------

/** `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`. */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

describe('the shell declares colour only in its token table (Requirement 12.8)', () => {
  it('the token table is where the hex values live', () => {
    // Guards the exclusion below: if the table held no hex, excluding it would
    // be hiding nothing and the scan would prove nothing.
    const table = stripCssComments(
      readFileSync(join(shellRoot, TOKEN_TABLE), 'utf8'),
    );
    expect(HEX_COLOUR.test(table)).toBe(true);
  });

  it('no shell stylesheet outside the token table writes a hex colour', () => {
    const offenders: string[] = [];
    for (const file of shellStyles) {
      const name = rel(shellRoot, file);
      if (name === TOKEN_TABLE) {
        continue;
      }
      if (HEX_COLOUR.test(stripCssComments(readFileSync(file, 'utf8')))) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell component writes a hex colour', () => {
    const offenders: string[] = [];
    for (const file of shellSources) {
      if (HEX_COLOUR.test(liveCodeWithStrings(file))) {
        offenders.push(rel(shellRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
