/**
 * Theme surface for the web auth screens.
 *
 * This module holds **no implementation**. The one appearance implementation for
 * the whole web application lives in `src/theme/` — outside this feature, outside
 * the marketing landing feature, and outside the app shell — and all three
 * features import it from there (Requirements 12.13, 15.7). What used to be a
 * second copy of the dark-mode-first resolution rule here is now a re-export, so
 * the auth screens, the landing page, and the shell can never disagree about the
 * resolved Theme.
 *
 * The exported names are unchanged, so every existing consumer and test of this
 * module — including the auth feature's public barrel — keeps working:
 *
 * - {@link resolveTheme} still accepts the one-argument browser-preference call
 *   shape (`'light' | 'dark' | null`) and is still dark-mode-first: `light` only
 *   for an explicit light preference.
 * - {@link greenTextToken} still maps a Theme to its green token; in `src/theme`
 *   it is defined through `greenTokenForSurface`, which keys the choice off the
 *   surface's luminance so green on a dark card inside the light Theme still
 *   takes the dark-surface token (Requirement 12.11).
 *
 * Requirements: 12.13, 15.3, 15.7
 */

export { greenTextToken, resolveTheme, type Theme } from '../../../theme';

/**
 * A resolvable appearance preference from the visitor's **browser**.
 *
 * `null` represents an unresolvable/absent preference. This is an alias of the
 * shared `BrowserAppearancePreference` and is deliberately *not* the shared
 * stored `AppearancePreference` (`'system' | 'dark' | 'light'`), which models
 * what the person chose rather than what the browser reports.
 */
export type { BrowserAppearancePreference as AppearancePreference } from '../../../theme';
