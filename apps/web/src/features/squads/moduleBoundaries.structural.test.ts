/**
 * Structural source scan: module containment and the public barrel (task 17.1).
 *
 * Requirement 20.11 makes this file part of the product rather than a courtesy
 * check. The two rules it enforces are stated as a universal and a prohibition —
 * "define every module of the feature under `apps/web/src/features/squads/`"
 * (18.1), "export its route paths, its path construction functions, and its
 * screen components through a single module barrel, and export no module of its
 * pure logic directory or its transport directory that a screen outside the
 * feature does not need" (18.7) — and neither a universal over a directory nor a
 * prohibition can be demonstrated by an example. So the source tree is read and
 * classified, following the mechanism the App_Shell established in
 * `features/app-shell/pureLogic.structural.test.ts` and its two siblings: read
 * each file's text, strip comments and string literals through the same small
 * state machine (declared once in `structural/sourceScan.ts`), and fail naming
 * the offending file and specifier.
 *
 * ### The four invariants
 *
 * 1. **Containment** (Requirement 18.1). The feature is rooted at
 *    `apps/web/src/features/squads/`, every module the design's layout names is
 *    present inside it, and no module of the feature resolves an in-app import to
 *    a path outside that root other than the three edges the design admits: the
 *    App_Shell barrel, the Auth_Feature barrel, and the shared `src/theme` module
 *    (Requirement 18.8). So no part of the feature is assembled from a module
 *    living elsewhere, and the dependency direction stays `app` → `squads` →
 *    (`app-shell`, `auth`, `theme`) — nothing here reaches back into `src/app/`.
 * 2. **One public barrel** (Requirement 18.7). `index.ts` exists at the feature
 *    root and nowhere else beneath it, re-exports feature modules only, and
 *    declares nothing of its own — it is re-exports and nothing else, so the
 *    surface can be read off the source rather than inferred.
 * 3. **The barrel is the only way in** (Requirement 18.7). Every file outside the
 *    feature that imports it imports the barrel, never a deeper path, and every
 *    such file lives under `src/app/` — the one application-level consumer. A
 *    single entry point is only single if reaching past it fails here.
 * 4. **Nothing surplus crosses from `lib/` or `api/`** (Requirement 18.7). The
 *    barrel names exactly six modules, and the names it carries out of `lib/` and
 *    `api/` are exactly the eight the design justifies: the three route patterns,
 *    the three path builders, and the transport facade with its type. The check is
 *    computed rather than listed — every exported name of every module under
 *    `lib/` and `api/` is collected, intersected with the barrel's surface, and
 *    the intersection must equal that set. So adding an export to a parser, the
 *    Enum_Code_Map, an ordering function, or the facade cannot widen the public
 *    surface without failing here.
 *
 * Invariant 4 is what makes the design's claim that the pending
 * `api-response-contracts` chore is an internal change verifiable: if a parser or
 * a printer were reachable from outside, changing the wire mapping would be a
 * consumer-visible change no matter what the design said.
 *
 * Requirements: 18.1, 18.7, 20.11
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  appShellRoot,
  appWiringRoot,
  authRoot,
  collectProductionSources,
  isTestFile,
  isWithin,
  inAppImports,
  norm,
  readCodeOnly,
  readWithoutComments,
  reExports,
  relTo,
  squadsModules,
  squadsRoot,
  squadsSources,
  squadsStyles,
  srcRoot,
  srcSources,
  targetsBarrelOf,
  themeRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The feature's production modules — the set every rule below binds. */
const featureModules = squadsModules();
/** Every file under the root, tests and scan support included. */
const featureSources = squadsSources();
/** Everything in `apps/web/src` that is not part of the feature. */
const outsideSources = srcSources().filter((file) => !isWithin(squadsRoot, file));

const barrelPath = join(squadsRoot, 'index.ts');
const barrelSource = readFileSync(barrelPath, 'utf8');
const barrelReExports = reExports(barrelSource);
const barrelExportedNames = barrelReExports.flatMap(({ names }) => names);

