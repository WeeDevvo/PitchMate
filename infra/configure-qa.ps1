# Connects GitHub Actions to Azure via OIDC federation and sets the QA pipeline
# secrets/variables. Reads deployment outputs from $env:TEMP\pm-deploy-qa.out.json.
# Logs to $env:TEMP\pm-configure-qa.log. Secrets are piped straight into GitHub.
$ErrorActionPreference = 'Stop'
$log = "$env:TEMP\pm-configure-qa.log"
function Log($m) { "$((Get-Date).ToString('HH:mm:ss'))  $m" | Tee-Object -FilePath $log -Append }

$rg       = 'rg-pitchmate-qa'
$appName  = 'pitchmate-github-oidc'

try {
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  az config set core.only_show_errors=true 2>$null | Out-Null

  # ── Identifiers, from the signed-in az and gh sessions ─────────────────────
  $subId    = az account show --query id -o tsv
  $tenantId = az account show --query tenantId -o tsv
  $repo     = gh repo view --json nameWithOwner -q .nameWithOwner
  $reviewer = gh api user -q .id    # the signed-in GitHub user approves production deploys
  if (-not $subId -or -not $repo -or -not $reviewer) { throw "Sign in with 'az login' and 'gh auth login' first." }
  Log "Subscription $subId, repo $repo, production reviewer id $reviewer"

  # ── Read deployment outputs ────────────────────────────────────────────────
  $o = Get-Content "$env:TEMP\pm-deploy-qa.out.json" -Raw | ConvertFrom-Json
  $apiApp = $o.apiAppName.value
  $apiHost = $o.apiDefaultHostname.value
  $swaApp = $o.staticWebAppName.value
  $kvName = $o.keyVaultName.value
  $pgServer = $o.postgresServerName.value
  $registry = $o.registryName.value
  if (-not $apiApp) { throw "No API in the deployment outputs; run deploy-qa.ps1 to completion first." }
  Log "Outputs: api=$apiApp swa=$swaApp kv=$kvName pg=$pgServer acr=$registry"

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

  # ── And AcrPush on the registry, so CD can push the API image ──────────────
  Log "Assigning AcrPush on $registry..."
  az role assignment create --assignee-object-id $spId --assignee-principal-type ServicePrincipal `
    --role AcrPush --scope "/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.ContainerRegistry/registries/$registry" 2>$null | Out-Null

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
  # cd-qa.yml pushes the image to this registry and rolls this Container App onto it.
  gh variable set AZURE_CONTAINERAPP_NAME_QA --repo $repo --body $apiApp
  gh variable set AZURE_ACR_NAME_QA --repo $repo --body $registry
  # Baked into the web build as VITE_API_BASE_URL (cd-qa.yml), since the web app and API are cross-origin.
  gh variable set API_BASE_URL_QA --repo $repo --body "https://$apiHost"
  gh variable set AZURE_RESOURCE_GROUP_QA --repo $repo --body $rg
  # cd-qa.yml opens an Azure Postgres firewall to its runner for the migration step, then
  # closes it. With an external database (Supabase) there's no server, so the variable goes.
  if ($pgServer) { gh variable set AZURE_PG_SERVER_QA --repo $repo --body $pgServer }
  else { gh variable delete AZURE_PG_SERVER_QA --repo $repo 2>$null; Log "External database: no AZURE_PG_SERVER_QA." }

  Log "DONE"
}
catch {
  Log ("FAILED: " + $_.Exception.Message)
}
