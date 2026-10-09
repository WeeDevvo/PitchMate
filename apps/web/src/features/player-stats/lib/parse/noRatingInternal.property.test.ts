import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FULL_PROFILE_FIXTURE,
  MINIMAL_PROFILE_FIXTURE,
  PROFILE_FIXTURE_ARBS,
  anyProfileFixtureArb,
  playerProfileArb,
  type PlayerProfileFixture,
} from '../../testing/playerProfileFixtures';
import { parsePlayerProfile, type PlayerProfile } from './playerProfile';

/**
 * Property 14: the parsed type graph holds no Rating_Internal.
 *
 * The backend's rating model has three kinds of quantity this feature is never
 * allowed to hold: the **mean skill**, the **uncertainty**, and the **display
 * scale and offset** constants that map the one to a friendly number
 * (Requirement 7.7). Two of them are on the wire today — every `RatingSummary`
 * and every progression record carries a mean and a spread — so the guarantee
 * cannot be read off the contract. It has to be read off the value the parser
 * produces.
 *
 * That is what this file does: it walks the transitive value graph of a parsed
 * `PlayerProfile` and reports every member whose *name* denotes one of the three
 * quantities. The claim is that the walk comes back empty, for every profile the
 * feature can hold.
 *
 * ## Why a reflective walk rather than a type assertion
 *
 * `RatingSummary` declares two members and a compiler error would follow from
 * adding a third, so a type-level check sounds sufficient. It is not, for two
 * reasons. A parsed value can carry members its declared type does not — an
 * object spread of the wire block, a cast, a `Record` built in a loop — and the
 * declared type would still typecheck while the rendered graph held a mean skill
 * for any component to reach. And the guarantee is about the **whole graph**,
 * transitively: a rating internal smuggled onto one of 500 progression points,
 * or onto one row of a 200-element Pairwise_Section, is as much a violation as
 * one on the summary, and no top-level type states anything about it.
 *
 * So the subject here is the runtime value, walked with `Reflect.ownKeys` over
 * each object **and its prototype chain**, so a planted member cannot hide as a
 * non-enumerable property, a symbol key, or a class accessor. Accessors are
 * named but never read: a getter is a finding by its name alone, and invoking
 * one would let a planted member decide whether it was found.
 *
 * ## Both halves of the read path
 *
 * The parsed-value generator is the cheap half, and on its own it would prove
 * too little — it yields values the fixtures built, so it demonstrates that the
 * *fixtures* hold no rating internal. The property that matters is about
 * `parsePlayerProfile`, so the walk is also pointed at profiles obtained by
 * parsing generated wire bodies, which do carry the wire's rating-model
 * members. Those cases assert both directions at once:
 *
 *  - the **body** walks to findings — the mean and the spread are really there,
 *    so a clean parse is not a clean input; and
 *  - the **parsed profile** walks to none — the parser named neither, so neither
 *    reached the graph.
 *
 * ## Spelling the forbidden names as data
 *
 * Every forbidden name below is a *string constant*, never a bare identifier, so
 * this file stays clean of the identifiers the feature's later rating-internal
 * source scan forbids over comment-and-string-stripped code — the convention
 * `testing/playerProfileFixtures.ts` already follows for the two wire member
 * names it has to send.
 *
 * Short names (`mu`, `sigma`, `k`, `c`) are matched as whole **segments** of a
 * member name, so `ratingMu`, `MU`, and `sigma_squared` are findings while
 * `count`, `keeperTimeMs`, and `cleanSheets` are not. The longer spelled forms
 * and the Greek symbols are matched as fragments. The table's own non-vacuity is
 * asserted member by member at the foot of this file.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 7.7**
 */

/* -------------------------------------------------------------------------- */
/* The three forbidden quantities, spelled as data                            */
/* -------------------------------------------------------------------------- */

/** The quantity a forbidden member name denotes. */
const MEAN_SKILL = 'a mean skill';
const UNCERTAINTY = 'an uncertainty';
const DISPLAY_SCALE = 'a display scale or offset';

