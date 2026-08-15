/**
 * Unit tests for the GoogleSignInControl branches (task 12.2).
 *
 * The control (task 12.1) runs an injected Google flow seam
 * (`requestGoogleAssertion`), relays a produced assertion verbatim to
 * `authApi.signInGoogle`, and stays retryable on every non-success outcome.
 * These tests cover its four control branches and its relay/persistence
 * contract:
 *
 *   - assertion → call (success): the assertion is relayed verbatim and the
 *     resulting session payload is surfaced via `onSession` (Requirement 4.6);
 *   - verbatim + never persisted: the exact assertion string reaches
 *     `signInGoogle` unmodified and is never written to storage (Requirement
 *     4.6);
 *   - cancel / no-assertion (and a thrown flow): no backend call, the
 *     incomplete message shows, the control stays retryable (Requirement 4.4);
 *   - backend rejection: non-disclosing copy, no session, `onFailure` fired,
 *     retryable (Requirement 4.5);
 *   - timeout / network: retryable copy, control restored, `onFailure` fired
 *     (Requirement 4.8);
 *   - in-flight guard: a second activation while a call is pending does not
 *     trigger a second backend call.
 *
 * Feature: web-auth-screens
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AuthSessionPayload,
  AuthSessionResult,
  FailureOutcome,
} from '../api/authApi'
import { messageForOutcome } from '../lib/errorMapping'
import {
  GoogleSignInControl,
  GOOGLE_SIGN_IN_DEFAULT_LABEL,
  GOOGLE_SIGN_IN_INCOMPLETE_MESSAGE,
} from './GoogleSignInControl'

/** A representative Google OIDC ID token — opaque to the control. */
const ASSERTION =
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.q-signature-part'

/** A session payload the fake backend returns on the success path. */
const SESSION: AuthSessionPayload = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  expiresAtMs: 1_900_000_000_000,
}

/** A `signInGoogle` fake that always resolves to the given result. */
function fakeSignInGoogle(result: AuthSessionResult) {
  return { signInGoogle: vi.fn(async () => result) }
}

