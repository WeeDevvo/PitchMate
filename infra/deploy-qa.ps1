# Provisions the PitchMate QA stack. Run from the repo root after `az login`.
# Logs progress to $env:TEMP\pm-deploy-qa.log and writes deployment outputs
# (non-secret) to $env:TEMP\pm-deploy-qa.out.json, which configure-qa.ps1 reads.
#
# The Postgres admin password and the API's token signing key are generated
# here, passed to the deployment and NOT persisted: both live in Key Vault
# afterwards. Re-running is safe for the infrastructure, but it generates new
# secrets, so it changes the database password and signs every user out.
#
# Parameters are passed INLINE (not via the .bicepparam file), because Azure CLI
# does not allow combining a .bicepparam file with additional --parameters.
param(
  # App Service plan SKU. B1 is the cheapest dedicated tier (Always On + health-check ping).
  [string]$AppServicePlanSku = 'B1',
  # Google OAuth client id. The web's Google flow isn't wired yet, so a placeholder boots the API.
  [string]$GoogleClientId = 'qa-placeholder.apps.googleusercontent.com'
)

$log = "$env:TEMP\pm-deploy-qa.log"
$out = "$env:TEMP\pm-deploy-qa.out.json"
function Log($m) { "$((Get-Date).ToString('HH:mm:ss'))  $m" | Tee-Object -FilePath $log -Append }

Remove-Item $log,$out -ErrorAction SilentlyContinue
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
az config set core.only_show_errors=true 2>$null | Out-Null

$rg       = 'rg-pitchmate-qa'
$location = 'uksouth'
# Static Web Apps isn't offered in uksouth, and westeurope refuses new customers
# ("region is currently not accepting new customers"). The SWA region only places
# its control plane; content is served from the global edge either way.

# 0) Who is deploying. The signed-in user keeps break-glass Key Vault access.
$meId = az ad signed-in-user show --query id -o tsv
if (-not $meId) { Log "FAILED: not signed in. Run 'az login' first."; return }
Log "Deploying as $(az account show --query user.name -o tsv) to subscription $(az account show --query name -o tsv)."

# 1) Register the resource providers the template needs, and wait for them.
$providers = 'Microsoft.Web','Microsoft.DBforPostgreSQL','Microsoft.KeyVault','Microsoft.Insights','Microsoft.OperationalInsights'
foreach ($p in $providers) { az provider register --namespace $p 2>$null | Out-Null }
Log "Checking resource providers..."
for ($i = 0; $i -lt 60; $i++) {
  $states = az provider list --query "[?contains(['Microsoft.Web','Microsoft.DBforPostgreSQL','Microsoft.KeyVault','Microsoft.Insights','Microsoft.OperationalInsights'], namespace)].{ns:namespace,state:registrationState}" -o json | ConvertFrom-Json
  $notReady = $states | Where-Object { $_.state -ne 'Registered' }
  if (-not $notReady) { Log "All providers registered."; break }
  Log ("Still registering: " + (($notReady | ForEach-Object { $_.ns }) -join ', '))
  Start-Sleep -Seconds 10
}

# 2) The resource group (idempotent).
az group create -n $rg -l $location -o none

# 3) Generate the secrets (alphanumeric plus guaranteed categories, connection-string safe).
function New-Secret([int]$length) { -join ((48..57)+(65..90)+(97..122) | Get-Random -Count $length | ForEach-Object {[char]$_}) }
$pgPassword = "Pm9$(New-Secret 24)-Kx"   # upper, lower, digit and '-' guaranteed
$signingKey = "$(New-Secret 48)$(New-Secret 16)"   # 64 chars, well over the 32-byte minimum

# 4) Deploy the Bicep template with INLINE parameters.
Log "Starting Bicep deployment on $AppServicePlanSku (Postgres provisioning takes several minutes)..."
az deployment group create `
  --resource-group $rg `
  --name pm-qa `
  --template-file infra/main.bicep `
  --parameters environmentName=qa `
  --parameters location=$location `
  --parameters namePrefix=pitchmate `
  --parameters postgresAdminLogin=pmadmin `
  --parameters appServicePlanSku=$AppServicePlanSku `
  --parameters postgresSkuName=Standard_B1ms `
  --parameters staticWebAppLocation=eastus2 `
  --parameters postgresAdminPassword=$pgPassword `
  --parameters authSigningKey=$signingKey `
  --parameters googleClientId=$GoogleClientId `
  --parameters keyVaultAdminObjectId=$meId `
  --only-show-errors 2>&1 | Tee-Object -FilePath $log -Append

if ($LASTEXITCODE -ne 0) { Log "FAILED: az deployment returned exit code $LASTEXITCODE"; return }

Log "Deployment succeeded. Fetching outputs..."
az deployment group show -g $rg -n pm-qa --query properties.outputs -o json 2>&1 | Set-Content $out
Log "DONE"
