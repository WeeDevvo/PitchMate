/**
 * The App_Shell's Squad_Scope plumbing.
 *
 * The Squad_Scope decides whether the notification calls ask for one squad's
 * Notification_List and Unread_Count or for the account-wide ones. Requirement
 * 7.2 fixes where that value may come from: **outside the Shell_Frame**, and only
 * from two places —
 *
 * 1. a `squadId` route parameter on a nested shell route, and
 * 2. a hosting Destination_Content calling {@link usePublishSquadScope}.
 *
 * The frame renders no Squad_Scope selection control of its own, and this module
 * offers none: there is no exported control, no list of squads, and nothing here
 * that could fetch one. The shell has no squad read model to render a selector
 * from, and Requirement 7.2 says it must not have one.
 *
 * Every value arriving from either source is untrusted, so both go through the
 * one pure normaliser, `lib/squadScope.ts`. An unusable value is **not** an
 * error (Requirement 7.1): it means no Squad_Scope is active, which the
 * notification calls answer by omitting the squad identity and the backend
 * answers account-wide. Nothing in this module throws over a bad value, and
 * nothing renders a message about one.
 *
 * ### Where the route parameter is read
 *
 * The provider sits above the `Outlet` — between the Theme_Provider and the
 * notification centre — so `useParams` inside it reports only the parameters of
 * the route the provider itself is rendered by and of that route's ancestors. A
 * parameter matched by a **nested** route below the provider is invisible to it,
 * which is a fact about the router, not a choice. The two are therefore covered
 * separately, and both end at the same normalised value:
 *
 * - a `squadId` matched **at or above** the provider's own route is read by the
 *   provider directly, and
 * - a `squadId` matched by a **nested** shell route is bound by that route's
 *   content calling {@link usePublishSquadScopeFromRoute}, a one-line hook that
 *   publishes the parameter and withdraws it when the content leaves.
 *
 * ### Which source wins
 *
 * | `squadId` on the provider's route | Published value | Active Squad_Scope |
 * | --------------------------------- | --------------- | ------------------ |
 * | absent                            | absent          | `null` (account-wide) |
 * | absent                            | any value       | the normalised published value |
 * | present                           | any value       | the normalised route parameter |
 *
 * A route parameter the provider can see wins **whenever the route carries one**,
 * even where it is malformed and so normalises to `null`. A route that names a
 * squad has already said which squad the person is working within; letting a
 * value published by some other content override it would show one squad's
 * notifications while standing in another squad's route. A malformed route
 * parameter therefore lands on the account-wide view rather than on a stale
 * scope (Requirement 7.1).
 *
 * ### Two contexts, not one
 *
 * The active scope and the publish function are provided separately so that a
 * Destination_Content which only *publishes* a scope does not re-render every
 * time the scope changes, and so the publish function's identity never changes —
 * hosting content can safely name it in an effect's dependency list without
 * looping.
 *
 * ### Changing the scope
 *
 * A change of the active scope — one identity to another, an identity to none,
 * or none to an identity — is observed by `useNotificationCentre`, which bumps
 * its generation counter, abandons the previous scope's calls, discards the
 * displayed list and count, and refetches (Requirements 7.3, 7.4). That is
 * deliberately *not* this module's job: this module publishes a value, and the
 * state machine reacts to it. Publishing a value that normalises to the scope
 * already active is a no-op here, so an idle re-publish cannot trigger a
 * refetch.
 *
 * Requirements: 7.1, 7.2
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router-dom';
import { normaliseSquadScope } from '../lib/squadScope';

/**
 * The name of the route parameter a shell route uses to carry the Squad_Scope
 * (Requirement 7.2). Exported so a route registration, the provider, and
 * {@link usePublishSquadScopeFromRoute} can never disagree about the spelling.
 */
export const SQUAD_SCOPE_ROUTE_PARAMETER = 'squadId';

/**
 * Publish a Squad_Scope from a hosting Destination_Content.
 *
 * The value is unasserted — whatever the hosting content has to hand — and is
 * normalised on the way in, so publishing an absent, empty, whitespace-only, or
 * malformed value leaves no Squad_Scope active rather than raising an error
 * (Requirement 7.1). Publish `null` to withdraw a Squad_Scope, which restores
 * the account-wide Notification_List and Unread_Count (Requirement 7.3).
 */
export type PublishSquadScope = (candidate: unknown) => void;

/**
 * The active Squad_Scope, or `null` where none is active.
 *
 * The default is `null` rather than a "no provider" sentinel: a surface rendered
 * outside a {@link SquadScopeProvider} has had no Squad_Scope supplied to it,
 * which Requirement 7.1 answers with the account-wide view and no error. This
 * deliberately differs from the Auth_Feature's `useAuth`, which throws when its
 * provider is missing — there, a missing session cannot be given a safe
 * meaning; here, "no scope" is a first-class, specified state.
 */
const SquadScopeContext = createContext<string | null>(null);

/**
 * The publish seam, `undefined` when no provider is above the caller.
 *
 * Unlike reading the scope, *publishing* into nothing has no safe meaning: the
 * hosting content believes it has set the Squad_Scope, and the notification
 * calls would silently stay account-wide with nothing to explain it. That is a
 * wiring mistake, so {@link usePublishSquadScope} throws, following the
 * Auth_Feature's `useAuth` convention.
 */
const PublishSquadScopeContext = createContext<PublishSquadScope | undefined>(undefined);

