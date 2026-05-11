param(
  [string]$SnapshotId
)

$ErrorActionPreference = "Stop"

if (-not $SnapshotId) {
  throw "Bitte SnapshotId angeben"
}

$Root = Resolve-Path "$PSScriptRoot\.."
$SnapshotDir = "$Root\snapshots\$SnapshotId"

if (!(Test-Path $SnapshotDir)) {
  throw "Snapshot nicht gefunden: $SnapshotDir"
}

$SchemaFile = "$SnapshotDir\db_schema.sql"
$DataFile = "$SnapshotDir\db_data.sql"
$N8nFile = "$SnapshotDir\n8n_workflows.json"

if (!(Test-Path $SchemaFile)) { throw "Fehlt: db_schema.sql" }
if (!(Test-Path $DataFile)) { throw "Fehlt: db_data.sql" }
if (!(Test-Path $N8nFile)) { throw "Fehlt: n8n_workflows.json" }

Write-Host "=== RESTORE START: $SnapshotId ==="

Write-Host "WARNING: This will overwrite your database!"

$confirm = Read-Host "Type RESTORE to continue"
if ($confirm -ne "RESTORE") {
  throw "Restore abgebrochen."
}

Write-Host "Restoring schema..."
supabase db execute --db-url $env:SUPABASE_DB_URL --file "$SchemaFile"
if ($LASTEXITCODE -ne 0) { throw "Schema Restore failed" }

Write-Host "Restoring data..."
supabase db execute --db-url $env:SUPABASE_DB_URL --file "$DataFile"
if ($LASTEXITCODE -ne 0) { throw "Data Restore failed" }

Write-Host "Importing n8n workflows..."
n8n import:workflow --input="$N8nFile"
if ($LASTEXITCODE -ne 0) { throw "n8n import failed" }

Write-Host "=== RESTORE COMPLETE ==="