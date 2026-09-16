/**
 * Property test for the rendered invite listing (task 12.2).
 *
 * **Property 28: The invite listing is ordered, complete, and discloses no
 * redeemable value.** *For any* parsed Invite_Summary collection, the
 * Invite_Manager renders exactly one entry per summary showing a text label
 * naming the Invite_State, the creation instant, and either the expiry instant or
 * a text label stating that the invite does not expire; the entries are ordered by
 * creation instant descending with ties broken by ascending invite identity, and
 * that order is identical for any two permutations of the collection; a revoke
 * control is rendered exactly on entries whose state is `active`; and the rendered
 * output contains no invite link, invite code, or other redeemable value,
 * including for bodies carrying secret-shaped properties the parser disregards.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 11.2 — one entry per summary, and none carrying any other invite identity | {@link expectOneEntryPerSummary} |
 * | 11.2 — a text label naming the Invite_State | {@link expectEntryStatesTheInvite} |
 * | 11.2 — the creation instant, and either the expiry instant or the does-not-expire label | {@link expectEntryStatesTheInvite} |
 * | 11.3 — creation instant descending, ties by invite identity ascending | {@link expectEntriesAreOrdered} |
 * | 11.9 — a revoke control exactly on the `active` entries, each bound to its own invite | {@link expectRevokeControlsSitOnActiveEntriesOnly} |
 * | 11.4 — no listed entry discloses a redeemable value | {@link expectNoRedeemableValueIsRendered} |
 * | 20.6 — the order is determined solely by its input | the permutation property below |
 *
 * ### The collection is parsed, not hand-built
 *
 * The property quantifies over a *parsed* collection, so every case starts as a
 * generated `ListInvites` wire body handed to `parseInviteSummaryList`, and the
 * manager renders whatever comes out. Two things stay honest as a result. The
 * state arrives as a numeric code and both instants arrive as ISO-8601 strings —
 * some written with a `Z`, some with a numeric offset — so the ordering is
 * exercised over instants as the backend actually writes them rather than over
 * numbers a test invented. And `expiresAt` is generated as an instant, as `null`,
 * and as a missing property, the last two being the same absence (Requirement
 * 16.8), so the does-not-expire label is reached by both routes.
 *
 * ### Why the secret-shaped properties are generated rather than argued about
 *
 * Requirement 11.4 is satisfied by an absence: an `InviteSummary` carries no
 * token, no hash, and no code, so an entry has nothing redeemable to render. An
 * absence is exactly the kind of claim that decays quietly — a parser that grew a
 * sixth field, or an entry that rendered a spread of its source object, would
 * disclose a redeemable value without any test noticing. So every body here
 * carries properties shaped like the secret the backend hashes and never sends
 * again — `token`, `secret`, `hash`, `code`, `redeemableLink` — each holding a
 * marked, unmistakable value, and the property asserts that none of those values
 * reaches the parsed summary or the document. The keys are asserted too: a parsed
 * summary carries exactly the five the Invite_Summary names.
 *
 * ### The ordering rule is restated rather than imported
 *
 * {@link compareByRule} spells Requirement 11.3 out — creation instant
 * descending, then invite identity ascending by code unit — instead of only
 * comparing against `orderInviteSummaries`. Asserting a surface against the very
 * function it renders through would pass for any rule that function happened to
 * implement, including a wrong one. The rendered sequence is checked against the
 * independent restatement *and* against `orderInviteSummaries`, the second being
 * the claim that no component sorts anything of its own. A third assertion walks
 * consecutive rendered pairs and demands each is strictly ascending under the
 * rule, which is what makes the order *total* rather than merely sorted-looking.
 *
 * Creation instants are drawn mostly from a small pool, so most runs carry several
 * invites sharing a creation millisecond and the identity tie-break is genuinely
 * exercised — which is the ordinary case for this endpoint rather than a corner
 * one, since two invites generated in the same tick collide.
 *
 * ### What is rendered through, and what is stubbed
 *
 * One seam is supplied: a `SquadsApi` whose `listInvites` answers with the parsed
 * collection. The component runs the real `useInviteManager`, so the order under
 * test is the one the machine applies on acceptance, reached the way a mount
 * reaches it. Every other method of the facade throws, so a call this property has
 * no business causing fails the run.
 *
 * Deliberately **not** claimed here: that the reveal's values are unrecoverable
 * (Property 29), the generate and revoke call disciplines (worked examples in
 * `InviteManager.test.tsx`), and the focus behaviour of the surfaces this
 * component opens (Property 33).
 *
 * Feature: web-squads-screens, Property 28: The invite listing is ordered, complete, and discloses no redeemable value
 * Validates: Requirements 11.2, 11.3, 11.4, 11.9, 20.6
 */
import { describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import { codeFromInviteState, type InviteStateValue } from '../lib/enumCodes';
import {
  formatInviteInstant,
  inviteInstantAttribute,
} from '../lib/inviteInstant';
import { orderInviteSummaries } from '../lib/inviteOrder';
import {
  INVITE_ACTIVE_STATE_LABEL,
  INVITE_EXPIRED_STATE_LABEL,
  INVITE_NEVER_EXPIRES_LABEL,
  INVITE_REVOKED_STATE_LABEL,
  NO_INVITES_STATEMENT,
} from '../lib/messages';
import {
  parseInviteSummaryList,
  type InviteSummary,
} from '../lib/parse/inviteSummary';
import { printInstant } from '../lib/parse/primitives';
import {
  INVITE_CREATED_SELECTOR,
  INVITE_ENTRY_ATTRIBUTE,
  INVITE_ENTRY_SELECTOR,
  INVITE_EXPIRES_SELECTOR,
  INVITE_MANAGER_SELECTOR,
  INVITE_NEVER_EXPIRES_SELECTOR,
  INVITE_REVOKE_SELECTOR,
  INVITE_STATE_ATTRIBUTE,
  INVITE_STATE_LABEL_SELECTOR,
  InviteManager,
} from './InviteManager';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/**
 * The attribute an entry's revoke control carries its invite identity in, read
 * out of the exported selector rather than restated, so the two cannot drift.
 */
const REVOKE_ATTRIBUTE = INVITE_REVOKE_SELECTOR.slice(1, -1);

/** The properties an Invite_Summary carries, and the only ones it may carry. */
const INVITE_SUMMARY_KEYS: readonly string[] = [
  'inviteId',
  'state',
  'createdAtMs',
  'createdBy',
  'expiresAtMs',
];

/**
 * The label each named Invite_State is stated by, restated here from the message
 * constants rather than read from the component's own lookup — so an entry that
 * labelled a revoked invite "Active" fails rather than agreeing with itself.
 */
const EXPECTED_STATE_LABELS: Readonly<Record<InviteStateValue, string>> = {
  active: INVITE_ACTIVE_STATE_LABEL,
  revoked: INVITE_REVOKED_STATE_LABEL,
  expired: INVITE_EXPIRED_STATE_LABEL,
};

// --- Generators --------------------------------------------------------------

const stateArb: fc.Arbitrary<InviteStateValue> = fc.constantFrom(
  'active' as const,
  'revoked' as const,
  'expired' as const,
);

/**
 * A well-formed invite identity, in either letter case. Both are generated
 * because the tie-break compares identities by code unit, where `A` sorts before
 * `a` — a comparison a case-folding tie-break would get wrong.
 */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/**
 * Creation instants that collide: four fixed instants drawn far more often than
 * the free range, so most runs carry several invites sharing a creation
 * millisecond and the identity tie-break decides them.
 */
const COLLIDING_INSTANTS: readonly number[] = [
  Date.UTC(2025, 2, 1, 10, 0, 0),
  Date.UTC(2025, 2, 5, 9, 30, 0),
  Date.UTC(2024, 11, 31, 23, 59, 59),
  Date.UTC(1970, 0, 1, 0, 0, 0),
];

const instantArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...COLLIDING_INSTANTS) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 0, max: Date.UTC(2100, 0, 1) }),
  },
);

