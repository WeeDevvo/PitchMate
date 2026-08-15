/**
 * Unit tests for the Verify_Email_Screen branches (task 17.2).
 *
 * The screen (task 17.1) reads the Email_Verification_Token from the URL query
 * string, redeems it on open through `authApi.redeemEmailVerification`, and
 * reports each backend outcome with non-disclosing copy plus the appropriate
 * control. The request-new-verification control is session-gated. These tests
 * cover its required branches:
 *
 *   - token-present redeem: with a token the redeem is called with that token
 *     and, on success, the verified confirmation and a proceed control are shown
 *     (Requirements 7.1, 7.3);
 *   - in-progress disables resend: while the redeem is awaiting a response the
 *     in-progress indicator is shown and the request-new control is disabled
 *     (Requirement 7.2);
 *   - success routing: unauthenticated success proceeds to the Log_In_Screen;
 *     authenticated success proceeds to the Redirect_Target (Requirement 7.3);
 *   - invalid/expired/used: the link-no-longer-valid message with a
 *     request-new-verification control (Requirement 7.4);
 *   - missing-token: the invalid/incomplete message with a request-new control
 *     and no backend call (Requirement 7.7);
 *   - session-gated resend routing: authenticated → `requestEmailVerification`;
 *     unauthenticated → a link that directs to the Log_In_Screen
 *     (Requirements 7.5, 7.6);
 *   - timeout retry preserving token: a `timeout-or-network` redeem shows a
 *     retryable message and a retry control that re-runs the redeem with the
 *     same preserved token (Requirement 7.8).
 *
 * The screen owns no session logic: the tests inject a fake `authApi`, supply
 * the token via the `search` prop, and wrap the screen in a real `AuthProvider`
 * (over an in-memory `SessionManager`) so the session-gated behaviour is
 * exercised against genuine auth state. It links via the shared `LinkButton`
 * (react-router `useNavigate`) and reads the router location, so it is rendered
 * inside a `MemoryRouter`.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from './session/AuthContext'
import {
  createSessionManager,
  type AuthApi,
  type RefreshResult,
  type SessionManager,
  type SignOutResult,
} from './session/SessionManager'
import { createInMemorySessionStore } from './session/SessionStore'
import { messageForOutcome } from './lib/errorMapping'
import type { AuthAckResult } from './api/authApi'
import {
  VerifyEmailScreen,
  VERIFYING_MESSAGE,
  MISSING_TOKEN_MESSAGE,
  RESEND_SUCCESS_MESSAGE,
  SEND_NEW_VERIFICATION_LABEL,
  LOG_IN_TO_VERIFY_LABEL,
  RETRY_LABEL,
  CONTINUE_TO_LOG_IN_LABEL,
  CONTINUE_TO_APP_LABEL,
  LOG_IN_PATH,
  DEFAULT_AUTHENTICATED_PATH,
} from './VerifyEmailScreen'

/** A search string carrying a present Email_Verification_Token. */
const TOKEN_SEARCH = '?token=abc123'
/** The decoded token value carried by {@link TOKEN_SEARCH}. */
const TOKEN = 'abc123'

/** The screen-appropriate success copy from the pure error-mapping layer. */
const SUCCESS_MESSAGE = messageForOutcome({ kind: 'success' }, 'verify-email')
/** The screen-appropriate invalid-or-expired copy. */
const INVALID_MESSAGE = messageForOutcome(
  { kind: 'invalid-or-expired-token' },
  'verify-email',
)
/** The screen-appropriate timeout/network copy. */
const TIMEOUT_MESSAGE = messageForOutcome(
  { kind: 'timeout-or-network' },
  'verify-email',
)

/** Build a fake auth API with controllable redeem/request results. */
function fakeApi(
  results: { redeem?: AuthAckResult; request?: AuthAckResult } = {},
) {
  return {
    redeemEmailVerification: vi.fn(
      async (): Promise<AuthAckResult> => results.redeem ?? { ok: true },
    ),
    requestEmailVerification: vi.fn(
      async (): Promise<AuthAckResult> => results.request ?? { ok: true },
    ),
  }
}

/** A stub backend seam for the SessionManager; never exercised by the screen. */
function stubSessionApi(): AuthApi {
  return {
    refresh: vi.fn(
      async (): Promise<RefreshResult> => ({ kind: 'invalid-or-expired' }),
    ),
    signOut: vi.fn(async (): Promise<SignOutResult> => ({ kind: 'success' })),
  }
}

