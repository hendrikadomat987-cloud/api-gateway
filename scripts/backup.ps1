param(
  [string]$Name = "baseline-green"
)

$ErrorActionPreference = "Stop"

$Date = Get-Date -Format "yyyy-MM-dd"
$SnapshotId = "${Date}_${Name}"
$Root = Resolve-Path "$PSScriptRoot\.."
$SnapshotDir = "$Root\snapshots\$SnapshotId"

New-Item -ItemType Directory -Force -Path $SnapshotDir | Out-Null

Write-Host "=== SNAPSHOT: $SnapshotId ==="

Write-Host "Creating Git tag only..."
git tag $SnapshotId 2>$null

Write-Host "Dumping Supabase schema..."
supabase db dump --db-url $env:SUPABASE_DB_URL -f "$SnapshotDir\db_schema.sql"

Write-Host "Dumping Supabase data..."
supabase db dump --db-url $env:SUPABASE_DB_URL --data-only -f "$SnapshotDir\db_data.sql"

Write-Host "Exporting local n8n workflows..."
n8n export:workflow --all --output="$SnapshotDir\n8n_workflows.json"

Write-Host "Saving manifest..."
$Manifest = @{
  date = $Date
  name = $Name
  snapshotId = $SnapshotId
  gitTag = $SnapshotId
  dbSchema = "db_schema.sql"
  dbData = "db_data.sql"
  n8nWorkflows = "n8n_workflows.json"
  description = "GREEN BASELINE SNAPSHOT"
} | ConvertTo-Json -Depth 5

$Manifest | Out-File "$SnapshotDir\manifest.json" -Encoding utf8

Write-Host "=== BACKUP COMPLETE ==="
Write-Host "Location: $SnapshotDir"