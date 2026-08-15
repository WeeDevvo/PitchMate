/**
 * Unit tests for the auth Api_Client facade (task 9.1).
 *
 * These exercise the real generated `openapi-fetch` client with an injected
 * `fetch`, verifying that each facade function targets the right `/auth/*`
 * endpoint with the right body, that a successful session response is shaped
 * into an {@link AuthSessionPayload} (with the ISO expiry converted to epoch
 * ms), and that backend problem responses are shaped into the correct
 * non-disclosing {@link FailureOutcome} via the pure error-mapping layer.
 *
 * Requirements: 12.1, 12.2, 12.3
 */

import { describe, expect, it } from 'vitest';

import { createAuthApi } from './authApi';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/** A fake `fetch` that records requests and replies from a queued handler. */
function fakeFetch(
  handler: (req: RecordedRequest) => Response,
): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const impl = (async (input: Request): Promise<Response> => {
    const method = input.method;
    const text = await input.clone().text();
    const body = text.length > 0 ? JSON.parse(text) : undefined;
    const recorded: RecordedRequest = { url: input.url, method, body };
    requests.push(recorded);
    return handler(recorded);
  }) as unknown as typeof fetch;
  return { fetch: impl, requests };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

const BASE_URL = 'https://api.test';

function makeApi(handler: (req: RecordedRequest) => Response) {
  const { fetch, requests } = fakeFetch(handler);
  const api = createAuthApi({ clientOptions: { baseUrl: BASE_URL, fetch } });
  return { api, requests };
}

describe('createAuthApi — session establishment', () => {
  it('shapes a successful sign-in into a session with an epoch-ms expiry', async () => {
    const expiresAt = '2025-01-01T00:00:00.000Z';
    const { api, requests } = makeApi(() =>
      jsonResponse(200, {
        userId: '11111111-1111-1111-1111-111111111111',
        accessToken: 'access-abc',
        accessTokenExpiresAt: expiresAt,
        refreshToken: 'refresh-xyz',
        refreshTokenExpiresAt: '2025-02-01T00:00:00.000Z',
      }),
    );

    const result = await api.signIn({ email: 'a@b.co', password: 'pw' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session).toEqual({
        accessToken: 'access-abc',
        refreshToken: 'refresh-xyz',
        expiresAtMs: Date.parse(expiresAt),
      });
    }
    expect(requests[0]?.url).toBe(`${BASE_URL}/auth/sign-in`);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.body).toEqual({ email: 'a@b.co', password: 'pw' });
  });

  it('relays the Google assertion to the google endpoint', async () => {
    const { api, requests } = makeApi(() =>
      jsonResponse(200, {
        accessToken: 'access',
        accessTokenExpiresAt: '2025-01-01T00:00:00Z',
        refreshToken: 'refresh',
        refreshTokenExpiresAt: '2025-02-01T00:00:00Z',
      }),
    );

    const result = await api.signInGoogle('google-assertion-token');

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${BASE_URL}/auth/sign-in/google`);
    expect(requests[0]?.body).toEqual({ assertion: 'google-assertion-token' });
  });

  it('sends the refresh token to the refresh endpoint', async () => {
    const { api, requests } = makeApi(() =>
      jsonResponse(200, {
        accessToken: 'a2',
        accessTokenExpiresAt: '2025-01-01T00:00:00Z',
        refreshToken: 'r2',
        refreshTokenExpiresAt: '2025-02-01T00:00:00Z',
      }),
    );

    const result = await api.refresh('current-refresh');

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${BASE_URL}/auth/refresh`);
    expect(requests[0]?.body).toEqual({ refreshToken: 'current-refresh' });
  });

  it('resolves a session response missing a token to a generic outcome', async () => {
    const { api } = makeApi(() =>
      jsonResponse(200, { accessToken: 'only-access' }),
    );

    const result = await api.signIn({ email: 'a@b.co', password: 'pw' });

    expect(result).toEqual({ ok: false, outcome: { kind: 'generic' } });
  });
});

