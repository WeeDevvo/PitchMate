# CI/CD workflows

GitHub Actions pipelines for the PitchMate monorepo. Branching model:
feature branch → PR → `main`, with `develop` as the QA integration branch
(create `develop` when QA deploys go live).

## What runs today (live)

| Workflow | Trigger | Does |
|----------|---------|------|
| `ci-backend.yml` | PR / push to `main`/`develop` touching `backend/**` | Restore, build (Release, warnings-as-errors), `dotnet test` — includes the Testcontainers PostgreSQL integration, migration, and architecture tests. Needs Docker, which `ubuntu-latest` provides. |
| `ci-web.yml` | PR / push to `main`/`develop` touching `apps/web/**`, `packages/**`, or the root `package.json`/lockfile | `npm ci`, lint, build across the npm workspaces. |

Path filters keep a web-only change from running the backend pipeline and vice
versa.

### Make CI a required merge gate

In **Settings → Branches → branch protection** for `main` (and `develop` once it
exists), mark **Build & test** and **Lint & build** as required status checks.

> Note: GitHub does not report a required check that was skipped by a path
> filter, which can block a PR that legitimately touches only one side. If that
> bites, the usual fix is a tiny "changes" detection job (e.g.
> `dorny/paths-filter`) that always runs and conditionally gates the heavy jobs.
> Left out for now to keep things simple.

## What's scaffolded but inert (pending Azure)

`cd-qa.yml` (on `develop`) and `cd-production.yml` (on `main`, behind a manual
approval gate) are written but **every deploy job is guarded** by
`vars.AZURE_DEPLOY_ENABLED == 'true'`. Until that variable is set the jobs are
**skipped** (the run is green, not red), so merging to `main` won't produce
failures while infrastructure is still being stood up.

The deploy structure already encodes the project's rules:
- **Migrations run as an explicit out-of-process `efbundle` step before the app
  rolls out** — never on startup (see `docs/migrations.md`).
- **OIDC federation** for Azure auth (`id-token: write`), not long-lived keys.
- **Manual approval gate** for production via the `production` environment's
  required reviewers.

### Turning CD on (checklist)

1. **Provision Azure** — App Service/Container Apps (API), Postgres Flexible
   Server, Static Web Apps (web), Key Vault. (`tech.md` → Hosting.)
2. **Set up GitHub OIDC federation** — an Entra app registration / managed
   identity with federated credentials trusting this repo's `qa` and
   `production` environments.
3. **Create GitHub Environments** `qa` and `production`; add **required
   reviewers** to `production` (this is the approval gate).
4. **Add secrets** (per environment): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `DB_CONNECTION_STRING`, plus the Static Web Apps
   deployment token.
5. **Fill in the `TODO` deploy steps** (App Service/Container Apps + Static Web
   Apps actions).
6. **Create the `develop` branch** for QA deploys.
7. **Set repo variable `AZURE_DEPLOY_ENABLED = true`** to activate the jobs.
