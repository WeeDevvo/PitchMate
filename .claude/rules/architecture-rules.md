---
paths:
  - "backend/src/**"
  - "backend/tests/**"
  - "apps/web/src/**"
---

# Architecture rules

Tests enforce every rule here, so a violation fails `dotnet test` or `npm test`, not just review.

## Backend layering

Dependencies point inward only: Api → Infrastructure → Application → Domain.

| Layer | May reference | Holds |
|---|---|---|
| `PitchMate.Domain` | nothing | entities, value types, per-feature `Result`/`Error`/`ErrorCode`, `IRatingEngine` |
| `PitchMate.Application` | Domain | use cases, `Abstractions/` interfaces, `IRepository<T>`, `IUnitOfWork` |
| `PitchMate.Infrastructure` | Application, Domain | EF Core, Npgsql, email, OpenSkill engine, repository/service implementations |
| `PitchMate.Api` | Infrastructure | minimal-API endpoints, transport records, error seams, composition roots |

Domain and Application stay free of `Microsoft.EntityFrameworkCore`, `Npgsql` and `Microsoft.AspNetCore` (`ArchitectureDependencyTests`). The Api layer holds transport only: use-case handlers, `IEntityTypeConfiguration` classes, and rating or statistics types in member signatures are rejected there (`InwardLogicRule`). Each feature also has placement tests (`*ArchitecturePlacementTests`, `*LayeringAndImplementationLocationTests`) that pin where its types live.

## Adding a backend use case to feature `X`

Use the same feature folder name in every project:

1. **Domain** `X/`: entity behaviour as methods or factory methods that return `Result<T>`, with private setters. Add any new failure to `XErrorCode`.
2. **Application** `X/UseCases/`: `DoThingCommand`, `DoThingHandler` and, if needed, `DoThingResult`. The handler guards arguments with `ArgumentNullException.ThrowIfNull`, returns `Result<T>` with a typed `XError` for business failures, and stages every write before one `IUnitOfWork.SaveChangesAsync` so the use case commits atomically. New ports go in `X/Abstractions/`.
3. **Infrastructure** `X/`: `internal sealed` implementations, registered in `XInfrastructureRegistration.AddXInfrastructure()`. Matches, Stats, Squads and LiveTracking call that from `DependencyInjection.AddInfrastructure`; Auth and Notifications call it from their Api `AddX()`. Follow whichever pattern feature `X` already uses. EF mappings are `internal sealed` `IEntityTypeConfiguration<T>` classes in `Persistence/Configurations/X/`, picked up by `ApplyConfigurationsFromAssembly`. A model change needs a migration (`db-migration` skill).
4. **Api** `X/Endpoints/`: map the route in `XEndpoints`, add request/response records beside it, resolve the caller with `CallerIdentity.ResolveUserId(principal)`, call the handler, and map failures through `XErrorResults` only. Register the handler in `Api/X/XServiceCollectionExtensions` (`AddX()`). The container runs `ValidateOnBuild`, so a missing registration fails at startup.
5. Then run the `sync-contracts` skill.

`Domain.Squads`, `Domain.Matches` and `Domain.Rating` each declare their own `Result`/`Result<T>`. When a file needs two of them, import one namespace and alias the other's types, as `Infrastructure/Matches/TeamBalancer.cs` does.

## Rating and balancing

All rating maths lives behind `IRatingEngine` (`PlackettLuceRatingEngine`). `TeamBalancer` judges fairness only through `IRatingEngine.Predict`, never by reading or combining μ/σ itself. `TeamBalancerIntegrationTests` asserts this with a recording spy. Use the `/balance-simulation` skill to see the effect of a balancer or engine change.

## Data-model invariants

These are design decisions, not all test-enforced. The tests that guard them are named where they exist; don't break one without changing the decision first.

- **Ratings are a derived cache of replay.** Completed matches are immutable, chronologically ordered events (kickoff lineup, outcome ranks, stable tie-break), enough to re-derive every rating. Single match completion and the bulk replay share the same rating-application code (`Replay*Properties`). Keep "edit a match and recompute from match N" possible without schema change, even though no UI exposes it.
- **Rating engine:** pure and reproducible (same inputs, same outputs); ranks **N teams**, not two; balancing uses `Predict` over μ/σ while display uses μ − 3σ, never conflated. Margin-of-victory and participation weighting are built, switchable, default **off** (`RatingEngineConfig`).
- **Membership-centric:** ratings, μ/σ snapshots and stats hang off `SquadMembership`, never `User`, so guests rate and a guest claim rebinds the owner without losing history.
- **Idempotent writes:** matches and live-tracking events carry client-generated GUID v7 ids (`Guid.CreateVersion7()`), and retries dedupe on them. Match completion applies the rating update once, guarded by match status inside the transaction (`IdempotentCompletionPropertyTests`). Completion writes the rating and per-match μ/σ snapshots atomically.
- **Live tracking** is an offline-first, append-only event log: corrections are compensating events, never mutations. Real-time broadcast is out of MVP scope.
- **Stats are computed on read** from the normalised tables. Don't add a denormalised `PlayerStatsSummary` until reads hurt; if one is added, it must be rebuildable from events.
- **Erasure is anonymisation** (`IAnonymisable`); see `security-and-privacy.md`.
- **No rating or domain logic in any client.** Clients only call the API; the web structural scans (`ratingAndThemingBoundaries`, `enumAndRatingBoundaries`) reject μ/σ handling in `apps/web`.

## C# conventions not covered by the compiler

- One top-level type per file, named after the type.
- `async`/`await` for all I/O, with a `CancellationToken` on every async public method, passed through. No `async void` (event handlers aside), `.Result` or `.Wait()`.
- Don't suppress a warning without a comment saying why: `TreatWarningsAsErrors` is on.

## Web feature boundaries

- Each feature in `apps/web/src/features/<feature>/` is imported only through its barrel `index.ts`. `moduleBoundaries.structural.test.ts` and the per-feature structural scans fail on deep imports across features.
- Each feature has one transport facade, `api/<feature>Api.ts`. It is the only module that uses `@pitchmate/api-client` as a value, and it uses the authenticated client injected from the auth feature. Every other module reaches the backend through the facade (`transportSeam.structural.test.ts`).
- Request and response types come from the generated `components["schemas"]`. Wire enum name lists live once per feature in `lib/wireEnums.ts`, pinned to the generated unions in both directions.
- New structural scans reuse the comment/string strippers in `features/<feature>/structural/sourceScan.ts`.
- **Shared components live in `apps/web/src/ui`**, built from the PitchMate design system (see `brand.md`). Features import them through `src/ui/index.ts` only. `src/ui` imports React, React DOM, its own modules and `src/design/logos`, nothing else; its components take display-ready props (a feature maps wire enums and ratings onto them), and its stylesheets use `--pm-*` tokens only (`ui.structural.test.ts`). A feature's boundary scan admits the `src/ui` barrel when that feature first uses it. Build a new shared control there rather than inside a feature.
