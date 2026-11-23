param(
  [switch]$ImportLocalSqlite,
  [switch]$ReplaceRemoteRegistry,
  [string]$Sqlite = "data/generated/horse-registry.sqlite"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# R95: every supported entrypoint requires explicit revision approval.
node tools/require-r95-release-approval.mjs
if ($LASTEXITCODE -ne 0) { throw "Exact-revision release approval missing." }
if ($ImportLocalSqlite -or $ReplaceRemoteRegistry) {
  throw "Bulk production replacement is disabled in this release path. Use a separately reviewed, backed-up import procedure."
}

function Get-Wrangler {
  $local = Join-Path $Root 'node_modules\.bin\wrangler.cmd'
  if (Test-Path -LiteralPath $local) { return $local }
  $cmd = Get-Command wrangler.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "Wrangler is required only for Cloudflare deployment. Run npm install first."
}

function Get-RemoteDatabases {
  $wrangler = Get-Wrangler
  $text = (& $wrangler d1 list --json | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Could not list Cloudflare D1 databases. Run npx wrangler login and retry." }
  if ([string]::IsNullOrWhiteSpace($text)) { return @() }
  return @($text | ConvertFrom-Json)
}

function Get-DatabaseId($Db) {
  foreach ($name in @('uuid','id','database_id')) {
    $prop = $Db.PSObject.Properties[$name]
    if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) { return [string]$prop.Value }
  }
  return $null
}

function Ensure-ProductionD1Configured {
  $configPath = Join-Path $Root 'wrangler.jsonc'
  $configText = Get-Content -Raw -LiteralPath $configPath
  if ($configText -notmatch '00000000-0000-0000-0000-000000000000') { return }

  Write-Host "Production D1 is not configured. Resolving/provisioning horse-registry..." -ForegroundColor Cyan
  $dbs = Get-RemoteDatabases
  $db = $dbs | Where-Object { [string]$_.name -eq 'horse-registry' } | Select-Object -First 1
  if ($null -eq $db) {
    $wrangler = Get-Wrangler
    & $wrangler d1 create horse-registry | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare D1 creation failed." }
    $db = (Get-RemoteDatabases | Where-Object { [string]$_.name -eq 'horse-registry' } | Select-Object -First 1)
  }
  if ($null -eq $db) { throw "D1 database horse-registry could not be found after provisioning." }
  $databaseId = Get-DatabaseId $db
  if (-not $databaseId) { throw "Cloudflare returned horse-registry without a usable database ID." }
  ($configText -replace '00000000-0000-0000-0000-000000000000', $databaseId) | Set-Content -LiteralPath $configPath -Encoding UTF8
  Write-Host "Production D1 configured: $databaseId" -ForegroundColor Green
}


function Assert-ProductionConfiguration {
  $configPath = Join-Path $Root 'wrangler.jsonc'
  $configText = Get-Content -Raw -LiteralPath $configPath
  if ($configText -match '"APP_ENV"\s*:\s*"development"') { throw "Production deployment refused: APP_ENV is development." }
  if ($configText -match '00000000-0000-0000-0000-000000000000') { throw "Production deployment refused: D1 database_id is still the placeholder." }
}

function Invoke-RemoteScalarCount([string]$Sql) {
  $wrangler = Get-Wrangler
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("horse-registry-remote-query-" + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    [IO.File]::WriteAllText($tmp, $Sql, (New-Object Text.UTF8Encoding($false)))
    $text = (& $wrangler d1 execute horse-registry --remote "--file=$tmp" --json --yes | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "Remote D1 count query failed." }
    $parsed = $text | ConvertFrom-Json
    $first = @($parsed)[0]
    return [int64](@($first.results)[0].count)
  }
  finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

# Provisioning is a separate reviewed operation, never an implicit release side effect.
Assert-ProductionConfiguration
$wrangler = Get-Wrangler

Write-Host "Verifying project before Cloudflare deployment..." -ForegroundColor Cyan
# R106 read-only authority freshness gate. Never changes Hyperdrive configuration.
npm run verify:hyperdrive:freshness
if ($LASTEXITCODE -ne 0) { throw "Hyperdrive authority freshness verification failed; deployment refused." }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }
npm test
if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
npm run test:review-native
if ($LASTEXITCODE -ne 0) { throw "Native review regression suite failed." }
npm run test:python
if ($LASTEXITCODE -ne 0) { throw "Python regression suite failed." }
$configText = Get-Content -Raw -LiteralPath (Join-Path $Root 'wrangler.jsonc')
if ($configText -match '"DB_PROVIDER_MODE"\s*:\s*"supabase_full"') {
  node tools/verify-r95-primary-schema.mjs
  if ($LASTEXITCODE -ne 0) { throw "Canonical PostgreSQL schema verification failed." }
}
npm run db:pg-parity
if ($LASTEXITCODE -ne 0) { throw "Disposable local PostgreSQL migration parity failed." }
npm run db:pg-execution-parity
if ($LASTEXITCODE -ne 0) { throw "Disposable PostgreSQL production-command parity failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Cloudflare build failed." }

node tools/require-r95-release-approval.mjs
if ($LASTEXITCODE -ne 0) { throw "Checkout changed after approval; deployment refused." }
Write-Host "Applying production D1 migrations..." -ForegroundColor Cyan
& $wrangler d1 migrations apply horse-registry --remote | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Remote migrations failed." }

if ($ImportLocalSqlite) {
  $sqlitePath = Join-Path $Root $Sqlite
  if (-not (Test-Path -LiteralPath $sqlitePath -PathType Leaf)) { throw "Local SQLite not found: $sqlitePath" }

  Write-Host "Ensuring local schema + derived analytics before upload..." -ForegroundColor Cyan
  python tools/ensure_schema.py $sqlitePath | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Local schema migration failed." }
  python tools/build_analytics_snapshot.py $sqlitePath --if-stale | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Local registry analytics snapshot build failed." }

  Write-Host "Verifying local SQLite before upload..." -ForegroundColor Cyan
  $verifyText = python tools/verify_sqlite.py $sqlitePath | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Local SQLite verification failed." }
  $verify = $verifyText | ConvertFrom-Json
  $localCount = [int64]$verify.counts.horses
  if ($localCount -lt 50000) { throw "Local SQLite has only $localCount horses; refusing production upload." }
  if (-not [bool]$verify.runtime_summary_ready) { throw "Local SQLite is missing the registry-runtime hot-path snapshot; refusing a production upload that would fall back to repeated full-registry facet/count scans." }

  $shards = Join-Path $Root 'data\generated\remote-d1-shards'
  if (Test-Path -LiteralPath $shards) { Remove-Item -LiteralPath $shards -Recurse -Force }
  Write-Host "Generating D1 upload shards directly from local SQLite..." -ForegroundColor Cyan
  python tools/export_sqlite_to_d1.py $sqlitePath --out $shards
  if ($LASTEXITCODE -ne 0) { throw "Could not generate D1 shards from local SQLite." }

  $manifestPath = Join-Path $shards 'manifest.json'
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $files = @($manifest.files)
  $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $progressPath = Join-Path $Root 'data\generated\remote-d1-upload-progress.json'
  $progress = $null
  if (Test-Path -LiteralPath $progressPath -PathType Leaf) {
    try { $progress = Get-Content $progressPath -Raw | ConvertFrom-Json } catch { $progress = $null }
  }
  $matchingIncompleteProgress = $null -ne $progress -and [string]$progress.manifest_sha256 -eq $manifestHash -and -not [bool]$progress.complete

  $remoteCount = Invoke-RemoteScalarCount "SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND id > 0;"
  Write-Host "Remote registry before upload: $remoteCount horses" -ForegroundColor DarkGray
  if ($remoteCount -gt 0 -and -not $matchingIncompleteProgress) {
    if (-not $ReplaceRemoteRegistry) {
      throw "Remote D1 already contains $remoteCount horses and there is no matching incomplete upload ledger. Refusing to guess whether this is a resumable import or an existing registry."
    }
    throw "Remote replacement refused: this D1 schema contains FTS5 virtual tables, so whole-database 'wrangler d1 export' is not a supported portable backup path. Follow RECOVERY_RUNBOOK.md and perform a verified restore-capable backup/recovery rehearsal before destructive replacement."
  }

  if ($remoteCount -eq 0 -or -not $matchingIncompleteProgress) {
    $progress = [pscustomobject]@{
      format_version = 1
      manifest_sha256 = $manifestHash
      source_sqlite_sha256 = [string]$manifest.source_sqlite_sha256
      started_at = [DateTime]::UtcNow.ToString('o')
      updated_at = [DateTime]::UtcNow.ToString('o')
      complete = $false
      completed_files = @()
    }
  } else {
    Write-Host "Resuming matching D1 upload ledger with $(@($progress.completed_files).Count) completed shards." -ForegroundColor Yellow
  }

  $completed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($done in @($progress.completed_files)) { [void]$completed.Add([string]$done) }

  $i = 0
  foreach ($name in $files) {
    $i++
    $entry = @($manifest.entries | Where-Object { [string]$_.file -eq [string]$name }) | Select-Object -First 1
    if ($null -ne $entry) {
      $localHash = (Get-FileHash -LiteralPath (Join-Path $shards $name) -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($localHash -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Shard hash mismatch before upload: $name" }
    }
    if ($completed.Contains([string]$name)) {
      Write-Host "Cloudflare D1 upload [$i/$($files.Count)] already complete: $name" -ForegroundColor DarkGray
      continue
    }

    Write-Host "Cloudflare D1 upload [$i/$($files.Count)] $name" -ForegroundColor DarkGray
    & $wrangler d1 execute horse-registry --remote "--file=$(Join-Path $shards $name)" --yes | Out-Null
    if ($LASTEXITCODE -ne 0) {
      $progress.updated_at = [DateTime]::UtcNow.ToString('o')
      $progress.completed_files = @($completed)
      $progress | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $progressPath -Encoding UTF8
      throw "Remote D1 import failed on shard $name. Completed-shard progress was preserved; after the quota/error is resolved, rerun the same import to resume."
    }

    [void]$completed.Add([string]$name)
    $progress.updated_at = [DateTime]::UtcNow.ToString('o')
    $progress.completed_files = @($completed)
    $progress | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $progressPath -Encoding UTF8
  }

  $afterCount = Invoke-RemoteScalarCount "SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND id > 0;"
  if ($afterCount -lt $localCount) { throw "Remote verification failed: $afterCount / $localCount horses present." }
  $progress.complete = $true
  $progress.updated_at = [DateTime]::UtcNow.ToString('o')
  $progress.completed_files = @($completed)
  $progress | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $progressPath -Encoding UTF8
  Write-Host "Remote D1 data verified: $afterCount horses" -ForegroundColor Green
}

node tools/require-r95-release-approval.mjs
if ($LASTEXITCODE -ne 0) { throw "Checkout changed before deployment; release refused." }
Write-Host "Deploying Worker + assets..." -ForegroundColor Cyan
& $wrangler deploy | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Worker deployment failed." }
Write-Host "Cloudflare deployment complete." -ForegroundColor Green
if (-not $ImportLocalSqlite) {
  Write-Host "Application/schema deployed; local SQLite data was not uploaded." -ForegroundColor Yellow
}
