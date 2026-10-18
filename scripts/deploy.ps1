param(
    [string]$Project = 'veonav',
    [string]$Region = 'asia-south1',
    [string]$Service = 'aeronav',
    [switch]$Live
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$gcloud = (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'AeroNavTools\windows-sdk\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path $gcloud)) { throw 'Install the Google Cloud CLI and run gcloud auth login first.' }
function Invoke-Cloud {
    & $gcloud @args
    if ($LASTEXITCODE -ne 0) { throw "Google Cloud command failed: $($args[0]) $($args[1])" }
}
Invoke-Cloud projects describe $Project '--format=value(projectId)'
Invoke-Cloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com "--project=$Project" --quiet
$buildAccount = "${Service}-build@${Project}.iam.gserviceaccount.com"
$runtimeAccount = "${Service}-runtime@${Project}.iam.gserviceaccount.com"
foreach ($account in @("${Service}-build", "${Service}-runtime")) {
    $email = "${account}@${Project}.iam.gserviceaccount.com"
    $existing = & $gcloud iam service-accounts list "--project=$Project" "--filter=email:$email" '--format=value(email)'
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect deployment service accounts.' }
    if (-not $existing) { Invoke-Cloud iam service-accounts create $account "--project=$Project" --quiet }
}
Invoke-Cloud projects add-iam-policy-binding $Project "--member=serviceAccount:$buildAccount" --role=roles/run.builder --condition=None --quiet '--format=none'
$liveFlags = @()
if ($Live) {
    $audience = & $gcloud run services describe $Service "--project=$Project" "--region=$Region" '--format=value(status.url)'
    if ($LASTEXITCODE -ne 0 -or -not $audience) { throw 'Deploy the base service and run provision-live.ps1 first.' }
    $liveFlags = @("--update-env-vars=LIVE_INTEGRATIONS=true,GOOGLE_CLOUD_PROJECT=$Project,SCENE_BUCKET=$Project-aeronav-scenes,SCENE_TOPIC=aeronav-scenes,SPATIAL_DATASET=aeronav_spatial,BQ_LOCATION=$Region,GEMINI_MODEL=gemini-2.5-flash-lite,EARTH_ENGINE_ENABLED=true,PUSH_AUDIENCE=$audience,PUSH_SERVICE_ACCOUNT=aeronav-push@$Project.iam.gserviceaccount.com", '--update-secrets=MAPS_SERVER_KEY=aeronav-server:latest,MAPS_BROWSER_KEY=aeronav-browser:latest,ROUTE_SIGNING_SECRET=aeronav-signing:latest')
}
Invoke-Cloud run deploy $Service --source=. "--project=$Project" "--region=$Region" "--build-service-account=projects/$Project/serviceAccounts/$buildAccount" "--service-account=$runtimeAccount" --allow-unauthenticated --min-instances=0 --max-instances=1 --memory=512Mi --cpu=1 --concurrency=40 --timeout=3600 --port=8080 --quiet @liveFlags
$url = & $gcloud run services describe $Service "--project=$Project" "--region=$Region" '--format=value(status.url)'
if ($LASTEXITCODE -ne 0 -or -not $url) { throw 'Could not resolve the deployed service URL.' }
$health = Invoke-RestMethod "$url/api/health"
if ($health.status -ne 'ok') { throw 'Deployment health check failed.' }
Write-Host "Verified public prototype: $url"
