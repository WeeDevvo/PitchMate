/**
 * Unit tests for the auth Api_Client middleware (task 9.2).
 *
 * These exercise the middleware two ways: directly against its `onRequest`
 * hook with a fake {@link BearerTokenSource}, and end-to-end through a real
 * generated `openapi-fetch` client (wired via `client.use`) with an injected
 * `fetch` that records the outgoing request headers. They assert that a
 * `{ token }` outcome attaches `Authorization: Bearer <token>` while both error
 * outcomes attach no credential and let the request proceed.
 *
 * The dedicated Property 13 test (bearer-token attachment across all inputs)
 * lives in task 9.3.
 *
 * Requirements: 8.2, 9.1
 */

import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_HEADER,
  bearerCredential,
  createAuthMiddleware,
  createAuthenticatedApiClient,
  type BearerTokenSource,
} from './authMiddleware';

type TokenOutcome = Awaited<
  ReturnType<BearerTokenSource['getAccessTokenForRequest']>
>;

/** A fixed-outcome {@link BearerTokenSource} that records its call count. */
function fakeSource(outcome: TokenOutcome): {
  source: BearerTokenSource;
  calls: () => number;
} {
  let count = 0;
  return {
    source: {
      getAccessTokenForRequest() {
        count += 1;
        return Promise.resolve(outcome);
      },
    },
    calls: () => count,
  };
}

/** Invoke the middleware's `onRequest` hook against a bare request. */
async function runOnRequest(
  source: BearerTokenSource,
  request: Request,
): Promise<Request> {
  const middleware = createAuthMiddleware(source);
  // The client always supplies an onRequest for this middleware.
  const result = await middleware.onRequest?.({
    request,
    schemaPath: '/auth/example',
    params: {},
    id: 'test-request',
    // The hook only reads `request`; the rest of the callback params are
    // irrelevant here and are cast to satisfy the structural type.
  } as never);
  return (result as Request | undefined) ?? request;
}

describe('createAuthMiddleware — onRequest hook', () => {
  it('attaches the bearer credential when a token is available', async () => {
    const { source, calls } = fakeSource({ token: 'access-abc' });
    const request = new Request('https://api.test/data');

    const result = await runOnRequest(source, request);

    expect(result.headers.get(AUTHORIZATION_HEADER)).toBe('Bearer access-abc');
    expect(calls()).toBe(1);
  });

  it('attaches no credential when unauthenticated', async () => {
    const { source } = fakeSource({ error: 'unauthenticated' });
    const request = new Request('https://api.test/data');

    const result = await runOnRequest(source, request);

    expect(result.headers.get(AUTHORIZATION_HEADER)).toBeNull();
  });

  it('attaches no credential when the refresh failed', async () => {
    const { source } = fakeSource({ error: 'refresh-failed' });
    const request = new Request('https://api.test/data');

    const result = await runOnRequest(source, request);

    expect(result.headers.get(AUTHORIZATION_HEADER)).toBeNull();
  });
});

describe('bearerCredential', () => {
  it('formats a token as an HTTP Bearer value', () => {
    expect(bearerCredential('xyz')).toBe('Bearer xyz');
  });
});

describe('createAuthenticatedApiClient — end-to-end header attachment', () => {
  interface RecordedRequest {
    readonly url: string;
    readonly authorization: string | null;
  }

  function recordingFetch(): {
    fetch: typeof fetch;
    requests: RecordedRequest[];
  } {
    const requests: RecordedRequest[] = [];
    const impl = (async (input: Request): Promise<Response> => {
      requests.push({
        url: input.url,
        authorization: input.headers.get(AUTHORIZATION_HEADER),
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    return { fetch: impl, requests };
  }

  it('carries the current access token on requests through the client', async () => {
    const { source } = fakeSource({ token: 'live-token' });
    const { fetch, requests } = recordingFetch();
    const client = createAuthenticatedApiClient(source, {
      baseUrl: 'https://api.test',
      fetch,
    });

    await client.POST('/auth/sign-out', { body: { refreshToken: 'r' } });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe('Bearer live-token');
  });

  it('sends no credential when the source is unauthenticated', async () => {
    const { source } = fakeSource({ error: 'unauthenticated' });
    const { fetch, requests } = recordingFetch();
    const client = createAuthenticatedApiClient(source, {
      baseUrl: 'https://api.test',
      fetch,
    });

    await client.POST('/auth/sign-out', { body: { refreshToken: 'r' } });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBeNull();
  });
});
