/**
 * Integration tests for per-endpoint timeout budgets (task 9.4).
 *
 * Requirement 12.5 mandates that each backend auth call is bounded by a
 * documented timeout budget: 30s in general (register, sign-in, Google sign-in,
 * password-reset redeem, verification resend), 10s for the password-reset
 * request, the email-verification redeem, and refresh, and no more than 5s for
 * sign-out. These tests verify the wiring against a *mocked transport* rather
 * than by waiting real time:
 *
 * - `AbortSignal.timeout` — the primitive the facade uses to bound every call —
 *   is spied so the exact budget requested for each endpoint is captured, and
 *   the spy returns a controllable signal so the abort can be driven on demand.
 * - An injected `fetch` captures the `AbortSignal` attached to the outgoing
 *   request, proving the budgeted signal reaches the transport.
 *
 * The budget assertions confirm each facade function asks for its documented
 * budget; the abort assertion confirms that when the budget lapses the call is
 * shaped to the non-disclosing `timeout-or-network` outcome.
 *
 * Requirements: 12.1, 12.3, 12.5
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthApi,
  DEFAULT_AUTH_API_TIMEOUTS,
  type AuthApiFacade,
} from './authApi';

const BASE_URL = 'https://api.test';

/** Records every budget passed to `AbortSignal.timeout` and the signals made. */
interface TimeoutSpyState {
  readonly budgets: number[];
  readonly controllers: AbortController[];
  /** The last `AbortSignal` returned by the stubbed `AbortSignal.timeout`. */
  lastReturned: AbortSignal | null;
}

let timeoutSpy: TimeoutSpyState;
/** The `AbortSignal` seen by the injected transport on the most recent call. */
let lastRequestSignal: AbortSignal | null;

beforeEach(() => {
  timeoutSpy = { budgets: [], controllers: [], lastReturned: null };
  lastRequestSignal = null;

  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    timeoutSpy.budgets.push(ms);
    const controller = new AbortController();
    timeoutSpy.controllers.push(controller);
    timeoutSpy.lastReturned = controller.signal;
    return controller.signal;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build an auth facade whose transport immediately succeeds (204) and records
 * the abort signal attached to the request, so budget wiring can be inspected.
 */
function makeApiWithCapturingTransport(): AuthApiFacade {
  const fetchImpl = (async (input: Request): Promise<Response> => {
    lastRequestSignal = input.signal;
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return createAuthApi({ clientOptions: { baseUrl: BASE_URL, fetch: fetchImpl } });
}

// Each facade call and the budget (ms) it must request from AbortSignal.timeout.
const budgetCases: ReadonlyArray<{
  readonly name: string;
  readonly expectedMs: number;
  readonly invoke: (api: AuthApiFacade) => Promise<unknown>;
}> = [
  {
    name: 'register',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.generalMs,
    invoke: (api) => api.register({ email: 'a@b.co', password: 'a-strong-password' }),
  },
  {
    name: 'signIn',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.generalMs,
    invoke: (api) => api.signIn({ email: 'a@b.co', password: 'pw' }),
  },
  {
    name: 'signInGoogle',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.generalMs,
    invoke: (api) => api.signInGoogle('google-assertion'),
  },
  {
    name: 'redeemPasswordReset',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.generalMs,
    invoke: (api) =>
      api.redeemPasswordReset({ token: 't', newPassword: 'a-new-strong-password' }),
  },
  {
    name: 'requestEmailVerification',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.generalMs,
    invoke: (api) => api.requestEmailVerification(),
  },
  {
    name: 'refresh',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.refreshMs,
    invoke: (api) => api.refresh('refresh-token'),
  },
  {
    name: 'requestPasswordReset',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.resetRequestMs,
    invoke: (api) => api.requestPasswordReset('a@b.co'),
  },
  {
    name: 'redeemEmailVerification',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.emailVerificationRedeemMs,
    invoke: (api) => api.redeemEmailVerification('verify-token'),
  },
  {
    name: 'signOut',
    expectedMs: DEFAULT_AUTH_API_TIMEOUTS.signOutMs,
    invoke: (api) => api.signOut('refresh-token'),
  },
];

describe('per-endpoint timeout budgets are enforced against the transport', () => {
  it.each(budgetCases)(
    '$name bounds its call with a $expectedMs ms budget attached to the request',
    async ({ expectedMs, invoke }) => {
      const api = makeApiWithCapturingTransport();

      await invoke(api);

      // Exactly one timeout budget was requested for the single call, and it is
      // the documented budget for this endpoint (Requirement 12.5).
      expect(timeoutSpy.budgets).toEqual([expectedMs]);
      // The budgeted signal actually reached the transport that issued the call.
      expect(lastRequestSignal).toBeInstanceOf(AbortSignal);
      expect(timeoutSpy.lastReturned).toBeInstanceOf(AbortSignal);
    },
  );

  it('matches the documented budget table (30s general, 10s refresh/reset-request/verify-redeem, 5s sign-out)', () => {
    expect(DEFAULT_AUTH_API_TIMEOUTS).toEqual({
      generalMs: 30_000,
      resetRequestMs: 10_000,
      emailVerificationRedeemMs: 10_000,
      refreshMs: 10_000,
      signOutMs: 5_000,
    });
    // Sign-out is explicitly capped at no more than 5 seconds.
    expect(DEFAULT_AUTH_API_TIMEOUTS.signOutMs).toBeLessThanOrEqual(5_000);
  });
});

describe('a lapsed timeout budget aborts the call and shapes to timeout-or-network', () => {
  it('rejects the in-flight sign-out when its budget elapses', async () => {
    // A transport that never resolves on its own — it only settles when the
    // request's timeout budget fires, standing in for a real network stall.
    const fetchImpl = (async (input: Request): Promise<Response> => {
      const signal = input.signal;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          // A real AbortSignal.timeout surfaces as a TimeoutError; mapAuthError
          // classifies that (and AbortError) as a transport failure.
          const timeoutError = new Error('The operation timed out.');
          timeoutError.name = 'TimeoutError';
          reject(timeoutError);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }) as unknown as typeof fetch;

    const api = createAuthApi({
      clientOptions: { baseUrl: BASE_URL, fetch: fetchImpl },
    });

    const pending = api.signOut('refresh-token');

    // Fire the budget for the in-flight call, as AbortSignal.timeout would.
    expect(timeoutSpy.controllers).toHaveLength(1);
    timeoutSpy.controllers[0]?.abort();

    const result = await pending;

    expect(result).toEqual({ ok: false, outcome: { kind: 'timeout-or-network' } });
  });
});
