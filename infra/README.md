# Infrastructure (Bicep)

Azure infrastructure-as-code for PitchMate, starting with the walking-skeleton
stack: the API on Container Apps (image in Azure Container Registry), PostgreSQL
Flexible Server, a Static Web App, Key Vault and Application Insights.

| File | Purpose |
|------|---------|
| `main.bicep` | The full resource-group deployment. |
| `main.qa.bicepparam` | QA/staging parameter values (reference; the script passes them inline). |
| `main.prod.bicepparam` | Production parameter values. |
| `deploy-qa.ps1` | Provisions or updates QA: deploys the platform, builds and pushes the API image, deploys the Container App, applies migrations. Writes the outputs to `%TEMP%\pm-deploy-qa.out.json`. |
| `configure-qa.ps1` | Connects GitHub Actions to Azure (OIDC), creates the `qa` and `production` environments, and sets the QA secrets and variables. |
| `verify-qa.ps1` | Writes the deployment state, resources, API revision and a health check to `%TEMP%\pm-verify.txt`. |

## Deploy (QA)

Run from the repo root, signed in to both CLIs (`az login`, `gh auth login`),
with Docker running:

```powershell
./infra/deploy-qa.ps1        # -SkipMigrations to leave them to CD
./infra/configure-qa.ps1
./infra/verify-qa.ps1
```

`deploy-qa.ps1` deploys `main.bicep` twice. The first pass (`deployApi=false`)
creates everything except the API, so the registry exists before the first
image is pushed. The second deploys the Container App on that image. Migrations
then run from your machine through a temporary firewall rule for your IP.

Two secrets are generated on the first run and never committed: the Postgres
admin password and `authSigningKey`, the API's access-token signing key. Both
live only in Key Vault. A re-run reads them back, so it neither changes the
database password nor signs users out.

The API validates its auth settings at startup and stops if one is missing.
The Bicep sets them all: the signing key (Key Vault reference), the issuer (the
API's own origin), the audience and the Google client id. The web's Google
sign-in flow isn't wired yet, so QA runs on a placeholder Google client id.
Email stays on the Console transport (messages go to the API log) until a
provider is chosen.

See `docs/walking-skeleton.md` for the end-to-end runbook (OIDC federation,
GitHub environments/secrets, activating CD).

## Decisions

- **API hosting: Azure Container Apps** (consumption, image from
  `backend/Dockerfile`). App Service was the first choice, but this subscription
  has no App Service compute quota (0 instances for every SKU, including F1),
  while Container Apps has its own quota. CD builds the image, pushes it to the
  environment's registry and runs `az containerapp update --image`.
- **Scale to zero in QA** (`apiMinReplicas = 0`): the first request after idle
  takes a few seconds. Production keeps one replica warm, which the background
  job host will also need.
- **Secrets via Key Vault references** — the API reads the connection string and
  signing key through Container Apps Key Vault secrets, resolved by a
  user-assigned identity. The same identity pulls from the registry (AcrPull).
  It's user-assigned so its roles exist before the app's first revision starts.
- **Low-cost tiers** — Container Apps consumption (0.5 vCPU / 1 GiB),
  Container Registry Basic, Postgres Burstable B1ms, Static Web Apps Free.
- **Static Web App in eastus2** — SWA isn't offered in uksouth and westeurope
  refuses new customers. The region only places its control plane; content is
  served from the global edge.
- **Migrations reach Postgres through a per-run firewall rule** — the server
  admits Azure services only, so CD (and `deploy-qa.ps1`) opens it to the
  caller's IP for the migration step and always removes the rule afterwards.
- **SPA routing and headers** live in `apps/web/public/staticwebapp.config.json`
  (deep links fall back to `index.html`). Its CSP is deliberately minimal
  (framing, plugins, base and form targets); a full script/connect policy is a
  backlog item.
