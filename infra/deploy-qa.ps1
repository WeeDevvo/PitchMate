# Provisions (or updates) the PitchMate QA stack. Run from the repo root after
# `az login`, with Docker running. Logs progress to $env:TEMP\pm-deploy-qa.log
# and writes deployment outputs (non-secret) to $env:TEMP\pm-deploy-qa.out.json,
# which configure-qa.ps1 reads.
#
# Steps:
#   1. Register providers, create the resource group.
#   2. Deploy everything except the API (the registry must exist before an
#      image can be pushed to it).
#   3. Build backend/Dockerfile and push it to the registry.
#   4. Deploy again with the API Container App on that image.
#   5. Apply EF migrations from this machine (firewall opened to this IP only
#      for the duration, then closed).
#
# Secrets: the Postgres admin password and the API's token signing key are
# generated on the first run and stored only in Key Vault. A re-run reads them
# back from Key Vault, so it neither changes the database password nor signs
# users out.
#
# Parameters are passed INLINE (not via the .bicepparam file), because Azure CLI
# does not allow combining a .bicepparam file with additional --parameters.
param(
  # Google OAuth client id. The web's Google flow isn't wired yet, so a placeholder boots the API.
  [string]$GoogleClientId = 'qa-placeholder.apps.googleusercontent.com',
  # Skip step 5, e.g. when CD will apply migrations.
  [switch]$SkipMigrations,
  # Only run step 5, against the stack a previous run deployed.
  [switch]$MigrationsOnly,
  # Use the database whose connection string is already in Key Vault as Db-ConnectionString
  # (e.g. a Supabase session pooler) instead of creating an Azure PostgreSQL server.
  [switch]$ExternalDatabase
)

$log = "$env:TEMP\pm-deploy-qa.log"
$out = "$env:TEMP\pm-deploy-qa.out.json"
function Log($m) { "$((Get-Date).ToString('HH:mm:ss'))  $m" | Tee-Object -FilePath $log -Append }
function Fail($m) { Log "FAILED: $m"; exit 1 }

Remove-Item $log -ErrorAction SilentlyContinue
if (-not $MigrationsOnly) { Remove-Item $out -ErrorAction SilentlyContinue }
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
az config set core.only_show_errors=true 2>$null | Out-Null

$rg       = 'rg-pitchmate-qa'
$location = 'uksouth'
# Static Web Apps isn't offered in uksouth, and westeurope refuses new customers
# ("region is currently not accepting new customers"). The SWA region only places
# its control plane; content is served from the global edge either way.
$swaLocation = 'eastus2'

