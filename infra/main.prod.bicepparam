using './main.bicep'

// Production parameters. As with QA, the secrets are passed at deploy time
// (secure) and never committed. Production sizing can grow later; the walking
// skeleton starts modest and scales via these parameters.

param environmentName = 'prod'
param location = 'uksouth'
param staticWebAppLocation = 'eastus2'
param namePrefix = 'pitchmate'
param postgresAdminLogin = 'pmadmin'
param postgresSkuName = 'Standard_B1ms'

param postgresAdminPassword = ''

// Provided at deploy time (secure, >= 32 bytes); use a different key from QA.
param authSigningKey = ''

param keyVaultAdminObjectId = ''

// Must be the real Google OAuth client id before production launch.
param googleClientId = '<google-oauth-client-id>.apps.googleusercontent.com'

// An image already pushed to the production registry.
param apiImageTag = 'pitchmate-api:<tag>'

// Keep one replica warm: no cold starts, and room for the background job host later.
param apiMinReplicas = 1