/** A deferred promise helper for asserting the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('GoogleSignInControl — assertion → call (success)', () => {
  // Validates: Requirements 4.6 — assertion relayed verbatim; session surfaced.
  it('relays the exact assertion to signInGoogle once and surfaces the session', async () => {
    const user = userEvent.setup()
    const requestGoogleAssertion = vi.fn(async () => ASSERTION)
    const authApi = fakeSignInGoogle({ ok: true, session: SESSION })
    const onSession = vi.fn()
    const onFailure = vi.fn()

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onSession}
        onFailure={onFailure}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: GOOGLE_SIGN_IN_DEFAULT_LABEL }),
    )

    await waitFor(() => expect(onSession).toHaveBeenCalledTimes(1))

    // Called exactly once, with the EXACT assertion string produced by the flow.
    expect(authApi.signInGoogle).toHaveBeenCalledTimes(1)
    expect(authApi.signInGoogle).toHaveBeenCalledWith(ASSERTION)
    // The session payload is relayed to the parent unchanged.
    expect(onSession).toHaveBeenCalledWith(SESSION)
    expect(onFailure).not.toHaveBeenCalled()
  })

  // Validates: Requirements 4.6 — never inspected/mutated and never persisted.
  it('passes the assertion through verbatim and never writes it to storage', async () => {
    const user = userEvent.setup()
    const setLocal = vi.spyOn(Storage.prototype, 'setItem')
    const requestGoogleAssertion = vi.fn(async () => ASSERTION)
    const authApi = fakeSignInGoogle({ ok: true, session: SESSION })

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button'))
    await waitFor(() => expect(authApi.signInGoogle).toHaveBeenCalledTimes(1))

    // Verbatim: the argument is the identical, unmodified string.
    const relayed = authApi.signInGoogle.mock.calls[0][0]
    expect(relayed).toBe(ASSERTION)

    // Never persisted: no storage write carried the assertion, and neither web
    // storage area contains it after the call.
    for (const [, value] of setLocal.mock.calls) {
      expect(value).not.toContain(ASSERTION)
    }
    const allStored = [
      ...Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k)),
      ...Object.keys(window.sessionStorage).map((k) =>
        window.sessionStorage.getItem(k),
      ),
    ]
    expect(allStored.some((v) => v?.includes(ASSERTION))).toBe(false)
  })
})

describe('GoogleSignInControl — cancel / no assertion (Req 4.4)', () => {
  // Validates: Requirements 4.4 — a null assertion is treated as incomplete.
  it('does not call the backend and shows the incomplete message, staying retryable', async () => {
    const user = userEvent.setup()
    const requestGoogleAssertion = vi.fn(async () => null)
    const authApi = fakeSignInGoogle({ ok: true, session: SESSION })
    const onSession = vi.fn()
    const onFailure = vi.fn()

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onSession}
        onFailure={onFailure}
      />,
    )

    const button = screen.getByRole('button')
    await user.click(button)

    // The incomplete copy is announced and no backend call was made.
    expect(await screen.findByText(GOOGLE_SIGN_IN_INCOMPLETE_MESSAGE)).toBeInTheDocument()
    expect(authApi.signInGoogle).not.toHaveBeenCalled()
    expect(onSession).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()

    // The control returns to an enabled, retryable state.
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).not.toHaveAttribute('aria-busy')
  })

  // Validates: Requirements 4.4 — a thrown Google flow is treated as incomplete.
  it('treats a thrown Google flow as incomplete and stays retryable', async () => {
    const user = userEvent.setup()
    const requestGoogleAssertion = vi.fn(async () => {
      throw new Error('popup closed')
    })
    const authApi = fakeSignInGoogle({ ok: true, session: SESSION })
    const onSession = vi.fn()

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onSession}
      />,
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(await screen.findByText(GOOGLE_SIGN_IN_INCOMPLETE_MESSAGE)).toBeInTheDocument()
    expect(authApi.signInGoogle).not.toHaveBeenCalled()
    expect(onSession).not.toHaveBeenCalled()
    await waitFor(() => expect(button).toBeEnabled())
  })
})

describe('GoogleSignInControl — backend rejection (Req 4.5)', () => {
  // Validates: Requirements 4.5 — rejection keeps the person on-screen, retryable.
  it('shows non-disclosing copy, fires onFailure, does not establish a session, and stays retryable', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = { kind: 'auth-failure' }
    const requestGoogleAssertion = vi.fn(async () => ASSERTION)
    const authApi = fakeSignInGoogle({ ok: false, outcome })
    const onSession = vi.fn()
    const onFailure = vi.fn()

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onSession}
        onFailure={onFailure}
      />,
    )

    const button = screen.getByRole('button')
    await user.click(button)

    // The mapped, non-disclosing Google failure copy is shown.
    const expected = messageForOutcome(outcome, 'google')
    expect(await screen.findByText(expected)).toBeInTheDocument()

    expect(onSession).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(outcome)

    // Retryable: the control is enabled again and a second activation re-calls.
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await waitFor(() => expect(authApi.signInGoogle).toHaveBeenCalledTimes(2))
  })
})

describe('GoogleSignInControl — timeout / network (Req 4.8)', () => {
  // Validates: Requirements 4.8 — restore control and show retryable copy.
  it('shows retryable copy, fires onFailure, and restores the control to available', async () => {
    const user = userEvent.setup()
    const outcome: FailureOutcome = { kind: 'timeout-or-network' }
    const requestGoogleAssertion = vi.fn(async () => ASSERTION)
    const authApi = fakeSignInGoogle({ ok: false, outcome })
    const onSession = vi.fn()
    const onFailure = vi.fn()

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={authApi}
        onSession={onSession}
        onFailure={onFailure}
      />,
    )

    const button = screen.getByRole('button')
    await user.click(button)

    const expected = messageForOutcome(outcome, 'google')
    expect(await screen.findByText(expected)).toBeInTheDocument()

    expect(onSession).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(outcome)

    await waitFor(() => expect(button).toBeEnabled())
    expect(button).not.toHaveAttribute('aria-busy')
  })
})

describe('GoogleSignInControl — in-flight guard (Req 4.7 semantics)', () => {
  // A slow backend call keeps the control busy; a second activation is a no-op.
  it('disables the control while pending and blocks a second backend call', async () => {
    const user = userEvent.setup()
    const pending = deferred<AuthSessionResult>()
    const requestGoogleAssertion = vi.fn(async () => ASSERTION)
    const signInGoogle = vi.fn(() => pending.promise)
    const onSession = vi.fn()

    render(
      <GoogleSignInControl
        requestGoogleAssertion={requestGoogleAssertion}
        authApi={{ signInGoogle }}
        onSession={onSession}
        pendingLabel="Signing in with Google…"
      />,
    )

    const button = screen.getByRole('button')
    await user.click(button)

    // In-flight: the button is disabled with aria-busy and shows the pending label.
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(signInGoogle).toHaveBeenCalledTimes(1))

    // A second activation while the first call is pending does nothing.
    await user.click(button)
    expect(signInGoogle).toHaveBeenCalledTimes(1)

    // Resolve the in-flight call; the control settles back to available.
    pending.resolve({ ok: true, session: SESSION })
    await waitFor(() => expect(onSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(button).toBeEnabled())
  })
})
