/**
 * The App_Shell's single pure requested-path-to-Destination resolver.
 *
 * Requirement 3.12 asks for exactly one function that turns a requested path
 * into either exactly one registered Destination identifier or the not-found
 * outcome, depending on neither React nor the DOM, so that route resolution and
 * active-state marking are testable without a browser. Requirement 14.12 asks
 * for that function to be *total*: every input — a string, `null`, `undefined`,
 * a number, a symbol, an object nested a hundred levels deep — yields one of the
 * two stated outcomes and raises no exception. Nothing here coerces an unknown
 * value to a string, so nothing here can be made to throw by a hostile input.
 *
 * Normalisation, in order (Requirement 3.13):
 *
 *  1. Any query string or fragment is discarded — resolution looks only at the
 *     path.
 *  2. ASCII letters are lowercased. Only `A`–`Z` are folded, because 3.13 speaks
 *     of "the letter case of its ASCII letters"; locale-sensitive folding of
 *     non-ASCII letters would make resolution depend on the runtime's locale.
 *  3. A *single* trailing `/` separator is dropped, because that is the only
 *     separator difference 3.13 calls equivalent. A second separator survives as
 *     a further (empty) segment, so `/app//settings` matches nothing while
 *     `/app/settings//` is simply a path nested under Settings.
 *
 * Matching (Requirement 3.11): the path is split into whole segments and a
 * registered Destination matches when its segments are a whole-segment prefix of
 * the requested segments. Where more than one Destination matches, the one
 * matching the greater number of whole segments wins, so `/app/settings/anything`
 * resolves to Settings rather than to Home.
 *
 * The Home_Destination is the one exception to prefix matching: it matches its
 * own path exactly and nothing deeper. Prefix-matching `/app` would swallow
 * every unregistered path beneath it, whereas Requirement 3.10 requires an
 * unregistered path under `/app` to be a not-found outcome with *no*
 * Primary_Navigation control marked as the current page. Requirement 3.11's
 * stated purpose — that Home is not the active Destination while a nested
 * Destination path is requested — is preserved either way; making Home exact
 * satisfies 3.10 as well.
 *
 * This module is React-free and DOM-free (Requirements 14.16, 15.5): it reads
 * the Destination registry and performs string comparisons, and touches nothing
 * ambient.
 *
 * Requirements: 3.11, 3.12, 3.13, 14.12, 14.14
 */

import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  type DestinationId,
} from './destinations';

/**
 * The outcome of resolving a requested path: exactly one registered Destination
 * identifier, or the not-found outcome (Requirements 3.12, 14.14).
 */
export type RouteResolution =
  | { readonly kind: 'destination'; readonly id: DestinationId }
  | { readonly kind: 'not-found' };

/** The one not-found value, shared so callers can compare cheaply. */
const NOT_FOUND: RouteResolution = { kind: 'not-found' };

interface RegisteredRoute {
  readonly id: DestinationId;
  /** The Destination's route path split into whole, already-lowercased segments. */
  readonly segments: readonly string[];
  /** Whether paths *beneath* this Destination resolve to it (Requirement 3.11). */
  readonly matchesNestedPaths: boolean;
}

const HOME_SEGMENT_COUNT = pathSegments(lowercaseAscii(HOME_ROUTE)).length;

/**
 * The registry as match rules, longest first — so the first rule that matches is
 * the one matching the greater number of whole segments (Requirement 3.11).
 */
const REGISTERED_ROUTES: readonly RegisteredRoute[] = SHELL_DESTINATIONS.map(
  (destination) => {
    const segments = pathSegments(lowercaseAscii(destination.path));
    return {
      id: destination.id,
      segments,
      matchesNestedPaths: segments.length > HOME_SEGMENT_COUNT,
    };
  },
).sort((left, right) => right.segments.length - left.segments.length);

/**
 * Resolve a requested path to exactly one registered Destination identifier or
 * the not-found outcome.
 *
 * Total over every input and free of exceptions (Requirement 14.12). A value
 * that is not a string, an empty path, a path that is not absolute, and a path
 * matching no registered Destination all yield the not-found outcome.
 *
 * Requirements: 3.11, 3.12, 3.13, 14.12, 14.14
 */
export function resolveDestination(requestedPath: unknown): RouteResolution {
  // 14.12: anything that is not a string is the not-found outcome. No coercion,
  // so a symbol or a hostile `toString` cannot raise.
  if (typeof requestedPath !== 'string') {
    return NOT_FOUND;
  }

  // 3.13: the query string and the fragment take no part in resolution.
  const pathOnly = stripQueryAndFragment(requestedPath);

  // A requested path is absolute; a bare relative value resolves to nothing.
  if (pathOnly.length === 0 || pathOnly.charAt(0) !== '/') {
    return NOT_FOUND;
  }

  // 3.13: fold ASCII case, then drop at most one trailing separator.
  const normalised = dropSingleTrailingSlash(lowercaseAscii(pathOnly));

  // `/` is the marketing landing route, not a shell route (Requirement 3.2).
  if (normalised === '/') {
    return NOT_FOUND;
  }

  const segments = pathSegments(normalised);

  // 3.11: longest whole-segment match wins; REGISTERED_ROUTES is longest first.
  for (const route of REGISTERED_ROUTES) {
    if (matchesRoute(route, segments)) {
      return { kind: 'destination', id: route.id };
    }
  }

  return NOT_FOUND;
}

/**
 * True iff the registered route's segments are a whole-segment prefix of the
 * requested segments, and the route admits nested paths when the requested path
 * carries further segments (Requirements 3.10, 3.11).
 */
function matchesRoute(
  route: RegisteredRoute,
  requestedSegments: readonly string[],
): boolean {
  if (requestedSegments.length < route.segments.length) {
    return false;
  }

  if (requestedSegments.length > route.segments.length && !route.matchesNestedPaths) {
    return false;
  }

  for (let index = 0; index < route.segments.length; index += 1) {
    if (requestedSegments[index] !== route.segments[index]) {
      return false;
    }
  }

  return true;
}

/** Everything before the first `?` or `#`. */
function stripQueryAndFragment(value: string): string {
  let end = value.length;

  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (character === '?' || character === '#') {
      end = index;
      break;
    }
  }

  return value.slice(0, end);
}

/**
 * Lowercase the ASCII letters `A`–`Z` and leave every other code point exactly
 * as supplied, so resolution cannot depend on the runtime's locale
 * (Requirement 3.13).
 */
function lowercaseAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Drop exactly one trailing `/` separator, leaving the root path `/` alone
 * (Requirement 3.13).
 */
function dropSingleTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith('/')) {
    return value.slice(0, -1);
  }

  return value;
}

/**
 * Split an absolute path into its whole segments, dropping only the empty
 * element the leading `/` produces. An interior empty segment (`/app//settings`)
 * is kept, so such a path matches no registered Destination.
 */
function pathSegments(absolutePath: string): readonly string[] {
  const parts = absolutePath.split('/');

  // The leading `/` always yields one empty first element for an absolute path.
  return parts[0] === '' ? parts.slice(1) : parts;
}
