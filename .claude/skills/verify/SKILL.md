---
name: verify
description: Run PitchMate's CI gates locally (backend build and tests, OpenAPI and TS client drift, web lint, build and tests) and report a pass/fail summary. Use before reporting work as done, committing, or opening a PR.
---

# Verify

The gates are the ones `.github/workflows/ci-backend.yml` and `ci-web.yml` run.

## Steps

1. **Pick the scope** from the changed paths (`git status --porcelain` plus `git diff --name-only main...HEAD`):
   - `backend/**` or `Directory.Build.props` → `backend`
   - `apps/web/**`, `packages/**`, `package.json`, `package-lock.json` → `web`
   - both, or any change to an Api endpoint, request/response record or wire enum → `all` (the spec the backend emits feeds the web client)
2. **Run** `.claude/skills/verify/verify.sh <scope>` from anywhere in the repo. The backend tests take a few minutes, so run it in the background with a long timeout, and run nothing else heavy at the same time.
3. **Fix each FAIL** using the log path the script prints:
   - `openapi-spec-sync` / `api-client-sync`: the regenerated file differs from the index. Read the diff. If it is the contract change you intended, `git add` it. If not, the code changed the contract by accident, so fix the code. Never hand-edit either file. The `sync-contracts` skill covers the full flow.
   - `web-test` with `Test timed out in 5000ms` in a property test: the full suite is CPU-bound and a few property tests run close to Vitest's default timeout. Rerun just that file (`npm test --workspace @pitchmate/web -- <file>`). If it passes alone, report it as a load timeout, naming the file, rather than a regression. If it fails alone, treat it as a real failure.
   - `docker`: start Docker Desktop (`open -a Docker`) and wait for `docker info` to succeed.
   - `backend-test` with `DockerApiException ... Unauthorized` pulling `postgres:17.2`: the saved Docker Hub login is stale, not the code. Ask the user to run `docker login` (or `docker logout`). Don't change their credentials yourself.
4. **Rerun** the script for the scope.

**Done** when the summary lists every gate in scope as `PASS`. Report the summary table as printed. If anything still fails, quote the failing output and say the work is not verified.
