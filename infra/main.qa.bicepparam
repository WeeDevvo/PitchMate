using './main.bicep'

// QA / staging parameters. The Postgres admin password is NOT set here — pass it
// at deploy time so it never lands in source control, e.g.:
//   az deployment group create -g rg-pitchmate-qa -f infra/main.bicep \
//     -p infra/main.qa.bicepparam -p postgresAdminPassword=$env:PG_ADMIN_PASSWORD

param environmentName = 'qa'
param location = 'uksouth'
param namePrefix = 'pitchmate'
param postgresAdminLogin = 'pmadmin'
param appServicePlanSku = 'B1'
param postgresSkuName = 'Standard_B1ms'

// Provided at deploy time (secure). Placeholder overridden on the CLI / pipeline.
param postgresAdminPassword = ''

// Optional: set to your Entra user object id for break-glass Key Vault access.
param keyVaultAdminObjectId = ''
