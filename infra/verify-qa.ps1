$ErrorActionPreference = 'SilentlyContinue'
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
az config set core.only_show_errors=true 2>$null | Out-Null
$f = "$env:TEMP\pm-verify.txt"
"=== Deployment state ===" | Set-Content $f
(az deployment group show -g rg-pitchmate-qa -n pm-qa --query "properties.provisioningState" -o tsv) | Add-Content $f
"=== Resources in rg-pitchmate-qa ===" | Add-Content $f
(az resource list -g rg-pitchmate-qa --query "[].{name:name,type:type}" -o tsv) | Add-Content $f
"=== Deployment outputs file ===" | Add-Content $f
if (Test-Path "$env:TEMP\pm-deploy-qa.out.json") { Get-Content "$env:TEMP\pm-deploy-qa.out.json" -Raw | Add-Content $f } else { "OUT FILE MISSING" | Add-Content $f }
