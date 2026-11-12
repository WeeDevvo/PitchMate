// PitchMate walking-skeleton infrastructure (Azure, Container Apps hosting).
//
// Deploys the thin vertical slice needed to run the API + web app in an
// environment: a Container App (consumption) for the API, pulling its image
// from an Azure Container Registry, a PostgreSQL Flexible Server, a Static Web
// App for the React app, a Key Vault for secrets, and Application Insights for
// the observability baseline.
//
// Decision (reversible): API hosting is Container Apps, not App Service. App
// Service has no compute quota on this subscription (0 instances for every
// SKU), while Container Apps has its own quota. The image is built from
// backend/Dockerfile. See infra/README.md and docs/walking-skeleton.md.
//
// Deploy (per environment, e.g. qa): infra/deploy-qa.ps1, which pushes a first
// image to the registry before deploying the app.
//
// Secrets (Postgres admin password, token signing key) are passed at deploy
// time, stored in Key Vault, and never committed.

targetScope = 'resourceGroup'

@description('Short environment name, e.g. "qa" or "prod". Used in resource names.')
@allowed(['qa', 'prod'])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Region for the Static Web App. SWA is only offered in a subset of regions, and westeurope refuses new customers, so it is set separately from the main location.')
@allowed(['westeurope', 'eastus2', 'centralus', 'westus2', 'eastasia'])
param staticWebAppLocation string = 'eastus2'

@description('Resource name prefix. Combined with environmentName for uniqueness.')
param namePrefix string = 'pitchmate'

@description('PostgreSQL administrator login name.')
param postgresAdminLogin string

@description('PostgreSQL administrator password. Pass via --parameters or a secure pipeline variable; never commit. Unused when useExternalDatabase is true.')
@secure()
param postgresAdminPassword string = ''

@description('Use a database outside this deployment (e.g. Supabase for QA) instead of an Azure PostgreSQL Flexible Server. Its connection string must already be in Key Vault as Db-ConnectionString; this template then neither creates the server nor writes that secret.')
param useExternalDatabase bool = false

@description('PostgreSQL Flexible Server SKU (Burstable tier for low-cost QA).')
param postgresSkuName string = 'Standard_B1ms'

@description('Object ID (principal) of the operator who should retain Key Vault admin access. Optional.')
param keyVaultAdminObjectId string = ''

@description('HMAC signing key for the API\'s access tokens (at least 32 bytes). Stored in Key Vault; pass at deploy time and never commit. Rotating it signs every user out.')
// No @minLength(32): the .bicepparam files read it from the environment, which Bicep checks
// at compile time. The API's AuthTokenOptionsValidator enforces the 32-byte minimum at startup.
@secure()
param authSigningKey string

@description('Google OAuth client id the API enforces as the audience of Google sign-in assertions. The API refuses to start without one; a placeholder boots it with Google sign-in unusable.')
param googleClientId string

@description('Audience of the API\'s access tokens; must match what the web client expects.')
param authTokenAudience string = 'pitchmate-web'

@description('API image repository and tag in the registry, e.g. "pitchmate-api:<sha>". It must already be pushed; CD rolls out later tags itself.')
param apiImageTag string = ''

@description('Deploy the API Container App. A first run passes false to create the registry, so an image can be pushed before the app that pulls it exists.')
param deployApi bool = true

@description('Minimum API replicas. 0 lets QA scale to zero (a few seconds of cold start); production should keep 1.')
@minValue(0)
param apiMinReplicas int = 0

@description('Maximum API replicas.')
@minValue(1)
param apiMaxReplicas int = 2

// ── Naming ──────────────────────────────────────────────────────────────────
var suffix = uniqueString(resourceGroup().id, environmentName)
var appName = '${namePrefix}-api-${environmentName}-${suffix}'
var caEnvName = '${namePrefix}-cae-${environmentName}'
var identityName = '${namePrefix}-id-api-${environmentName}'
var acrName = take('${namePrefix}${environmentName}${suffix}', 50)
var pgName = '${namePrefix}-pg-${environmentName}-${suffix}'
var kvName = take('${namePrefix}kv${environmentName}${suffix}', 24)
var swaName = '${namePrefix}-web-${environmentName}'
var laName = '${namePrefix}-logs-${environmentName}'
var aiName = '${namePrefix}-ai-${environmentName}'
var databaseName = 'pitchmate'

