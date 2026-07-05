# Provisions the PitchMate QA stack. Logs progress to $env:TEMP\pm-deploy-qa.log
# and writes deployment outputs (non-secret) to $env:TEMP\pm-deploy-qa.out.json.
# The Postgres admin password is generated here, passed to the deployment, and
# NOT persisted — the DB connection string lives in Key Vault afterwards.
#
# Parameters are passed INLINE (not via the .bicepparam file), because Azure CLI
# does not allow combining a .bicepparam file with additional --parameters.
$log = "$env:TEMP\pm-deploy-qa.log"
$out = "$env:TEMP\pm-deploy-qa.out.json"
function Log($m) { "$((Get-Date).ToString('HH:mm:ss'))  $m" | Tee-Object -FilePath $log -Append }

Remove-Item $log,$out -ErrorAction SilentlyContinue
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
az config set core.only_show_errors=true 2>$null | Out-Null

$meId = '82caded0-fdd9-44ef-841c-1bec3ec1b791'  # signed-in user object id (Key Vault admin)
$rg   = 'rg-pitchmate-qa'

# 1) Wait for the required resource providers to finish registering.
Log "Checking resource providers..."
for ($i = 0; $i -lt 60; $i++) {
  $states = az provider list --query "[?contains(['Microsoft.Web','Microsoft.DBforPostgreSQL','Microsoft.KeyVault','Microsoft.Insights','Microsoft.OperationalInsights'], namespace)].{ns:namespace,state:registrationState}" -o json | ConvertFrom-Json
  $notReady = $states | Where-Object { $_.state -ne 'Registered' }
  if (-not $notReady) { Log "All providers registered."; break }
  Log ("Still registering: " + (($notReady | ForEach-Object { $_.ns }) -join ', '))
  Start-Sleep -Seconds 10
}

# 2) Generate a strong Postgres admin password (guaranteed categories, connection-string safe).
$alnum = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})
$pgPassword = "Pm9$alnum-Kx"   # upper, lower, digit, and '-' guaranteed

# 3) Deploy the Bicep template with INLINE parameters.
Log "Starting Bicep deployment (Postgres provisioning takes several minutes)..."
az deployment group create `
  --resource-group $rg `
  --name pm-qa `
  --template-file infra/main.bicep `
  --parameters environmentName=qa `
  --parameters location=uksouth `
  --parameters namePrefix=pitchmate `
  --parameters postgresAdminLogin=pmadmin `
  --parameters appServicePlanSku=F1 `
  --parameters postgresSkuName=Standard_B1ms `
  --parameters staticWebAppLocation=eastus2 `
  --parameters postgresAdminPassword=$pgPassword `
  --parameters keyVaultAdminObjectId=$meId `
  --only-show-errors 2>&1 | Tee-Object -FilePath $log -Append

if ($LASTEXITCODE -ne 0) { Log "FAILED: az deployment returned exit code $LASTEXITCODE"; return }

Log "Deployment succeeded. Fetching outputs..."
az deployment group show -g $rg -n pm-qa --query properties.outputs -o json 2>&1 | Set-Content $out
Log "DONE"