# ── 0. Preconditions ────────────────────────────────────────────────────────
$meId = az ad signed-in-user show --query id -o tsv
if (-not $meId) { Fail "not signed in. Run 'az login' first." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker isn't running. Start Docker Desktop first." }
Log "Deploying as $(az account show --query user.name -o tsv) to subscription $(az account show --query name -o tsv)."

# ── 1. Providers and resource group ────────────────────────────────────────
$providers = 'Microsoft.App','Microsoft.ContainerRegistry','Microsoft.ManagedIdentity','Microsoft.Web',
             'Microsoft.DBforPostgreSQL','Microsoft.KeyVault','Microsoft.Insights','Microsoft.OperationalInsights'
foreach ($p in $providers) { az provider register --namespace $p 2>$null | Out-Null }
Log "Checking resource providers..."
for ($i = 0; $i -lt 60; $i++) {
  $notReady = $providers | Where-Object { (az provider show --namespace $_ --query registrationState -o tsv) -ne 'Registered' }
  if (-not $notReady) { Log "All providers registered."; break }
  Log ("Still registering: " + ($notReady -join ', '))
  Start-Sleep -Seconds 10
}
az group create -n $rg -l $location -o none

# ── Secrets: reuse what Key Vault holds, else generate ─────────────────────
function New-Secret([int]$length) { -join ((48..57)+(65..90)+(97..122) | Get-Random -Count $length | ForEach-Object {[char]$_}) }
$pgPassword = $null; $signingKey = $null
$kvName = az keyvault list -g $rg --query "[0].name" -o tsv 2>$null
if ($kvName) {
  $conn = az keyvault secret show --vault-name $kvName -n Db-ConnectionString --query value -o tsv 2>$null
  if ($conn -match 'Password=([^;]+)') { $pgPassword = $Matches[1] }
  $signingKey = az keyvault secret show --vault-name $kvName -n Auth-SigningKey --query value -o tsv 2>$null
}
# Once Key Vault holds a non-Azure database, stay external even without the switch, so a
# plain re-run can't recreate the Azure server and overwrite the operator's secret.
if (-not $ExternalDatabase -and $conn -and $conn -notmatch 'postgres\.database\.azure\.com') {
  $ExternalDatabase = [switch]$true
  Log "Key Vault holds an external database; deploying in -ExternalDatabase mode."
}
if ($ExternalDatabase) {
  if (-not $conn) { Fail "-ExternalDatabase needs the connection string in Key Vault first: az keyvault secret set --vault-name <vault> --name Db-ConnectionString --value ""Host=...""" }
  if ($conn -match 'postgres\.database\.azure\.com') { Fail "Db-ConnectionString in Key Vault still points at the Azure server; set the external one first." }
  $externalConn = $conn; $pgPassword = ''
  Log "Using the external database from Key Vault ($(($conn -split ';' | Where-Object { $_ -like 'Host=*' }) -replace 'Host=',''))."
}
elseif ($pgPassword) { Log "Reusing the Postgres password from Key Vault." } else { $pgPassword = "Pm9$(New-Secret 24)-Kx"; Log "Generated a new Postgres password." }
if ($signingKey) { Log "Reusing the token signing key from Key Vault." } else { $signingKey = "$(New-Secret 48)$(New-Secret 16)"; Log "Generated a new token signing key." }

function Deploy([bool]$withApi, [string]$imageTag) {
  az deployment group create `
    --resource-group $rg `
    --name pm-qa `
    --template-file infra/main.bicep `
    --parameters environmentName=qa `
    --parameters location=$location `
    --parameters staticWebAppLocation=$swaLocation `
    --parameters namePrefix=pitchmate `
    --parameters postgresAdminLogin=pmadmin `
    --parameters postgresSkuName=Standard_B1ms `
    --parameters useExternalDatabase=$($ExternalDatabase.IsPresent.ToString().ToLower()) `
    --parameters postgresAdminPassword=$pgPassword `
    --parameters authSigningKey=$signingKey `
    --parameters googleClientId=$GoogleClientId `
    --parameters keyVaultAdminObjectId=$meId `
    --parameters apiMinReplicas=0 `
    --parameters deployApi=$($withApi.ToString().ToLower()) `
    --parameters apiImageTag=$imageTag `
    --query properties.outputs -o json 2>&1 | Tee-Object -Variable result | Out-Null
  if ($LASTEXITCODE -ne 0) { $result | Tee-Object -FilePath $log -Append; Fail "az deployment returned exit code $LASTEXITCODE" }
  return ($result -join "`n" | ConvertFrom-Json)
}

if ($MigrationsOnly) {
  if (-not (Test-Path $out)) { Fail "no outputs from a previous run at $out" }
  $o = Get-Content $out -Raw | ConvertFrom-Json
} else {
# ── 2. Everything but the API ──────────────────────────────────────────────
Log "Deploying the platform (Postgres provisioning takes several minutes on a first run)..."
$o = Deploy $false ''
$registry = $o.registryName.value
$loginServer = $o.registryLoginServer.value
Log "Platform ready. Registry: $loginServer"

# ── 3. Build and push the API image ────────────────────────────────────────
$tag = "pitchmate-api:qa-$(git rev-parse --short HEAD)-$((Get-Date).ToString('yyyyMMddHHmm'))"
Log "Building $tag..."
docker build -f backend/Dockerfile -t "$loginServer/$tag" . 2>&1 | Out-File -Append $log
if ($LASTEXITCODE -ne 0) { Fail "docker build failed (see $log)" }
az acr login -n $registry -o none
if ($LASTEXITCODE -ne 0) { Fail "az acr login failed" }
docker push "$loginServer/$tag" 2>&1 | Out-File -Append $log
if ($LASTEXITCODE -ne 0) { Fail "docker push failed (see $log)" }
Log "Pushed $loginServer/$tag"

# ── 4. The API Container App ───────────────────────────────────────────────
Log "Deploying the API Container App..."
$o = Deploy $true $tag
$o | ConvertTo-Json -Depth 5 | Set-Content $out
Log "API: https://$($o.apiDefaultHostname.value)"
Log "Web: https://$($o.staticWebAppHostname.value)"
}

# ── 5. Migrations ──────────────────────────────────────────────────────────
if (-not $SkipMigrations -and $ExternalDatabase) {
  # Nothing to open: the external database authenticates by password from anywhere.
  Log "Applying migrations to the external database..."
  Push-Location backend
  dotnet tool restore | Out-Null
  dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --connection $externalConn 2>&1 | Out-File -Append $log
  $migrateExit = $LASTEXITCODE
  Pop-Location
  if ($migrateExit -ne 0) { Fail "migrations failed (see $log)" }
  Log "Migrations applied."
}
elseif (-not $SkipMigrations) {
  $pgServer = $o.postgresServerName.value
  $ip = (Invoke-RestMethod https://api.ipify.org).Trim()
  $rule = "deploy-qa-$((Get-Date).ToString('yyyyMMddHHmmss'))"
  Log "Opening the Postgres firewall to $ip for migrations..."
  az postgres flexible-server firewall-rule create -g $rg --server-name $pgServer --name $rule --start-ip-address $ip --end-ip-address $ip -o none
  if ($LASTEXITCODE -ne 0) { Fail "couldn't create the firewall rule" }
  try {
    # A new firewall rule takes a little while to apply; wait until the port answers.
    for ($i = 0; $i -lt 24; $i++) {
      if (Test-NetConnection $o.postgresFqdn.value -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue) { break }
      Start-Sleep -Seconds 5
    }
    $conn = "Host=$($o.postgresFqdn.value);Database=pitchmate;Username=pmadmin;Password=$pgPassword;SslMode=Require;Trust Server Certificate=true"
    Push-Location backend
    dotnet tool restore | Out-Null
    dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --connection $conn 2>&1 | Out-File -Append $log
    $migrateExit = $LASTEXITCODE
    Pop-Location
    if ($migrateExit -ne 0) { Fail "migrations failed (see $log)" }
    Log "Migrations applied."
  }
  finally {
    az postgres flexible-server firewall-rule delete -g $rg --server-name $pgServer --name $rule --yes -o none
    Log "Firewall rule removed."
  }
}

Log "DONE"
