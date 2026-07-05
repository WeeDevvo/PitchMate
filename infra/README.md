# Infrastructure (Bicep)

Azure infrastructure-as-code for PitchMate, starting with the walking-skeleton
stack (App Service API + PostgreSQL Flexible Server + Static Web App + Key Vault
+ Application Insights).

| File | Purpose |
|------|---------|
| `main.bicep` | The full resource-group deployment. |
| `main.qa.bicepparam` | QA/staging parameter values. |
| `main.prod.bicepparam` | Production parameter values. |

## Deploy

The Postgres admin password is passed at deploy time and never committed:

```powershell
az group create -n rg-pitchmate-qa -l uksouth
az deployment group create -g rg-pitchmate-qa `
  -f infra/main.bicep -p infra/main.qa.bicepparam `
  -p postgresAdminPassword=<generated-secret>
```

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
