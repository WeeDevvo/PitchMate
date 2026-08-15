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
export {
  mapAuthError,
  messageForOutcome,
  GENERIC_AUTH_FAILURE,
  UNIFORM_RESET_ACKNOWLEDGEMENT,
  GENERIC_FALLBACK_MESSAGE,
  GENERIC_VALIDATION_MESSAGE,
  PASSWORD_POLICY_VALIDATION_MESSAGE,
  type AuthOutcome,
  type ScreenContext,
  type BackendAuthError,
} from './lib/errorMapping'

// Session model — persistence seam (Requirements 8.3, 8.5).
export {
  createLocalStorageSessionStore,
  createInMemorySessionStore,
  SESSION_STORAGE_KEY,
  type PersistedSession,
  type SessionStore,
} from './session/SessionStore'

// Session model — the SessionManager core (Requirements 8.1, 8.3, 8.4, 8.5, 8.7).
export {
  createSessionManager,
  type Session,
  type AuthState,
  type SessionManager,
  type SessionManagerDeps,
  type AuthApi,
  type RefreshResult,
  type SignOutResult,
} from './session/SessionManager'

// Session model — the thin React context over the SessionManager (Requirement 8.7).
export {
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type AuthProviderProps,
} from './session/AuthContext'

// Typed API facade — the single seam onto the generated @pitchmate/api-client
// (Requirements 12.1, 12.2, 12.3, 12.5).
export {
  createAuthApi,
  DEFAULT_AUTH_API_TIMEOUTS,
  type AuthApiFacade,
  type AuthApiOptions,
  type AuthApiTimeouts,
  type AuthSessionPayload,
  type AuthAckResult,
  type AuthSessionResult,
  type FailureOutcome,
  type RegisterCommand,
  type SignInCommand,
  type RedeemPasswordResetCommand,
} from './api/authApi'

// Typed API — the bearer-attaching auth middleware and its authenticated client
// (Requirements 8.2, 9.1).
export {
  createAuthMiddleware,
  createAuthenticatedApiClient,
  bearerCredential,
  AUTHORIZATION_HEADER,
  type BearerTokenSource,
} from './api/authMiddleware'
