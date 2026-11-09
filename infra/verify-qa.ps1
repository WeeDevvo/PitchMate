# Writes the QA deployment state, resource list and a health check to
# $env:TEMP\pm-verify.txt (and the console).
$ErrorActionPreference = 'SilentlyContinue'
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
az config set core.only_show_errors=true 2>$null | Out-Null
$f = "$env:TEMP\pm-verify.txt"
function Out($m) { $m | Tee-Object -FilePath $f -Append }
Remove-Item $f -ErrorAction SilentlyContinue

Out "=== Deployment state ==="
Out (az deployment group show -g rg-pitchmate-qa -n pm-qa --query "properties.provisioningState" -o tsv)
Out "=== Resources in rg-pitchmate-qa ==="
Out ((az resource list -g rg-pitchmate-qa --query "[].{name:name,type:type}" -o tsv) -join "`n")

$outFile = "$env:TEMP\pm-deploy-qa.out.json"
if (-not (Test-Path $outFile)) { Out "OUT FILE MISSING: run deploy-qa.ps1 first."; return }
$o = Get-Content $outFile -Raw | ConvertFrom-Json
$api = $o.apiAppName.value

Out "=== API revision ==="
Out ((az containerapp revision list -n $api -g rg-pitchmate-qa --query "[].{name:name,active:properties.active,health:properties.healthState,running:properties.runningState,image:properties.template.containers[0].image}" -o tsv) -join "`n")

Out "=== Health (a scaled-to-zero app takes a few seconds to wake) ==="
$health = "https://$($o.apiDefaultHostname.value)/health"
try { Out ("$health -> " + (Invoke-WebRequest $health -UseBasicParsing -TimeoutSec 90).Content) }
catch { Out "$health -> FAILED: $($_.Exception.Message)" }

Out "=== Web ==="
$web = "https://$($o.staticWebAppHostname.value)"
try { Out ("$web -> HTTP " + (Invoke-WebRequest $web -UseBasicParsing -TimeoutSec 30).StatusCode) }
catch { Out "$web -> $($_.Exception.Message) (expected until the first web deploy)" }
