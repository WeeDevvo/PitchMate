/**
 * The Api_Client auth middleware that attaches the bearer credential.
 *
 * Requirement 8.2 says that WHILE a current Session is established, the
 * Auth_Web SHALL attach the current Access_Token as the bearer credential on
 * authenticated Api_Client requests. This module implements exactly that as an
 * `openapi-fetch` {@link Middleware}: an `onRequest` hook that, for every
 * outgoing authenticated request, asks a {@link BearerTokenSource} (the
 * {@link SessionManager}) for the token to present and, when one is returned,
 * sets the `Authorization: Bearer <token>` header on the request.
 *
 * The token is obtained through {@link BearerTokenSource.getAccessTokenForRequest},
 * which performs the just-in-time, single-flight refresh described by
 * Requirement 9.1 — so by the time this hook attaches a credential, the
 * Access_Token has already been renewed if it was within its Renewal_Margin.
 * The middleware itself makes no refresh or expiry decision; it only relays the
 * source's outcome onto the request headers.
 *
 * The three outcomes of {@link BearerTokenSource.getAccessTokenForRequest} are
 * handled per the SessionManager contract:
 *
 * - `{ token }` — a usable Access_Token: set the `Authorization` header and let
 *   the (now-authenticated) request proceed (Requirement 8.2).
 * - `{ error: 'unauthenticated' }` — no Session is held, so there is nothing to
 *   attach: leave the request unauthenticated and let it proceed. The backend
 *   is the single source of truth and will reject it if the endpoint requires a
 *   credential.
 * - `{ error: 'refresh-failed' }` — a Session is held but the token could not be
 *   renewed (the SessionManager has already retried and, on an invalid/expired
 *   Refresh_Token, torn the Session down and routed to Log_In_Screen — Req 9.3,
 *   9.4). No credential is attached; the request proceeds without one rather
 *   than being blocked here, keeping this middleware free of auth decisions.
 *
 * ### Wiring
 *
 * Only authenticated requests should carry the bearer, so this middleware is
 * attached to a dedicated authenticated client via
 * {@link createAuthenticatedApiClient} (using `openapi-fetch`'s
 * `client.use(...)`), kept separate from the unauthenticated auth facade
 * (`api/authApi.ts`) whose endpoints — register, sign-in, refresh, and the like
 * — must NOT carry a bearer. The middleware is a plain factory over an injected
 * token source, so it is trivially testable with a fake source (see task 9.3).
 *
 * Requirements: 8.2, 9.1
 */

import {
  createApiClient,
  type ClientOptions,
  type Middleware,
  type PitchMateApiClient,
} from '@pitchmate/api-client';

/**
 * The minimal token-source seam the middleware depends on.
 *
 * This is the just-in-time bearer provider from the {@link SessionManager}
 * (`getAccessTokenForRequest`), narrowed to a single method so the middleware
 * carries no knowledge of the wider session model and can be exercised with a
 * hand-written fake. The {@link SessionManager} structurally satisfies it.
 */
export interface BearerTokenSource {
  /**
   * Return the bearer token to present on the current request, performing any
   * just-in-time refresh first (Requirement 9.1). Resolves to `{ token }` when
   * a usable Access_Token is available, or an error variant when none can be
   * presented.
   */
  getAccessTokenForRequest(): Promise<
    | { token: string }
    | { error: 'refresh-failed' }
    | { error: 'unauthenticated' }
  >;
}

/** The HTTP header carrying the bearer credential. */
export const AUTHORIZATION_HEADER = 'Authorization';

/** Format an Access_Token as an HTTP `Bearer` credential value. */
export function bearerCredential(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Create the auth {@link Middleware} that attaches the current Access_Token as
 * the bearer credential on authenticated requests (Requirement 8.2).
 *
 * The `onRequest` hook awaits the injected {@link BearerTokenSource} (which
 * performs just-in-time refresh — Requirement 9.1) and, only on a `{ token }`
 * outcome, sets the `Authorization: Bearer <token>` header on the request and
 * returns it. On either error outcome it returns the request unchanged, so the
 * request proceeds without a credential rather than being blocked in transport.
 *
 * Requirements: 8.2, 9.1
 */
export function createAuthMiddleware(source: BearerTokenSource): Middleware {
  return {
    async onRequest({ request }) {
      const result = await source.getAccessTokenForRequest();
      if ('token' in result) {
        request.headers.set(AUTHORIZATION_HEADER, bearerCredential(result.token));
      }
      // On `refresh-failed` / `unauthenticated` no credential is attached; the
      // request proceeds unauthenticated (the backend remains authoritative).
      return request;
    },
  };
}

/**
 * Create a dedicated authenticated `@pitchmate/api-client` whose every request
 * carries the current Access_Token via {@link createAuthMiddleware}.
 *
 * This is the SessionManager-backed client for authenticated API calls, kept
 * separate from the unauthenticated auth facade so that only authenticated
 * requests carry the bearer credential. It uses `openapi-fetch`'s
 * `client.use(...)` to register the bearer-attaching middleware.
 *
 * Requirements: 8.2, 9.1
 */
export function createAuthenticatedApiClient(
  source: BearerTokenSource,
  options?: ClientOptions,
): PitchMateApiClient {
  const client = createApiClient(options);
  client.use(createAuthMiddleware(source));
  return client;
}
