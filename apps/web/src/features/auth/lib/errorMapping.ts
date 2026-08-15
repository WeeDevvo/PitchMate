/**
 * Pure backend-error → outcome/message mapping for the auth feature.
 *
 * Framework-free (no React, no DOM, no `window` access): this classifies a
 * typed Api_Client error response — or a thrown transport error — into a small,
 * closed set of {@link AuthOutcome}s, and produces the non-disclosing,
 * screen-appropriate user copy for each outcome. Because it is pure, it is
 * fully property-testable in a browserless environment (Requirement 15.1).
 *
 * Two non-disclosure guarantees are built in *by construction* so a screen can
 * never accidentally leak sensitive detail:
 *
 * 1. **Never surface raw backend content.** Any response that cannot be mapped
 *    to a known success/error outcome resolves to {@link AuthOutcome} `generic`,
 *    whose copy is a fixed constant. Classification reads only short machine
 *    *codes* (`code`/`type`) and the HTTP `status`; it never copies a backend
 *    `detail`/`message`/`error` string into user-facing copy (Requirements
 *    12.4, 12.6, 15.8).
 * 2. **Uniform, credential-agnostic copy.** Sign-in failure copy on the
 *    Log_In_Screen is the single {@link GENERIC_AUTH_FAILURE} constant, and
 *    every reset-request outcome renders the single
 *    {@link UNIFORM_RESET_ACKNOWLEDGEMENT} constant, so neither which credential
 *    was wrong nor whether an account exists can leak (Requirements 3.6, 5.4,
 *    5.5).
 *
 * ### Assumed backend-error shape
 *
 * The generated `@pitchmate/api-client` types are a separate backlog
 * prerequisite ("API client generation wired") and are **not yet available**,
 * so this module does not import from that package. Instead it consumes a
 * deliberately permissive, self-contained {@link BackendAuthError} descriptor
 * that mirrors the fields an RFC 7807 problem response / `openapi-fetch` error
 * envelope typically surfaces:
 *
 * - a short, stable machine `code` and/or problem `type` string used for
 *   classification (never shown to the user);
 * - an HTTP `status` used as a coarse fallback classifier;
 * - free-text `detail`/`message` fields that MAY carry raw backend content and
 *   are therefore **read for nothing** — never inspected, never surfaced.
 *
 * When the client generation lands, the facade in `api/authApi.ts` is expected
 * to adapt the generated error type onto this shape (or call `mapAuthError`
 * with the raw thrown value); either way the mapping contract here is stable.
 *
 * Requirements: 2.6, 2.7, 3.6, 3.7, 4.5, 5.4, 5.5, 6.6, 6.7, 7.4, 12.4, 12.6,
 * 15.1, 15.8
 */

/**
 * The closed set of outcomes an auth backend call is mapped to.
 *
 * Requirements 2.6, 2.7, 3.6, 3.7, 6.6, 6.7, 12.4, 12.5, 12.6, 15.8
 */
export type AuthOutcome =
  | { readonly kind: 'success' }
  | { readonly kind: 'email-already-registered' }
  | { readonly kind: 'validation'; readonly message: string }
  | { readonly kind: 'auth-failure' } // → Generic_Auth_Failure
  | { readonly kind: 'email-not-verified' }
  | { readonly kind: 'invalid-or-expired-token' }
  | { readonly kind: 'timeout-or-network' }
  | { readonly kind: 'generic' }; // safe fallback, never raw backend text

/**
 * The screen a message is being produced for. Copy is tailored per screen while
 * remaining non-disclosing.
 */
export type ScreenContext =
  | 'sign-up'
  | 'log-in'
  | 'reset-request'
  | 'reset-confirm'
  | 'verify-email'
  | 'google';

/**
 * A permissive descriptor of a mapped backend error. Every field is optional
 * because different endpoints/transports populate different subsets.
 *
 * Only {@link BackendAuthError.code}, {@link BackendAuthError.type}, and
 * {@link BackendAuthError.status} participate in classification. The remaining
 * free-text fields exist purely to document that they are recognised and
 * deliberately **never** surfaced to the user.
 */
export interface BackendAuthError {
  /** Short, stable machine code (e.g. `email-already-registered`). */
  readonly code?: string;
  /** Problem `type` token (RFC 7807-style), used like `code`. */
  readonly type?: string;
  /** HTTP status, used as a coarse fallback classifier. */
  readonly status?: number;
  /** Explicit transport-failure signal for a synthesised error envelope. */
  readonly kind?: string;
  /** Free-text backend detail — NEVER classified or surfaced. */
  readonly detail?: string;
  /** Free-text backend message — NEVER classified or surfaced. */
  readonly message?: string;
  /** Free-text backend error — NEVER classified or surfaced. */
  readonly error?: string;
}

// --- Non-disclosing user-facing copy constants ------------------------------

/**
 * The single Generic_Auth_Failure message shown for a failed email + password
 * sign-in. It deliberately does not reveal whether the Email_Address or the
 * password was wrong (Requirement 3.6).
 */
export const GENERIC_AUTH_FAILURE =
  "We couldn't sign you in. Check your details and try again.";

