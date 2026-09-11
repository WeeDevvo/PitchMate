/**
 * The Invite_Order: the order the Invite_Manager renders its invite entries in.
 *
 * Requirement 11.3 fixes the order — creation instant **descending**, ties broken
 * by invite identity **ascending** — and fixes that it is "derived through a pure
 * function", so `components/InviteManager.tsx` holds no sorting of its own; it
 * maps over the result of {@link orderInviteSummaries} and nothing else.
 *
 * Descending is the deliberate half. The Squad_Card order (`./squadOrder`) is
 * ascending by name because a person looks a squad up by its name; an invite has
 * no name worth looking up, and the one an admin has just generated is the one
 * they are about to act on, so the newest sorts first. That is the only structural
 * difference between the two modules — the tie-break, the totality argument, and
 * the permutation-invariance argument are the same.
 *
 * Two properties matter more than the keys themselves, and Property 28 states
 * both at the rendering site:
 *
 * - **It is a total order.** Two invites of one squad can share a creation
 *   instant: the backend stamps `createdAt` from its clock, and two invites
 *   generated in the same tick — or, more plainly, two rows whose instants
 *   serialise to the same millisecond — collide. The invite identity is unique
 *   per invite, so the final key separates every distinct pair and the order
 *   never falls back to the arrival order of the response.
 * - **A permutation of the input changes nothing.** `ListInvites` promises no
 *   ordering, and Requirement 11.10 has a successful revocation issue a *further*
 *   `ListInvites`. If the order depended on arrival position, revoking one invite
 *   could rearrange the rest of the list under the admin's cursor — and the next
 *   revoke control they aim at would not be the one they meant.
 *
 * The instants compared here are the epoch milliseconds `lib/parse/inviteSummary`
 * already normalised each `createdAt` to, which is why this module does no date
 * arithmetic and constructs no `Date`. Comparing numbers rather than the ISO-8601
 * strings is what makes the descending key correct for instants written with
 * different offsets — `…T10:00:00Z` and `…T11:00:00+01:00` are the same instant
 * and compare equal here, where as strings they would not.
 *
 * Nothing here formats an instant for display, and nothing here reads or derives
 * an Invite_Secret: an Invite_Summary carries none (Requirement 11.4), so the
 * ordering cannot disclose one.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the parsed value type it orders (Requirement 18.2).
 *
 * Requirements: 11.3
 */

import type { InviteSummary } from './parse/inviteSummary';

/**
 * A comparison result narrowed to the three answers a total order gives, so a
 * caller cannot come to depend on a magnitude.
 *
 * Declared here rather than imported from `./squadOrder` so that neither ordering
 * module depends on the other; they are two leaves, not a chain.
 */
export type InviteComparison = -1 | 0 | 1;

/**
 * Compares two invite identities by code unit.
 *
 * Deliberately neither case-insensitive nor locale-aware: this is the key that
 * has to separate every pair the creation instant leaves equal, so it must be as
 * fine-grained and as runtime-independent as possible. An invite identity is
 * opaque to this feature — comparing one is only ever a tie-break, never a
 * statement about what it means.
 */
const compareIdentity = (left: string, right: string): InviteComparison =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * The Invite_Summary comparator: creation instant descending, then invite
 * identity ascending (Requirement 11.3).
 *
 * Total over every pair of Invite_Summary values and free of exceptions. Returns
 * `0` only for two summaries carrying the same invite identity, so the induced
 * order is total over any listing of distinct invites.
 *
 * The instant comparison is a subtraction of two numbers written in the order
 * that yields *descending*, then reduced to a sign — the reduction is what stops
 * the magnitude of a millisecond difference from leaking into the result.
 *
 * @returns `-1` when `left` sorts before `right`, `1` when after, `0` when the
 *   two are the same invite
 */
export function compareInviteSummaries(
  left: InviteSummary,
  right: InviteSummary,
): InviteComparison {
  // 11.3: descending, so the *later* instant sorts first. Written as two
  // comparisons rather than a subtraction so that no pair of instants can
  // produce a `NaN` difference and no large gap can overflow.
  if (left.createdAtMs > right.createdAtMs) {
    return -1;
  }

  if (left.createdAtMs < right.createdAtMs) {
    return 1;
  }

  // Reached whenever two invites carry the same creation millisecond — which the
  // backend's clock makes an ordinary occurrence, not a corner case.
  return compareIdentity(left.inviteId, right.inviteId);
}

/**
 * The parsed Invite_Summary listing in the order its entries are rendered.
 *
 * Pure and total: the input is copied before sorting, so the listing a hook is
 * holding is never reordered in place, and every input summary appears in the
 * result exactly once — this function selects nothing, adds nothing, and merges
 * nothing. In particular it does **not** filter by Invite_State: a revoked or
 * expired invite is still rendered, just without a revoke control
 * (Requirement 11.9), and deciding that is the entry's job rather than the
 * ordering's.
 *
 * Idempotent, and independent of the supplied order: ordering an already-ordered
 * listing, or any permutation of a listing, yields the same sequence.
 *
 * @param summaries the parsed `ListInvites` listing, in whatever order the
 *   response carried it
 * @returns a new listing holding exactly those summaries, ordered by
 *   {@link compareInviteSummaries}
 *
 * Requirements: 11.3
 */
export function orderInviteSummaries(
  summaries: readonly InviteSummary[],
): readonly InviteSummary[] {
  return [...summaries].sort(compareInviteSummaries);
}
