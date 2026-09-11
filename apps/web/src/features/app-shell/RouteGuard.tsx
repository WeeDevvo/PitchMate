/**
 * The Route_Guard — the authenticated boundary every shell route sits behind.
 *
 * One decision, taken on every render pass: the Auth_State is `authenticated`, so
 * the wrapped subtree renders; or it is not, so **nothing** of the shell renders
 * and the person is sent to the Auth_Feature's Log_In_Route carrying the path
 * they asked for (Requirements 2.1, 2.2).
 *
 * ### Why the unauthenticated branch returns only a navigation
 *
 * Requirement 2.2 forbids rendering the Shell_Frame or the Destination_Content
 * "at any point during the request", and Requirement 2.3 requires that a session
 * ending mid-screen stops rendering the content — and every value it displayed —
 * rather than leaving it on screen behind a redirect. Both fall out of the same
 * shape: while unauthenticated the guard returns `<Navigate />` **instead of**
 * `children`, never alongside it. `children` is an element the caller already
 * described, but an element React is never asked to render is never mounted, so
 * no frame, no destination, and no value inside either reaches the DOM. React
 * unmounts the previously rendered subtree in the same commit as the state
 * change, which is what makes 2.3 hold without any extra teardown here.
 *
 * `Navigate` itself renders nothing — it performs the navigation in an effect and
 * returns `null` — so the guard's unauthenticated output is an empty region plus
 * a redirect, exactly as the design states.
 *
 * ### Why nothing is retained across renders
 *
 * Requirement 2.4 rules out deciding from a stale Auth_State. The guard therefore
 * holds no state, no ref, and no memo: it reads `useAuth().state` and uses that
 * value within the same render pass, so the rendered output is a pure function of
 * the current context value. There is nothing here that could outlive a render
 * and be consulted later.
 *
 * ### Where the redirect comes from
 *
 * The Log_In_Route path and the Redirect_Capture parameter name are the
 * Auth_Feature's `LOG_IN_ROUTE` and `REDIRECT_PARAM_NAME`, imported through its
 * public barrel — the shell keeps no copy of either literal (Requirements 2.6,
 * 15.1, 15.3). The target string itself is built by the pure
 * {@link loginRedirectTarget}, which owns the percent-encoding of the whole
 * requested path (its query string and fragment included) into a single parameter
 * value and the rule that a requested path above 2048 characters is dropped
 * rather than truncated (Requirements 2.5, 2.7).
 *
 * The navigation **replaces** the current history entry, so the browser back
 * control does not return to a shell path the visitor may not enter
 * (Requirement 2.8).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 15.1
 */
import { type ReactElement, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { LOG_IN_ROUTE, REDIRECT_PARAM_NAME, useAuth } from '../auth';
import { loginRedirectTarget } from './lib/redirectCapture';

export interface RouteGuardProps {
  /**
   * The shell subtree admitted only while the Auth_State is `authenticated` —
   * the providers and the Shell_Frame in the route table, arbitrary content in a
   * test. Described by the caller, but rendered by the guard only when the
   * boundary admits the request (Requirement 2.2).
   */
  readonly children?: ReactNode;
}

/**
 * Admit a shell route only while the Auth_State is `authenticated`.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 15.1
 */
export function RouteGuard({ children }: RouteGuardProps): ReactElement | null {
  // 2.4: read on every render pass, retained nowhere.
  const { state } = useAuth();
  const { pathname, search, hash } = useLocation();

  if (state !== 'authenticated') {
    // 2.5: the requested path is what the person actually asked for — path,
    // query string, and fragment — handed over as one encoded value.
    const requestedPath = `${pathname}${search}${hash}`;

    return (
      <Navigate
        to={loginRedirectTarget(requestedPath, LOG_IN_ROUTE, REDIRECT_PARAM_NAME)}
        replace
      />
    );
  }

  return <>{children}</>;
}

export default RouteGuard;
