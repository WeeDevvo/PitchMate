import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { MEMBERSHIP_STATE_CODES, MEMBER_ROLE_CODES } from '../enumCodes';
import { parseCreatedGuest } from './createdGuest';
import { parseCreatedSquad } from './createdSquad';
import { parseFeatureFlag, parseFeatureFlags } from './featureFlags';
import { parseGeneratedInvite } from './generatedInvite';
import { parseInvitePreview } from './invitePreview';
import { parseInviteSummary, parseInviteSummaryList } from './inviteSummary';
import {
  parseDisplayRatingEntry,
  parseDisplayRatingLeaderboard,
} from './leaderboard';
import type { ParseResult } from './primitives';
import { parseRedemption } from './redemption';
import { parseSquadDetail, parseSquadMember } from './squadDetail';
import { parseSquadSummary, parseSquadSummaryList } from './squadSummary';

/**
 * Property test for the two tolerances every Response_Parser owes a body, placed
 * beside the modules it covers as the design's Testing Strategy asks and running
 * well above the 100-iteration floor (20.1).
 *
 * This file carries **Property 38: Absent role and state parse as absences, and
 * unknown properties are disregarded** — for any body whose role field, state
 * field, or both are `null` or absent, the parser yields a value carrying those
 * absences rather than a failure (16.8); and for any body extended with
 * properties the parser does not recognise, the parsed outcome equals the outcome
 * of the same body without them (16.9).
 *
 * Four things about how this is written matter more than the run counts.
 *
 * First, **`null` and absent are generated as separate cases and asserted to
 * agree**. A JSON body can express both, this feature treats them as the same
 * absence, and only generating both can show that it does. The Squad_Summary's
 * `role` and `state` are exercised across all nine combinations of present,
 * `null`, and absent, because that field pair is where the requirement bites: a
 * caller whose membership the backend could not resolve sends both as `null`, and
 * failing that body would empty the Squads_Home.
 *
 * Second, the **asymmetry between the two membership shapes is asserted, not
 * assumed**. A Squad_Summary's `state` may be absent; a Squad_Member's may not,
 * because the Player_Order sorts on it and the Admin_Authority check reads it. A
 * test that only asserted tolerance would pass on a parser that had gone lenient
 * everywhere, so the member's absent and `null` `state` are asserted to **fail**
 * in the same file that asserts the summary's parse.
 *
 * Third, the **unrecognised-property side is stated as an equality of outcomes,
 * over both valid and malformed bases**. Requirement 16.9 is not "an extra
 * property does not throw" but "an extra property changes nothing", so the
 * assertion compares the whole `ParseResult` — including the failure reason of a
 * body that was already going to fail — against the same body without the extras.
 * The injected keys are drawn per shape from the keys **other** parsers in the
 * feature recognise (`members` on a summary, `statistic` on a leaderboard,
 * `redeemableLink` on anything that is not a generated invite) plus
 * secret-shaped, prototype-shaped, and awkward names, because a near-miss key is
 * where an over-eager reader would trip.
 *
 * Fourth, tolerance is asserted to be **omission rather than filtering**. An
 * unrecognised property defined as a throwing accessor must not throw, which is
 * only true if it is never read at all; and a secret-shaped extra property
 * carrying a marker value must not appear anywhere in the parsed outcome, reason
 * text included (4.10, 17.2).
 *
 * Requirements: 16.8, 16.9
 */

/* -------------------------------------------------------------------------- */
/* Generators for well-formed wire values                                     */
/* -------------------------------------------------------------------------- */

/** The 36-character hyphenated identity form, in both letter cases. */
const uuidArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.uuid().map((identity) => identity.toUpperCase()),
);

/**
 * An ISO-8601 instant with an explicit `Z`, bounded to a range `toISOString`
 * always renders — the instant grammar itself is the round-trip property's
 * subject, not this one's.
 */
const isoInstantArb: fc.Arbitrary<string> = fc
  .integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 })
  .map((instantMs) => new Date(instantMs).toISOString());

/**
 * A code table's entries as code/name pairs, read from the Enum_Code_Map rather
 * than restated — this file asserts tolerance, not the codes themselves, and the
 * codes have their own property (37).
 */
function entriesOf(
  table: Readonly<Record<number, string>>,
): readonly (readonly [number, string])[] {
  return Object.entries(table).map(([code, named]) => [Number(code), named]);
}