/**
 * The UTC offset an instant's wire form is written with, in whole minutes.
 *
 * `ListInvites` is free to write an instant with any offset, and two instants
 * written with different offsets can name the same point in time — which is
 * exactly the case an ordering that compared wire strings would get wrong.
 */
const offsetMinutesArb: fc.Arbitrary<number> = fc.constantFrom(0, 60, -300, 330);

/** How a body carries an absent optional property: as `null`, or not at all. */
type AbsenceForm = 'null' | 'absent';

const absenceFormArb: fc.Arbitrary<AbsenceForm> = fc.constantFrom(
  'null' as const,
  'absent' as const,
);

/** The property names a redeemable value would arrive under, if one ever did. */
const SECRET_SHAPED_KEYS = [
  'token',
  'secret',
  'hash',
  'code',
  'redeemableLink',
] as const;

type SecretShapedKey = (typeof SECRET_SHAPED_KEYS)[number];

/**
 * Which secret-shaped properties a generated body carries, and what each holds.
 * `null` means the property is not written at all.
 */
type SecretShapedFields = Readonly<Record<SecretShapedKey, string | null>>;

/**
 * A marker no part of the rendered listing could contain by coincidence — the
 * entries render state labels, localised instants, and hyphenated hexadecimal
 * identities, none of which carry this — so "the document does not contain this
 * value" is a claim about disclosure rather than about luck.
 */
const SECRET_MARKER = 'SEKRIT';

/** The digits a token-shaped value is built from. */
const HEX_DIGITS: readonly string[] = '0123456789abcdef'.split('');

/** A marked, unmistakable value for one secret-shaped property. */
const secretValueArb = (key: SecretShapedKey): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX_DIGITS), { minLength: 12, maxLength: 24 })
    .map((digits) => `${SECRET_MARKER}-${key}-${digits.join('')}`);

const optionalSecretArb = (
  key: SecretShapedKey,
): fc.Arbitrary<string | null> =>
  fc.option(secretValueArb(key), { nil: null });

/** Bodies carrying some of the secret-shaped properties, and sometimes none. */
const someSecretFieldsArb: fc.Arbitrary<SecretShapedFields> = fc.record({
  token: optionalSecretArb('token'),
  secret: optionalSecretArb('secret'),
  hash: optionalSecretArb('hash'),
  code: optionalSecretArb('code'),
  redeemableLink: optionalSecretArb('redeemableLink'),
});

/** Bodies carrying every one of them at once. */
const allSecretFieldsArb: fc.Arbitrary<SecretShapedFields> = fc.record({
  token: secretValueArb('token'),
  secret: secretValueArb('secret'),
  hash: secretValueArb('hash'),
  code: secretValueArb('code'),
  redeemableLink: secretValueArb('redeemableLink'),
});

/** One generated `ListInvites` element, before it becomes a wire body. */
interface InviteCase {
  readonly inviteId: string;
  readonly state: InviteStateValue;
  readonly createdAtMs: number;
  readonly createdAtOffsetMinutes: number;
  /** The expiry instant, or `null` for a non-expiring invite. */
  readonly expiresAtMs: number | null;
  readonly expiresAtOffsetMinutes: number;
  /** How a non-expiring invite's absent expiry is written. */
  readonly expiresAtAbsence: AbsenceForm;
  /** The audit actor, or an absence in one of its two forms. */
  readonly createdBy: string | null | 'absent';
  readonly secretFields: SecretShapedFields;
}

