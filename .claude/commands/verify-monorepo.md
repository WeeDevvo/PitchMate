Run PitchMate's CI verification gates locally across the monorepo.

Scope argument: `$ARGUMENTS` (supported values: `all`, `backend`, `web`; defaults to `all`).

Execute the verify script:
```bash
.claude/skills/verify/verify.sh $ARGUMENTS
```

Interpret the results:
- **all / backend**: Verifies `dotnet build`, OpenAPI spec generation and sync, Docker availability, and `dotnet test` (Infrastructure + Api tests run against Testcontainers PostgreSQL).
- **all / web**: Verifies `npm run gen` (@pitchmate/api-client), schema.d.ts sync, `npm run lint` (ESLint), `npm run build` (tsc -b + Vite), and `npm test` (Vitest suite).
- Report the summary table as printed.
- If any gate fails, inspect the log file indicated in the failure line (e.g. `$TMPDIR/.../<gate>.log`), diagnose the issue, and provide the exact fix.