const MEMBER_ROLE_ENTRIES = entriesOf(MEMBER_ROLE_CODES);
const MEMBERSHIP_STATE_ENTRIES = entriesOf(MEMBERSHIP_STATE_CODES);

/** The name a table gives a wire value, or `null` when it gives it none. */
function nameOf(
  entries: readonly (readonly [number, string])[],
  code: unknown,
): string | null {
  return entries.find(([candidate]) => candidate === code)?.[1] ?? null;
}

const roleCodeArb: fc.Arbitrary<number> = fc.constantFrom(
  ...MEMBER_ROLE_ENTRIES.map(([code]) => code),
);

const membershipStateCodeArb: fc.Arbitrary<number> = fc.constantFrom(
  ...MEMBERSHIP_STATE_ENTRIES.map(([code]) => code),
);

/** `SquadFeature` carries one member; `InviteState` three; `RedeemOutcome` is 0-based. */
const featureCodeArb: fc.Arbitrary<number> = fc.constant(1);
const inviteStateCodeArb: fc.Arbitrary<number> = fc.constantFrom(1, 2, 3);
const redeemOutcomeCodeArb: fc.Arbitrary<number> = fc.constantFrom(0, 1, 2);

const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.string({ unit: 'grapheme', maxLength: 12 }),
);

const finiteNumberArb: fc.Arbitrary<number> = fc.double({
  noNaN: true,
  noDefaultInfinity: true,
});

/* -------------------------------------------------------------------------- */
/* Absence: how a field is carried, and what it should parse to               */
/* -------------------------------------------------------------------------- */

/**
 * The three ways a body can carry an optional field. `absent` writes no property
 * at all; `null` writes the JSON null; `present` writes a valid wire value. The
 * first two are the same absence to this feature, which is exactly what
 * Requirement 16.8 asks and what the properties below check by asserting the same
 * parsed outcome for each.
 */
const PRESENCES = ['absent', 'null', 'present'] as const;

type Presence = (typeof PRESENCES)[number];

const presenceArb: fc.Arbitrary<Presence> = fc.constantFrom(...PRESENCES);

/** The two presences that mean "the field was not sent". */
const absenceArb: fc.Arbitrary<Presence> = fc.constantFrom<Presence>(
  'absent',
  'null',
);

/**
 * Writes an optional field onto a body under construction, leaving the property
 * off entirely for `absent`.
 */
function writeOptional(
  body: Record<string, unknown>,
  key: string,
  presence: Presence,
  wire: unknown,
): void {
  if (presence === 'absent') {
    return;
  }

  body[key] = presence === 'null' ? null : wire;
}

