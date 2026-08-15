/**
 * AuthContext — a thin React context over the framework-agnostic {@link SessionManager}.
 *
 * The {@link SessionManager} (`./SessionManager`) is the single source of session
 * truth: it owns the in-memory Session, keeps it in step with persistence, and
 * publishes the derived {@link AuthState} to subscribers. This context is a
 * deliberately thin React wrapper over that model — it does not own session
 * logic, it merely mirrors the manager's `AuthState` into React state and exposes
 * the two triggers screens need (`establish`/`signOut`). It follows the landing
 * feature's `useTheme` co-location convention: the provider and its context hook
 * live together in one module (Requirement 8.7).
 *
 * The Access_Token and Refresh_Token are opaque credentials handled entirely by
 * the {@link SessionManager}; they are intentionally NOT exposed through this
 * context. Consumers read the coarse `state` and trigger transitions; the manager
 * attaches bearer credentials to requests just-in-time (task 9.2).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthState, Session, SessionManager } from './SessionManager'

/**
 * The value exposed through {@link useAuth}.
 *
 * - `state` — the current derived {@link AuthState}, kept in step with the
 *   {@link SessionManager} via its `subscribe` seam (Requirement 8.7).
 * - `establish` — replace and persist the current Session, delegating to
 *   {@link SessionManager.establish}; subscribers (including this context) move
 *   to `authenticated`.
 * - `signOut` — trigger an explicit sign-out via {@link SessionManager.signOut};
 *   resolves once the manager has ended the Session `unauthenticated`.
 *
 * Raw tokens are intentionally absent: the Access_Token is an opaque credential
 * handled by the {@link SessionManager}, never surfaced through React context.
 */
export interface AuthContextValue {
  /** The current derived auth state, mirrored from the SessionManager. */
  readonly state: AuthState
  /** Replace and persist the current Session (delegates to the manager). */
  readonly establish: (session: Session) => void
  /** Explicit sign-out; always ends unauthenticated (delegates to the manager). */
  readonly signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/**
 * Read the current auth context value.
 *
 * Must be called from within an {@link AuthProvider}; mirrors the `useTheme`
 * error pattern from the landing feature so misuse fails loudly in development.
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hook are intentionally co-located
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return value
}

export interface AuthProviderProps {
  /**
   * The session model to wrap. Injected as a prop rather than constructed here,
   * matching the framework-agnostic design: app wiring (task 19.1) owns the
   * manager's lifecycle (including `bootstrap` at startup); this provider only
   * mirrors its state into React.
   */
  readonly manager: SessionManager
  readonly children: ReactNode
}

/**
 * Provide the auth context, sourcing `state` from the injected
 * {@link SessionManager}.
 *
 * On mount the local state is seeded from `manager.getState()` and the provider
 * subscribes to the manager's state-change notifications, returning the
 * unsubscribe as the effect cleanup so the subscription is torn down on unmount
 * or when the manager instance changes. Bootstrap is intentionally NOT invoked
 * here — restoring persisted state at startup is app-wiring's concern (task
 * 19.1); the provider seeds from `getState()` and stays in step via `subscribe`.
 *
 * The context value is memoised on `state`; `establish` and `signOut` are stable
 * thin delegates to the manager.
 *
 * Requirement: 8.7
 */
export function AuthProvider({ manager, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() => manager.getState())

  useEffect(() => {
    // Stay in step with the manager: subscribe for future transitions, then
    // reconcile once in case the state moved between the initial render and
    // this effect running. The functional updater only triggers a re-render
    // when the reconciled state actually differs from what React already holds.
    const reconcile = (next: AuthState) => {
      setState((current) => (current === next ? current : next))
    }
    const unsubscribe = manager.subscribe(reconcile)
    reconcile(manager.getState())
    return unsubscribe
  }, [manager])

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      establish: (session: Session) => manager.establish(session),
      signOut: () => manager.signOut(),
    }),
    [state, manager],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
