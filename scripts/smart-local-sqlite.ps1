param([string]$Workbook)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$StateRoot = Join-Path $Root '.launcher'
$BackupRoot = Join-Path $StateRoot 'backups'
$StatePath = Join-Path $StateRoot 'database-state.json'
$SqlitePath = Join-Path $Root 'data\generated\horse-registry.sqlite'
New-Item -ItemType Directory -Force -Path $StateRoot,$BackupRoot,(Split-Path -Parent $SqlitePath) | Out-Null

function Find-Workbook([string]$Explicit) {
  if ($Explicit -and (Test-Path -LiteralPath $Explicit -PathType Leaf)) { return (Resolve-Path -LiteralPath $Explicit).Path }
  $preferred = Join-Path $Root 'horse-allll.xlsx'
  if (Test-Path -LiteralPath $preferred -PathType Leaf) { return $preferred }
  $xlsx = @(Get-ChildItem -LiteralPath $Root -File -Filter '*.xlsx' -ErrorAction SilentlyContinue | Sort-Object Length -Descending)
  if ($xlsx.Count -gt 0) { return $xlsx[0].FullName }
  return $null
}

function Ensure-PythonRequirements {
  python -c "import openpyxl" 2>$null
  if ($LASTEXITCODE -eq 0) { return }
  Write-Host "Installing Python XLSX dependency..." -ForegroundColor Cyan
  python -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw "Could not install Python requirements." }
}

function Verify-Sqlite([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $text = python tools/verify_sqlite.py $Path | Out-String
  if ($LASTEXITCODE -ne 0) { return $null }
  try { return $text | ConvertFrom-Json } catch { return $null }
}

function Is-Healthy($Verification) {
  if ($null -eq $Verification) { return $false }
  $horses = [int64]$Verification.counts.horses
  $source = [int64]$Verification.counts.horse_search_source
  $fts = [int64]$Verification.counts.horse_search_fts
  $tri = [int64]$Verification.counts.horse_search_trigram
  return ($horses -ge 50000 -and $source -ge $horses -and $fts -ge $horses -and $tri -ge $horses)
}

Write-Host "Horse Registry local SQLite preflight" -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Python 3 is required for SQLite verification and analytics maintenance." }
Write-Host "Local database: $SqlitePath" -ForegroundColor DarkGray
Write-Host "Cloudflare/Wrangler: skipped for local startup" -ForegroundColor Green

$verification = Verify-Sqlite $SqlitePath
$action = 'reuse-existing-sqlite'
$workbookPath = Find-Workbook $Workbook

if (-not (Is-Healthy $verification)) {
  if (-not $workbookPath) {
    throw "Local SQLite is missing or invalid and no XLSX workbook was found in the project root. Put horse-allll.xlsx beside package.json and relaunch."
  }
  Ensure-PythonRequirements

  if (Test-Path -LiteralPath $SqlitePath) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $BackupRoot "horse-registry-before-sqlite-regenerate-$stamp.sqlite"
    Copy-Item -LiteralPath $SqlitePath -Destination $backup -Force
    Write-Host "Existing SQLite was not healthy; backup created: $backup" -ForegroundColor Yellow
  }

  Write-Host "Generating local SQLite directly from workbook..." -ForegroundColor Cyan
  python tools/import_xlsx.py $workbookPath --sqlite $SqlitePath
  if ($LASTEXITCODE -ne 0) { throw "XLSX -> SQLite generation failed." }
  $verification = Verify-Sqlite $SqlitePath
  if (-not (Is-Healthy $verification)) { throw "Generated SQLite failed registry/search verification." }
  $action = 'generated-sqlite-from-workbook'
}

Write-Host "Ensuring current database schema migrations..." -ForegroundColor Cyan
python tools/ensure_schema.py $SqlitePath | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Could not apply local SQLite schema migrations." }

Write-Host "Checking derived registry analytics snapshot..." -ForegroundColor Cyan
$analyticsText = python tools/build_analytics_snapshot.py $SqlitePath --if-stale | Out-String
if ($LASTEXITCODE -ne 0) { throw "Registry analytics snapshot build failed." }
try { $analyticsState = $analyticsText | ConvertFrom-Json } catch { throw "Registry analytics builder returned invalid JSON." }
Write-Host "Analytics snapshot: $($analyticsState.action); source=$($analyticsState.sourceRevision)" -ForegroundColor Green

# Re-verify after migrations/analytics maintenance so launcher state reflects final DB integrity.
$verification = Verify-Sqlite $SqlitePath
if (-not (Is-Healthy $verification)) { throw "SQLite became unhealthy after schema/analytics maintenance." }

$state = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  backend = 'sqlite'
  sqlite = $SqlitePath
  workbook = $workbookPath
  action = $action
  local = [ordered]@{
    clientHorses = [int64]$verification.counts.horses
    searchSource = [int64]$verification.counts.horse_search_source
    searchFts = [int64]$verification.counts.horse_search_fts
    searchTrigram = [int64]$verification.counts.horse_search_trigram
  }
  analytics = [ordered]@{
    action = [string]$analyticsState.action
    sourceRevision = [string]$analyticsState.sourceRevision
    generatedAt = [string]$analyticsState.generatedAt
  }
}
$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding UTF8
Write-Host "Local SQLite ready: $($state.local.clientHorses) horses; search=$($state.local.searchSource)" -ForegroundColor Green
