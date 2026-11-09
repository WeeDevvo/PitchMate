using './main.bicep'

// QA / staging parameters, for reference. infra/deploy-qa.ps1 passes the same
// values inline, because az can't combine a .bicepparam file with the secure
// values below on the command line.

param environmentName = 'qa'
param location = 'uksouth'
param staticWebAppLocation = 'eastus2'
param namePrefix = 'pitchmate'
param postgresAdminLogin = 'pmadmin'
param postgresSkuName = 'Standard_B1ms'

// Provided at deploy time (secure). Placeholders overridden on the CLI / pipeline.
param postgresAdminPassword = ''
param authSigningKey = ''

// Optional: set to your Entra user object id for break-glass Key Vault access.
param keyVaultAdminObjectId = ''

// The web's Google sign-in flow isn't wired yet, so QA boots on a placeholder client id.
// Replace it with the real OAuth client id once Google sign-in ships.
param googleClientId = 'qa-placeholder.apps.googleusercontent.com'

// An image already pushed to the registry; deploy-qa.ps1 builds and pushes one first.
param apiImageTag = 'pitchmate-api:<tag>'
param deployApi = true

// Scale to zero when idle (a few seconds of cold start on the first request).
param apiMinReplicas = 0