/** Build a real SessionManager, optionally already holding a Session. */
function makeManager(authenticated: boolean): SessionManager {
  const manager = createSessionManager({
    storage: createInMemorySessionStore(),
    api: stubSessionApi(),
    now: () => 1_000_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  })
  if (authenticated) {
    manager.establish({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtMs: 5_000_000,
    })
  }
  return manager
}

interface RenderOverrides {
  authApi?: ReturnType<typeof fakeApi>
  search?: string
  authenticated?: boolean
  redirectTarget?: string
}

/** Render the screen inside a router + AuthProvider, allowing overrides. */
function renderScreen(overrides: RenderOverrides = {}) {
  const authApi = overrides.authApi ?? fakeApi()
  const search = overrides.search ?? TOKEN_SEARCH
  const manager = makeManager(overrides.authenticated ?? false)
  render(
    <MemoryRouter>
      <AuthProvider manager={manager}>
        <VerifyEmailScreen
          authApi={authApi}
          search={search}
          redirectTarget={overrides.redirectTarget}
        />
      </AuthProvider>
    </MemoryRouter>,
  )
  return { authApi, manager }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VerifyEmailScreen — token-present redeem + success (Req 7.1, 7.3)', () => {
  it('redeems the token from the URL and, unauthenticated, offers a proceed-to-login control', async () => {
    const { authApi } = renderScreen({ authApi: fakeApi({ redeem: { ok: true } }) })

    await waitFor(() =>
      expect(authApi.redeemEmailVerification).toHaveBeenCalledTimes(1),
    )
    expect(authApi.redeemEmailVerification).toHaveBeenCalledWith(TOKEN)

    // Confirmation is shown...
    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument()
    // ...and the proceed-to-login control is presented (no Session established).
    const loginLink = screen.getByRole('link', {
      name: CONTINUE_TO_LOG_IN_LABEL,
    })
    expect(loginLink).toHaveAttribute('href', LOG_IN_PATH)
    // No resend control on the success path.
    expect(
      screen.queryByRole('button', { name: SEND_NEW_VERIFICATION_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('proceeds to the Redirect_Target on success WHERE a Session is established (Req 7.3)', async () => {
    renderScreen({ authenticated: true, redirectTarget: '/squads' })

    const link = await screen.findByRole('link', { name: CONTINUE_TO_APP_LABEL })
    expect(link).toHaveAttribute('href', '/squads')
    // The proceed-to-login control is not shown when a Session exists.
    expect(
      screen.queryByRole('link', { name: CONTINUE_TO_LOG_IN_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('falls back to the default authenticated route when no Redirect_Target is supplied', async () => {
    renderScreen({ authenticated: true })

    const link = await screen.findByRole('link', { name: CONTINUE_TO_APP_LABEL })
    expect(link).toHaveAttribute('href', DEFAULT_AUTHENTICATED_PATH)
  })
})

describe('VerifyEmailScreen — in-progress disables resend (Req 7.2)', () => {
  it('shows the in-progress indicator and disables the resend control while redeeming', async () => {
    // A redeem that never resolves keeps the screen in the verifying state.
    const authApi = {
      redeemEmailVerification: vi.fn(
        (): Promise<AuthAckResult> => new Promise<AuthAckResult>(() => {}),
      ),
      requestEmailVerification: vi.fn(
        async (): Promise<AuthAckResult> => ({ ok: true }),
      ),
    }
    render(
      <MemoryRouter>
        <AuthProvider manager={makeManager(true)}>
          <VerifyEmailScreen authApi={authApi} search={TOKEN_SEARCH} />
        </AuthProvider>
      </MemoryRouter>,
    )

    // The visible in-progress indicator is shown (Requirement 7.2).
    expect(await screen.findByText(VERIFYING_MESSAGE)).toBeInTheDocument()

    // The control that would trigger a new verification request is disabled.
    const resend = screen.getByRole('button', {
      name: SEND_NEW_VERIFICATION_LABEL,
    })
    expect(resend).toBeDisabled()
    expect(resend).toHaveAttribute('aria-busy', 'true')
  })
})

describe('VerifyEmailScreen — invalid / expired / used token (Req 7.4)', () => {
  it('shows the link-no-longer-valid message and a request-new-verification control', async () => {
    renderScreen({
      authApi: fakeApi({
        redeem: { ok: false, outcome: { kind: 'invalid-or-expired-token' } },
      }),
    })

    expect(await screen.findByText(INVALID_MESSAGE)).toBeInTheDocument()
    // Unauthenticated: the request-new control routes to the Log_In_Screen.
    expect(
      screen.getByRole('link', { name: LOG_IN_TO_VERIFY_LABEL }),
    ).toHaveAttribute('href', LOG_IN_PATH)
    // The person stays on the screen: no success control appears.
    expect(
      screen.queryByRole('link', { name: CONTINUE_TO_LOG_IN_LABEL }),
    ).not.toBeInTheDocument()
  })
})

describe('VerifyEmailScreen — missing token (Req 7.7)', () => {
  it('shows the invalid/incomplete message, offers a request-new control, and never redeems', async () => {
    const { authApi } = renderScreen({ search: '' })

    expect(screen.getByText(MISSING_TOKEN_MESSAGE)).toBeInTheDocument()
    expect(authApi.redeemEmailVerification).not.toHaveBeenCalled()
    // Unauthenticated: request-new routes to the Log_In_Screen.
    expect(
      screen.getByRole('link', { name: LOG_IN_TO_VERIFY_LABEL }),
    ).toHaveAttribute('href', LOG_IN_PATH)
  })
})

describe('VerifyEmailScreen — session-gated resend routing (Req 7.5, 7.6)', () => {
  it('authenticated: the request-new control resends via requestEmailVerification', async () => {
    const user = userEvent.setup()
    const authApi = fakeApi({
      redeem: { ok: false, outcome: { kind: 'invalid-or-expired-token' } },
      request: { ok: true },
    })
    renderScreen({ authApi, authenticated: true })

    await screen.findByText(INVALID_MESSAGE)

    const resend = screen.getByRole('button', {
      name: SEND_NEW_VERIFICATION_LABEL,
    })
    await user.click(resend)

    await waitFor(() =>
      expect(authApi.requestEmailVerification).toHaveBeenCalledTimes(1),
    )
    expect(await screen.findByText(RESEND_SUCCESS_MESSAGE)).toBeInTheDocument()
  })

  it('unauthenticated: the request-new control directs to the Log_In_Screen and does not resend', async () => {
    const authApi = fakeApi({
      redeem: { ok: false, outcome: { kind: 'invalid-or-expired-token' } },
    })
    renderScreen({ authApi })

    await screen.findByText(INVALID_MESSAGE)

    const link = screen.getByRole('link', { name: LOG_IN_TO_VERIFY_LABEL })
    expect(link).toHaveAttribute('href', LOG_IN_PATH)
    // No authenticated resend button, and the resend endpoint is never called.
    expect(
      screen.queryByRole('button', { name: SEND_NEW_VERIFICATION_LABEL }),
    ).not.toBeInTheDocument()
    expect(authApi.requestEmailVerification).not.toHaveBeenCalled()
  })
})

describe('VerifyEmailScreen — timeout / network retry preserving token (Req 7.8)', () => {
  it('shows a retryable message and retries the redeem with the same token', async () => {
    const user = userEvent.setup()
    let call = 0
    const authApi = {
      redeemEmailVerification: vi.fn(async (): Promise<AuthAckResult> => {
        call += 1
        return call === 1
          ? { ok: false, outcome: { kind: 'timeout-or-network' } }
          : { ok: true }
      }),
      requestEmailVerification: vi.fn(
        async (): Promise<AuthAckResult> => ({ ok: true }),
      ),
    }
    render(
      <MemoryRouter>
        <AuthProvider manager={makeManager(false)}>
          <VerifyEmailScreen authApi={authApi} search={TOKEN_SEARCH} />
        </AuthProvider>
      </MemoryRouter>,
    )

    // The retryable message and retry control are shown.
    expect(await screen.findByText(TIMEOUT_MESSAGE)).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: RETRY_LABEL })

    await user.click(retry)

    // The redeem is retried with the SAME preserved token (Requirement 7.8).
    await waitFor(() =>
      expect(authApi.redeemEmailVerification).toHaveBeenCalledTimes(2),
    )
    expect(authApi.redeemEmailVerification).toHaveBeenNthCalledWith(1, TOKEN)
    expect(authApi.redeemEmailVerification).toHaveBeenNthCalledWith(2, TOKEN)

    // The retry succeeds and the confirmation is shown.
    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument()
  })
})
