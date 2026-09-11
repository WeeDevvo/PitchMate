/**
 * The two route paths the application router owns itself.
 *
 * Every other registered path belongs to a feature and is imported from that
 * feature's public entry point — the five Auth_Feature paths come with
 * `createWiredAuthRoutes`, and the four App_Shell Destination paths come with
 * `createShellRoutes`. These two are the router's own: the marketing landing
 * route and the single application-level catch-all (Requirements 15.6, 15.9).
 *
 * They live in their own module rather than in `appRouter.tsx` so that
 * `AppNotFound.tsx` can link to the landing route without importing the router
 * that renders it, keeping the two modules free of a cycle.
 *
 * Requirements: 15.6, 15.9
 */

/** The marketing landing route — the unauthenticated entry point (Requirement 15.6). */
export const LANDING_ROUTE = '/';

/**
 * The application-level catch-all: any requested path that no registered route
 * matches (Requirement 15.9).
 *
 * Registered exactly once, at the top level of the application router. The
 * App_Shell keeps its own `*` child *inside* `/app`, which is a different path
 * (`/app/*`) reached only for a miss under the shell (Requirement 3.10).
 */
export const APP_CATCH_ALL_ROUTE = '*';