/* -------------------------------------------------------------------------- */
/* Part one: `role` and `state` absences (16.8)                               */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 38: Absent role and state parse as absences, and unknown properties are disregarded
// Validates: Requirements 16.8, 16.9
describe('Response_Parser — a `null` or absent role and state are absences', () => {
  it('parses a Squad_Summary for every combination of present, null, and absent', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        presenceArb,
        roleCodeArb,
        presenceArb,
        membershipStateCodeArb,
        (squadId, name, rolePresence, roleCode, statePresence, stateCode) => {
          const body: Record<string, unknown> = { squadId, name };
          writeOptional(body, 'role', rolePresence, roleCode);
          writeOptional(body, 'state', statePresence, stateCode);

          const result = parseSquadSummary(body);

          // 16.8: nine combinations, nine successes. A caller whose membership
          // the backend could not resolve sends both fields as `null`, and
          // failing that body would empty the Squads_Home.
          expect(result.ok).toBe(true);

          if (!result.ok) {
            return;
          }

          expect(result.value).toStrictEqual({
            squadId,
            name,
            role:
              rolePresence === 'present'
                ? nameOf(MEMBER_ROLE_ENTRIES, roleCode)
                : null,
            state:
              statePresence === 'present'
                ? nameOf(MEMBERSHIP_STATE_ENTRIES, stateCode)
                : null,
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('reads a `null` role and an absent role as the same absence', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        membershipStateCodeArb,
        (squadId, name, stateCode) => {
          // The distinction a JSON body can express between "sent as null" and
          // "not sent" carries no meaning here, so the two must be
          // indistinguishable in the parsed value rather than merely both valid.
          expect(
            parseSquadSummary({ squadId, name, role: null, state: stateCode }),
          ).toStrictEqual(parseSquadSummary({ squadId, name, state: stateCode }));

          expect(
            parseSquadSummary({ squadId, name, role: 1, state: null }),
          ).toStrictEqual(parseSquadSummary({ squadId, name, role: 1 }));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parses a Squad_Summary carrying both absences, by either spelling', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        absenceArb,
        absenceArb,
        (squadId, name, rolePresence, statePresence) => {
          const body: Record<string, unknown> = { squadId, name };
          writeOptional(body, 'role', rolePresence, 1);
          writeOptional(body, 'state', statePresence, 1);

          expect(parseSquadSummary(body)).toStrictEqual({
            ok: true,
            value: { squadId, name, role: null, state: null },
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parses a whole squads listing whose summaries carry mixed absences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record(
            {
              squadId: uuidArb,
              name: displayNameArb,
              role: fc.oneof(fc.constant(null), roleCodeArb),
              state: fc.oneof(fc.constant(null), membershipStateCodeArb),
            },
            { requiredKeys: ['squadId', 'name'] },
          ),
          { maxLength: 8 },
        ),
        (summaries) => {
          const result = parseSquadSummaryList(summaries);

          // One absence must not fail the body that carries it, so a listing of
          // guests and unresolved memberships parses whole (16.8).
          expect(result.ok).toBe(true);

          if (!result.ok) {
            return;
          }

          expect(result.value).toHaveLength(summaries.length);

          for (const [index, summary] of result.value.entries()) {
            const source = summaries[index];

            expect(summary.role).toBe(nameOf(MEMBER_ROLE_ENTRIES, source.role));
            expect(summary.state).toBe(
              nameOf(MEMBERSHIP_STATE_ENTRIES, source.state),
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses a Squad_Member whose role is `null` or absent — a guest', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        absenceArb,
        membershipStateCodeArb,
        fc.boolean(),
        (membershipId, displayName, rolePresence, stateCode, isGuest) => {
          const body: Record<string, unknown> = {
            membershipId,
            displayName,
            state: stateCode,
            isGuest,
          };
          writeOptional(body, 'role', rolePresence, 1);

          expect(parseSquadMember(body)).toStrictEqual({
            ok: true,
            value: {
              membershipId,
              displayName,
              role: null,
              state: nameOf(MEMBERSHIP_STATE_ENTRIES, stateCode),
              isGuest,
            },
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails a Squad_Member whose state is `null` or absent', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        presenceArb,
        roleCodeArb,
        absenceArb,
        fc.boolean(),
        (membershipId, displayName, rolePresence, roleCode, statePresence, isGuest) => {
          const body: Record<string, unknown> = {
            membershipId,
            displayName,
            isGuest,
          };
          writeOptional(body, 'role', rolePresence, roleCode);
          writeOptional(body, 'state', statePresence, 1);

          const result = parseSquadMember(body);

          // The asymmetry, asserted rather than assumed: a membership always has
          // a lifecycle state, and an invented `active` would reorder the
          // Player_List and could unlock an administration surface. Without this,
          // a parser gone lenient everywhere would still pass the test above.
          expect(result.ok).toBe(false);

          if (result.ok) {
            return;
          }

          expect(typeof result.reason).toBe('string');
          expect(result.reason.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses a Squad_Detail whose members are all roleless guests', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        fc.array(
          fc.record(
            {
              membershipId: uuidArb,
              displayName: displayNameArb,
              role: fc.constant(null),
              state: membershipStateCodeArb,
              isGuest: fc.constant(true),
            },
            { requiredKeys: ['membershipId', 'displayName', 'state', 'isGuest'] },
          ),
          { maxLength: 6 },
        ),
        (squadId, name, members) => {
          const result = parseSquadDetail({ squadId, name, members, features: [] });

          expect(result.ok).toBe(true);

          if (!result.ok) {
            return;
          }

          for (const member of result.value.members) {
            expect(member.role).toBeNull();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every absence of the Redemption body, the empty body included', () => {
    fc.assert(
      fc.property(
        absenceArb,
        absenceArb,
        absenceArb,
        (membershipPresence, outcomePresence, squadPresence) => {
          const body: Record<string, unknown> = {};
          writeOptional(body, 'membershipId', membershipPresence, null);
          writeOptional(body, 'outcome', outcomePresence, 0);
          writeOptional(body, 'squadId', squadPresence, null);

          const empty = {
            ok: true,
            value: { membershipId: null, outcome: null, squadId: null },
          };

          // The already-a-member no-op answers `200` with no body at all, which
          // the transport seam hands on as an absence; failing it would tell a
          // person their invite did not work when nothing needed doing.
          expect(parseRedemption(body)).toStrictEqual(empty);
          expect(parseRedemption(undefined)).toStrictEqual(empty);
          expect(parseRedemption(null)).toStrictEqual(empty);
          expect(parseRedemption({})).toStrictEqual(empty);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parses a Generated_Invite and an Invite_Summary carrying instant absences', () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        absenceArb,
        inviteStateCodeArb,
        isoInstantArb,
        absenceArb,
        absenceArb,
        (
          inviteId,
          redeemableLink,
          code,
          expiryPresence,
          state,
          createdAt,
          summaryExpiryPresence,
          createdByPresence,
        ) => {
          const invite: Record<string, unknown> = {
            inviteId,
            redeemableLink,
            code,
          };
          writeOptional(invite, 'expiresAt', expiryPresence, createdAt);

          // A non-expiring invite is an absence with meaning, not a missing
          // value, so it parses rather than failing.
          expect(parseGeneratedInvite(invite)).toStrictEqual({
            ok: true,
            value: { inviteId, redeemableLink, code, expiresAtMs: null },
          });

          const summary: Record<string, unknown> = { inviteId, state, createdAt };
          writeOptional(summary, 'expiresAt', summaryExpiryPresence, createdAt);
          writeOptional(summary, 'createdBy', createdByPresence, 'someone');

          const result = parseInviteSummary(summary);

          expect(result.ok).toBe(true);

          if (!result.ok) {
            return;
          }

          expect(result.value.expiresAtMs).toBeNull();
          expect(result.value.createdBy).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Part two: unrecognised properties (16.9)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Secret-shaped keys. `redeemableLink` and `code` are recognised by exactly one
 * parser and by nothing else, so on every other shape they are extra properties
 * that must be disregarded — an Invite_Secret must never reach a parsed value
 * through a body that has no business carrying one (4.10).
 */
const SECRET_SHAPED_KEYS = [
  'token',
  'inviteToken',
  'redeemableLink',
  'code',
  'presentedSecret',
  'secret',
  'tokenHash',
  'plaintextToken',
  'refreshToken',
] as const;

/**
 * Squad-shaped keys: every property name a parser in this feature recognises on
 * *some* shape, plus plausible additive names a future backend might send. Used
 * per shape with that shape's own recognised keys removed, so each injection is a
 * near miss rather than an obviously foreign name.
 */
const SQUAD_SHAPED_KEYS = [
  'squadId',
  'name',
  'members',
  'features',
  'membershipId',
  'displayName',
  'role',
  'state',
  'isGuest',
  'entries',
  'statistic',
  'value',
  'outcome',
  'inviteId',
  'createdAt',
  'createdBy',
  'expiresAt',
  'feature',
  'isEnabled',
  'guestMembershipId',
  'ownerMembershipId',
  'requiresAuthentication',
  'message',
  'skillTier',
  'ratingValue',
  'isProvisional',
  'memberCount',
  'ownerId',
] as const;

/** Names that are awkward for a reason other than shape. */
const AWKWARD_KEYS = [
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  '',
  ' ',
  '0',
  'length',
  'role ',
  ' state',
  'ROLE',
] as const;

const ALL_INJECTABLE_KEYS: readonly string[] = [
  ...SECRET_SHAPED_KEYS,
  ...SQUAD_SHAPED_KEYS,
  ...AWKWARD_KEYS,
];

/** Wraps a leaf in `depth` alternating levels of array and object. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { nested: value };
  }

  return value;
}

/** The values an unrecognised property might carry — anything at all. */
const unknownValueArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.anything({
      maxDepth: 2,
      withBigInt: true,
      withMap: true,
      withSet: true,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      -0,
      1,
      7,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      'owner',
      'active',
      [],
      {},
      [[[]]],
      1n,
      Symbol('extra'),
      () => 1,
      new Map([['role', 1]]),
      new Set([1]),
      new Date(0),
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: 1, max: 100 })
      .map((depth) => nest({ role: 1, state: 1 }, depth)),
  },
);

/** One unrecognised property: a name the parser does not read, and any value. */
type Extra = readonly [string, unknown];

/**
 * `base` with each extra defined on it as an **own, enumerable** property.
 *
 * Defined rather than assigned, because assigning `__proto__` would set the
 * prototype instead of adding a property — and a body arriving from
 * `JSON.parse` carries `__proto__` as an ordinary own property. Testing the
 * assignment form would be testing a body the transport cannot produce, and
 * would change what the parser reads rather than what it ignores.
 */
function withExtras(
  base: Readonly<Record<string, unknown>>,
  extras: readonly Extra[],
): Record<string, unknown> {
  const extended: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(base)) {
    Object.defineProperty(extended, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  for (const [key, value] of extras) {
    Object.defineProperty(extended, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return extended;
}

/* --- the well-formed body of every shape in the feature -------------------- */

const squadSummaryBodyArb = fc.record(
  {
    squadId: uuidArb,
    name: displayNameArb,
    role: fc.oneof(fc.constant(null), roleCodeArb),
    state: fc.oneof(fc.constant(null), membershipStateCodeArb),
  },
  { requiredKeys: ['squadId', 'name'] },
);

const squadMemberBodyArb = fc.record(
  {
    membershipId: uuidArb,
    displayName: displayNameArb,
    role: fc.oneof(fc.constant(null), roleCodeArb),
    state: membershipStateCodeArb,
    isGuest: fc.boolean(),
  },
  { requiredKeys: ['membershipId', 'displayName', 'state', 'isGuest'] },
);

const featureFlagBodyArb = fc.record({
  feature: featureCodeArb,
  isEnabled: fc.boolean(),
});

const squadDetailBodyArb = fc.record({
  squadId: uuidArb,
  name: displayNameArb,
  members: fc.array(squadMemberBodyArb, { maxLength: 5 }),
  features: fc.array(featureFlagBodyArb, { maxLength: 2 }),
});

const leaderboardEntryBodyArb = fc.record({
  membershipId: uuidArb,
  displayName: displayNameArb,
  value: finiteNumberArb,
});

const leaderboardBodyArb = fc.record({
  entries: fc.uniqueArray(leaderboardEntryBodyArb, {
    maxLength: 6,
    selector: (entry) => entry.membershipId,
  }),
});

const redemptionBodyArb = fc.record(
  {
    membershipId: fc.oneof(fc.constant(null), uuidArb),
    outcome: fc.oneof(fc.constant(null), redeemOutcomeCodeArb),
    squadId: fc.oneof(fc.constant(null), uuidArb),
  },
  { requiredKeys: [] },
);

const createdSquadBodyArb = fc.record({
  squadId: uuidArb,
  ownerMembershipId: uuidArb,
});

const createdGuestBodyArb = fc.record({ guestMembershipId: uuidArb });

const generatedInviteBodyArb = fc.record(
  {
    inviteId: uuidArb,
    redeemableLink: fc.string({ minLength: 1, maxLength: 64 }),
    code: fc.string({ minLength: 1, maxLength: 16 }),
    expiresAt: fc.oneof(fc.constant(null), isoInstantArb),
  },
  { requiredKeys: ['inviteId', 'redeemableLink', 'code'] },
);

const invitePreviewBodyArb = fc.record({
  requiresAuthentication: fc.boolean(),
  message: displayNameArb,
});

const inviteSummaryBodyArb = fc.record(
  {
    inviteId: uuidArb,
    state: inviteStateCodeArb,
    createdAt: isoInstantArb,
    createdBy: fc.oneof(fc.constant(null), displayNameArb),
    expiresAt: fc.oneof(fc.constant(null), isoInstantArb),
  },
  { requiredKeys: ['inviteId', 'state', 'createdAt'] },
);

/** One body shape: its parser, the properties that parser reads, and its body. */
interface WireShape {
  readonly label: string;
  readonly parse: (body: unknown) => ParseResult<unknown>;
  readonly recognisedKeys: readonly string[];
  readonly bodyArb: fc.Arbitrary<Record<string, unknown>>;
}

const SHAPES: readonly WireShape[] = [
  {
    label: 'Squad_Summary',
    parse: parseSquadSummary,
    recognisedKeys: ['squadId', 'name', 'role', 'state'],
    bodyArb: squadSummaryBodyArb,
  },
  {
    label: 'Squad_Member',
    parse: parseSquadMember,
    recognisedKeys: ['membershipId', 'displayName', 'role', 'state', 'isGuest'],
    bodyArb: squadMemberBodyArb,
  },
  {
    label: 'Squad_Detail',
    parse: parseSquadDetail,
    recognisedKeys: ['squadId', 'name', 'members', 'features'],
    bodyArb: squadDetailBodyArb,
  },
  {
    label: 'Feature_Flag',
    parse: parseFeatureFlag,
    recognisedKeys: ['feature', 'isEnabled'],
    bodyArb: featureFlagBodyArb,
  },
  {
    label: 'Display_Rating entry',
    parse: parseDisplayRatingEntry,
    recognisedKeys: ['membershipId', 'displayName', 'value'],
    bodyArb: leaderboardEntryBodyArb,
  },
  {
    label: 'Display_Rating leaderboard',
    parse: parseDisplayRatingLeaderboard,
    recognisedKeys: ['entries'],
    bodyArb: leaderboardBodyArb,
  },
  {
    label: 'Redemption',
    parse: parseRedemption,
    recognisedKeys: ['membershipId', 'outcome', 'squadId'],
    bodyArb: redemptionBodyArb,
  },
  {
    label: 'Created_Squad',
    parse: parseCreatedSquad,
    recognisedKeys: ['squadId', 'ownerMembershipId'],
    bodyArb: createdSquadBodyArb,
  },
  {
    label: 'Created_Guest',
    parse: parseCreatedGuest,
    recognisedKeys: ['guestMembershipId'],
    bodyArb: createdGuestBodyArb,
  },
  {
    label: 'Generated_Invite',
    parse: parseGeneratedInvite,
    recognisedKeys: ['inviteId', 'redeemableLink', 'code', 'expiresAt'],
    bodyArb: generatedInviteBodyArb,
  },
  {
    label: 'Invite_Preview',
    parse: parseInvitePreview,
    recognisedKeys: ['requiresAuthentication', 'message'],
    bodyArb: invitePreviewBodyArb,
  },
  {
    label: 'Invite_Summary',
    parse: parseInviteSummary,
    recognisedKeys: ['inviteId', 'state', 'createdAt', 'createdBy', 'expiresAt'],
    bodyArb: inviteSummaryBodyArb,
  },
];

/** Every property name any parser in the feature reads. */
const GLOBALLY_RECOGNISED_KEYS: ReadonlySet<string> = new Set(
  SHAPES.flatMap((shape) => shape.recognisedKeys),
);

/** A marker no parsed value may carry, whatever a body puts beside it. */
const MARKER = 'pitchmate-unrecognised-property-marker';

/**
 * The whole unrecognised-property side of Property 38 for one shape.
 *
 * The injectable keys are this shape's near misses: every name any parser in the
 * feature reads, minus the ones *this* parser reads, plus the secret-shaped,
 * prototype-shaped, and awkward names. So a Squad_Summary is offered `members`
 * and `entries`, a leaderboard is offered `role` and `redeemableLink`, and a
 * generated invite is offered everything except its own four fields.
 */
function describeShapeTolerance(shape: WireShape): void {
  const recognised = new Set(shape.recognisedKeys);
  const injectableKeys = ALL_INJECTABLE_KEYS.filter((key) => !recognised.has(key));
  const keyArb = fc.constantFrom(...injectableKeys);
  const extrasArb = fc.uniqueArray(fc.tuple(keyArb, unknownValueArb), {
    minLength: 1,
    maxLength: 4,
    selector: ([key]) => key,
  });

  /** Bodies the parser accepts, and bodies it does not — both must be tolerant. */
  const anyBodyArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
    { weight: 3, arbitrary: shape.bodyArb },
    {
      weight: 1,
      arbitrary: fc.dictionary(
        fc.constantFrom(...shape.recognisedKeys),
        fc.anything({ maxDepth: 2 }),
        { maxKeys: 4 },
      ),
    },
  );

  // Feature: web-squads-screens, Property 38: Absent role and state parse as absences, and unknown properties are disregarded
  // Validates: Requirements 16.8, 16.9
  describe(`Response_Parser — ${shape.label} disregards unrecognised properties`, () => {
    it('parses a well-formed body with extra properties to the same value', () => {
      fc.assert(
        fc.property(shape.bodyArb, extrasArb, (body, extras) => {
          // 16.9 stated as an equality of outcomes rather than as "does not
          // throw": an additive backend change must change nothing at all.
          expect(shape.parse(withExtras(body, extras))).toStrictEqual(
            shape.parse(body),
          );
        }),
        { numRuns: 300 },
      );
    });

    it('parses a malformed body with extra properties to the same failure', () => {
      fc.assert(
        fc.property(anyBodyArb, extrasArb, (body, extras) => {
          // The reason is compared too. A parser that mentioned an unrecognised
          // property in a diagnostic would have read it, and a body that was
          // going to fail must fail for the same field it failed on before.
          expect(shape.parse(withExtras(body, extras))).toStrictEqual(
            shape.parse(body),
          );
        }),
        { numRuns: 300 },
      );
    });

    it('parses a body carrying every injectable extra property at once', () => {
      fc.assert(
        fc.property(shape.bodyArb, unknownValueArb, (body, value) => {
          const extras: readonly Extra[] = injectableKeys.map((key) => [key, value]);

          expect(shape.parse(withExtras(body, extras))).toStrictEqual(
            shape.parse(body),
          );
        }),
        { numRuns: 200 },
      );
    });

    it('never reads an unrecognised property, even a throwing accessor', () => {
      fc.assert(
        fc.property(anyBodyArb, keyArb, (body, key) => {
          let reads = 0;
          const extended: Record<string, unknown> = withExtras(body, []);

          Object.defineProperty(extended, key, {
            get(): never {
              reads += 1;
              throw new Error('an unrecognised property must never be read');
            },
            enumerable: true,
            configurable: true,
          });

          // Tolerance by omission, not by filtering: a parser that copied the
          // body or enumerated its keys before reading the ones it wants would
          // trip this accessor, and a parser that named its fields cannot.
          expect(shape.parse(extended)).toStrictEqual(shape.parse(body));
          expect(reads).toBe(0);
        }),
        { numRuns: 200 },
      );
    });

    it('lets no unrecognised value reach the parsed outcome', () => {
      fc.assert(
        fc.property(
          anyBodyArb,
          keyArb,
          fc.string({ maxLength: 8 }),
          (body, key, suffix) => {
            const marker = `${MARKER}:${suffix}`;
            const result = shape.parse(withExtras(body, [[key, marker]]));

            // A secret-shaped extra property must not surface in a value or in a
            // diagnostic reason, which is where a leaked Invite_Secret would
            // travel into a log (4.10, 17.2).
            expect(JSON.stringify(result)).not.toContain(MARKER);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
}

for (const shape of SHAPES) {
  describeShapeTolerance(shape);
}

/* --- collections, and objects nested inside a body ------------------------ */

/** Extras drawn from names **no** parser in the feature reads, for deep injection. */
const globallyUnrecognisedKeyArb: fc.Arbitrary<string> = fc.constantFrom(
  ...ALL_INJECTABLE_KEYS.filter((key) => !GLOBALLY_RECOGNISED_KEYS.has(key)),
);

const deepExtrasArb = fc.uniqueArray(
  fc.tuple(globallyUnrecognisedKeyArb, unknownValueArb),
  { minLength: 1, maxLength: 3, selector: ([key]) => key },
);

/** Whether a value is a plain object, the only thing the walker descends into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` with every plain object it contains — at every depth, inside arrays
 * included — carrying the given extras.
 *
 * Only ever applied to a generated well-formed body, so the walk is finite and
 * acyclic by construction.
 */
function extendEveryObject(value: unknown, extras: readonly Extra[]): unknown {
  if (Array.isArray(value)) {
    return value.map((element) => extendEveryObject(element, extras));
  }

  if (isPlainObject(value)) {
    const rewritten: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      Object.defineProperty(rewritten, key, {
        value: extendEveryObject(nestedValue, extras),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    return withExtras(rewritten, extras);
  }

  return value;
}

/** The collection bodies, whose elements are objects a parser reads one by one. */
const COLLECTIONS: readonly {
  readonly label: string;
  readonly parse: (body: unknown) => ParseResult<unknown>;
  readonly bodyArb: fc.Arbitrary<readonly Record<string, unknown>[]>;
}[] = [
  {
    label: 'squads listing',
    parse: parseSquadSummaryList,
    bodyArb: fc.array(squadSummaryBodyArb, { maxLength: 6 }),
  },
  {
    label: 'feature-flag collection',
    parse: parseFeatureFlags,
    bodyArb: fc.array(featureFlagBodyArb, { maxLength: 3 }),
  },
  {
    label: 'invite listing',
    parse: parseInviteSummaryList,
    bodyArb: fc.array(inviteSummaryBodyArb, { maxLength: 6 }),
  },
];

// Feature: web-squads-screens, Property 38: Absent role and state parse as absences, and unknown properties are disregarded
// Validates: Requirements 16.8, 16.9
describe('Response_Parser — unrecognised properties nested inside a body', () => {
  for (const collection of COLLECTIONS) {
    it(`parses a ${collection.label} whose every element carries extras to the same value`, () => {
      fc.assert(
        fc.property(collection.bodyArb, deepExtrasArb, (body, extras) => {
          // A list parser reads each element through the same element parser, so
          // an additive change lands on every element at once rather than on the
          // body's own properties.
          expect(
            collection.parse(extendEveryObject(body, extras)),
          ).toStrictEqual(collection.parse(body));
        }),
        { numRuns: 300 },
      );
    });
  }

  it('parses a Squad_Detail whose members and features all carry extras', () => {
    fc.assert(
      fc.property(squadDetailBodyArb, deepExtrasArb, (body, extras) => {
        expect(parseSquadDetail(extendEveryObject(body, extras))).toStrictEqual(
          parseSquadDetail(body),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('parses a leaderboard whose entries all carry extras', () => {
    fc.assert(
      fc.property(leaderboardBodyArb, deepExtrasArb, (body, extras) => {
        expect(
          parseDisplayRatingLeaderboard(extendEveryObject(body, extras)),
        ).toStrictEqual(parseDisplayRatingLeaderboard(body));
      }),
      { numRuns: 300 },
    );
  });

  it('parses a body whose extra property is nested 100 levels deep', () => {
    fc.assert(
      fc.property(
        squadSummaryBodyArb,
        globallyUnrecognisedKeyArb,
        fc.integer({ min: 1, max: 100 }),
        (body, key, depth) => {
          // Depth is only paid for where a parser descends deliberately, so an
          // unrecognised property of any depth costs the same as none at all.
          expect(
            parseSquadSummary(withExtras(body, [[key, nest({ role: 1 }, depth)]])),
          ).toStrictEqual(parseSquadSummary(body));
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* --- the two tolerances together ------------------------------------------ */

// Feature: web-squads-screens, Property 38: Absent role and state parse as absences, and unknown properties are disregarded
// Validates: Requirements 16.8, 16.9
describe('Response_Parser — absences and extra properties together', () => {
  it('parses a Squad_Summary with both absences and extra properties', () => {
    fc.assert(
      fc.property(
        uuidArb,
        displayNameArb,
        presenceArb,
        roleCodeArb,
        presenceArb,
        membershipStateCodeArb,
        deepExtrasArb,
        (squadId, name, rolePresence, roleCode, statePresence, stateCode, extras) => {
          const body: Record<string, unknown> = { squadId, name };
          writeOptional(body, 'role', rolePresence, roleCode);
          writeOptional(body, 'state', statePresence, stateCode);

          const result = parseSquadSummary(withExtras(body, extras));

          // The two rules of Requirement 16 that a real additive change exercises
          // at once: a guest membership sending no role, in a body a later backend
          // grew fields on.
          expect(result).toStrictEqual(parseSquadSummary(body));
          expect(result.ok).toBe(true);

          if (!result.ok) {
            return;
          }

          expect(result.value.role).toBe(
            rolePresence === 'present'
              ? nameOf(MEMBER_ROLE_ENTRIES, roleCode)
              : null,
          );
          expect(result.value.state).toBe(
            statePresence === 'present'
              ? nameOf(MEMBERSHIP_STATE_ENTRIES, stateCode)
              : null,
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it('parses an extra `role` on a shape that has no role at all', () => {
    fc.assert(
      fc.property(
        leaderboardEntryBodyArb,
        fc.oneof(roleCodeArb, fc.constant(null), fc.constant('owner')),
        (entry, role) => {
          // A leaderboard entry names no role, so a `role` the backend adds must
          // be disregarded rather than read — however plausible its value.
          expect(
            parseDisplayRatingEntry(withExtras(entry, [['role', role]])),
          ).toStrictEqual(parseDisplayRatingEntry(entry));
        },
      ),
      { numRuns: 200 },
    );
  });
});
