/**
 * The typed Api_Client facade for the auth feature (Requirement 12).
 *
 * This module is the single place the web auth feature talks to the backend.
 * It configures one `openapi-fetch` client through the generated
 * `@pitchmate/api-client` package and exposes exactly the `/auth/*` endpoints
 * the screens and the {@link SessionManager} need — `register`, `signIn`,
 * `signInGoogle`, `refresh`, `requestPasswordReset`, `redeemPasswordReset`,
 * `redeemEmailVerification`, `requestEmailVerification`, and `signOut`.
 *
 * Design constraints honoured here:
 *
 * - **Only the generated client.** Every call goes through the client returned
 *   by `createApiClient` (over `createClient<paths>`); the feature never issues
 *   a bare `fetch` (Requirement 12.1). Request bodies are the generated
 *   `components["schemas"]["*Command"]` types, checked at each call site, so no
 *   request shape is hand-rolled (Requirement 12.2).
 * - **No auth logic.** The facade performs no credential, token, or assertion
 *   validation and makes no authentication decision (Requirement 12.3). It only
 *   relays the caller's input and shapes the typed response into an
 *   {@link AuthOutcome} via {@link mapAuthError}, so non-disclosure is inherited
 *   from the pure error-mapping layer (Requirements 12.4, 12.6).
 * - **Per-call timeouts.** Each call is bounded by an `AbortSignal` timeout:
 *   30s in general, 10s for the password-reset request, the email-verification
 *   redeem, and refresh, and 5s for sign-out (Requirement 12.5). A lapsed
 *   timeout aborts the request, which surfaces as a `timeout-or-network`
 *   outcome through {@link mapAuthError}.
 *
 * ### Response-body note
 *
 * The committed OpenAPI contract currently documents the session endpoints as
 * `200 OK`/`204 No Content` with **no response schema**, so the generated types
 * expose no session body. The session payload the backend actually returns
 * (`{ userId, accessToken, accessTokenExpiresAt, refreshToken,
 * refreshTokenExpiresAt }`) is therefore modelled locally by
 * {@link AuthSessionPayload}, reduced to the fields the client needs and with
 * the access-token expiry converted to an epoch-millisecond instant. This is
 * the minimal shaping the requirements call for, not a hand-rolled duplicate of
 * an existing contract type; when the backend spec documents the body this
 * local shape can be replaced by the generated one with no change to callers.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.5
 */

import {
  createApiClient,
  type ClientOptions,
  type PitchMateApiClient,
  type components,
} from '@pitchmate/api-client';

import {
  mapAuthError,
  type AuthOutcome,
  type BackendAuthError,
} from '../lib/errorMapping';

// --- Request command aliases (derived from the generated contract) ----------

/** Body for `POST /auth/register` (Requirement 2). */
export type RegisterCommand =
  components['schemas']['RegisterWithPasswordCommand'];
/** Body for `POST /auth/sign-in` (Requirement 3). */
export type SignInCommand = components['schemas']['SignInWithPasswordCommand'];
/** Body for `POST /auth/password-reset/redeem` (Requirement 6). */
export type RedeemPasswordResetCommand =
  components['schemas']['RedeemPasswordResetCommand'];

// --- Result shapes ----------------------------------------------------------

/**
 * The failure half of every facade result: any {@link AuthOutcome} other than
 * `success`. Success is represented structurally by the `ok: true` variant, so
 * a failure never carries the `success` kind.
 */
export type FailureOutcome = Exclude<AuthOutcome, { kind: 'success' }>;

/**
 * A session payload surfaced by a session-establishing call.
 *
 * The Access_Token is an opaque bearer credential; `expiresAtMs` is its expiry
 * instant in epoch milliseconds, converted from the backend's ISO-8601
 * `accessTokenExpiresAt`. See the module note on why this is modelled locally.
 */
export interface AuthSessionPayload {
  /** Opaque bearer Access_Token. */
  readonly accessToken: string;
  /** Rotating, revocable Refresh_Token. */
  readonly refreshToken: string;
  /** Access_Token expiry instant, in epoch milliseconds. */
  readonly expiresAtMs: number;
}

