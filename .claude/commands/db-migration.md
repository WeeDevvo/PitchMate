Scaffold, review, and validate an EF Core migration against the local Docker PostgreSQL database.

Arguments: `$ARGUMENTS` (migration name in PascalCase verb + subject, e.g. `AddSquadsAndMembership`, `AddMatchEvent`).

Steps:

1. **Check for pending changes**:
   Run from `backend/`:
   ```bash
   (cd backend && dotnet ef migrations has-pending-model-changes --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api)
   ```
   If no changes are reported, stop.

2. **Scaffold migration**:
   Run from `backend/`:
   ```bash
   (cd backend && dotnet ef migrations add $ARGUMENTS --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --output-dir Persistence/Migrations)
   ```

3. **Review generated migration**:
   Inspect `backend/src/PitchMate.Infrastructure/Persistence/Migrations/*_$ARGUMENTS.cs`:
   - Column and table names follow `snake_case`.
   - Renames use `RenameColumn` or `RenameTable`, not drop/add.
   - New non-nullable columns on existing tables define defaults or backfill strategy.
   - `Down` precisely reverses `Up`.

4. **Apply and reverse test against local PostgreSQL**:
   Ensure PostgreSQL is running (`docker compose up -d` or `make up`).
   ```bash
   (cd backend && dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --connection "Host=localhost;Port=5432;Database=pitchmate;Username=pitchmate;Password=pitchmate_local_dev")
   ```

5. **Run migration integration tests**:
   ```bash
   dotnet test backend/tests/PitchMate.Infrastructure.Tests --filter "FullyQualifiedName~Migration"
   ```