/**
 * How a forbidden spelling is matched against a member name.
 *
 * `segment` compares whole words of the name — a two-letter spelling matched as
 * a fragment would fire on half the contract — and `fragment` compares the
 * lower-cased name as a substring, which is what the longer forms and the two
 * Greek symbols need.
 */
type SpellingMatch = 'segment' | 'fragment';

/** One forbidden member spelling, and the quantity it denotes. */
interface ForbiddenSpelling {
  /** The spelling, as a string rather than as an identifier. */
  readonly spelling: string;
  /** How {@link spelling} is compared with a member name. */
  readonly match: SpellingMatch;
  /** The quantity a member of this name would hold. */
  readonly quantity: string;
}

/** The Greek letter for a mean skill, as an escape rather than as a glyph. */
const MEAN_SKILL_SYMBOL = '\u03bc';

/** The Greek letter for an uncertainty, as an escape rather than as a glyph. */
const UNCERTAINTY_SYMBOL = '\u03c3';

/** The short spelling of a mean skill, used by the planted controls below. */
const MEAN_SKILL_MEMBER = 'mu';

/** The short spelling of an uncertainty, used by the planted controls below. */
const UNCERTAINTY_MEMBER = 'sigma';

/**
 * Every spelling of the three quantities a parsed profile must not carry.
 *
 * The list is deliberately wider than the contract's two member names: a future
 * change that read the model and renamed it on the way in would be exactly as
 * much a violation of Requirement 7.7 as one that kept the wire's spelling, so
 * the plausible rewordings are named too.
 */
const FORBIDDEN_SPELLINGS: readonly ForbiddenSpelling[] = [
  { spelling: MEAN_SKILL_MEMBER, match: 'segment', quantity: MEAN_SKILL },
  { spelling: 'mean', match: 'segment', quantity: MEAN_SKILL },
  { spelling: 'skill', match: 'segment', quantity: MEAN_SKILL },
  { spelling: MEAN_SKILL_SYMBOL, match: 'fragment', quantity: MEAN_SKILL },
  { spelling: UNCERTAINTY_MEMBER, match: 'segment', quantity: UNCERTAINTY },
  { spelling: 'uncertainty', match: 'segment', quantity: UNCERTAINTY },
  { spelling: 'spread', match: 'segment', quantity: UNCERTAINTY },
  { spelling: 'variance', match: 'segment', quantity: UNCERTAINTY },
  { spelling: 'deviation', match: 'segment', quantity: UNCERTAINTY },
  { spelling: 'stddev', match: 'segment', quantity: UNCERTAINTY },
  { spelling: UNCERTAINTY_SYMBOL, match: 'fragment', quantity: UNCERTAINTY },
  { spelling: 'k', match: 'segment', quantity: DISPLAY_SCALE },
  { spelling: 'c', match: 'segment', quantity: DISPLAY_SCALE },
  { spelling: 'scale', match: 'segment', quantity: DISPLAY_SCALE },
  { spelling: 'offset', match: 'segment', quantity: DISPLAY_SCALE },
  { spelling: 'multiplier', match: 'segment', quantity: DISPLAY_SCALE },
];

/**
 * A member name split into lower-cased words, on camel-case boundaries and on
 * every non-letter.
 *
 * `displayRating` reads as `display, rating`; `keeperTimeMs` as
 * `keeper, time, ms`; `MU` as `mu`; `sigma_squared` as `sigma, squared`. An
 * array index contributes no word at all, which is what keeps a 500-point
 * progression from being 500 names to test.
 */
