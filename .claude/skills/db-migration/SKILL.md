---
name: db-migration
description: Scaffold, review and validate an EF Core migration against local Docker PostgreSQL. Use after changing an entity, an IEntityTypeConfiguration in Infrastructure/Persistence/Configurations, or PitchMateDbContext, or when asked to add, check or apply a migration.
---

# EF Core migrations

Run every `dotnet ef` command from `backend/`, after `dotnet tool restore`, with the flags written out in full as shown.

Tooling builds the context through the design-time `PitchMateDbContextFactory`. Its connection string is a placeholder (`postgres`/`postgres` on `pitchmate_designtime`), so commands that only read the model need no database. Any command that touches a database must pass `--connection` explicitly. For the docker-compose database that is:

```
--connection "Host=localhost;Port=5432;Database=pitchmate;Username=pitchmate;Password=pitchmate_local_dev"
```

## Steps

1. **Check whether one is needed**: `dotnet ef migrations has-pending-model-changes --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api`. If it reports no changes, stop: no migration is required.
2. **Name it** as PascalCase verb + subject describing the schema change, matching the existing ones (`ls src/PitchMate.Infrastructure/Persistence/Migrations`): `AddSquadsAndMembership`, `AddMatchEvent`.
3. **Scaffold**: `dotnet ef migrations add <Name> --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --output-dir Persistence/Migrations`. This writes the migration, its `.Designer.cs`, and an updated `PitchMateDbContextModelSnapshot.cs`.
4. **Review the generated `Up` and `Down`** line by line:
   - Identifiers are snake_case (the context uses `UseSnakeCaseNamingConvention`).
   - A rename should be `RenameColumn`/`RenameTable`. EF often scaffolds a rename as drop + add, which loses data, so hand-edit it.
   - A new non-nullable column on a populated table needs a default value or a backfill.
   - Soft-delete query filters live in the model, so they produce no SQL.
   - `Down` exactly reverses `Up`.
5. **Apply locally**: `docker compose up -d` (repo root), then `dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --connection "<local>"`.
6. **Prove it reverses**: run the same `database update` with `<PreviousMigrationName>` before `--project`, then run it once more with no name. Both must print `Done.`
7. **Run the migration tests** (Testcontainers, so Docker must be running): `dotnet test tests/PitchMate.Infrastructure.Tests --filter "FullyQualifiedName~Migration"`.

**Done** when `has-pending-model-changes` reports no changes, the forward → back → forward cycle in steps 5–6 succeeds, and the migration tests pass. Then run the `verify` skill with scope `backend`.

## Rules

- A migration merged to `main` is immutable: schema fixes go in a new migration. A migration that only exists on your branch can be dropped with `dotnet ef migrations remove --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api`.
- Migrations reach QA and production only as the `dotnet ef migrations bundle` → `efbundle` step in `.github/workflows/cd-*.yml`, which runs before the app rolls out. Production code applies schema only through that path. `MigrationPolicySmokeTests` fails the build if `Migrate`, `MigrateAsync`, `EnsureCreated` or `EnsureCreatedAsync` appears in `PitchMate.Infrastructure` or `PitchMate.Api`.
- `20260625201240_InitialCreate` must stay the earliest migration (`MigrationPolicySmokeTests` asserts it).