describe('createAuthApi — error shaping (non-disclosing)', () => {
  it('maps a 401 sign-in problem to auth-failure', async () => {
    const { api } = makeApi(() =>
      jsonResponse(401, {
        title: 'AuthenticationFailed',
        code: 'AuthenticationFailed',
        status: 401,
        detail: 'internal detail that must never surface',
      }),
    );

    const result = await api.signIn({ email: 'a@b.co', password: 'pw' });

    expect(result).toEqual({ ok: false, outcome: { kind: 'auth-failure' } });
  });

  it('maps a 403 email-not-verified problem to email-not-verified', async () => {
    const { api } = makeApi(() =>
      jsonResponse(403, {
        title: 'EmailNotVerified',
        code: 'EmailNotVerified',
        status: 403,
      }),
    );

    const result = await api.signIn({ email: 'a@b.co', password: 'pw' });

    expect(result).toEqual({
      ok: false,
      outcome: { kind: 'email-not-verified' },
    });
  });

  it('maps a 409 register conflict to email-already-registered', async () => {
    const { api } = makeApi(() =>
      jsonResponse(409, {
        title: 'EmailAlreadyRegistered',
        code: 'EmailAlreadyRegistered',
        status: 409,
      }),
    );

    const result = await api.register({ email: 'a@b.co', password: 'pw' });

    expect(result).toEqual({
      ok: false,
      outcome: { kind: 'email-already-registered' },
    });
  });

  it('maps a 400 TokenInvalid redeem problem to invalid-or-expired-token', async () => {
    const { api } = makeApi(() =>
      jsonResponse(400, {
        title: 'TokenInvalid',
        code: 'TokenInvalid',
        status: 400,
      }),
    );

    const result = await api.redeemPasswordReset({
      token: 'reset-token',
      newPassword: 'a-new-strong-password',
    });

    expect(result).toEqual({
      ok: false,
      outcome: { kind: 'invalid-or-expired-token' },
    });
  });

  it('maps a 400 PasswordPolicy problem to a controlled validation outcome', async () => {
    const { api } = makeApi(() =>
      jsonResponse(400, {
        title: 'PasswordPolicy',
        code: 'PasswordPolicy',
        status: 400,
      }),
    );

    const result = await api.redeemPasswordReset({
      token: 'reset-token',
      newPassword: 'short',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome.kind).toBe('validation');
    }
  });
});

describe('createAuthApi — valueless acknowledgements', () => {
  it('treats a 204 reset-request response as success', async () => {
    const { api, requests } = makeApi(() => noContent());

    const result = await api.requestPasswordReset('a@b.co');

    expect(result).toEqual({ ok: true });
    expect(requests[0]?.url).toBe(`${BASE_URL}/auth/password-reset/request`);
    expect(requests[0]?.body).toEqual({ email: 'a@b.co' });
  });

  it('posts the refresh token when signing out', async () => {
    const { api, requests } = makeApi(() => noContent());

    const result = await api.signOut('refresh-to-revoke');

    expect(result).toEqual({ ok: true });
    expect(requests[0]?.url).toBe(`${BASE_URL}/auth/sign-out`);
    expect(requests[0]?.body).toEqual({ refreshToken: 'refresh-to-revoke' });
  });

  it('redeems an email-verification token at the redeem endpoint', async () => {
    const { api, requests } = makeApi(() => noContent());

    const result = await api.redeemEmailVerification('verify-token');

    expect(result).toEqual({ ok: true });
    expect(requests[0]?.url).toBe(
      `${BASE_URL}/auth/email/verification/redeem`,
    );
    expect(requests[0]?.body).toEqual({ token: 'verify-token' });
  });

  it('requests a new verification message with no body', async () => {
    const { api, requests } = makeApi(() => noContent());

    const result = await api.requestEmailVerification();

    expect(result).toEqual({ ok: true });
    expect(requests[0]?.url).toBe(
      `${BASE_URL}/auth/email/verification/request`,
    );
    expect(requests[0]?.body).toBeUndefined();
  });
});
