param(
  [string]$Name = "manual-save",
  [string]$Message = "System snapshot"
)

$ErrorActionPreference = "Stop"

$Date = Get-Date -Format "yyyy-MM-dd"
$GitTag = "SNAPSHOT-$Date-$Name"

Write-Host "=== SAVE START ==="
Write-Host "Name: $Name"
Write-Host "Git tag: $GitTag"

Write-Host "Checking Git status..."
git status --short

Write-Host "Committing current code..."
git add .
git commit -m "$Message ($Name)" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "No new code changes to commit or commit failed. Continuing..."
  $global:LASTEXITCODE = 0
}

Write-Host "Creating/updating Git tag..."
$ErrorActionPreference = "Continue"
git tag -d $GitTag 2>$null
$ErrorActionPreference = "Stop"
$global:LASTEXITCODE = 0

git tag $GitTag
if ($LASTEXITCODE -ne 0) { throw "Git tag creation failed" }

Write-Host "Creating DB + n8n backup..."
& "$PSScriptRoot\backup.ps1" -Name $Name
if ($LASTEXITCODE -ne 0) { throw "backup.ps1 failed" }

Write-Host "=== SAVE COMPLETE ==="
Write-Host "Git tag: $GitTag"
Write-Host "Snapshot folder: snapshots/${Date}_${Name}"