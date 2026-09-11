/**
 * The App_Shell's door onto theming — a re-export, never an implementation.
 *
 * Two acceptance criteria pull in opposite directions here. Requirement 14.16
 * asks that every module declaring one of the pure functions named in 14.1 —
 * Theme resolution among them — live under `features/app-shell/lib/`.
 * Requirement 15.7 asks that the pre-paint bootstrap, the Appearance_Preference
 * logic, and the pure Theme resolution live in exactly **one** shared module that
 * sits *outside* `features/app-shell/`, outside the Auth_Feature, and outside the
 * marketing landing feature.
 *
 * Both are satisfied by keeping the single implementation in `src/theme/` and
 * making this file a re-export of it. The shell's property tests for Theme
 * resolution, stored-preference interpretation, and the pre-paint bootstrap sit
 * beside this module under `lib/` as Requirement 14.2 asks, and exercise that one
 * implementation *through* this re-export. No second implementation exists
 * anywhere in the web application — the marketing landing feature's and the
 * Auth_Feature's theme modules are re-exports of the same source
 * (Requirement 15.3).
 *
 * This module is React-free and DOM-free, like every module under `lib/`
 * (Requirements 14.16, 15.5): it declares nothing and touches nothing.
 *
 * Requirements: 12.13, 14.16, 15.3, 15.7
 */

// Pure Theme resolution and stored-preference interpretation
// (Requirements 12.1, 12.2, 12.3, 12.6, 12.12, 12.15, 14.10).
export {
  APPEARANCE_PREFERENCES,
  interpretStoredPreference,
  isAppearancePreference,
  resolveTheme,
  type AppearancePreference,
  type BrowserAppearancePreference,
  type ResolvableAppearancePreference,
  type Theme,
} from '../../../theme';

// Green token selection, keyed off the surface's luminance rather than the
// Theme's name (Requirement 12.11).
export {
  GREEN_DARK,
  GREEN_TOKEN_LUMINANCE_THRESHOLD,
  PITCH_GREEN,
  greenTextToken,
  greenTokenForSurface,
  type GreenToken,
} from '../../../theme';

// The one pre-paint bootstrap and the names it shares with the Theme_Provider:
// the storage key it reads, the attribute it writes, and the media query it
// consults (Requirements 12.5, 12.13).
export {
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
} from '../../../theme';