function segmentsOf(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/**
 * The quantity the given member name denotes, or `null` when it denotes none of
 * the three.
 */
function forbiddenQuantity(name: string): string | null {
  const lowered = name.toLowerCase();
  const segments = segmentsOf(name);

  for (const rule of FORBIDDEN_SPELLINGS) {
    const found =
      rule.match === 'segment'
        ? segments.includes(rule.spelling)
        : lowered.includes(rule.spelling);

    if (found) {
      return rule.quantity;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* The reflective walk                                                        */
/* -------------------------------------------------------------------------- */

/** One member of a walked graph whose name denotes a forbidden quantity. */
interface RatingInternalFinding {
  /** Where in the graph the member sits, as a dotted path. */
  readonly path: string;
  /** The quantity its name denotes. */
  readonly quantity: string;
}

/** A member key as a comparable name; a symbol contributes its description. */
function memberName(key: string | symbol): string {
  return typeof key === 'symbol' ? (key.description ?? '') : key;
}

/**
 * The value and every prototype worth reading members from: the value itself,
 * then its prototype chain up to — but not including — the built-in prototypes.
 *
 * Walking the chain is what makes a class accessor visible: a planted member
 * declared as a getter is an own property of the prototype, not of the instance,
 * and an instance-only walk would miss it.
 */
function holdersOf(value: object): readonly object[] {
  const holders: object[] = [value];
  let current: unknown = Object.getPrototypeOf(value);

  while (
    typeof current === 'object' &&
    current !== null &&
    current !== Object.prototype &&
    current !== Array.prototype
  ) {
    holders.push(current);
    current = Object.getPrototypeOf(current);
  }

  return holders;
}

/**
 * Every member of the transitive value graph of `root` whose name denotes a mean
 * skill, an uncertainty, or a display scale or offset.
 *
 * Returns findings rather than asserting, so the same walk can be pointed at a
 * deliberately planted graph to prove it fires (see the non-vacuity cases at the
 * foot of this file), and takes `unknown` for the same reason: a walker that
 * only accepted a well-typed profile could not be shown to find anything.
 *
 * Iterative and cycle-guarded, so a graph that refers to itself terminates; and
 * it reads no accessor, so a planted getter is named without being invoked.
 */
function ratingInternalFindings(root: unknown): readonly RatingInternalFinding[] {
  const findings: RatingInternalFinding[] = [];
  const visited = new WeakSet<object>();
  const pending: { readonly value: unknown; readonly path: string }[] = [
    { value: root, path: 'profile' },
  ];

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined) {
      break;
    }

    const { value, path } = next;

    if (typeof value !== 'object' && typeof value !== 'function') {
      continue;
    }

    if (value === null || visited.has(value)) {
      continue;
    }

    visited.add(value);

    for (const holder of holdersOf(value)) {
      for (const key of Reflect.ownKeys(holder)) {
        const name = memberName(key);
        const at = `${path}.${name}`;
        const quantity = forbiddenQuantity(name);

        if (quantity !== null) {
          findings.push({ path: at, quantity });
        }

        const descriptor = Object.getOwnPropertyDescriptor(holder, key);

        // Data properties only: an accessor is named above and left unread, so
        // nothing a planted member does can influence whether it is found.
        if (descriptor !== undefined && 'value' in descriptor) {
          pending.push({ value: descriptor.value, path: at });
        }
      }
    }
  }

  return findings;
}

/** The findings as a readable list, for an assertion message. */
function describeFindings(findings: readonly RatingInternalFinding[]): string {
  return findings
    .map((finding) => `${finding.path} holds ${finding.quantity}`)
    .join('; ');
}

/** The quantities a walk found, deduplicated. */
function quantitiesFound(
  findings: readonly RatingInternalFinding[],
): readonly string[] {
  return [...new Set(findings.map((finding) => finding.quantity))];
}

/* -------------------------------------------------------------------------- */
/* The profile a body parses to, with the frame asserted on the way through    */
/* -------------------------------------------------------------------------- */

/** The profile a valid fixture body parses to, asserted to be accepted. */
function acceptedProfile(fixture: PlayerProfileFixture): PlayerProfile {
  const outcome = parsePlayerProfile(fixture.wire);

  if (!outcome.ok) {
    throw new Error(`a valid body was rejected: ${outcome.reason}`);
  }

  return outcome.value;
}

/* -------------------------------------------------------------------------- */
/* Property 14, over the parsed values and over the real read path            */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 14: The parsed type graph holds no Rating_Internal
// Validates: Requirements 7.7
describe('the parsed type graph holds no rating internal', () => {
  it('finds no mean skill, uncertainty, scale, or offset in a parsed profile', () => {
    fc.assert(
      fc.property(playerProfileArb, (profile) => {
        const findings = ratingInternalFindings(profile);

        expect(findings, describeFindings(findings)).toStrictEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('finds none in a profile parsed from a body that carries the model', () => {
    fc.assert(
      fc.property(anyProfileFixtureArb, (fixture) => {
        // The body really does carry the rating model — a clean parse is not a
        // clean input — so this case is about the parser, not the fixtures.
        const onTheWire = ratingInternalFindings(fixture.wire);

        expect(quantitiesFound(onTheWire)).toContain(MEAN_SKILL);
        expect(quantitiesFound(onTheWire)).toContain(UNCERTAINTY);

        const findings = ratingInternalFindings(acceptedProfile(fixture));

        expect(findings, describeFindings(findings)).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  for (const shape of PROFILE_FIXTURE_ARBS) {
    it(`finds none in a profile parsed from a body with ${shape.label}`, () => {
      fc.assert(
        fc.property(shape.arbitrary, (fixture) => {
          const findings = ratingInternalFindings(acceptedProfile(fixture));

          expect(findings, describeFindings(findings)).toStrictEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  }

  it('finds none in either fixed sample, parsed or as the fixtures built it', () => {
    for (const fixture of [MINIMAL_PROFILE_FIXTURE, FULL_PROFILE_FIXTURE]) {
      expect(ratingInternalFindings(fixture.parsed)).toStrictEqual([]);
      expect(ratingInternalFindings(acceptedProfile(fixture))).toStrictEqual([]);
    }

    // And the fully populated sample is the one carrying a rating state, a
    // display rating, and plottable points — the members a rating internal
    // would most plausibly travel beside.
    expect(FULL_PROFILE_FIXTURE.parsed.rating.displayRating).not.toBeNull();
    expect(FULL_PROFILE_FIXTURE.parsed.progression.length).toBeGreaterThan(0);
    expect(
      [...quantitiesFound(ratingInternalFindings(FULL_PROFILE_FIXTURE.wire))].sort(),
    ).toStrictEqual([MEAN_SKILL, UNCERTAINTY].sort());
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the walk detects a planted member of each kind                 */
/* -------------------------------------------------------------------------- */

/**
 * A test-only type carrying planted members of two of the three kinds: a
 * mean skill as an own data property, and an uncertainty as a **prototype
 * accessor** that raises if it is ever read.
 *
 * Both are named through computed keys, so this file carries no bare identifier
 * denoting a rating quantity.
 */
class PlantedRatingModel {
  readonly [MEAN_SKILL_MEMBER] = 25.5;

  get [UNCERTAINTY_MEMBER](): number {
    throw new Error('the walk must name a planted member, never read it');
  }
}

// Feature: web-player-stats-screen, Property 14: The parsed type graph holds no Rating_Internal
// Validates: Requirements 7.7
describe('the rating-internal walk', () => {
  it('detects a planted member of each kind on a test-only type', () => {
    const whole = MINIMAL_PROFILE_FIXTURE.parsed;

    const planted: readonly {
      readonly label: string;
      readonly value: unknown;
      readonly quantity: string;
    }[] = [
      {
        label: 'a test-only type, as a field and as a prototype accessor',
        value: new PlantedRatingModel(),
        quantity: MEAN_SKILL,
      },
      {
        label: 'a mean skill on the rating summary',
        value: {
          ...whole,
          rating: { ...whole.rating, [MEAN_SKILL_MEMBER]: 25.5 },
        },
        quantity: MEAN_SKILL,
      },
      {
        label: 'an uncertainty on one progression point',
        value: {
          ...whole,
          progression: [
            { completedAtMs: 0, displayRating: 1_200 },
            {
              completedAtMs: 1_000,
              displayRating: 1_210,
              [UNCERTAINTY_MEMBER]: 4.25,
            },
          ],
        },
        quantity: UNCERTAINTY,
      },
      {
        label: 'a mean skill spelled in a different case',
        value: { ...whole, ratingMU: 25.5 },
        quantity: MEAN_SKILL,
      },
      {
        label: 'a mean skill spelled out',
        value: { ...whole, meanSkillEstimate: 25.5 },
        quantity: MEAN_SKILL,
      },
      {
        label: 'an uncertainty spelled out',
        value: { ...whole, uncertaintyValue: 4.25 },
        quantity: UNCERTAINTY,
      },
      {
        label: 'an uncertainty spelled as the Greek symbol',
        value: { ...whole, [UNCERTAINTY_SYMBOL]: 4.25 },
        quantity: UNCERTAINTY,
      },
      {
        label: 'a display scale and offset as single letters',
        value: { ...whole, k: 40, c: 1_000 },
        quantity: DISPLAY_SCALE,
      },
      {
        label: 'a display scale spelled out',
        value: { ...whole, displayScale: 40 },
        quantity: DISPLAY_SCALE,
      },
      {
        label: 'a display offset spelled out',
        value: { ...whole, displayOffset: 1_000 },
        quantity: DISPLAY_SCALE,
      },
      {
        label: 'a mean skill behind a symbol key',
        value: { ...whole, [Symbol(MEAN_SKILL_MEMBER)]: 25.5 },
        quantity: MEAN_SKILL,
      },
      {
        label: 'a non-enumerable uncertainty',
        value: Object.defineProperty({ ...whole }, UNCERTAINTY_MEMBER, {
          value: 4.25,
          enumerable: false,
        }),
        quantity: UNCERTAINTY,
      },
      {
        label: 'a mean skill inside a pairwise row',
        value: {
          ...whole,
          bestPartnerships: [
            {
              membershipId: whole.membershipId,
              displayName: 'Ade',
              value: 78.5,
              qualifyingMatches: 14,
              [MEAN_SKILL_MEMBER]: 25.5,
            },
          ],
        },
        quantity: MEAN_SKILL,
      },
    ];

    for (const { label, value, quantity } of planted) {
      const findings = ratingInternalFindings(value);

      expect(findings.length, label).toBeGreaterThan(0);
      expect(quantitiesFound(findings), label).toContain(quantity);
    }
  });

  it('detects every spelling the table declares, in either letter case', () => {
    for (const rule of FORBIDDEN_SPELLINGS) {
      for (const spelling of [
        rule.spelling,
        rule.spelling.toUpperCase(),
        `rating_${rule.spelling}`,
      ]) {
        const findings = ratingInternalFindings({ [spelling]: 1 });

        expect(quantitiesFound(findings), spelling).toContain(rule.quantity);
      }
    }
  });

  it('is not simply firing on everything the contract names', () => {
    // The near misses: every member name the parsed graph actually carries,
    // plus the ones whose letters brush a forbidden spelling. None of these
    // denotes a rating quantity, and a walk that flagged them would make the
    // property above unfalsifiable rather than true.
    const nearMisses = [
      'membershipId',
      'displayName',
      'state',
      'isGuest',
      'record',
      'appearances',
      'wins',
      'draws',
      'losses',
      'winPercentage',
      'rating',
      'displayRating',
      'progression',
      'completedAtMs',
      'winStreak',
      'unbeatenStreak',
      'mostPlayedWith',
      'mostPlayedAgainst',
      'bestPartnerships',
      'bogeyOpponents',
      'count',
      'value',
      'qualifyingMatches',
      'bibAppearances',
      'rich',
      'goals',
      'cleanSheets',
      'goalsConcededAsKeeper',
      'keeperTimeMs',
      'kickOffs',
      'community',
      'mutations',
      'checked',
      'musician',
    ];

    for (const name of nearMisses) {
      const findings = ratingInternalFindings({ [name]: 1 });

      expect(describeFindings(findings), name).toBe('');
    }
  });

  it('terminates on a graph that refers to itself', () => {
    const cyclic: Record<string, unknown> = {
      ...MINIMAL_PROFILE_FIXTURE.parsed,
      [MEAN_SKILL_MEMBER]: 25.5,
    };

    cyclic.itself = cyclic;
    cyclic.viaAnArray = [cyclic, { nested: cyclic }];

    const findings = ratingInternalFindings(cyclic);

    expect(quantitiesFound(findings)).toStrictEqual([MEAN_SKILL]);
  });
});
