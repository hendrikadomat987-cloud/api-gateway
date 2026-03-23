$SERVER="deploy@46.225.102.88"
$KEY="$env:USERPROFILE\.ssh\id_ed25519_hetzner"
$BASE="$PWD\api-gateway"

Write-Host "🚀 Deploy startet..."

scp -i $KEY "$BASE\src\utils\forwardRequest.js" "${SERVER}:~/api-gateway/src/utils/"
scp -i $KEY "$BASE\src\services\serviceMap.js" "${SERVER}:~/api-gateway/src/services/"
scp -i $KEY "$BASE\src\routes\apiRouter.js" "${SERVER}:~/api-gateway/src/routes/"
scp -i $KEY "$BASE\config.js" "${SERVER}:~/api-gateway/"

Write-Host "♻️ Restarting API Gateway..."

ssh -i $KEY $SERVER "pm2 restart api-gateway"

Write-Host "✅ Deploy fertig"