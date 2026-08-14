/**
 * Pure theme logic for the marketing landing page.
 *
 * PitchMate is dark-mode-first (see brand.md): the dark Theme is applied unless
 * the visitor's browser explicitly reports a light appearance preference.
 */

/** The active colour scheme of the landing page. */
export type Theme = 'dark' | 'light';

/**
 * A resolvable appearance preference from the visitor's browser.
 * `null` represents an unresolvable/absent preference.
 */
export type AppearancePreference = 'dark' | 'light' | null;

/**
 * Resolve the active Theme from a browser appearance preference.
 *
 * Dark-mode-first: returns `'light'` if and only if the preference is explicitly
 * `'light'`; otherwise returns `'dark'` (covering `'dark'`, `null`, and any
 * unresolvable input).
 *
 * Requirements: 5.1, 5.3, 5.4
 */
export function resolveTheme(pref: AppearancePreference): Theme {
  return pref === 'light' ? 'light' : 'dark';
}

/**
 * Select the green token to use for text and icons in a given Theme.
 *
 * In the light Theme, green text/icons use Green Dark (`#3E8F24`) for accessible
 * contrast; in the dark Theme they use Pitch Green (`#5BBF36`).
 *
 * Requirements: 5.2, 5.6
 */
export function greenTextToken(theme: Theme): '#5BBF36' | '#3E8F24' {
  return theme === 'light' ? '#3E8F24' : '#5BBF36';
}