const inviteCaseArb = (
  secretFields: fc.Arbitrary<SecretShapedFields>,
): fc.Arbitrary<Omit<InviteCase, 'inviteId'>> =>
  fc.record({
    state: stateArb,
    createdAtMs: instantArb,
    createdAtOffsetMinutes: offsetMinutesArb,
    // Both halves of Requirement 11.2's expiry clause: an expiring invite and a
    // non-expiring one, in roughly equal measure.
    expiresAtMs: fc.option(instantArb, { nil: null }),
    expiresAtOffsetMinutes: offsetMinutesArb,
    expiresAtAbsence: absenceFormArb,
    createdBy: fc.oneof(
      fc.constant<string | null | 'absent'>('admin'),
      fc.constant<string | null | 'absent'>(null),
      fc.constant<string | null | 'absent'>('absent'),
    ),
    secretFields,
  });

/**
 * A generated collection whose invite identities are **distinct** — what the
 * backend guarantees within a squad, and what makes the ordering a total order
 * rather than a partial one.
 */
function collectionArb(
  minLength: number,
  maxLength: number,
  secretFields: fc.Arbitrary<SecretShapedFields> = someSecretFieldsArb,
): fc.Arbitrary<readonly InviteCase[]> {
  return fc
    .array(inviteCaseArb(secretFields), { minLength, maxLength })
    .chain((cases) =>
      fc
        .uniqueArray(identityArb, {
          minLength: cases.length,
          maxLength: cases.length,
        })
        .map((identities) =>
          cases.map((inviteCase, index) => ({
            ...inviteCase,
            inviteId: identities[index],
          })),
        ),
    );
}

/** A permutation of a generated collection, of the same length. */
function permutationArb(
  cases: readonly InviteCase[],
): fc.Arbitrary<readonly InviteCase[]> {
  return fc.shuffledSubarray(cases as InviteCase[], {
    minLength: cases.length,
    maxLength: cases.length,
  });
}

// --- From generated cases to a parsed collection -----------------------------

/** A whole number of minutes as the two-field offset designator of ISO-8601. */
function offsetDesignator(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'Z';
  }

  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, '0');
  const minutes = String(magnitude % 60).padStart(2, '0');

  return `${sign}${hours}:${minutes}`;
}

/**
 * An instant as a `ListInvites` body could write it: ISO-8601 carrying either the
 * UTC designator or a numeric offset naming the same point in time.
 *
 * The local fields are printed from the shifted instant and the designator
 * appended, so `2025-03-01T10:00:00.000Z` and `2025-03-01T11:00:00.000+01:00`
 * are two wire forms of one instant — and the parser normalises both to the same
 * epoch milliseconds, which is what {@link parsedCollectionOf} verifies.
 */
function instantWireForm(instantMs: number, offsetMinutes: number): string {
  const shifted = printInstant(instantMs + offsetMinutes * 60_000);

  return `${shifted.slice(0, -1)}${offsetDesignator(offsetMinutes)}`;
}

/** The wire body a generated case describes, with an absent property unwritten. */
function bodyOf(inviteCase: InviteCase): Record<string, unknown> {
  const body: Record<string, unknown> = {
    inviteId: inviteCase.inviteId,
    // 16.7: the code comes from the Enum_Code_Map, the one module allowed to
    // write a numeric enum literal.
    state: codeFromInviteState(inviteCase.state),
    createdAt: instantWireForm(
      inviteCase.createdAtMs,
      inviteCase.createdAtOffsetMinutes,
    ),
  };

  if (inviteCase.createdBy !== 'absent') {
    body.createdBy = inviteCase.createdBy;
  }

  if (inviteCase.expiresAtMs !== null) {
    body.expiresAt = instantWireForm(
      inviteCase.expiresAtMs,
      inviteCase.expiresAtOffsetMinutes,
    );
  } else if (inviteCase.expiresAtAbsence === 'null') {
    // 16.8: `null` and an absent property are the same absence, so both routes to
    // a non-expiring invite are exercised.
    body.expiresAt = null;
  }

  // 11.4: properties shaped like the redeemable value the backend never sends
  // again. The parser names five properties and reads no others (16.9), so none
  // of these may reach a parsed summary or the document.
  for (const key of SECRET_SHAPED_KEYS) {
    const value = inviteCase.secretFields[key];

    if (value !== null) {
      body[key] = value;
    }
  }

  return body;
}

