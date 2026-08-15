/**
 * Public barrel for the web auth feature module.
 *
 * The auth feature is a self-contained module under
 * `apps/web/src/features/auth/` (Requirement 1.8), split into pure logic
 * (`lib/`), the session model (`session/`), the typed API facade (`api/`),
 * presentational components (`components/`), and theme tokens (`styles/`).
 *
 * As later tasks land the session, API, and screen surfaces, their public
 * entry points are re-exported here so consumers import from a single place.
 */

// Theming (dark-mode-first) — mirrors the landing feature's proven pattern.
export {
  resolveTheme,
  greenTextToken,
  type Theme,
  type AppearancePreference,
} from './lib/theme'
export {
  ThemeProvider,
  useTheme,
  type ThemeProviderProps,
} from './components/ThemeProvider'

// Pure validation logic (framework-free).
export {
  validateEmail,
  EMAIL_MAX_LENGTH,
  type EmailValidation,
} from './lib/emailValidation'
export { extractToken } from './lib/tokenFromUrl'
export {
  resolveRedirectTarget,
  type RedirectResolutionConfig,
} from './lib/redirectTarget'
export {
  isRefreshRequired,
  clampRenewalMargin,
  RENEWAL_MARGIN_DEFAULT_MS,
  RENEWAL_MARGIN_MIN_MS,
  RENEWAL_MARGIN_MAX_MS,
  type RefreshDecisionInput,
} from './lib/accessTokenExpiry'
