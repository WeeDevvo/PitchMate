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

// Shared presentational components — the single-`h1` themed shell, labelled
// inputs with programmatic error association, the disabled-while-pending submit
// control, the message live region, and the client-side nav link
// (Requirements 13.4, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6).
export { AuthLayout, type AuthLayoutProps } from './components/AuthLayout'
export { FormField, type FormFieldProps } from './components/FormField'
export { EmailField, type EmailFieldProps } from './components/EmailField'
export {
  PasswordField,
  type PasswordFieldProps,
} from './components/PasswordField'
export { SubmitButton, type SubmitButtonProps } from './components/SubmitButton'
export { LiveRegion, type LiveRegionProps } from './components/LiveRegion'
export { LinkButton, type LinkButtonProps } from './components/LinkButton'
export {
  GoogleSignInControl,
  GOOGLE_SIGN_IN_INCOMPLETE_MESSAGE,
  GOOGLE_SIGN_IN_DEFAULT_LABEL,
  type GoogleSignInControlProps,
} from './components/GoogleSignInControl'

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

// Screens — the Sign_Up_Screen at `/signup` (Requirement 2).
export {
  SignUpScreen,
  SIGN_UP_HEADING,
  EMAIL_REQUIRED_MESSAGE,
  EMAIL_TOO_LONG_MESSAGE,
  EMAIL_MALFORMED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  type SignUpScreenProps,
} from './SignUpScreen'

// Screens — the Log_In_Screen at `/login` (Requirement 3).
export {
  LogInScreen,
  LOG_IN_HEADING,
  SIGN_UP_PATH,
  RESET_REQUEST_PATH,
  VERIFY_EMAIL_PATH,
  EMAIL_REQUIRED_MESSAGE as LOG_IN_EMAIL_REQUIRED_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE as LOG_IN_PASSWORD_REQUIRED_MESSAGE,
  RESEND_VERIFICATION_LABEL,
  type LogInScreenProps,
} from './LogInScreen'

// Screens — the Reset_Request_Screen (Requirement 5).
export {
  ResetRequestScreen,
  RESET_REQUEST_HEADING,
  LOG_IN_PATH,
  BACK_TO_LOG_IN_LABEL,
  EMAIL_REQUIRED_MESSAGE as RESET_REQUEST_EMAIL_REQUIRED_MESSAGE,
  EMAIL_TOO_LONG_MESSAGE as RESET_REQUEST_EMAIL_TOO_LONG_MESSAGE,
  EMAIL_MALFORMED_MESSAGE as RESET_REQUEST_EMAIL_MALFORMED_MESSAGE,
  type ResetRequestScreenProps,
} from './ResetRequestScreen'

// Screens — the Reset_Confirm_Screen at `/reset-password/confirm` (Requirement 6).
export {
  ResetConfirmScreen,
  RESET_CONFIRM_HEADING,
  MISSING_TOKEN_MESSAGE as RESET_CONFIRM_MISSING_TOKEN_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE as RESET_CONFIRM_PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE as RESET_CONFIRM_PASSWORD_TOO_LONG_MESSAGE,
  REQUEST_NEW_LINK_LABEL,
  PROCEED_TO_LOG_IN_LABEL,
  RESET_REQUEST_PATH as RESET_CONFIRM_RESET_REQUEST_PATH,
  LOG_IN_PATH as RESET_CONFIRM_LOG_IN_PATH,
  type ResetConfirmScreenProps,
} from './ResetConfirmScreen'

// Screens — the Verify_Email_Screen at `/verify-email` (Requirement 7).
export {
  VerifyEmailScreen,
  VERIFY_EMAIL_HEADING,
  VERIFYING_MESSAGE,
  MISSING_TOKEN_MESSAGE as VERIFY_EMAIL_MISSING_TOKEN_MESSAGE,
  RESEND_SUCCESS_MESSAGE,
  SEND_NEW_VERIFICATION_LABEL,
  LOG_IN_TO_VERIFY_LABEL,
  RETRY_LABEL,
  CONTINUE_TO_LOG_IN_LABEL,
  CONTINUE_TO_APP_LABEL,
  DEFAULT_AUTHENTICATED_PATH,
  LOG_IN_PATH as VERIFY_EMAIL_LOG_IN_PATH,
  type VerifyEmailScreenProps,
} from './VerifyEmailScreen'

// Screen — the unmatched-route fallback within the auth feature (Requirement 1.7).
export {
  AuthNotFound,
  AUTH_NOT_FOUND_HEADING,
  AUTH_NOT_FOUND_MESSAGE,
  BACK_TO_LOG_IN_LABEL as AUTH_NOT_FOUND_BACK_TO_LOG_IN_LABEL,
  LOG_IN_PATH as AUTH_NOT_FOUND_LOG_IN_PATH,
} from './AuthNotFound'

// Routing — the auth feature's route table for the app router (Requirement 1).
export {
  createAuthRoutes,
  AUTH_ROUTE_PATHS,
  SIGN_UP_ROUTE,
  LOG_IN_ROUTE,
  RESET_REQUEST_ROUTE,
  RESET_CONFIRM_ROUTE,
  VERIFY_EMAIL_ROUTE,
  type AuthRouteDeps,
} from './authRoutes'

// Configuration model — routes, timeouts, and the Google client id in one record
// (Requirements 9.1, 10.3, 11.2, 11.3, 11.5).
export {
  createAuthConfig,
  redirectResolutionConfigFromAuthConfig,
  clampSignOutTimeout,
  REDIRECT_TARGET_MAX_LENGTH,
  REFRESH_TIMEOUT_DEFAULT_MS,
  SIGN_OUT_TIMEOUT_MAX_MS,
  CALL_TIMEOUT_DEFAULT_MS,
  DEFAULT_AUTHENTICATED_ROUTE,
  DEFAULT_PUBLIC_POST_SIGN_OUT_ROUTE,
  type AuthConfig,
} from './config/authConfig'

// Post-auth redirect capture — the single-use Redirect_Target store and the pure
// URL capture helper (Requirements 11.1, 11.6).
export {
  createRedirectTargetStore,
  redirectCandidateFromSearch,
  REDIRECT_PARAM_NAME,
  type RedirectTargetStore,
} from './session/redirectTargetStore'

// Post-auth redirect & sign-out navigation wiring (Requirements 10.4, 11.1, 11.2, 11.6).
export {
  createAuthNavigation,
  createNavigationController,
  type AuthNavigation,
  type AuthNavigationDeps,
  type NavigationSeam,
  type NavigationController,
} from './session/authNavigation'

// The React adapter that binds router navigation and captures the pre-auth
// Redirect_Target (Requirements 10.4, 11.1, 11.2).
export {
  AuthNavigationBinder,
  type AuthNavigationBinderProps,
} from './session/AuthNavigationBinder'

// Top-level wiring — the auth route table assembled with redirect and sign-out
// navigation (Requirements 10.4, 11.1, 11.2, 11.6).
export {
  createWiredAuthRoutes,
  sessionTuningFromConfig,
  authApiTimeoutsFromConfig,
  type WiredAuthRoutesOptions,
  type WiredAuthRoutes,
  type SessionTuning,
} from './authWiring'
