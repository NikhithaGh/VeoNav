param([string]$Project = 'veonav', [string]$Region = 'asia-south1')
$ErrorActionPreference = 'Stop'
$g = Join-Path $env:LOCALAPPDATA 'AeroNavTools\windows-sdk\google-cloud-sdk\bin\gcloud.cmd'
if (-not (Test-Path $g)) { $g = (Get-Command gcloud.cmd).Source }
function Cloud { & $g @args; if ($LASTEXITCODE -ne 0) { throw "Cloud command failed: $($args[0]) $($args[1])" } }
Cloud services enable routes.googleapis.com places.googleapis.com maps-backend.googleapis.com aiplatform.googleapis.com bigquery.googleapis.com pubsub.googleapis.com storage.googleapis.com earthengine.googleapis.com secretmanager.googleapis.com apikeys.googleapis.com "--project=$Project" --quiet
$runtime = "aeronav-runtime@$Project.iam.gserviceaccount.com"
$push = "aeronav-push@$Project.iam.gserviceaccount.com"
$number = Cloud projects describe $Project '--format=value(projectNumber)'
$bucket = "$Project-aeronav-scenes"
$accountExists = Cloud iam service-accounts list "--project=$Project" "--filter=email:$push" '--format=value(email)'
if (-not $accountExists) { Cloud iam service-accounts create aeronav-push "--project=$Project" --quiet }
$existingBuckets = Cloud storage buckets list "--project=$Project" '--format=value(name)'
if ($existingBuckets -notcontains $bucket) { Cloud storage buckets create "gs://$bucket" "--project=$Project" "--location=$Region" --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0 --quiet }
Cloud storage buckets add-iam-policy-binding "gs://$bucket" "--member=serviceAccount:$runtime" --role=roles/storage.objectUser '--format=none'
$token = Cloud auth print-access-token
$headers = @{ Authorization = "Bearer $token" }
function Rest($method, $url, $body) {
    $params = @{ Method=$method; Uri=$url; Headers=$headers; ContentType='application/json' }
    if ($null -ne $body) { $params.Body = ($body | ConvertTo-Json -Depth 30 -Compress) }
    Invoke-RestMethod @params
}
Rest PATCH "https://storage.googleapis.com/storage/v1/b/$bucket" @{lifecycle=@{rule=@(@{action=@{type='Delete'};condition=@{age=1}})}} | Out-Null
$datasets = Rest GET "https://bigquery.googleapis.com/bigquery/v2/projects/$Project/datasets" $null
if (-not ($datasets.datasets | Where-Object { $_.datasetReference.datasetId -eq 'aeronav_spatial' })) {
    Rest POST "https://bigquery.googleapis.com/bigquery/v2/projects/$Project/datasets" @{datasetReference=@{projectId=$Project;datasetId='aeronav_spatial'};location=$Region;defaultPartitionExpirationMs='86400000'} | Out-Null
}
$dataset = Rest GET "https://bigquery.googleapis.com/bigquery/v2/projects/$Project/datasets/aeronav_spatial" $null
$access = @($dataset.access | Where-Object { $_.userByEmail -ne $runtime }) + @(@{role='WRITER';userByEmail=$runtime})
Rest PATCH "https://bigquery.googleapis.com/bigquery/v2/projects/$Project/datasets/aeronav_spatial" @{access=$access} | Out-Null
$tables = Rest GET "https://bigquery.googleapis.com/bigquery/v2/projects/$Project/datasets/aeronav_spatial/tables" $null
if (-not ($tables.tables | Where-Object { $_.tableReference.tableId -eq 'geofences' })) {
    Rest POST "https://bigquery.googleapis.com/bigquery/v2/projects/$Project/datasets/aeronav_spatial/tables" @{tableReference=@{projectId=$Project;datasetId='aeronav_spatial';tableId='geofences'};schema=@{fields=@(@{name='scene_id';type='STRING'},@{name='route_id';type='STRING'},@{name='location';type='GEOGRAPHY'},@{name='expires_at';type='TIMESTAMP'},@{name='created_at';type='TIMESTAMP'})};timePartitioning=@{type='DAY';field='created_at';expirationMs='86400000'}} | Out-Null
}
foreach ($role in @('roles/bigquery.jobUser','roles/aiplatform.user','roles/earthengine.viewer','roles/serviceusage.serviceUsageConsumer')) { Cloud projects add-iam-policy-binding $Project "--member=serviceAccount:$runtime" "--role=$role" --condition=None --quiet '--format=none' }
$topics = Cloud pubsub topics list "--project=$Project" '--format=value(name)'
if ($topics -notcontains "projects/$Project/topics/aeronav-scenes") { Cloud pubsub topics create aeronav-scenes "--project=$Project" --quiet }
Cloud pubsub topics add-iam-policy-binding aeronav-scenes "--project=$Project" "--member=serviceAccount:$runtime" --role=roles/pubsub.publisher '--format=none'
Cloud iam service-accounts add-iam-policy-binding $push "--project=$Project" "--member=serviceAccount:service-$number@gcp-sa-pubsub.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator '--format=none'
$url = Cloud run services describe aeronav "--project=$Project" "--region=$Region" '--format=value(status.url)'
$subs = Cloud pubsub subscriptions list "--project=$Project" '--format=value(name)'
if ($subs -notcontains "projects/$Project/subscriptions/aeronav-scene-worker") { Cloud pubsub subscriptions create aeronav-scene-worker --topic=aeronav-scenes "--project=$Project" "--push-endpoint=$url/internal/scene-worker" "--push-auth-service-account=$push" "--push-auth-token-audience=$url" --ack-deadline=120 --message-retention-duration=1h --min-retry-delay=30s --max-retry-delay=300s --quiet }
$keys = Cloud services api-keys list "--project=$Project" --format=json | ConvertFrom-Json
foreach ($name in @('aeronav-server','aeronav-browser')) {
    $found = $keys | Where-Object { $_.displayName -eq $name } | Select-Object -First 1
    if (-not $found) {
        $arguments = @('services','api-keys','create',"--project=$Project","--display-name=$name","--key-id=$name",'--quiet','--verbosity=error','--format=value(name)')
        if ($name -eq 'aeronav-server') { $arguments += @('--api-target=service=routes.googleapis.com','--api-target=service=places.googleapis.com') }
        else { $arguments += @('--api-target=service=maps-backend.googleapis.com',"--allowed-referrers=https://aeronav-$number.$Region.run.app/*,$url/*,http://localhost:8080/*,http://localhost:5173/*") }
        $created = Cloud @arguments
    }
}
$keys = Cloud services api-keys list "--project=$Project" --format=json | ConvertFrom-Json
$secrets = Cloud secrets list "--project=$Project" '--format=value(name)'
foreach ($name in @('aeronav-server','aeronav-browser','aeronav-signing')) {
    if ($secrets -notcontains $name) {
        Cloud secrets create $name "--project=$Project" --replication-policy=automatic --quiet '--format=none'
        if ($name -eq 'aeronav-signing') {
            $bytes = New-Object byte[] 48
            $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
            $value = [Convert]::ToBase64String($bytes)
        } else {
            $keyName = ($keys | Where-Object { $_.displayName -eq $name } | Select-Object -First 1).name
            $value = Cloud services api-keys get-key-string $keyName "--project=$Project" '--format=value(keyString)'
        }
        $value | & $g secrets versions add $name "--project=$Project" --data-file=- --quiet '--format=none'
        if ($LASTEXITCODE -ne 0) { throw 'Secret version creation failed.' }
        $value = $null
    }
    Cloud secrets add-iam-policy-binding $name "--project=$Project" "--member=serviceAccount:$runtime" --role=roles/secretmanager.secretAccessor '--format=none'
}
Write-Host "Provisioned private scenes, spatial dataset, authenticated queue, restricted API keys, and runtime grants for $Project."