/**
 * The result of a valueless auth call (register, reset request/redeem,
 * verification redeem/request, sign-out): success carries nothing, failure
 * carries a shaped {@link FailureOutcome}.
 */
export type AuthAckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly outcome: FailureOutcome };

/**
 * The result of a session-establishing call (sign-in, Google sign-in, refresh):
 * success carries the {@link AuthSessionPayload}, failure a shaped
 * {@link FailureOutcome}.
 */
export type AuthSessionResult =
  | { readonly ok: true; readonly session: AuthSessionPayload }
  | { readonly ok: false; readonly outcome: FailureOutcome };

// --- Timeout budgets (Requirement 12.5) -------------------------------------

/** Per-call timeout budgets in milliseconds. */
export interface AuthApiTimeouts {
  /** General call timeout (register, sign-in, Google, reset redeem, resend). */
  readonly generalMs: number;
  /** Password-reset request timeout. */
  readonly resetRequestMs: number;
  /** Email-verification redeem timeout. */
  readonly emailVerificationRedeemMs: number;
  /** Refresh timeout. */
  readonly refreshMs: number;
  /** Sign-out timeout (must be <= 5000). */
  readonly signOutMs: number;
}

/** The default timeout budgets mandated by the requirements (Requirement 12.5). */
export const DEFAULT_AUTH_API_TIMEOUTS: AuthApiTimeouts = {
  generalMs: 30_000,
  resetRequestMs: 10_000,
  emailVerificationRedeemMs: 10_000,
  refreshMs: 10_000,
  signOutMs: 5_000,
};

// --- Facade surface ---------------------------------------------------------

/**
 * The auth backend surface the screens and {@link SessionManager} consume.
 *
 * Every method relays its input to the backend through the generated client and
 * returns a shaped result; none inspects credentials, tokens, or assertions
 * (Requirement 12.3).
 */
export interface AuthApiFacade {
  /** `POST /auth/register` — create an email + password account. */
  register(command: RegisterCommand): Promise<AuthAckResult>;
  /** `POST /auth/sign-in` — sign in with email + password. */
  signIn(command: SignInCommand): Promise<AuthSessionResult>;
  /** `POST /auth/sign-in/google` — relay a Google_Assertion for sign-in. */
  signInGoogle(assertion: string): Promise<AuthSessionResult>;
  /** `POST /auth/refresh` — exchange the current Refresh_Token for a session. */
  refresh(refreshToken: string): Promise<AuthSessionResult>;
  /** `POST /auth/password-reset/request` — request a reset message. */
  requestPasswordReset(email: string): Promise<AuthAckResult>;
  /** `POST /auth/password-reset/redeem` — set a new password with a token. */
  redeemPasswordReset(
    command: RedeemPasswordResetCommand,
  ): Promise<AuthAckResult>;
  /** `POST /auth/email/verification/redeem` — redeem a verification token. */
  redeemEmailVerification(token: string): Promise<AuthAckResult>;
  /** `POST /auth/email/verification/request` — resend verification (authenticated). */
  requestEmailVerification(): Promise<AuthAckResult>;
  /** `POST /auth/sign-out` — revoke the current Refresh_Token family. */
  signOut(refreshToken: string): Promise<AuthAckResult>;
}

/** Options for {@link createAuthApi}. */
export interface AuthApiOptions {
  /**
   * A pre-configured client to use (e.g. one wired with the bearer-attaching
   * middleware from task 9.2, or a fake in tests). When omitted a client is
   * created from {@link AuthApiOptions.clientOptions}.
   */
  readonly client?: PitchMateApiClient;
  /** `openapi-fetch` options (`baseUrl`, `fetch`, `headers`) when no client is given. */
  readonly clientOptions?: ClientOptions;
  /** Timeout overrides; defaults to {@link DEFAULT_AUTH_API_TIMEOUTS}. */
  readonly timeouts?: Partial<AuthApiTimeouts>;
}

