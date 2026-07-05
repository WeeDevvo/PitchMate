using './main.bicep'

// Production parameters. As with QA, the Postgres admin password is passed at
// deploy time (secure) and never committed. Production sizing can grow later;
// the walking skeleton starts modest and scales via these SKUs.

param environmentName = 'prod'
param location = 'uksouth'
param namePrefix = 'pitchmate'
param postgresAdminLogin = 'pmadmin'
param appServicePlanSku = 'B1'
param postgresSkuName = 'Standard_B1ms'

param postgresAdminPassword = ''

param keyVaultAdminObjectId = ''