/**
 * The single Uniform_Reset_Acknowledgement shown for every password-reset
 * request outcome, so the screen reveals nothing about account existence
 * (Requirements 5.4, 5.5).
 */
export const UNIFORM_RESET_ACKNOWLEDGEMENT =
  "If an account exists for that email address, we've sent a link to reset the password.";

/**
 * The safe fallback copy for the `generic` outcome. A fixed constant that never
 * contains any raw backend response content (Requirements 12.6, 15.8).
 */
export const GENERIC_FALLBACK_MESSAGE =
  'Something went wrong. Please try again.';

/** Controlled copy for a generic backend validation problem (no raw text). */
export const GENERIC_VALIDATION_MESSAGE =
  'Some of the details entered are not valid. Please review them and try again.';

/** Controlled copy for a backend password-strength validation problem. */
export const PASSWORD_POLICY_VALIDATION_MESSAGE =
  'That password does not meet the required policy. Please choose a different password.';

// --- Recognised classification codes ----------------------------------------

// Short machine codes only — these are matched against `code`/`type`, never
// against any free-text field.
const ALREADY_REGISTERED_CODES = new Set<string>([
  'email-already-registered',
  'already-registered',
  'duplicate-email',
  'email-taken',
  'account-exists',
  'conflict',
]);

const VALIDATION_CODES = new Set<string>([
  'validation',
  'validation-error',
  'validation-failed',
  'invalid-input',
  'invalid-request',
  'bad-request',
]);

const PASSWORD_POLICY_CODES = new Set<string>([
  'password-too-weak',
  'weak-password',
  'password-policy',
  'invalid-password',
  'password-too-short',
  'password-too-long',
]);

const EMAIL_NOT_VERIFIED_CODES = new Set<string>([
  'email-not-verified',
  'unverified-email',
  'email-unverified',
  'verification-required',
]);

const INVALID_OR_EXPIRED_TOKEN_CODES = new Set<string>([
  'invalid-token',
  'expired-token',
  'token-invalid',
  'token-expired',
  'invalid-or-expired-token',
  'token-used',
  'token-already-used',
  'used-token',
]);

const AUTH_FAILURE_CODES = new Set<string>([
  'invalid-credentials',
  'authentication-failed',
  'auth-failure',
  'unauthorized',
  'bad-credentials',
  'invalid-login',
]);

const SUCCESS_CODES = new Set<string>(['success', 'ok']);

/**
 * Normalised view of an arbitrary error input, reduced to the only signals used
 * for classification. Free-text content is intentionally dropped here so it can
 * never influence the outcome or reach the user.
 */
interface NormalizedError {
  readonly code: string | null;
  readonly status: number | null;
  readonly transport: boolean;
}

/**
 * Map a typed Api_Client error response (or a thrown transport error) to a
 * defined {@link AuthOutcome}.
 *
 * Classification is deterministic and precedence-ordered: an explicit transport
 * failure first, then an explicit success signal, then the machine `code`/`type`
 * token, then the HTTP `status` as a coarse fallback. Anything that matches
 * none of these — including `null`, `undefined`, primitives, arbitrary `Error`
 * instances, and objects carrying only unknown codes — resolves to `generic`.
 * Raw backend content is never inspected for classification and never surfaced
 * (Requirements 12.4, 12.6, 15.8).
 *
 * Requirements: 2.6, 2.7, 3.6, 3.7, 4.5, 6.6, 6.7, 7.4, 12.4, 12.6, 15.8
 */
export function mapAuthError(error: unknown): AuthOutcome {
  const normalized = normalizeError(error);

  // 4.5 / 12.5: an explicit timeout or network/transport failure.
  if (normalized.transport) {
    return { kind: 'timeout-or-network' };
  }

  const { code, status } = normalized;

  // A defined success signal maps straight through (12.4).
  if (code !== null && SUCCESS_CODES.has(code)) {
    return { kind: 'success' };
  }

  // Code/type classification takes precedence over status (most specific).
  if (code !== null) {
    if (ALREADY_REGISTERED_CODES.has(code)) {
      return { kind: 'email-already-registered' };
    }
    if (PASSWORD_POLICY_CODES.has(code)) {
      return { kind: 'validation', message: PASSWORD_POLICY_VALIDATION_MESSAGE };
    }
    if (VALIDATION_CODES.has(code)) {
      return { kind: 'validation', message: GENERIC_VALIDATION_MESSAGE };
    }
    if (EMAIL_NOT_VERIFIED_CODES.has(code)) {
      return { kind: 'email-not-verified' };
    }
    if (INVALID_OR_EXPIRED_TOKEN_CODES.has(code)) {
      return { kind: 'invalid-or-expired-token' };
    }
    if (AUTH_FAILURE_CODES.has(code)) {
      return { kind: 'auth-failure' };
    }
  }

  // Coarse HTTP-status fallback when no recognised code is present.
  if (status !== null) {
    if (status === 408 || status === 504) {
      return { kind: 'timeout-or-network' };
    }
    if (status === 409) {
      return { kind: 'email-already-registered' };
    }
    if (status === 400 || status === 422) {
      return { kind: 'validation', message: GENERIC_VALIDATION_MESSAGE };
    }
    if (status === 401) {
      return { kind: 'auth-failure' };
    }
  }

  // 12.6 / 15.8: anything unmappable is a safe generic fallback.
  return { kind: 'generic' };
}

