#!/usr/bin/env pwsh
# Deploy @hw/faenwald-bot to a DigitalOcean droplet as a Docker container.
#
# Usage (run from anywhere; the script cd's to the package root itself):
#   .\deploy\deploy.ps1 -DropletHost root@164.92.0.0
#
# Prerequisites:
#   - Docker Desktop running locally
#   - SSH access to the droplet (key-based auth recommended)
#   - Docker installed on the droplet (see README note in the chat)
#   - A .env file in the package root (contains VK_ACCESS_TOKEN)

param(
    [Parameter(Mandatory = $true)]
    [string]$DropletHost,                          # e.g. root@164.92.0.0
    [string]$RemoteDir     = "/opt/faenwald-bot",
    [string]$ImageName     = "faenwald-bot",
    [string]$ContainerName = "faenwald-bot"
)

$ErrorActionPreference = "Stop"

# Package root = parent of this script's folder.
$pkgRoot = Split-Path -Parent $PSScriptRoot
Set-Location $pkgRoot

if (-not (Test-Path ".env")) {
    throw ".env not found in $pkgRoot - the bot needs it (VK_ACCESS_TOKEN)."
}

$tar = Join-Path $env:TEMP "faenwald-bot.tar"

Write-Host "==> Building image ${ImageName}:latest (linux/amd64)..." -ForegroundColor Cyan
docker build --platform linux/amd64 -t "${ImageName}:latest" .
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

Write-Host "==> Saving image to $tar..." -ForegroundColor Cyan
docker save "${ImageName}:latest" -o $tar
if ($LASTEXITCODE -ne 0) { throw "docker save failed" }

Write-Host "==> Copying image + .env to $DropletHost..." -ForegroundColor Cyan
ssh $DropletHost "mkdir -p ${RemoteDir}"
scp $tar   "${DropletHost}:${RemoteDir}/faenwald-bot.tar"
scp ".env" "${DropletHost}:${RemoteDir}/.env"

Write-Host "==> Loading image + (re)starting container on droplet..." -ForegroundColor Cyan
$remote = @"
set -e
docker load -i ${RemoteDir}/faenwald-bot.tar
docker rm -f ${ContainerName} 2>/dev/null || true
docker run -d --name ${ContainerName} --restart unless-stopped \
  -v ${RemoteDir}/.env:/app/.env:ro \
  ${ImageName}:latest
rm -f ${RemoteDir}/faenwald-bot.tar
docker image prune -f >/dev/null 2>&1 || true
echo '--- running container ---'
docker ps --filter name=${ContainerName}
"@ -replace "`r`n", "`n"
# CRLF would otherwise reach bash on the droplet as literal \r, breaking
# `set -e`, `\` line-continuations, and image refs like `faenwald-bot:latest\r`.
ssh $DropletHost $remote
if ($LASTEXITCODE -ne 0) { throw "remote deploy step failed" }

Remove-Item $tar -Force
Write-Host ""
Write-Host "==> Done. Follow logs with:" -ForegroundColor Green
Write-Host "    ssh $DropletHost 'docker logs -f $ContainerName'" -ForegroundColor Green
