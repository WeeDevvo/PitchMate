# 06 · Platform

## Purpose

Where PitchMate runs and how a change reaches it: the Azure resources, the two environments, the CI gates, the CD pipelines and how database migrations ship. Read this before touching `infra/`, `.github/workflows/` or a Dockerfile.

## Today (as-is)

### Deployment picture

```mermaid
flowchart LR
  dev[Pull request] --> ci{CI gates}
  ci -->|merge| develop[develop branch]
  ci -->|merge| main[main branch]
  develop --> cdqa[cd-qa.yml]
  main --> approve[production approval] --> cdprod[cd-production.yml]

  subgraph job[Each CD run: two unordered jobs]
    direction TB
    mig[efbundle migrations] --> img[Build and push API image] --> roll[Container App update]
    web[Vite build] --> swa[Static Web Apps upload]
  end
  cdqa --> job
  cdprod --> job

  roll --> api[API Container App]
  swa --> site[Static Web App]
  site -->|HTTPS + CORS| api
  api --> db[(PostgreSQL)]
  api -. secrets .-> kv[Key Vault]
```

### Azure resources

All resources are declared in one template, deployed per environment into one resource group.

| Resource | Status | Detail | Source |
|---|---|---|---|
| API on **Azure Container Apps** | **Built** | One container app, 0.5 vCPU / 1 GiB, single-revision mode, external HTTPS-only ingress on port 5243, liveness and readiness probes on `/health` | `infra/main.bicep:272`, `infra/main.bicep:284`, `infra/main.bicep:289`, `infra/main.bicep:323` |
| Container Apps environment | **Built** | Consumption profile, logs to Log Analytics | `infra/main.bicep:251` |
| Scaling | **Built** | Min/max replicas only (default 0–2); no custom scale rules. QA scales to zero, production keeps one replica | `infra/main.bicep:72`, `infra/main.bicep:329`, `infra/main.qa.bicepparam:34`, `infra/main.prod.bicepparam:29` |
| Container Registry | **Built** | Basic tier; the API pulls with a user-assigned managed identity (AcrPull) | `infra/main.bicep:203`, `infra/main.bicep:214` |
| Web on **Azure Static Web Apps** | **Built** | Free tier, in `eastus2` (the API region is the resource group's) | `infra/main.bicep:337`, `infra/main.bicep:31` |
| PostgreSQL Flexible Server | **Partial** | PG 16, `Standard_B1ms`, 7-day backups, no HA, public access with the "all Azure services" firewall rule. Created **only** when `useExternalDatabase` is false, so it does not exist in QA | `infra/main.bicep:119`, `infra/main.bicep:133`, `infra/main.bicep:154`, `infra/main.qa.bicepparam:16` |
| External database (Supabase) for QA | **Built** | QA sets `useExternalDatabase = true`; the operator puts the Supabase session-pooler connection string in Key Vault by hand. The free project pauses after 7 idle days | `infra/main.qa.bicepparam:16`, `infra/README.md:27`, `infra/README.md:38` |
| Key Vault | **Built** | RBAC, 7-day soft delete, no purge protection. Holds `Db-ConnectionString` and `Auth-SigningKey` | `infra/main.bicep:164`, `infra/main.bicep:178`, `infra/main.bicep:187` |
| Secrets into the API | **Built** | Key Vault references resolved by the managed identity, surfaced as `ConnectionStrings__Default` and `Auth__Token__SigningKey` | `infra/main.bicep:297`, `infra/main.bicep:310`, `infra/main.bicep:314` |
| CORS | **Built** | The API allows exactly the Static Web App's default hostname | `infra/main.bicep:320`, `backend/src/PitchMate.Api/WebClientCors.cs` |
| Log Analytics + Application Insights | **Partial** | Both resources exist and the connection string is passed to the API, but no Application Insights or OpenTelemetry SDK is referenced in `backend/src`, so only container logs are collected | `infra/main.bicep:99`, `infra/main.bicep:108`, `infra/main.bicep:309` |
| Custom domain `pitch-mate.co.uk`, DNS, managed certificates | **Gap** | Nothing in the template; both endpoints use platform default hostnames. The domain is named only in `README.md:3` | `infra/main.bicep` |
| Private networking | **Gap** | No VNet or private endpoints; Key Vault, registry and the owned Postgres are publicly reachable (identity- and firewall-protected) | `infra/main.bicep:154` |
| Alerts, availability tests, action groups | **Gap** | None declared | `infra/main.bicep` |
| Email transport in the cloud | **Gap** | Email stays on the Console transport (messages go to the API log) | `infra/README.md:55` |
| Google sign-in client id | **Gap** | A placeholder in both parameter files | `infra/main.qa.bicepparam`, `infra/main.prod.bicepparam` |

### Environments

| Line | Status | Source |
|---|---|---|
| Two environments are modelled: `qa` and `prod` (`environmentName`), each with a parameter file | **Built** | `infra/main.bicep:24`, `infra/main.qa.bicepparam`, `infra/main.prod.bicepparam` |
| The API runs as `Staging` in QA and `Production` in prod | **Built** | `infra/main.bicep:308` |
| QA is provisioned by a manual script: two-pass Bicep deploy (infra, then API once an image exists), image build and push, then `dotnet ef database update` | **Built** | `infra/deploy-qa.ps1` |
| GitHub→Azure auth is OIDC (no stored cloud credentials); `configure-qa.ps1` creates the Entra app, the federated credentials, the `qa` and `production` GitHub environments, and the QA secrets and variables | **Built** | `infra/configure-qa.ps1`, `.github/workflows/cd-qa.yml:64` |
| `verify-qa.ps1` checks deployment state, API revisions, `/health` and the web status code | **Built** | `infra/verify-qa.ps1` |
| Production has a parameter file but no deploy script, and the OIDC identity is granted roles on the QA resource group and registry only | **Partial** | `infra/main.prod.bicepparam`, `infra/configure-qa.ps1` |
| Infrastructure changes are applied only by the manual script; no workflow runs a Bicep deployment | **Gap** | `.github/workflows/cd-qa.yml`, `infra/deploy-qa.ps1` |

### CI

| Line | Status | Source |
|---|---|---|
| Backend CI runs on PRs and pushes to `main`/`develop` that touch `backend/**` or `Directory.Build.props` | **Built** | `.github/workflows/ci-backend.yml:9` |
| Backend gates, in order: tool restore → restore → Release build (warnings are errors; emits the OpenAPI document) → OpenAPI drift check → tests (Testcontainers on the runner's Docker) | **Built** | `.github/workflows/ci-backend.yml:54`, `.github/workflows/ci-backend.yml:64`, `.github/workflows/ci-backend.yml:73`, `.github/workflows/ci-backend.yml:79` |
| Web CI runs on PRs and pushes that touch `apps/web/**`, `packages/**` or the root package files | **Built** | `.github/workflows/ci-web.yml:8` |
| Web gates, in order: `npm ci` → TS client drift check → lint → build (tsc + Vite) → Vitest | **Built** | `.github/workflows/ci-web.yml:46`, `.github/workflows/ci-web.yml:65`, `.github/workflows/ci-web.yml:70`, `.github/workflows/ci-web.yml:73`, `.github/workflows/ci-web.yml:80` |
| The same nine gates run locally through `/verify` | **Built** | `.claude/skills/verify/verify.sh:45` |
| A packages-only PR skips the backend OpenAPI gate (path filters), and there is no always-run "changes" job, so path-skipped required checks can block a PR | **Partial** | `.github/workflows/ci-web.yml:61`, `.github/workflows/README.md:22` |
| No C# format or analyser-only lint step, and no image or dependency scanning | **Gap** | `.github/workflows/ci-backend.yml` |

### CD

| Line | Status | Source |
|---|---|---|
| A push to `develop` deploys QA; a push to `main` deploys production. Both can be run by hand | **Built** | `.github/workflows/cd-qa.yml:12`, `.github/workflows/cd-production.yml:16` |
| Every deploy job is skipped unless the repo variable `AZURE_DEPLOY_ENABLED` is `true` | **Built** | `.github/workflows/cd-qa.yml:28`, `.github/workflows/cd-production.yml:31` |
| Production jobs target the `production` GitHub environment, whose required reviewers are the manual approval | **Built** | `.github/workflows/cd-production.yml:33` |
| Backend job: build the migration bundle → OIDC login → open the Postgres firewall to the runner (no-op for an external database) → apply migrations → close the firewall → build and push the image → `az containerapp update` | **Built** | `.github/workflows/cd-qa.yml:54`, `.github/workflows/cd-qa.yml:74`, `.github/workflows/cd-qa.yml:90`, `.github/workflows/cd-qa.yml:107` |
| Web job: build with `VITE_API_BASE_URL` from a repo variable (fails if unset) → upload `apps/web/dist` to Static Web Apps | **Built** | `.github/workflows/cd-qa.yml:149`, `.github/workflows/cd-qa.yml:161` |
| The backend and web jobs have no `needs:` between them, so the web can ship before the API and its migrations | **Partial** | `.github/workflows/cd-qa.yml:127` |
| No post-deploy smoke test, no automatic rollback, no revision traffic splitting | **Gap** | `.github/workflows/cd-qa.yml`, `infra/main.bicep:284` |

### Migrations

| Line | Status | Source |
|---|---|---|
| Migrations never run at application start; a test bans `Migrate`/`EnsureCreated` | **Built** | `.claude/skills/db-migration/SKILL.md:36` |
| In CD, a self-contained `efbundle` is built and applied **before** the new image rolls out, in the same job | **Built** | `.github/workflows/cd-qa.yml:54`, `.github/workflows/cd-qa.yml:90` |
| Packages are restored before the bundle is built (the bundle reads project metadata first) | **Built** | `.github/workflows/cd-qa.yml:48` |
| The manual QA script applies migrations with `dotnet ef database update` rather than the bundle | **Built** | `infra/deploy-qa.ps1` |
| Locally: scaffold, review Up/Down, apply forward–back–forward against the compose database, run the migration tests (`/db-migration`) | **Built** | `.claude/skills/db-migration/SKILL.md` |

### Containers and local development

| Line | Status | Source |
|---|---|---|
| `backend/Dockerfile` publishes the API on `aspnet:10.0`, port 5243, as a non-root user; it is the image CD ships | **Built** | `backend/Dockerfile` |
| `apps/web/Dockerfile` builds the web and serves it from nginx, which proxies API paths to the backend. It is used only by docker-compose and the Makefile; the cloud ships the web through Static Web Apps | **Built** | `apps/web/Dockerfile`, `apps/web/nginx.conf`, `docker-compose.yml:39` |
| `docker compose up` runs PostgreSQL 16, the API and the nginx client | **Built** | `docker-compose.yml:3`, `docker-compose.yml:21`, `docker-compose.yml:39` |
| The Static Web App serves an SPA fallback and security headers (minimal CSP, nosniff, HSTS) | **Built** | `apps/web/public/staticwebapp.config.json:2`, `apps/web/public/staticwebapp.config.json:7` |
| The web Dockerfile builds on Node 22 while CI and CD use Node 24 | **Partial** | `apps/web/Dockerfile`, `.github/workflows/ci-web.yml:41` |

## Rules

- **Built** · The contract flows one way, C# API → OpenAPI → TypeScript client, and CI fails on drift in either generated file. `.github/workflows/ci-backend.yml:73`, `.github/workflows/ci-web.yml:65`
- **Built** · Migrations are an explicit, out-of-process deployment step that completes before rollout. `.github/workflows/cd-qa.yml:90`
- **Built** · No cloud credential is stored in GitHub; deployments authenticate by OIDC, and the API reads secrets from Key Vault through its managed identity. `.github/workflows/cd-qa.yml:64`, `infra/main.bicep:297`
- **Built** · Production deploys only from `main`, behind a human approval. `.github/workflows/cd-production.yml:16`, `.github/workflows/cd-production.yml:33`
- **Built** · Ingress is HTTPS-only and the API accepts browser calls from the web origin alone. `infra/main.bicep:289`, `infra/main.bicep:320`

## Open questions

1. **The docs describe a platform that no longer exists.** `CLAUDE.md` says hosting is "App Service, Postgres Flexible Server, Static Web Apps, Key Vault" and that CD is "scaffolded but inert"; `.github/workflows/README.md` says the same and tells the reader to create `develop`. The template now declares Container Apps and a registry (`infra/main.bicep:272`, `infra/main.bicep:203`), QA's database is external (`infra/main.qa.bicepparam:16`), and the CD error hints still mention `azurewebsites.net` (`.github/workflows/cd-qa.yml:154`). Update the docs, or is some of this temporary?
2. **Is CD switched on?** Observed with `gh` on 2026-11-11 (live repository state, not in the repo): `AZURE_DEPLOY_ENABLED` is `true`, QA deploys from `develop` are succeeding, and a production run on `main` is waiting for approval while the `production` environment has no secrets and no `_PROD` variables, so approving it would fail. The variable is repo-wide, so it arms production as well as QA. Should production stay armed before it is provisioned?
3. **What is production's database?** The prod parameter file leaves `useExternalDatabase` false, which creates a B1ms Flexible Server with 7-day local backups, no HA and no geo-redundancy. Is that the launch target, and what are the backup and restore expectations?
4. **When does `pitch-mate.co.uk` get wired?** Custom domains, DNS and certificates are outside the template, and CORS and the token issuer are derived from platform hostnames.
5. **Should the web deploy wait for the API?** The jobs are unordered, so a web build can briefly call an API that has not rolled out.
6. **Who applies infrastructure changes?** Today only `deploy-qa.ps1` run from a workstation. Should Bicep run in CD?
7. **Observability.** Application Insights is provisioned but unused. Wire the SDK, or remove the resource?
8. **Secret rotation.** `DB_CONNECTION_STRING` in GitHub is a one-time copy of the Key Vault secret, and rotating `Auth-SigningKey` signs everyone out. Is a rotation procedure needed before launch?
9. **`README.md` and the device READMEs point at `docs/` and `.kiro/steering/`**, neither of which is in the repo. Should those references move to `specs/`?

## Ideas

- **Idea** · A post-deploy smoke test (`/health` plus one authenticated round trip) that fails the run and re-points the previous revision.
- **Idea** · Preview environments per pull request using Static Web Apps previews.
- **Idea** · An always-run "changes" job so path-filtered checks can be required safely.
- **Idea** · Uptime and error-rate alerts to email once Application Insights is wired.
- **Idea** · A keep-alive ping so the free QA database does not pause.