/**
 * The parsed collection the property quantifies over.
 *
 * Parsing is asserted rather than assumed, so a generator that wandered outside
 * the accepted wire shape reports itself instead of silently narrowing the
 * property to the empty listing. The normalised instants are checked against the
 * instants the cases were built from, which is what keeps
 * {@link instantWireForm}'s offset arithmetic honest — a wire form naming the
 * wrong instant would otherwise make the ordering claims quantify over the wrong
 * values.
 */
function parsedCollectionOf(
  cases: readonly InviteCase[],
): readonly InviteSummary[] {
  const body = cases.map(bodyOf);
  const parsed = parseInviteSummaryList(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated body must parse, but it did not: ${JSON.stringify(body)} — ${parsed.reason}`,
    );
  }

  parsed.value.forEach((summary, index) => {
    const inviteCase = cases[index];

    if (summary.createdAtMs !== inviteCase.createdAtMs) {
      throw new Error(
        `the generated createdAt must name the intended instant, but ${String(
          summary.createdAtMs,
        )} is not ${String(inviteCase.createdAtMs)}`,
      );
    }

    if (summary.expiresAtMs !== inviteCase.expiresAtMs) {
      throw new Error(
        `the generated expiresAt must name the intended instant, but ${String(
          summary.expiresAtMs,
        )} is not ${String(inviteCase.expiresAtMs)}`,
      );
    }
  });

  return parsed.value;
}

/** Every secret-shaped value a generated collection's bodies carried. */
function secretValuesOf(cases: readonly InviteCase[]): readonly string[] {
  return cases.flatMap((inviteCase) =>
    SECRET_SHAPED_KEYS.map((key) => inviteCase.secretFields[key]).filter(
      (value): value is string => value !== null,
    ),
  );
}

// --- The ordering rule, restated ---------------------------------------------

/**
 * Requirement 11.3's rule, written out here rather than imported: creation
 * instant **descending**, then invite identity ascending by code unit.
 *
 * @returns `-1`, `0`, or `1`; `0` only for two summaries of the same invite
 */
function compareByRule(left: InviteSummary, right: InviteSummary): -1 | 0 | 1 {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs > right.createdAtMs ? -1 : 1;
  }

  if (left.inviteId === right.inviteId) {
    return 0;
  }

  return left.inviteId < right.inviteId ? -1 : 1;
}

/** The invite identities in the order Requirement 11.3 demands. */
function expectedIdentityOrder(
  summaries: readonly InviteSummary[],
): readonly string[] {
  return [...summaries].sort(compareByRule).map((summary) => summary.inviteId);
}

// --- The seam ----------------------------------------------------------------

/** A method the Invite_Manager has no business calling in this property. */
function unreached(method: string): () => never {
  return () => {
    throw new Error(`the ${method} call is not part of Property 28`);
  };
}

/**
 * A Squads_Api answering `ListInvites` with one accepted collection and refusing
 * every other call, so a generate or a revoke this property never asks for fails
 * the run rather than passing unnoticed.
 */
function listingApi(summaries: readonly InviteSummary[]): SquadsApi {
  const listed: CallResult<readonly InviteSummary[]> = {
    kind: 'success',
    value: summaries,
  };

  return {
    listInvites: () => Promise.resolve(listed),
    generateInvite: unreached('GenerateInvite'),
    revokeInvite: unreached('RevokeInvite'),
    listMySquads: unreached('ListMySquads'),
    getSquad: unreached('GetSquad'),
    getDisplayRatingLeaderboard: unreached('GetSquadLeaderboard'),
    createSquad: unreached('CreateSquad'),
    redeemInvite: unreached('RedeemInvite'),
    previewInvite: unreached('PreviewInvite'),
    createGuest: unreached('CreateGuest'),
    editGuest: unreached('EditGuest'),
    promoteToAdmin: unreached('PromoteToAdmin'),
    getFeatureFlags: unreached('GetFeatureFlags'),
    setFeatureFlag: unreached('SetFeatureFlag'),
  };
}

// --- Rendering ---------------------------------------------------------------

/** Let the listing call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Render the Invite_Manager over an accepted collection and let its one mount
 * `ListInvites` settle.
 *
 * No router and no `AuthProvider` are involved: the component takes the facade as
 * a prop and the machine assumes an authenticated session when none is supplied.
 */
async function renderListing(
  summaries: readonly InviteSummary[],
): Promise<void> {
  render(<InviteManager api={listingApi(summaries)} squadId={SQUAD_ID} />);

  await flush();
}

/** The rendered invite entries, in document order. */
function renderedEntries(): readonly HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(INVITE_ENTRY_SELECTOR),
  );
}

/** The invite identity of every rendered entry, in rendered order. */
function renderedIdentities(): readonly string[] {
  return renderedEntries().map(
    (entry) => entry.getAttribute(INVITE_ENTRY_ATTRIBUTE) ?? '',
  );
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 11.2: exactly one entry per parsed Invite_Summary, and no entry
 * carrying any other invite identity.
 *
 * Stated as a multiset comparison rather than only as a count, so a listing that
 * dropped one invite and duplicated another cannot satisfy it — which would
 * otherwise let the order claims quantify over the wrong set.
 */
function expectOneEntryPerSummary(summaries: readonly InviteSummary[]): void {
  const rendered = renderedIdentities();

  expect(rendered).toHaveLength(summaries.length);
  expect([...rendered].sort()).toEqual(
    summaries.map((summary) => summary.inviteId).sort(),
  );

  const parsedIdentities = new Set(summaries.map((summary) => summary.inviteId));
  for (const identity of rendered) {
    expect(parsedIdentities.has(identity)).toBe(true);
  }
}

/**
 * Requirement 11.2, entry by entry: a text label naming the Invite_State, the
 * creation instant, and **exactly one** of the expiry instant and the label
 * stating that the invite does not expire.
 *
 * The instants are expected through `lib/inviteInstant.ts` — the same functions
 * the component renders through — so a changed format cannot make this pass while
 * the screen says something else, and the machine-readable `dateTime` is asserted
 * beside the text because it is the half whose shape does not vary by runtime.
 */
function expectEntryStatesTheInvite(summaries: readonly InviteSummary[]): void {
  const byIdentity = new Map(
    summaries.map((summary) => [summary.inviteId, summary] as const),
  );

  for (const entry of renderedEntries()) {
    const identity = entry.getAttribute(INVITE_ENTRY_ATTRIBUTE) ?? '';
    const summary = byIdentity.get(identity);

    expect(summary).toBeDefined();
    const invite = summary as InviteSummary;

    // 11.2: the Invite_State named in text, not by colour or position.
    const stateLabel = entry.querySelector(INVITE_STATE_LABEL_SELECTOR);
    expect(stateLabel).not.toBeNull();
    expect(stateLabel?.textContent).toBe(EXPECTED_STATE_LABELS[invite.state]);
    expect(stateLabel?.getAttribute(INVITE_STATE_ATTRIBUTE)).toBe(invite.state);

    // 11.2: the creation instant, in text and in a machine-readable form.
    const created = entry.querySelector(INVITE_CREATED_SELECTOR);
    expect(created).not.toBeNull();
    expect(created?.textContent).toBe(formatInviteInstant(invite.createdAtMs));
    expect(created?.getAttribute('datetime')).toBe(
      inviteInstantAttribute(invite.createdAtMs) ?? null,
    );

    const expires = entry.querySelector(INVITE_EXPIRES_SELECTOR);
    const neverExpires = entry.querySelector(INVITE_NEVER_EXPIRES_SELECTOR);

    if (invite.expiresAtMs === null) {
      // 11.2: a statement in text rather than a blank column.
      expect(neverExpires).not.toBeNull();
      expect(neverExpires?.textContent).toBe(INVITE_NEVER_EXPIRES_LABEL);
      expect(expires).toBeNull();
    } else {
      expect(expires).not.toBeNull();
      expect(expires?.textContent).toBe(formatInviteInstant(invite.expiresAtMs));
      expect(expires?.getAttribute('datetime')).toBe(
        inviteInstantAttribute(invite.expiresAtMs) ?? null,
      );
      expect(neverExpires).toBeNull();
    }
  }
}

/**
 * Requirement 11.3: the rendered sequence is the ordering rule's sequence, it is
 * the one the single pure function yields, and consecutive entries are strictly
 * ascending under the rule — the last being what makes the order *total* rather
 * than merely sorted-looking.
 */
function expectEntriesAreOrdered(summaries: readonly InviteSummary[]): void {
  const rendered = renderedIdentities();

  // The rule as restated in this file, independently of the implementation.
  expect(rendered).toEqual(expectedIdentityOrder(summaries));

  // And nothing in the rendering path sorts anything of its own — the sequence is
  // exactly what the one pure ordering function yields.
  expect(rendered).toEqual(
    orderInviteSummaries(summaries).map((summary) => summary.inviteId),
  );

  const byIdentity = new Map(
    summaries.map((summary) => [summary.inviteId, summary] as const),
  );

  for (let index = 1; index < rendered.length; index += 1) {
    const previous = byIdentity.get(rendered[index - 1]);
    const current = byIdentity.get(rendered[index]);

    expect(previous).toBeDefined();
    expect(current).toBeDefined();
    expect(
      compareByRule(previous as InviteSummary, current as InviteSummary),
    ).toBe(-1);
  }
}

/**
 * Requirement 11.9: a revoke control on every `active` entry, none on a revoked
 * or expired one, and each control bound to the invite identity of the entry it
 * sits in — so a listing that rendered the right number of controls against the
 * wrong invites cannot pass.
 *
 * The whole-listing count is asserted too, which catches a control rendered
 * outside any entry.
 */
function expectRevokeControlsSitOnActiveEntriesOnly(
  summaries: readonly InviteSummary[],
): void {
  const byIdentity = new Map(
    summaries.map((summary) => [summary.inviteId, summary] as const),
  );

  for (const entry of renderedEntries()) {
    const identity = entry.getAttribute(INVITE_ENTRY_ATTRIBUTE) ?? '';
    const invite = byIdentity.get(identity) as InviteSummary;
    const revoke = entry.querySelector(INVITE_REVOKE_SELECTOR);

    if (invite.state === 'active') {
      expect(revoke).not.toBeNull();
      expect(revoke?.getAttribute(REVOKE_ATTRIBUTE)).toBe(identity);
    } else {
      expect(revoke).toBeNull();
    }
  }

  expect(
    document.querySelectorAll(INVITE_REVOKE_SELECTOR).length,
  ).toBe(summaries.filter((summary) => summary.state === 'active').length);
}

/**
 * Requirement 11.4: no listing discloses a redeemable value.
 *
 * Asserted in two places, because the absence has two halves. A parsed summary
 * carries exactly the five properties an Invite_Summary names, so nothing
 * redeemable ever reaches the rendering path; and no secret-shaped value the body
 * carried appears anywhere in the document — in text, in an attribute, or in a
 * comment — so nothing reached it by another route either.
 */
function expectNoRedeemableValueIsRendered(
  summaries: readonly InviteSummary[],
  secrets: readonly string[],
): void {
  for (const summary of summaries) {
    expect(Object.keys(summary).sort()).toEqual([...INVITE_SUMMARY_KEYS].sort());
  }

  const markup = document.body.innerHTML;
  const text = document.body.textContent ?? '';

  for (const secret of secrets) {
    expect(markup).not.toContain(secret);
    expect(text).not.toContain(secret);
  }

  // The marker itself, so a truncated or re-encoded fragment of a secret is
  // caught as well as a whole one.
  expect(markup).not.toContain(SECRET_MARKER);
}

/**
 * The surface is the listing rather than an absence or a failure: an accepted
 * empty collection states that the squad has no invites, and a non-empty one
 * renders entries instead of that statement. Asserted alongside the entry set so
 * "no entry out of place" cannot be satisfied by rendering nothing at all.
 */
function expectSurfaceMatchesCollection(
  summaries: readonly InviteSummary[],
): void {
  expect(document.querySelector(INVITE_MANAGER_SELECTOR)).not.toBeNull();

  const text = document.body.textContent ?? '';

  if (summaries.length === 0) {
    expect(text).toContain(NO_INVITES_STATEMENT);
  } else {
    expect(text).not.toContain(NO_INVITES_STATEMENT);
  }
}

// --- The property ------------------------------------------------------------

describe('Property 28 — the invite listing is ordered, complete, and discloses no redeemable value', () => {
  // Feature: web-squads-screens, Property 28: The invite listing is ordered, complete, and discloses no redeemable value
  // Validates: Requirements 11.2, 11.3, 11.4, 11.9
  it('renders one entry per parsed summary, each stating its state and instants, in the ordering rule’s sequence', async () => {
    await fc.assert(
      fc.asyncProperty(collectionArb(0, 8), async (cases) => {
        const summaries = parsedCollectionOf(cases);

        try {
          await renderListing(summaries);

          expectSurfaceMatchesCollection(summaries);
          expectOneEntryPerSummary(summaries);
          expectEntryStatesTheInvite(summaries);
          expectEntriesAreOrdered(summaries);
          expectRevokeControlsSitOnActiveEntriesOnly(summaries);
          expectNoRedeemableValueIsRendered(summaries, secretValuesOf(cases));
        } finally {
          cleanup();
        }
      }),
      { numRuns: 120 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 28: The invite listing is ordered, complete, and discloses no redeemable value
  // Validates: Requirements 11.3, 20.6
  it('renders the identical entry sequence for any two permutations of the same collection', async () => {
    await fc.assert(
      fc.asyncProperty(
        collectionArb(2, 8).chain((cases) =>
          fc.record({
            first: permutationArb(cases),
            second: permutationArb(cases),
          }),
        ),
        async ({ first, second }) => {
          const renderOrder = async (
            cases: readonly InviteCase[],
          ): Promise<readonly string[]> => {
            try {
              await renderListing(parsedCollectionOf(cases));
              return renderedIdentities();
            } finally {
              cleanup();
            }
          };

          const firstOrder = await renderOrder(first);
          const secondOrder = await renderOrder(second);

          // 20.6: the rendered order is a function of the collection alone. It
          // matters here beyond tidiness: Requirement 11.10 has a successful
          // revocation issue a *further* `ListInvites`, and `ListInvites` promises
          // no order — so an order that owed anything to arrival position would
          // rearrange the listing under the admin's cursor between two revokes.
          expect(firstOrder).toEqual(secondOrder);
          // And that shared order is the rule's own, not merely a stable one.
          expect(firstOrder).toEqual(
            expectedIdentityOrder(parsedCollectionOf(first)),
          );
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 28: The invite listing is ordered, complete, and discloses no redeemable value
  // Validates: Requirements 11.2, 11.4, 11.9
  it('discloses no redeemable value for bodies carrying every secret-shaped property at once', async () => {
    await fc.assert(
      fc.asyncProperty(
        collectionArb(1, 6, allSecretFieldsArb),
        async (cases) => {
          const summaries = parsedCollectionOf(cases);
          const secrets = secretValuesOf(cases);

          // Every body carried all five, so the run is genuinely about disclosure
          // rather than about a generator that drew nothing.
          expect(secrets).toHaveLength(cases.length * SECRET_SHAPED_KEYS.length);

          try {
            await renderListing(summaries);

            // The listing is fully rendered — the absence is not the absence of a
            // listing.
            expectOneEntryPerSummary(summaries);
            expectEntryStatesTheInvite(summaries);
            expectRevokeControlsSitOnActiveEntriesOnly(summaries);
            expectNoRedeemableValueIsRendered(summaries, secrets);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});