/** Path relative to the feature root, in forward-slash form, for messages. */
function featureRel(path: string): string {
  return relTo(squadsRoot, path);
}

// --- Invariant 0: the scan sees something ------------------------------------

describe('the containment scan sees the Squads_Feature', () => {
  it('is rooted at apps/web/src/features/squads', () => {
    expect(norm(squadsRoot).endsWith('apps/web/src/features/squads')).toBe(true);
  });

  it('discovers the feature modules, the files outside it, and no test file', () => {
    // A vacuous scan would satisfy every invariant below, so it is ruled out
    // first: the feature is large, the application around it is not empty, and
    // no test file may leak into a production set.
    expect(featureModules.length).toBeGreaterThan(40);
    expect(outsideSources.length).toBeGreaterThan(0);
    expect(featureModules.map(featureRel).filter(isTestFile)).toEqual([]);
  });

  it('excludes the scan-support directory from the production set', () => {
    // `structural/` holds the machinery these scans share. It is imported by no
    // module of the feature and named by no export of the barrel, so holding it
    // to the feature's own boundary rules would assert something about the scans
    // rather than about the product.
    const scanSupport = featureModules
      .map(featureRel)
      .filter((file) => file.startsWith('structural/'));
    expect(scanSupport).toEqual([]);

    // It does exist, though — otherwise this exclusion is hiding nothing and the
    // strippers every scan depends on have gone missing.
    const support = featureSources
      .map(featureRel)
      .filter((file) => file.startsWith('structural/'));
    expect(support).toContain('structural/sourceScan.ts');
  });
});

// --- Invariant 1: containment (Requirement 18.1) -----------------------------

/**
 * Every module the design's layout names, relative to the feature root.
 *
 * The feature may hold more than this — `lib/inviteInstant.ts` and
 * `components/surfaceFocus.ts` arrived during implementation — but it may hold no
 * *less*, and none of these may live anywhere else. A module of the feature found
 * outside the root fails the import check below; a module of the feature missing
 * from inside it fails here.
 */
const DESIGNED_MODULES: readonly string[] = [
  'index.ts',
  'squadsRoutes.tsx',

  'lib/routePaths.ts',
  'lib/identifiers.ts',
  'lib/wireEnums.ts',
  'lib/callOutcome.ts',
  'lib/messages.ts',
  'lib/squadOrder.ts',
  'lib/playerList.ts',
  'lib/ratingPresentation.ts',
  'lib/adminAuthority.ts',
  'lib/promotionEligibility.ts',
  'lib/inviteSecret.ts',
  'lib/inviteOrder.ts',
  'lib/skillTier.ts',
  'lib/nameValidation.ts',
  'lib/headingOutline.ts',

  'lib/parse/primitives.ts',
  'lib/parse/squadSummary.ts',
  'lib/parse/squadDetail.ts',
  'lib/parse/createdSquad.ts',
  'lib/parse/redemption.ts',
  'lib/parse/invitePreview.ts',
  'lib/parse/generatedInvite.ts',
  'lib/parse/inviteSummary.ts',
  'lib/parse/featureFlags.ts',
  'lib/parse/createdGuest.ts',
  'lib/parse/leaderboard.ts',

  'api/squadsApi.ts',

  'state/useSquadsHome.ts',
  'state/useSquadScreen.ts',
  'state/useInviteRedemption.ts',
  'state/useInviteManager.ts',
  'state/useGuestManager.ts',
  'state/usePromotion.ts',
  'state/useFeatureToggles.ts',

  'screens/SquadsHome.tsx',
  'screens/SquadScreen.tsx',
  'screens/InviteLandingScreen.tsx',

  'components/SquadCard.tsx',
  'components/SquadsEmptyState.tsx',
  'components/CreateSquadForm.tsx',
  'components/JoinSquadForm.tsx',
  'components/PlayerList.tsx',
  'components/PlayerRow.tsx',
  'components/RatingBadge.tsx',
  'components/MembershipLabels.tsx',
  'components/AdminSection.tsx',
  'components/InviteManager.tsx',
  'components/InviteReveal.tsx',
  'components/GuestManager.tsx',
  'components/GuestForm.tsx',
  'components/PromotionControl.tsx',
  'components/FeatureToggles.tsx',
  'components/PlaceholderSection.tsx',
  'components/NotFoundTreatment.tsx',
  'components/FailureNotice.tsx',
  'components/ConfirmDialog.tsx',
  'components/FormPanel.tsx',
  'components/LoadingIndication.tsx',
];

