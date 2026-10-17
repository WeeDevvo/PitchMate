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

## Web feature boundaries

- Each feature in `apps/web/src/features/<feature>/` is imported only through its barrel `index.ts`. `moduleBoundaries.structural.test.ts` and the per-feature structural scans fail on deep imports across features.
- Each feature has one transport facade, `api/<feature>Api.ts`. It is the only module that uses `@pitchmate/api-client` as a value, and it uses the authenticated client injected from the auth feature. Every other module reaches the backend through the facade (`transportSeam.structural.test.ts`).
- Request and response types come from the generated `components["schemas"]`. Wire enum name lists live once per feature in `lib/wireEnums.ts`, pinned to the generated unions in both directions.
- New structural scans reuse the comment/string strippers in `features/<feature>/structural/sourceScan.ts`.
