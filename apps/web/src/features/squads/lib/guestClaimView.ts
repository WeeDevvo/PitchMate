/**
 * What the admins' claim list shows for each player row, and which single action
 * it offers. Pure, total and exception-free, like every module under `lib/`.
 *
 * | Row | Claim status | View | Action |
 * | --- | --- | --- | --- |
 * | active guest, not a former player | none | `unclaimed` | create a link |
 * | active guest, not a former player | `LinkIssued` | `link-issued` (expiry) | create a new link |
 * | active guest, not a former player | `LinkExpired` | `link-expired` | create a new link |
 * | active guest, not a former player | `Accepted` | `accepted` (who) | complete |
 * | any membership | `Claimed` | `claimed` | undo |
 * | anything else | — | `none` | — |
 *
 * Nothing is offered to a caller without admin authority. An inactive guest is
 * out of selection and a former player's details were erased, so neither is
 * offered a link; a claim already in flight for one still shows, so an admin can
 * see it.
 */

import type { GuestClaimRow } from './parse/guestClaim';
import type { PlayerListRow } from './playerList';

/** What one row of the claim list shows. */
export type GuestClaimView =
  | { readonly kind: 'none' }
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'link-issued'; readonly expiresAtMs: number | null }
  | { readonly kind: 'link-expired' }
  | { readonly kind: 'accepted'; readonly acceptedByName: string | null }
  | { readonly kind: 'claimed' };

/** The view for `row`, given its claim (if any) and whether the viewer is an admin. */
export function guestClaimViewFor(
  row: Pick<PlayerListRow, 'isGuest' | 'state' | 'isFormerPlayer'>,
  claim: GuestClaimRow | undefined,
  viewerIsAdmin: boolean,
): GuestClaimView {
  if (!viewerIsAdmin) {
    return { kind: 'none' };
  }

  switch (claim?.status) {
    case 'Claimed':
      return { kind: 'claimed' };
    case 'Accepted':
      return { kind: 'accepted', acceptedByName: claim.acceptedByName };
    case 'LinkIssued':
      return { kind: 'link-issued', expiresAtMs: claim.expiresAtMs };
    case 'LinkExpired':
      return { kind: 'link-expired' };
    case undefined:
      break;
  }

  const linkable = row.isGuest && row.state === 'Active' && !row.isFormerPlayer;
  return linkable ? { kind: 'unclaimed' } : { kind: 'none' };
}

/** The claim list's entries: every row with something to show, in the rows' order. */
export function guestClaimEntries<TRow extends Pick<PlayerListRow, 'membershipId' | 'isGuest' | 'state' | 'isFormerPlayer'>>(
  rows: readonly TRow[],
  claims: readonly GuestClaimRow[],
  viewerIsAdmin: boolean,
): readonly { readonly row: TRow; readonly view: GuestClaimView }[] {
  const byMembership = new Map(claims.map((claim) => [claim.membershipId, claim]));

  return rows
    .map((row) => ({ row, view: guestClaimViewFor(row, byMembership.get(row.membershipId), viewerIsAdmin) }))
    .filter((entry) => entry.view.kind !== 'none');
}