describe('every module of the feature lives under features/squads/ (Requirement 18.1)', () => {
  it('houses every module the design layout names', () => {
    const present = new Set(featureModules.map(featureRel));
    const missing = DESIGNED_MODULES.filter((file) => !present.has(file));
    expect(missing).toEqual([]);
  });

  it('houses the feature token table', () => {
    // The one stylesheet the design names by path (Requirement 18.9). The
    // per-component sheets beside it are free to come and go.
    expect(squadsStyles().map(featureRel)).toContain('styles/squadsTokens.css');
  });

  it('resolves no import outside the root beyond the shell barrel, the auth barrel, and the shared theme module', () => {
    const offenders: Array<{ module: string; specifier: string }> = [];

    for (const file of featureModules) {
      for (const { specifier, target } of inAppImports(file)) {
        if (isWithin(squadsRoot, target)) continue;
        // The three admitted outward edges. Both features are admitted at their
        // barrel only: `useInviteRedemption`, `NotFoundTreatment`, and
        // `SquadScreen` take `HOME_ROUTE`, `SQUAD_SCOPE_ROUTE_PARAMETER`, and
        // `usePublishSquadScopeFromRoute` from the App_Shell barrel, and the
        // Invite_Landing_Route takes `SIGN_UP_ROUTE`, `LOG_IN_ROUTE`, and
        // `REDIRECT_PARAM_NAME` from the Auth_Feature barrel, rather than
        // restating either contract (see ADR 0001). The shared Theme module is
        // admitted throughout, because Requirement 18.8 puts the one appearance
        // store, bootstrap, and resolution function there.
        if (targetsBarrelOf(appShellRoot, target)) continue;
        if (targetsBarrelOf(authRoot, target)) continue;
        if (isWithin(themeRoot, target)) continue;

        offenders.push({ module: featureRel(file), specifier });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reaches the App_Shell, the Auth_Feature, and the shared theme module at all', () => {
    // Guard: the three admitted edges are all used, so an empty offender list
    // above means the boundary is clean rather than that resolution broke.
    const targets = featureModules.flatMap((file) =>
      inAppImports(file).map(({ target }) => target),
    );

    expect(targets.some((target) => targetsBarrelOf(appShellRoot, target))).toBe(
      true,
    );
    expect(targets.some((target) => targetsBarrelOf(authRoot, target))).toBe(true);
    expect(targets.some((target) => isWithin(themeRoot, target))).toBe(true);
  });

  it('imports nothing from the application wiring or another feature', () => {
    // The direction runs one way. `src/app/` composes this feature; this feature
    // knows nothing of it, and it reaches into neither the marketing landing
    // feature nor any feature added later.
    const offenders: Array<{ module: string; specifier: string }> = [];
    const featuresRoot = norm(join(srcRoot, 'features'));

    for (const file of featureModules) {
      for (const { specifier, target } of inAppImports(file)) {
        if (isWithin(squadsRoot, target)) continue;
        if (isWithin(themeRoot, target)) continue;
        if (targetsBarrelOf(appShellRoot, target)) continue;
        if (targetsBarrelOf(authRoot, target)) continue;
        if (isWithin(appWiringRoot, target) || target.startsWith(`${featuresRoot}/`)) {
          offenders.push({ module: featureRel(file), specifier });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

// --- Invariant 2: one public barrel (Requirement 18.7) ----------------------

describe('the feature exposes exactly one public barrel (Requirement 18.7)', () => {
  it('carries index.ts at the root and no second barrel beneath it', () => {
    expect(barrelSource.length).toBeGreaterThan(0);

    const indexes = featureSources
      .map(featureRel)
      .filter((file) => /(?:^|\/)index\.tsx?$/.test(file));
    expect(indexes).toEqual(['index.ts']);
  });

  it('re-exports feature modules only', () => {
    const escaping = inAppImports(barrelPath)
      .filter(({ target }) => !isWithin(squadsRoot, target))
      .map(({ specifier }) => specifier);
    expect(escaping).toEqual([]);
  });

  it('declares nothing of its own and star-exports nothing', () => {
    // A barrel that only re-exports has a surface readable from its source. A
    // local declaration, or an `export *`, would widen it without saying by what.
    const code = readCodeOnly(barrelPath);
    expect(code).not.toMatch(/\b(?:function|class|interface|enum|let|var)\b/);
    expect(code).not.toMatch(/\bconst\b/);
    expect(barrelReExports.filter(({ isStar }) => isStar)).toEqual([]);

    // Every export statement of the file is an `export … from`, so the parsed
    // re-exports below are the whole surface rather than part of it.
    const exportStatements = code.match(/\bexport\b/g) ?? [];
    expect(exportStatements).toHaveLength(barrelReExports.length);
  });
});

// --- Invariant 3: the barrel is the only way in (Requirement 18.7) -----------

describe('the feature is imported through its barrel only (Requirement 18.7)', () => {
  /** Every file outside the feature that resolves an import into it. */
  const inboundImports = outsideSources.flatMap((file) =>
    inAppImports(file)
      .filter(({ target }) => isWithin(squadsRoot, target))
      .map(({ specifier, target }) => ({ file, specifier, target })),
  );

  it('is imported from outside at all', () => {
    // Guard: `src/app/appRouter.tsx` mounts all three screens, so an empty set
    // means resolution broke rather than that nothing reaches in.
    expect(inboundImports.length).toBeGreaterThan(0);
  });

  it('is reached at no deeper path than the barrel', () => {
    const offenders = inboundImports
      .filter(({ target }) => !targetsBarrelOf(squadsRoot, target))
      .map(({ file, specifier }) => ({ file: relTo(srcRoot, file), specifier }));
    expect(offenders).toEqual([]);
  });

  it('is imported by the application-level router wiring only', () => {
    // One consumer, and no second. The App_Shell, the Auth_Feature, and the
    // marketing landing feature import nothing of this feature — the edge runs
    // `app` → `squads`, never the reverse and never sideways.
    const offenders = inboundImports
      .filter(({ file }) => !isWithin(appWiringRoot, file))
      .map(({ file, specifier }) => ({ file: relTo(srcRoot, file), specifier }));
    expect(offenders).toEqual([]);
  });
});

// --- Invariant 4: nothing surplus from lib/ or api/ (Requirement 18.7) ------

/**
 * The names of `lib/` and `api/` the design justifies crossing the boundary.
 *
 * The three route patterns and three builders, because a consumer registers and
 * navigates by them and must not rebuild a path from a pattern (Requirements 9.2,
 * 9.3); the transport facade and its type, because `src/app/appRouter.tsx`
 * constructs it once from the Authenticated_Api_Client and threads it into both
 * route tables (Requirement 16.2). Nothing else in either directory is a
 * consumer's business.
 */
const PERMITTED_LIB_AND_API_EXPORTS: readonly string[] = [
  'INVITE_LANDING_ROUTE',
  'PLAYER_STATS_ROUTE',
  'SQUAD_ROUTE',
  'SquadsApi',
  'createSquadsApi',
  'inviteLandingPath',
  'playerStatsPath',
  'squadPath',
];

/** The two internal directories whose surface Requirement 18.7 constrains. */
const libModules = collectProductionSources(join(squadsRoot, 'lib'));
const apiModules = collectProductionSources(join(squadsRoot, 'api'));

/**
 * Every name a module exports, read from its source.
 *
 * Declaration forms (`export function`, `export const`, `export type`,
 * `export interface`, `export class`, `export enum`) plus `export { … }` lists,
 * with `from` clauses handled by {@link reExports}. Types count: a type crossing
 * the boundary is part of the exported surface just as a value is.
 */
function declaredExportNames(file: string): string[] {
  const code = readWithoutComments(file);
  const names: string[] = [];

  const declaration =
    /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(code)) !== null) {
    names.push(match[1]);
  }

  // `export { a, type B, c as d }` — with or without a `from` clause.
  const list = /\bexport\s*\{([^}]*)\}/g;
  while ((match = list.exec(code)) !== null) {
    for (const entry of match[1].split(',')) {
      const trimmed = entry.trim().replace(/^type\s+/, '');
      if (trimmed.length === 0) continue;
      const aliased = /\bas\s+([\w$]+)\s*$/.exec(trimmed);
      names.push(aliased === null ? trimmed : aliased[1]);
    }
  }

  return names;
}

describe('nothing surplus is exported from lib/ or api/ (Requirement 18.7)', () => {
  it('names exactly the six modules the design admits into the barrel', () => {
    expect([...new Set(barrelReExports.map(({ specifier }) => specifier))].sort()).toEqual(
      [
        './api/squadsApi',
        './lib/routePaths',
        './screens/InviteLandingScreen',
        './screens/SquadScreen',
        './screens/SquadsHome',
        './squadsRoutes',
      ],
    );
  });

  it('names no module of lib/parse/, state/, components/, styles/, or the scan support', () => {
    const internalOnly = barrelReExports
      .map(({ specifier }) => specifier)
      .filter((specifier) =>
        /^\.\/(?:lib\/parse\/|state\/|components\/|styles\/|testing\/|structural\/)/.test(
          specifier,
        ),
      );
    expect(internalOnly).toEqual([]);
  });

  it('carries out of lib/ and api/ exactly the names a consumer needs', () => {
    // Computed rather than listed: every export of every module in the two
    // directories is collected, and the barrel's surface may intersect it only at
    // the permitted names. So adding an export to a parser, the Enum_Code_Map, an
    // ordering function, or the facade cannot widen the public surface silently.
    const internalNames = new Set(
      [...libModules, ...apiModules].flatMap(declaredExportNames),
    );

    // Non-vacuity: the internal surface is large, and holds the very things
    // Requirement 18.7 keeps inside.
    expect(internalNames.size).toBeGreaterThan(50);
    for (const internal of [
      'parseSquadDetail',
      'printSquadDetail',
      'parseDisplayRatingLeaderboard',
      'classifyOutcome',
      'orderSquadSummaries',
      'composePlayerList',
      'selectRatingPresentation',
      'resolveAdminAuthority',
      'isPromotable',
      'validateHeadingOutline',
      'GENERIC_SQUADS_FAILURE',
    ]) {
      expect(internalNames, `${internal} must be an internal export`).toContain(
        internal,
      );
    }

    const crossing = barrelExportedNames
      .filter((name) => internalNames.has(name))
      .sort();
    expect([...new Set(crossing)]).toEqual([...PERMITTED_LIB_AND_API_EXPORTS]);
  });

  it('exports the three screens, the two route factories, and their props types', () => {
    // The other half of 18.7: the barrel must carry what a consumer does need, or
    // "one entry point" would be satisfied by an empty file.
    expect(barrelExportedNames.sort()).toEqual(
      [
        'INVITE_LANDING_ROUTE',
        'InviteLandingScreen',
        'PLAYER_STATS_ROUTE',
        'SQUAD_ROUTE',
        'SquadScreen',
        'SquadScreenProps',
        'SquadsApi',
        'SquadsHome',
        'SquadsHomeProps',
        'SquadsRoutesOptions',
        'createSquadsApi',
        'createSquadsPublicRoutes',
        'createSquadsShellRoutes',
        'inviteLandingPath',
        'playerStatsPath',
        'squadPath',
      ].sort(),
    );
  });
});
