$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

npm run check
npm run build

if (Test-Path "data/generated/horse-registry.sqlite") {
  python tools/verify_sqlite.py data/generated/horse-registry.sqlite
  python tools/analyze_pedigree.py data/generated/horse-registry.sqlite
}
