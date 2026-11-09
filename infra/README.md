# Infrastructure (Bicep)

Azure infrastructure-as-code for PitchMate, starting with the walking-skeleton
stack (App Service API + PostgreSQL Flexible Server + Static Web App + Key Vault
+ Application Insights).

| File | Purpose |
|------|---------|
| `main.bicep` | The full resource-group deployment. |
| `main.qa.bicepparam` | QA/staging parameter values. |
| `main.prod.bicepparam` | Production parameter values. |
| `deploy-qa.ps1` | Provisions QA: generates the Postgres password and token signing key, deploys `main.bicep`, writes the outputs to `%TEMP%\pm-deploy-qa.out.json`. |
| `configure-qa.ps1` | Connects GitHub Actions to Azure (OIDC), creates the `qa` and `production` environments, and sets the QA secrets and variables. |
| `verify-qa.ps1` | Writes the deployment state and resource list to `%TEMP%\pm-verify.txt`. |

## Deploy (QA)

Run from the repo root, signed in to both CLIs (`az login`, `gh auth login`):

```powershell
./infra/deploy-qa.ps1        # B1 by default; -AppServicePlanSku F1 for the free shared tier
./infra/configure-qa.ps1
./infra/verify-qa.ps1
```

Two secrets are passed at deploy time and never committed: the Postgres admin
password and `authSigningKey`, the API's access-token signing key. Both end up
in Key Vault. Re-running `deploy-qa.ps1` generates new ones, which changes the
database password and signs every user out, so re-run `configure-qa.ps1`
afterwards to refresh `DB_CONNECTION_STRING`.

The API validates its auth settings at startup and stops if one is missing.
The Bicep sets them all: the signing key (Key Vault reference), the issuer (the
API's own origin), the audience and the Google client id. The web's Google
sign-in flow isn't wired yet, so QA runs on a placeholder Google client id.
Email stays on the Console transport (messages go to the API log) until a
provider is chosen.

See `docs/walking-skeleton.md` for the end-to-end runbook (OIDC federation,
GitHub environments/secrets, activating CD).

## Decisions

- **API hosting: Azure App Service** (Linux, `.NET 10`) — chosen over Container
  Apps for the skeleton to avoid a registry/Dockerfile. Reversible; the
  `IRatingEngine`/Clean-Architecture app is container-ready if we switch later.
- **Secrets via Key Vault references** — the API reads
  `ConnectionStrings:Default` through a Key Vault reference resolved by its
  system-assigned managed identity; the secret value never lands in app config.
- **Low-cost tiers** — App Service B1, Postgres Burstable B1ms, Static Web Apps
  Free. Scale via the SKU parameters.
- **Migrations reach Postgres through a per-run firewall rule** — the server
  admits Azure services only, so the CD job opens it to the runner's IP for the
  `efbundle` step and always removes the rule afterwards.
- **SPA routing and headers** live in `apps/web/public/staticwebapp.config.json`
  (deep links fall back to `index.html`). Its CSP is deliberately minimal
  (framing, plugins, base and form targets); a full script/connect policy is a
  backlog item.
