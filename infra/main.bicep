// PitchMate walking-skeleton infrastructure (Azure, App Service hosting).
//
// Deploys the thin vertical slice needed to run the auth API + web shell in an
// environment: an App Service (Linux, .NET 10) for the API, a PostgreSQL
// Flexible Server, a Static Web App for the React app, a Key Vault for secrets,
// and Application Insights for the observability baseline.
//
// Decision (reversible): API hosting is App Service (zip-deploy), not Container
// Apps — simplest path for a walking skeleton, no registry/Dockerfile. See
// docs/backlog.md decision log and docs/walking-skeleton.md.
//
// Deploy (per environment, e.g. qa):
//   az group create -n rg-pitchmate-qa -l uksouth
//   az deployment group create -g rg-pitchmate-qa \
//     -f infra/main.bicep -p infra/main.qa.bicepparam
//
// Secrets (Postgres admin password) are passed at deploy time and never committed.

targetScope = 'resourceGroup'

@description('Short environment name, e.g. "qa" or "prod". Used in resource names.')
@allowed(['qa', 'prod'])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Region for the Static Web App. SWA is only offered in a subset of regions, so it is set separately from the main location.')
@allowed(['westeurope', 'eastus2', 'centralus', 'westus2', 'eastasia'])
param staticWebAppLocation string = 'westeurope'

@description('Resource name prefix. Combined with environmentName for uniqueness.')
param namePrefix string = 'pitchmate'

@description('PostgreSQL administrator login name.')
param postgresAdminLogin string

@description('PostgreSQL administrator password. Pass via --parameters or a secure pipeline variable; never commit.')
@secure()
param postgresAdminPassword string

@description('App Service plan SKU. B1 is the cheapest always-on tier suitable for a skeleton.')
param appServicePlanSku string = 'B1'

@description('PostgreSQL Flexible Server SKU (Burstable tier for low-cost QA).')
param postgresSkuName string = 'Standard_B1ms'

@description('Object ID (principal) of the operator who should retain Key Vault admin access. Optional.')
param keyVaultAdminObjectId string = ''

// ── Naming ──────────────────────────────────────────────────────────────────
var suffix = uniqueString(resourceGroup().id, environmentName)
var appName = '${namePrefix}-api-${environmentName}-${suffix}'
var planName = '${namePrefix}-plan-${environmentName}'
var pgName = '${namePrefix}-pg-${environmentName}-${suffix}'
var kvName = take('${namePrefix}kv${environmentName}${suffix}', 24)
var swaName = '${namePrefix}-web-${environmentName}'
var laName = '${namePrefix}-logs-${environmentName}'
var aiName = '${namePrefix}-ai-${environmentName}'
var databaseName = 'pitchmate'

// Npgsql connection string built from the provisioned server + admin credentials.
var pgConnectionString = 'Host=${pg.properties.fullyQualifiedDomainName};Database=${databaseName};Username=${postgresAdminLogin};Password=${postgresAdminPassword};SslMode=Require;Trust Server Certificate=true'

// Free (F1) / Shared (D1) tiers run on shared compute: no dedicated VM quota, but
// they do NOT support AlwaysOn or the health-check ping. Enable those only on
// dedicated tiers (B1+).
var isDedicatedPlan = !contains(['F1', 'FREE', 'D1', 'SHARED'], toUpper(appServicePlanSku))

// ── Observability ─────────────────────────────────────────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: laName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ── PostgreSQL Flexible Server ──────────────────────────────────────────────
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  sku: {
    name: postgresSkuName
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow other Azure services (the App Service) to reach the server. The
// 0.0.0.0 sentinel rule is the documented "Allow Azure services" toggle.
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── Key Vault (RBAC) ────────────────────────────────────────────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// Store the DB connection string as a secret; the API reads it via a Key Vault reference.
resource dbConnectionSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Db-ConnectionString'
  properties: {
    value: pgConnectionString
  }
}

// ── App Service (Linux, .NET 10) ────────────────────────────────────────────
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: appServicePlanSku
  }
  kind: 'linux'
  properties: {
    reserved: true // Linux
  }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: isDedicatedPlan
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: isDedicatedPlan ? '/health' : null
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: environmentName == 'prod' ? 'Production' : 'Staging'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          // Key Vault reference — the API resolves ConnectionStrings:Default at runtime
          // via its managed identity. Secret value never lands in app config.
          name: 'ConnectionStrings__Default'
          value: '@Microsoft.KeyVault(SecretUri=${dbConnectionSecret.properties.secretUri})'
        }
      ]
    }
  }
}

// Grant the API's managed identity read access to Key Vault secrets (RBAC).
// Role: Key Vault Secrets User.
var kvSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource apiKvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, api.id, kvSecretsUserRoleId)
  properties: {
    roleDefinitionId: kvSecretsUserRoleId
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Optional: keep an operator as Key Vault Secrets Officer for break-glass access.
var kvSecretsOfficerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')

resource operatorKvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(keyVaultAdminObjectId)) {
  scope: keyVault
  name: guid(keyVault.id, keyVaultAdminObjectId, kvSecretsOfficerRoleId)
  properties: {
    roleDefinitionId: kvSecretsOfficerRoleId
    principalId: keyVaultAdminObjectId
    principalType: 'User'
  }
}

// ── Static Web App (React/Vite) ─────────────────────────────────────────────
resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

// ── Outputs (consumed by the runbook / CD secrets) ──────────────────────────
output apiAppName string = api.name
output apiDefaultHostname string = api.properties.defaultHostName
output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output keyVaultName string = keyVault.name
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
output appInsightsConnectionString string = appInsights.properties.ConnectionString
