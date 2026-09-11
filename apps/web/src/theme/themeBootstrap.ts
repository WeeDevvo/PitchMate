/**
 * The one pre-paint theme bootstrap for the whole web application.
 *
 * Requirement 12.13 asks that the resolved Theme reach the document *before the
 * document's first paint* and before any component renders, for a stored
 * Appearance_Preference of `system`, `dark`, `light`, an absent value, or an
 * unreadable one. Only a synchronous, inline, non-module `<script>` in `<head>`
 * can do that — a module script is deferred past first paint, and a React
 * effect runs far too late.
 *
 * So the bootstrap body cannot be ordinary application code; it has to be a
 * source string. Declaring that string here once, and injecting it into
 * `index.html` from a `transformIndexHtml` hook in `vite.config.ts`, keeps a
 * single bootstrap declaration in the application (Requirements 12.13, 15.7):
 * there is no hand-written copy in `index.html` to drift from this one, the
 * storage key is interpolated from {@link APPEARANCE_STORAGE_KEY} rather than
 * spelled a second time, and — because the string is a module export — a test
 * can evaluate it in jsdom for every stored value and assert it agrees with the
 * pure `resolveTheme` in `./themeResolution`.
 *
 * {@link applyThemeAttribute} is the runtime half of the same rule: the Theme
 * lands on the document element under one attribute name, written in one place,
 * so the pre-paint script and the Theme_Provider cannot disagree about where
 * the Theme lives.
 */

import { APPEARANCE_STORAGE_KEY } from './appearancePreference';
import { type Theme } from './themeResolution';

/**
 * The document-element attribute carrying the resolved Theme.
 *
 * The CSS token tables key off it (`:root, [data-theme='dark']` and
 * `[data-theme='light']`), so this name is the contract between the bootstrap,
 * the Theme_Provider, and the stylesheets.
 */
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * The media query expressing an *explicit* light browser appearance preference.
 *
 * Dark-mode-first: only this query matching can pull the resolved Theme away
 * from dark, which is why the light query is consulted rather than the dark one
 * (a browser with no preference matches neither).
 */
export const LIGHT_APPEARANCE_QUERY = '(prefers-color-scheme: light)';

/**
 * The slice of an element this module needs to record the Theme.
 *
 * Narrowing to `setAttribute` keeps the module free of DOM types — it is
 * imported by `vite.config.ts`, which is type-checked without the DOM library —
 * and lets a test pass a plain object.
 */
export interface ThemeAttributeTarget {
  setAttribute(name: string, value: string): void;
}

/**
 * Resolve the ambient document element, or `null` when there is none.
 *
 * Reached without DOM types and defensively: the module is loaded in the Vite
 * config (Node, no `document`) as well as in the browser, and a caller may run
 * before the document exists.
 */
function ambientDocumentElement(): ThemeAttributeTarget | null {
  try {
    const root = (
      globalThis as { document?: { documentElement?: unknown } | null }
    ).document?.documentElement;

    if (root === null || root === undefined) {
      return null;
    }

    return typeof (root as { setAttribute?: unknown }).setAttribute ===
      'function'
      ? (root as ThemeAttributeTarget)
      : null;
  } catch {
    return null;
  }
}

/**
 * Record the resolved Theme on the document element under
 * {@link THEME_ATTRIBUTE}.
 *
 * Never throws. The return value reports whether the attribute was written:
 * `false` means there was no element to write to or the write was rejected,
 * which leaves whatever the pre-paint bootstrap already applied in place rather
 * than surfacing an error.
 *
 * @param theme - The resolved Theme.
 * @param target - Element to write to. Omit to use the ambient document
 *   element; pass `null` to model there being none.
 * @returns `true` iff the attribute was written.
 *
 * Requirements: 12.13, 15.7
 */
export function applyThemeAttribute(
  theme: Theme,
  target?: ThemeAttributeTarget | null,
): boolean {
  const element = target === undefined ? ambientDocumentElement() : target;
  if (element === null) {
    return false;
  }

  try {
    element.setAttribute(THEME_ATTRIBUTE, theme);
    return true;
  } catch {
    return false;
  }
}

/**
 * The pre-paint theme bootstrap, as plain JavaScript source.
 *
 * Injected verbatim as an inline, non-module `<script>` in `<head>` by the
 * `transformIndexHtml` hook in `vite.config.ts`. It must stay ES5-plain and
 * dependency-free: it runs before any bundle, so it cannot import anything, and
 * it must not be transformed or deferred.
 *
 * Its decision is the same one `resolveTheme` makes, over the same two
 * inputs — the stored Appearance_Preference and an explicit light browser
 * preference — so no paint can carry a Theme other than the resolved one
 * (Requirement 12.13):
 *
 * - a stored `dark` resolves to dark, a stored `light` to light;
 * - a stored `system`, an absent value, an unrecognised value, and an
 *   unreadable store all defer to the browser, which yields light only on an
 *   explicit light preference and dark otherwise.
 *
 * Both the storage read and the media query are wrapped in `try/catch` because
 * either can throw in a privacy mode or a locked-down embed, and a bootstrap
 * that throws would leave the document with no Theme at all.
 *
 * Requirements: 12.13, 15.7
 */
export const THEME_BOOTSTRAP_SOURCE = `(function () {
  var STORAGE_KEY = ${JSON.stringify(APPEARANCE_STORAGE_KEY)};
  var THEME_ATTRIBUTE = ${JSON.stringify(THEME_ATTRIBUTE)};
  var LIGHT_QUERY = ${JSON.stringify(LIGHT_APPEARANCE_QUERY)};

  var preference = 'system';
  try {
    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'system' || stored === 'dark' || stored === 'light') {
      preference = stored;
    }
  } catch (storageError) {
    preference = 'system';
  }

  var theme;
  if (preference === 'light') {
    theme = 'light';
  } else if (preference === 'dark') {
    theme = 'dark';
  } else {
    var prefersLight = false;
    try {
      prefersLight =
        typeof window.matchMedia === 'function' &&
        window.matchMedia(LIGHT_QUERY).matches === true;
    } catch (mediaError) {
      prefersLight = false;
    }
    theme = prefersLight ? 'light' : 'dark';
  }

  try {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  } catch (applyError) {
    /* Nothing further can be done before first paint. */
  }
})();`;