/**
 * Produce the non-disclosing user-facing copy for an outcome on a given screen.
 *
 * The copy is always produced by this module — it is never derived from backend
 * text — so it cannot leak raw backend content (Requirements 12.6, 15.8). Two
 * uniform-copy rules are enforced here:
 *
 * - On the Reset_Request_Screen, **every** outcome renders the single
 *   {@link UNIFORM_RESET_ACKNOWLEDGEMENT}, concealing account existence
 *   (Requirements 5.4, 5.5).
 * - An `auth-failure` on the Log_In_Screen renders the single
 *   {@link GENERIC_AUTH_FAILURE}, concealing which credential was wrong
 *   (Requirement 3.6).
 *
 * Requirements: 2.6, 2.7, 3.6, 3.7, 4.5, 5.4, 5.5, 6.6, 6.7, 7.4, 12.6, 15.8
 */
export function messageForOutcome(
  outcome: AuthOutcome,
  ctx: ScreenContext,
): string {
  // 5.4, 5.5: the reset-request screen is uniform for every outcome.
  if (ctx === 'reset-request') {
    return UNIFORM_RESET_ACKNOWLEDGEMENT;
  }

  switch (outcome.kind) {
    case 'success':
      return successMessage(ctx);

    case 'email-already-registered':
      return 'That email address is already registered. Try signing in, or reset your password.';

    case 'validation':
      // Controlled copy chosen by mapAuthError; never raw backend text.
      return outcome.message;

    case 'auth-failure':
      // 3.6: credential-agnostic on log-in; Google gets its own copy.
      return ctx === 'google'
        ? 'Google sign-in was not accepted. Please try again.'
        : GENERIC_AUTH_FAILURE;

    case 'email-not-verified':
      return 'Your email address needs to be verified. We can send you a new verification message.';

    case 'invalid-or-expired-token':
      return ctx === 'verify-email'
        ? 'This verification link is no longer valid. Please request a new verification message.'
        : 'This reset link is invalid or has expired. Please request a new one.';

    case 'timeout-or-network':
      return ctx === 'google'
        ? 'Google sign-in could not be completed. Please try again.'
        : 'That could not be completed. Please check your connection and try again.';

    case 'generic':
      // 12.6, 15.8: fixed safe fallback, never any backend content.
      return GENERIC_FALLBACK_MESSAGE;
  }
}

/** Success copy tailored per screen. */
function successMessage(ctx: ScreenContext): string {
  switch (ctx) {
    case 'sign-up':
      return 'Your account was created. We have sent a verification message to your email address.';
    case 'reset-confirm':
      return 'Your password was changed. You can now sign in with your new password.';
    case 'verify-email':
      return 'Your email address is verified.';
    case 'log-in':
    case 'google':
    case 'reset-request':
      return 'Success.';
  }
}

// --- Normalisation helpers --------------------------------------------------

/**
 * Reduce an arbitrary input to the {@link NormalizedError} signals used for
 * classification. Only short machine codes, the HTTP status, and an explicit
 * transport marker are extracted; all free-text content is discarded.
 */
function normalizeError(error: unknown): NormalizedError {
  const none: NormalizedError = { code: null, status: null, transport: false };

  if (error === null || error === undefined) {
    return none;
  }

  // Native transport failures: abort/timeout by name, real fetch failures are a
  // `TypeError` mentioning fetch/network. Arbitrary `Error`s do not match.
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { code: null, status: null, transport: true };
    }
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
      return { code: null, status: null, transport: true };
    }
    // A thrown Error may still carry a structured envelope (e.g. `.status`).
    return normalizeObject(error as unknown as Record<string, unknown>);
  }

  if (typeof error === 'object') {
    return normalizeObject(error as Record<string, unknown>);
  }

  // Primitives (string, number, boolean, symbol, bigint) are unmappable.
  return none;
}

/** Extract classification signals from a plain object envelope. */
function normalizeObject(obj: Record<string, unknown>): NormalizedError {
  const transportKind = readString(obj, 'kind');
  const transport =
    transportKind === 'timeout' ||
    transportKind === 'network' ||
    transportKind === 'transport';

  // Prefer `code`, then `type`, for classification. Free-text fields
  // (`detail`, `message`, `error`) are intentionally ignored.
  const code = readCode(obj, 'code') ?? readCode(obj, 'type');
  const status = readStatus(obj);

  return { code, status, transport };
}

/** Read a string field, or null when absent/not a string. */
function readString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

/** Read a classification code, normalised to a trimmed lowercase token. */
function readCode(obj: Record<string, unknown>, key: string): string | null {
  const value = readString(obj, key);
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

/** Read an integer HTTP status from `status` (or `statusCode`). */
function readStatus(obj: Record<string, unknown>): number | null {
  for (const key of ['status', 'statusCode']) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
  }
  return null;
}