/**
 * Create the auth Api_Client facade over a single generated `openapi-fetch`
 * client.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.5
 */
export function createAuthApi(options: AuthApiOptions = {}): AuthApiFacade {
  const client = options.client ?? createApiClient(options.clientOptions);
  const timeouts: AuthApiTimeouts = {
    ...DEFAULT_AUTH_API_TIMEOUTS,
    ...options.timeouts,
  };

  return {
    register(command) {
      return callAck(() =>
        client.POST('/auth/register', {
          body: command,
          signal: timeoutSignal(timeouts.generalMs),
        }),
      );
    },

    signIn(command) {
      return callSession(() =>
        client.POST('/auth/sign-in', {
          body: command,
          signal: timeoutSignal(timeouts.generalMs),
        }),
      );
    },

    signInGoogle(assertion) {
      return callSession(() =>
        client.POST('/auth/sign-in/google', {
          body: { assertion },
          signal: timeoutSignal(timeouts.generalMs),
        }),
      );
    },

    refresh(refreshToken) {
      return callSession(() =>
        client.POST('/auth/refresh', {
          body: { refreshToken },
          signal: timeoutSignal(timeouts.refreshMs),
        }),
      );
    },

    requestPasswordReset(email) {
      return callAck(() =>
        client.POST('/auth/password-reset/request', {
          body: { email },
          signal: timeoutSignal(timeouts.resetRequestMs),
        }),
      );
    },

    redeemPasswordReset(command) {
      return callAck(() =>
        client.POST('/auth/password-reset/redeem', {
          body: command,
          signal: timeoutSignal(timeouts.generalMs),
        }),
      );
    },

    redeemEmailVerification(token) {
      return callAck(() =>
        client.POST('/auth/email/verification/redeem', {
          body: { token },
          signal: timeoutSignal(timeouts.emailVerificationRedeemMs),
        }),
      );
    },

    requestEmailVerification() {
      return callAck(() =>
        client.POST('/auth/email/verification/request', {
          signal: timeoutSignal(timeouts.generalMs),
        }),
      );
    },

    signOut(refreshToken) {
      return callAck(() =>
        client.POST('/auth/sign-out', {
          body: { refreshToken },
          signal: timeoutSignal(timeouts.signOutMs),
        }),
      );
    },
  };
}

// --- Call plumbing ----------------------------------------------------------

/**
 * The subset of an `openapi-fetch` call result this facade reads. The generated
 * types model no session/error body for these endpoints (see module note), so
 * the result is read loosely and shaped by {@link mapAuthError}.
 */
interface OpenapiCallResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response?: Response;
}

/** An awaited `openapi-fetch` call producing an {@link OpenapiCallResult}. */
type CallInvoker = () => Promise<unknown>;

/**
 * Run a valueless call: success → `{ ok: true }`; a returned error body or a
 * thrown transport failure → a shaped {@link FailureOutcome}.
 */
async function callAck(invoke: CallInvoker): Promise<AuthAckResult> {
  try {
    const { error, response } = (await invoke()) as OpenapiCallResult;
    if (isPresent(error)) {
      return { ok: false, outcome: failureFromError(error, response) };
    }
    return { ok: true };
  } catch (thrown) {
    return { ok: false, outcome: failureFromThrown(thrown) };
  }
}

/**
 * Run a session-establishing call: success → the shaped
 * {@link AuthSessionPayload}; a returned error body or a thrown transport
 * failure → a shaped {@link FailureOutcome}. A success response whose body is
 * not a usable session resolves to the safe `generic` outcome.
 */
async function callSession(invoke: CallInvoker): Promise<AuthSessionResult> {
  try {
    const { data, error, response } = (await invoke()) as OpenapiCallResult;
    if (isPresent(error)) {
      return { ok: false, outcome: failureFromError(error, response) };
    }
    const session = toSessionPayload(data);
    if (session === null) {
      return { ok: false, outcome: { kind: 'generic' } };
    }
    return { ok: true, session };
  } catch (thrown) {
    return { ok: false, outcome: failureFromThrown(thrown) };
  }
}

