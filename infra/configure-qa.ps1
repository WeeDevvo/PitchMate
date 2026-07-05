# Connects GitHub Actions to Azure via OIDC federation and sets the QA pipeline
# secrets/variables. Reads deployment outputs from $env:TEMP\pm-deploy-qa.out.json.
# Logs to $env:TEMP\pm-configure-qa.log. Secrets are piped straight into GitHub.
$ErrorActionPreference = 'Stop'
$log = "$env:TEMP\pm-configure-qa.log"
function Log($m) { "$((Get-Date).ToString('HH:mm:ss'))  $m" | Tee-Object -FilePath $log -Append }

# ── Known identifiers ───────────────────────────────────────────────────────
$subId    = '3bce1ec2-a6e2-4747-9e4a-159ae9653806'
$tenantId = 'eaa3c798-a706-475b-8d46-d55d0f5bccc7'
$repo     = 'WeeDevvo/PitchMate'
$reviewer = 71254518            # GitHub user id (production approval gate)
$rg       = 'rg-pitchmate-qa'
$appName  = 'pitchmate-github-oidc'

try {
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  az config set core.only_show_errors=true 2>$null | Out-Null

  # ── Read deployment outputs ────────────────────────────────────────────────
  $o = Get-Content "$env:TEMP\pm-deploy-qa.out.json" -Raw | ConvertFrom-Json
  $apiApp = $o.apiAppName.value
  $swaApp = $o.staticWebAppName.value
  $kvName = $o.keyVaultName.value
  Log "Outputs: api=$apiApp swa=$swaApp kv=$kvName"

  # ── Entra app registration + service principal (idempotent) ────────────────
  $appId = az ad app list --display-name $appName --query "[0].appId" -o tsv
  if (-not $appId) {
    Log "Creating Entra app registration '$appName'..."
    $appId = az ad app create --display-name $appName --query appId -o tsv
  } else { Log "Reusing existing app registration ($appId)." }

  $spId = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
  if (-not $spId) {
    az ad sp create --id $appId | Out-Null
    $spId = az ad sp show --id $appId --query id -o tsv
  }
  Log "App id=$appId  SP object id=$spId"

  # ── Grant the SP Contributor on the QA resource group ──────────────────────
  Log "Assigning Contributor on $rg..."
  az role assignment create --assignee-object-id $spId --assignee-principal-type ServicePrincipal `
    --role Contributor --scope "/subscriptions/$subId/resourceGroups/$rg" 2>$null | Out-Null

  # ── Federated credentials for the qa and production environments ───────────
  foreach ($envName in 'qa','production') {
    $fname = "github-$envName"
    $exists = az ad app federated-credential list --id $appId --query "[?name=='$fname'] | [0].name" -o tsv
    if (-not $exists) {
      Log "Creating federated credential $fname..."
      $fc = @{
        name      = $fname
        issuer    = 'https://token.actions.githubusercontent.com'
        subject   = "repo:${repo}:environment:$envName"
        audiences = @('api://AzureADTokenExchange')
      } | ConvertTo-Json -Compress
      $tmp = "$env:TEMP\fc-$envName.json"; $fc | Set-Content $tmp
      az ad app federated-credential create --id $appId --parameters "@$tmp" | Out-Null
      Remove-Item $tmp -ErrorAction SilentlyContinue
    } else { Log "Federated credential $fname already exists." }
  }

  # ── Read the DB connection string from Key Vault ───────────────────────────
  $dbConn = az keyvault secret show --vault-name $kvName --name Db-ConnectionString --query value -o tsv

  # ── Static Web Apps deployment token ───────────────────────────────────────
  $swaToken = az staticwebapp secrets list -n $swaApp -g $rg --query "properties.apiKey" -o tsv

  # ── GitHub environments ────────────────────────────────────────────────────
  Log "Creating GitHub environment 'qa'..."
  gh api --method PUT "repos/$repo/environments/qa" --silent

  Log "Creating GitHub environment 'production' with approval gate..."
  $prod = @{ reviewers = @(@{ type = 'User'; id = $reviewer }); deployment_branch_policy = $null } | ConvertTo-Json -Depth 5
  $ptmp = "$env:TEMP\prod-env.json"; $prod | Set-Content $ptmp
  gh api --method PUT "repos/$repo/environments/production" --input $ptmp --silent
  Remove-Item $ptmp -ErrorAction SilentlyContinue

  # ── QA secrets + variable ──────────────────────────────────────────────────
  Log "Setting QA secrets..."
  gh secret set AZURE_CLIENT_ID       --env qa --repo $repo --body $appId
  gh secret set AZURE_TENANT_ID       --env qa --repo $repo --body $tenantId
  gh secret set AZURE_SUBSCRIPTION_ID --env qa --repo $repo --body $subId
  gh secret set DB_CONNECTION_STRING  --env qa --repo $repo --body $dbConn
  gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --env qa --repo $repo --body $swaToken
  gh variable set AZURE_WEBAPP_NAME_QA --repo $repo --body $apiApp

  Log "DONE"
}
catch {
  Log ("FAILED: " + $_.Exception.Message)
}