// The port the image listens on (backend/Dockerfile: ASPNETCORE_URLS).
var apiPort = 5243

// Npgsql connection string built from the provisioned server + admin credentials
// (only when this template owns the database).
var pgConnectionString = useExternalDatabase ? '' : 'Host=${pg!.properties.fullyQualifiedDomainName};Database=${databaseName};Username=${postgresAdminLogin};Password=${postgresAdminPassword};SslMode=Require;Trust Server Certificate=true'

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
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (!useExternalDatabase) {
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

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (!useExternalDatabase) {
  parent: pg
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow other Azure services (the Container App) to reach the server. The
// 0.0.0.0 sentinel rule is the documented "Allow Azure services" toggle.
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (!useExternalDatabase) {
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
// With an external database the operator sets this secret, and the template leaves it alone.
resource dbConnectionSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!useExternalDatabase) {
  parent: keyVault
  name: 'Db-ConnectionString'
  properties: {
    value: pgConnectionString
  }
}

// The access-token signing key; the API reads Auth:Token:SigningKey via a Key Vault reference.
resource authSigningKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'Auth-SigningKey'
  properties: {
    value: authSigningKey
  }
}

// ── Identity, registry and role assignments ────────────────────────────────
// A user-assigned identity, so its roles exist before the Container App is
// created and its first revision can pull the image and read the secrets.
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource apiAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, apiIdentity.id, acrPullRoleId)
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Role: Key Vault Secrets User.
var kvSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource apiKvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, apiIdentity.id, kvSecretsUserRoleId)
  properties: {
    roleDefinitionId: kvSecretsUserRoleId
    principalId: apiIdentity.properties.principalId
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

// ── Container Apps (consumption) ────────────────────────────────────────────
resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: caEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// The token issuer is the API's own origin, built from the environment's domain
// (the app cannot reference its own FQDN in its own settings).
var apiOrigin = 'https://${appName}.${containerAppsEnv.properties.defaultDomain}'

resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApi) {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${apiIdentity.id}': {} }
  }
  dependsOn: [apiAcrPull, apiKvAccess, dbConnectionSecret]
  properties: {
    environmentId: containerAppsEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: apiPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        { server: registry.properties.loginServer, identity: apiIdentity.id }
      ]
      // Key Vault references, resolved by the identity. Values never land in app config.
      secrets: [
        // Versionless, so the app follows the latest value whoever wrote it.
        { name: 'db-connection-string', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/Db-ConnectionString', identity: apiIdentity.id }
        { name: 'auth-signing-key', keyVaultUrl: authSigningKeySecret.properties.secretUri, identity: apiIdentity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registry.properties.loginServer}/${apiImageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'ASPNETCORE_ENVIRONMENT', value: environmentName == 'prod' ? 'Production' : 'Staging' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
            { name: 'ConnectionStrings__Default', secretRef: 'db-connection-string' }
            // Auth settings the API validates at startup (AuthTokenOptionsValidator,
            // GoogleOptionsValidator); a missing one stops the host. Lifetimes keep their code
            // defaults, and email stays on the Console transport until a provider is chosen.
            { name: 'Auth__Token__SigningKey', secretRef: 'auth-signing-key' }
            { name: 'Auth__Token__Issuer', value: apiOrigin }
            { name: 'Auth__Token__Audience', value: authTokenAudience }
            { name: 'Auth__Google__ClientId', value: googleClientId }
            // The web client is served from the Static Web App's origin, so the API must
            // allow it cross-origin (see PitchMate.Api/WebClientCors.cs).
            { name: 'Cors__AllowedOrigins__0', value: 'https://${staticWebApp.properties.defaultHostname}' }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/health', port: apiPort }, periodSeconds: 30 }
            { type: 'Readiness', httpGet: { path: '/health', port: apiPort }, periodSeconds: 10 }
          ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
      }
    }
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
output apiAppName string = deployApi ? appName : ''
output apiDefaultHostname string = deployApi ? '${appName}.${containerAppsEnv.properties.defaultDomain}' : ''
output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output keyVaultName string = keyVault.name
output postgresFqdn string = useExternalDatabase ? '' : pg!.properties.fullyQualifiedDomainName
output postgresServerName string = useExternalDatabase ? '' : pg!.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
