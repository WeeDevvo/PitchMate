/**
 * Public entry point for the shared theme module.
 *
 * This directory is the one place the web application decides appearance: the
 * pure Theme resolution, the Appearance_Preference read/write against the single
 * namespaced storage key, and the pre-paint bootstrap. It sits outside
 * `features/app-shell/`, outside the auth feature, and outside the marketing
 * landing feature, and all three import it from here (Requirement 15.7).
 *
 * It exposes the pure Theme resolution, the Appearance_Preference store, and
 * the pre-paint bootstrap.
 */

export {
  APPEARANCE_STORAGE_KEY,
  createInMemoryAppearanceStorage,
  readAppearancePreference,
  writeAppearancePreference,
  type AppearanceStorage,
} from './appearancePreference';

export {
  LIGHT_APPEARANCE_QUERY,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
  applyThemeAttribute,
  type ThemeAttributeTarget,
} from './themeBootstrap';

export {
  APPEARANCE_PREFERENCES,
  GREEN_DARK,
  GREEN_TOKEN_LUMINANCE_THRESHOLD,
  PITCH_GREEN,
  greenTextToken,
  greenTokenForSurface,
  interpretStoredPreference,
  isAppearancePreference,
  resolveTheme,
  type AppearancePreference,
  type BrowserAppearancePreference,
  type GreenToken,
  type ResolvableAppearancePreference,
  type Theme,
} from './themeResolution';
