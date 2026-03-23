# CONFIG
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$SERVER = "deploy@46.225.102.88"
$KEY    = "$env:USERPROFILE\.ssh\id_ed25519_hetzner"
$BASE   = "$PWD\api-gateway"

Write-Host "Auto-Deploy running for $BASE"

# STATE
$lastState = @{}

function Get-State {
    $state = @{}

    Get-ChildItem -Path $BASE -Recurse -Filter *.js | ForEach-Object {
        $state[$_.FullName] = $_.LastWriteTimeUtc
    }

    return $state
}

function Deploy {
    Write-Host "`n🚀 Deploy triggered..."

    scp -i $KEY "$BASE\src\utils\forwardRequest.js" "${SERVER}:~/api-gateway/src/utils/"
    scp -i $KEY "$BASE\src\services\serviceMap.js" "${SERVER}:~/api-gateway/src/services/"
    scp -i $KEY "$BASE\src\routes\apiRouter.js" "${SERVER}:~/api-gateway/src/routes/"
    scp -i $KEY "$BASE\config.js" "${SERVER}:~/api-gateway/"

    ssh -i $KEY $SERVER "pm2 restart api-gateway"

    Write-Host "✅ Deploy done"
}

# INIT
$lastState = Get-State

while ($true) {
    Start-Sleep -Milliseconds 1000

    $currentState = Get-State
    $changed = $false

    foreach ($file in $currentState.Keys) {
        if (-not $lastState.ContainsKey($file)) {
            Write-Host "[NEW] $file"
            $changed = $true
        }
        elseif ($lastState[$file] -ne $currentState[$file]) {
            Write-Host "[CHANGED] $file"
            $changed = $true
        }
    }

    if ($changed) {
        Deploy
        $lastState = $currentState
    }
}