/**
 * Read the active Squad_Scope.
 *
 * @returns the well-formed squad identity exactly as it was supplied, or `null`
 *   where no Squad_Scope is active — because none was supplied, because the
 *   supplied value was unusable (Requirement 7.1), or because the caller sits
 *   outside a {@link SquadScopeProvider}.
 *
 * Requirements: 7.1, 7.2
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hooks are intentionally co-located
export function useSquadScope(): string | null {
  return useContext(SquadScopeContext);
}

/**
 * Obtain the function a hosting Destination_Content calls to supply the
 * Squad_Scope.
 *
 * The returned function has a **stable identity** for the lifetime of the
 * provider, so it can be named in an effect's dependency list without causing
 * that effect to re-run. Call it from an effect (or an event handler), never
 * during render, and withdraw the scope when the content leaves:
 *
 * ```tsx
 * const publishSquadScope = usePublishSquadScope()
 *
 * useEffect(() => {
 *   publishSquadScope(squadId)
 *   return () => publishSquadScope(null)
 * }, [publishSquadScope, squadId])
 * ```
 *
 * The provider cannot observe a Destination_Content mounting or unmounting, so
 * withdrawing a published scope is the publishing content's responsibility;
 * withdrawing it restores the account-wide Notification_List and Unread_Count
 * (Requirements 7.1, 7.3). Content whose scope comes from its own route
 * parameter should call {@link usePublishSquadScopeFromRoute} instead of writing
 * that effect by hand.
 *
 * @throws Error where the caller sits outside a {@link SquadScopeProvider}.
 *
 * Requirements: 7.1, 7.2
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hooks are intentionally co-located
export function usePublishSquadScope(): PublishSquadScope {
  const publish = useContext(PublishSquadScopeContext);
  if (publish === undefined) {
    throw new Error('usePublishSquadScope must be used within a SquadScopeProvider');
  }
  return publish;
}

/**
 * Bind the `squadId` parameter of a **nested** shell route to the Squad_Scope.
 *
 * Called from the content of a route below the provider — the only place the
 * router will report that route's parameters — this publishes the parameter as
 * the Squad_Scope and withdraws it when the content unmounts or the parameter
 * changes, so navigating out of a squad's route restores the account-wide
 * Notification_List and Unread_Count (Requirements 7.1, 7.3).
 *
 * Publishing happens in an effect, since a value may not be published during
 * another component's render. The scope is therefore active from immediately
 * after the content's first paint rather than during it, well inside the 500
 * milliseconds Requirement 7.3 allows for reacting to a change.
 *
 * @returns the normalised Squad_Scope this hook published — the identity, or
 *   `null` where the route parameter is absent or unusable (Requirement 7.1).
 *
 * @throws Error where the caller sits outside a {@link SquadScopeProvider}.
 *
 * Requirements: 7.1, 7.2
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hooks are intentionally co-located
export function usePublishSquadScopeFromRoute(): string | null {
  const publish = usePublishSquadScope();
  // 7.1: normalised here, so the effect below is driven by the scope itself
  // rather than by the raw parameter — two malformed parameters both mean "no
  // scope" and so cause no second publish.
  const scope = normaliseSquadScope(useParams()[SQUAD_SCOPE_ROUTE_PARAMETER]);

  useEffect(() => {
    publish(scope);
    // 7.3: leaving the route, or moving to a different squad's route, withdraws
    // this scope rather than leaving it active over content that is gone.
    return () => publish(null);
  }, [publish, scope]);

  return scope;
}

export interface SquadScopeProviderProps {
  readonly children: ReactNode;
}

/**
 * Provide the active Squad_Scope to the shell.
 *
 * Sits between the Theme_Provider and the notification centre provider, so the
 * notification state machine reads the scope the moment it mounts and observes
 * every later change to it (Requirements 7.3, 7.4).
 *
 * Renders no element of its own — only the two context providers around
 * `children` — and in particular renders no Squad_Scope selection control
 * (Requirement 7.2).
 *
 * Requirements: 7.1, 7.2
 */
export function SquadScopeProvider({ children }: SquadScopeProviderProps): ReactElement {
  // 7.2: a `squadId` matched by this route or one of its ancestors. `useParams`
  // yields no parameters at all outside a router, so the provider is usable in a
  // non-routed tree and simply falls back to the published value.
  const routeParameter = useParams()[SQUAD_SCOPE_ROUTE_PARAMETER];

  // 7.2: the other source — a hosting Destination_Content, including a nested
  // route's content via `usePublishSquadScopeFromRoute`. Held normalised, so the
  // state only ever contains an identity or `null`.
  const [publishedScope, setPublishedScope] = useState<string | null>(null);

  const publish = useCallback<PublishSquadScope>((candidate) => {
    // 7.1: normalise on the way in, so an unusable value becomes "no scope"
    // here rather than travelling any further.
    const next = normaliseSquadScope(candidate);
    // Publishing the value already held changes nothing, so no re-render and no
    // spurious scope change reaches the notification centre (Requirement 7.3).
    setPublishedScope((current) => (current === next ? current : next));
  }, []);

  // A route parameter the provider can see wins wherever the route carries one,
  // malformed included.
  const scope =
    routeParameter === undefined ? publishedScope : normaliseSquadScope(routeParameter);

  return (
    <PublishSquadScopeContext.Provider value={publish}>
      <SquadScopeContext.Provider value={scope}>{children}</SquadScopeContext.Provider>
    </PublishSquadScopeContext.Provider>
  );
}

export default SquadScopeProvider;
