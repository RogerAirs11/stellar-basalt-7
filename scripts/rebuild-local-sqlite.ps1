param([string]$Workbook)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Sqlite = Join-Path $Root 'data\generated\horse-registry.sqlite'
$Backups = Join-Path $Root '.launcher\backups'
New-Item -ItemType Directory -Force -Path $Backups,(Split-Path -Parent $Sqlite) | Out-Null

if (-not $Workbook) {
  $preferred = Join-Path $Root 'horse-allll.xlsx'
  if (Test-Path -LiteralPath $preferred) { $Workbook = $preferred }
}
if (-not $Workbook -or -not (Test-Path -LiteralPath $Workbook -PathType Leaf)) {
  throw "Workbook not found. Put horse-allll.xlsx in the project root or pass -Workbook <path>."
}
if (Test-Path -LiteralPath $Sqlite) {
  $backup = Join-Path $Backups ("horse-registry-before-xlsx-refresh-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sqlite')
  Copy-Item -LiteralPath $Sqlite -Destination $backup -Force
  Write-Host "Existing SQLite backed up: $backup" -ForegroundColor Yellow
}
python -c "import openpyxl" 2>$null
if ($LASTEXITCODE -ne 0) { python -m pip install -r requirements.txt }
if ($LASTEXITCODE -ne 0) { throw "Python requirements are unavailable." }
Write-Host "Rebuilding local SQLite directly from XLSX (no Wrangler)..." -ForegroundColor Cyan
python tools/import_xlsx.py $Workbook --sqlite $Sqlite
if ($LASTEXITCODE -ne 0) { throw "XLSX -> SQLite rebuild failed." }
python tools/ensure_schema.py $Sqlite
if ($LASTEXITCODE -ne 0) { throw "Schema migration after rebuild failed." }
python tools/build_analytics_snapshot.py $Sqlite
if ($LASTEXITCODE -ne 0) { throw "Registry analytics snapshot rebuild failed." }
python tools/verify_sqlite.py $Sqlite
if ($LASTEXITCODE -ne 0) { throw "Rebuilt SQLite failed verification." }
Write-Host "Local SQLite refresh complete." -ForegroundColor Green
