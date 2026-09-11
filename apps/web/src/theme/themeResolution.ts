/**
 * The one pure Theme resolution module for the whole web application.
 *
 * PitchMate is dark-mode-first (see brand.md). This module is the single
 * implementation of appearance resolution shared by the marketing landing page,
 * the auth screens, and the app shell (Requirements 12.12, 15.7). It is
 * React-free and DOM-free so resolution is testable without a browser: nothing
 * here touches `window`, `document`, `matchMedia`, or browser storage.
 *
 * Reading and writing the stored Appearance_Preference lives in
 * `./appearancePreference`; the pre-paint bootstrap lives in `./themeBootstrap`.
 * This module only decides.
 */

/** The active colour scheme of a rendered surface. */
export type Theme = 'dark' | 'light';

/**
 * The stored Appearance_Preference — what the person chose.
 *
 * `system` defers to the browser's appearance preference; `dark` and `light`
 * are explicit and override the browser (Requirement 12.3).
 */
export type AppearancePreference = 'system' | 'dark' | 'light';

/**
 * What the browser reports as its appearance preference.
 *
 * `null` represents an unresolvable or absent preference — the case where the
 * browser expresses no explicit choice. Only an explicit `'light'` can pull the
 * resolved Theme away from dark.
 */
export type BrowserAppearancePreference = 'dark' | 'light' | null;

/**
 * Every value {@link resolveTheme} accepts as a preference.
 *
 * Besides the three stored {@link AppearancePreference} values this admits the
 * browser-reported {@link BrowserAppearancePreference} shape (including `null`)
 * and `undefined`, so a caller holding either kind of preference — or none —
 * can resolve without a pre-step. Anything other than `'light'` or `'system'`
 * resolves to `dark`, which keeps the dark-mode-first invariant total.
 */
export type ResolvableAppearancePreference =
  | AppearancePreference
  | BrowserAppearancePreference
  | undefined;

/** The three stored Appearance_Preference values, in presentation order. */
export const APPEARANCE_PREFERENCES: readonly AppearancePreference[] = [
  'system',
  'dark',
  'light',
];

/** Pitch Green — green text and icons on a dark surface (brand.md). */
export const PITCH_GREEN = '#5BBF36';

/** Green Dark — green text and icons on a light surface (brand.md). */
export const GREEN_DARK = '#3E8F24';

/** The two green tokens available to text and icons. */
export type GreenToken = typeof PITCH_GREEN | typeof GREEN_DARK;

/**
 * The relative-luminance boundary between a "dark" and a "light" surface for
 * the purpose of picking a green token (Requirement 12.11). A surface at or
 * above this luminance takes {@link GREEN_DARK}; below it takes
 * {@link PITCH_GREEN}.
 */
export const GREEN_TOKEN_LUMINANCE_THRESHOLD = 0.05;

/**
 * True iff `value` is one of the three stored Appearance_Preference values.
 *
 * Total over any input: never throws, never inspects nested structure.
 */
export function isAppearancePreference(
  value: unknown,
): value is AppearancePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

/**
 * Interpret a value read from browser storage as an Appearance_Preference.
 *
 * Every value is interpreted and none is rejected: an absent value, a `null`,
 * a value of any other type, and a string that is not one of `system`, `dark`,
 * or `light` all yield `system`. No error is raised and none is surfaced, so a
 * corrupt or foreign stored value degrades to following the browser rather than
 * to a failure (Requirements 12.6, 12.15).
 *
 * Requirements: 12.6, 12.15, 15.7
 */
export function interpretStoredPreference(value: unknown): AppearancePreference {
  return isAppearancePreference(value) ? value : 'system';
}

/**
 * Resolve the active Theme from an Appearance_Preference and the browser's
 * appearance preference.
 *
 * Dark-mode-first: the result is `light` in exactly two cases — the preference
 * is `light`, or the preference is `system` and the browser reports an
 * *explicit* light preference. Every other combination resolves to `dark`,
 * including `system` with no explicit browser preference, an absent preference,
 * and an unrecognised one (Requirements 12.1, 12.2, 12.3, 12.12, 14.10).
 *
 * `browserPrefersLight` is treated as an explicit light preference only when it
 * is exactly `true`; `false`, `null`, and `undefined` all mean "no explicit
 * light preference", which is what a browser without
 * `prefers-color-scheme: light` reports.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.12, 14.10
 */
export function resolveTheme(
  preference: ResolvableAppearancePreference,
  browserPrefersLight?: boolean | null,
): Theme {
  if (preference === 'light') {
    return 'light';
  }

  if (preference === 'system' && browserPrefersLight === true) {
    return 'light';
  }

  return 'dark';
}

/**
 * Select the green token for text or an icon from the relative luminance of the
 * surface it is rendered on.
 *
 * The choice depends on the surface alone and never on which Theme is active,
 * so green on a dark card inside the light Theme still takes the dark-surface
 * token (Requirement 12.11). A surface luminance of 0.05 or above takes
 * {@link GREEN_DARK}; below 0.05 takes {@link PITCH_GREEN}.
 *
 * Total over any number: a `NaN` or otherwise non-comparable luminance is
 * treated as a dark surface, which is the dark-mode-first default.
 *
 * Requirements: 12.11
 */
export function greenTokenForSurface(relativeLuminance: number): GreenToken {
  return relativeLuminance >= GREEN_TOKEN_LUMINANCE_THRESHOLD
    ? GREEN_DARK
    : PITCH_GREEN;
}

/**
 * The representative surface luminance of each Theme's default background,
 * used to express the Theme-keyed green token in terms of the surface-keyed one.
 *
 * Ink (`#141414`) sits well below the 0.05 boundary; the light Theme's near-white
 * background sits well above it.
 */
const THEME_SURFACE_LUMINANCE: Readonly<Record<Theme, number>> = {
  dark: 0,
  light: 1,
};

/**
 * Select the green token for text or an icon rendered on a Theme's default
 * surface.
 *
 * This is the convenience form of {@link greenTokenForSurface} for the common
 * case of green on the Theme's own background, and is defined *through* it so
 * only one rule exists: the light Theme's background is a light surface and so
 * takes {@link GREEN_DARK}; the dark Theme's is a dark surface and takes
 * {@link PITCH_GREEN}. Green on any other surface should call
 * {@link greenTokenForSurface} with that surface's luminance directly.
 *
 * Requirements: 12.11
 */
export function greenTextToken(theme: Theme): GreenToken {
  return greenTokenForSurface(THEME_SURFACE_LUMINANCE[theme]);
}