/**
 * Shape an error body returned by the client into a {@link FailureOutcome}.
 *
 * The backend's stable {@link https://www.rfc-editor.org/rfc/rfc7807 problem}
 * `code`/`title` (a PascalCase `AuthErrorCode`) is translated to the machine
 * token {@link mapAuthError} understands, and the HTTP status is passed through
 * as a coarse fallback. Free-text problem fields are never read or surfaced.
 */
function failureFromError(
  error: unknown,
  response: Response | undefined,
): FailureOutcome {
  const backend: BackendAuthError = {
    code: translateBackendCode(error) ?? undefined,
    status: readStatus(error, response) ?? undefined,
  };
  return asFailure(mapAuthError(backend));
}

/** Shape a thrown transport error (abort/timeout/network) into a failure. */
function failureFromThrown(thrown: unknown): FailureOutcome {
  return asFailure(mapAuthError(thrown));
}

/**
 * Coerce an {@link AuthOutcome} to a {@link FailureOutcome}. A `success` here
 * would mean an error path produced success, which cannot happen; it is coerced
 * to the safe `generic` fallback so no failure is ever reported as success.
 */
function asFailure(outcome: AuthOutcome): FailureOutcome {
  return outcome.kind === 'success' ? { kind: 'generic' } : outcome;
}

/**
 * Convert a success response body into an {@link AuthSessionPayload}, or `null`
 * when it lacks a usable token pair or a parseable expiry. Only the fields the
 * client needs are read; the backend `userId` and the refresh-token expiry are
 * intentionally ignored.
 */
function toSessionPayload(data: unknown): AuthSessionPayload | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const body = data as Record<string, unknown>;
  const accessToken = body['accessToken'];
  const refreshToken = body['refreshToken'];
  const expiresAtRaw = body['accessTokenExpiresAt'];

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null;
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return null;
  }
  const expiresAtMs = parseInstantMs(expiresAtRaw);
  if (expiresAtMs === null) {
    return null;
  }
  return { accessToken, refreshToken, expiresAtMs };
}

/** Parse an ISO-8601 instant (or epoch-ms number) to epoch ms, or null. */
function parseInstantMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Translate a backend problem `code`/`title` into the dashed machine token that
 * {@link mapAuthError} classifies. Returns `undefined` when the code is absent
 * or unrecognised, letting the HTTP-status fallback decide.
 */
function translateBackendCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const body = error as Record<string, unknown>;
  const raw = readString(body, 'code') ?? readString(body, 'title');
  if (raw === null) {
    return undefined;
  }
  return BACKEND_CODE_TO_MAPPING_CODE[raw.trim().toLowerCase()];
}

/**
 * Map each backend {@link AuthErrorCode} (lowercased) to the machine token the
 * pure error-mapping layer recognises. Codes with no meaningful client outcome
 * are deliberately omitted so the HTTP-status fallback governs them.
 */
const BACKEND_CODE_TO_MAPPING_CODE: Readonly<Record<string, string>> = {
  emailalreadyregistered: 'email-already-registered',
  passwordpolicy: 'password-policy',
  invalidemail: 'validation',
  validationfailed: 'validation',
  tokenexpired: 'expired-token',
  tokeninvalid: 'invalid-token',
  authenticationfailed: 'authentication-failed',
  unauthenticated: 'unauthorized',
  emailnotverified: 'email-not-verified',
};

/** Read the HTTP status from an error body's `status`, else the response. */
function readStatus(
  error: unknown,
  response: Response | undefined,
): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as Record<string, unknown>)['status'];
    if (typeof status === 'number' && Number.isInteger(status)) {
      return status;
    }
  }
  if (response !== undefined && Number.isInteger(response.status)) {
    return response.status;
  }
  return null;
}

/** Read a string property, or null when absent/not a string. */
function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

/** True when a value is neither `undefined` nor `null`. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** An `AbortSignal` that fires after `ms`, bounding a single call. */
function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
