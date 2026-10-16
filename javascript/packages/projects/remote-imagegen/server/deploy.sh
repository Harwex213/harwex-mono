#!/usr/bin/env bash
#
# Builds the server, packs it into an image, streams the image straight to the
# droplet over ssh, and restarts the container. No registry is involved.
#
# Required:
#   DEPLOY_HOST   ssh target, e.g. deploy@harwex.example
#
# Optional:
#   REMOTE_DIR    dir on the droplet    (default: /opt/hw-imagegen)
#
# One-time setup:
#   1. In Cloudflare, add a DNS record `imagegen`, proxied, pointing at the
#      droplet like the other sites.
#   2. On the droplet, create the env file. It holds the token that MCP clients
#      must send, so it stays out of the repo and the image:
#        mkdir -p /opt/hw-imagegen
#        echo "REMOTE_IMAGEGEN_TOKEN=$(openssl rand -hex 32)" > /opt/hw-imagegen/.env
#        chmod 600 /opt/hw-imagegen/.env
#      CODEX_MODEL=<model> can go in the same file to override the default model.
#   3. Redeploy nginx (hw-sites) once. Its nginx.conf in
#      packages/infrastructure/deploy has the server block for
#      imagegen.harwexworld.com:
#        DEPLOY_HOST=... yarn workspace @hw/deploy deploy
#   4. After the first deploy of this server, log in to ChatGPT once. The login
#      lands in the codex-home volume and survives later deploys:
#        cd /opt/hw-imagegen && docker compose exec -it hw-imagegen codex login --device-auth
#      Do not copy ~/.codex/auth.json from a Mac instead. Its refresh token is
#      single-use, so the Mac and the droplet would log each other out.
#
# Docker itself and the shared `hw` network are set up as described in
# packages/infrastructure/deploy/deploy.sh. This script creates the network if
# it is missing.
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST, e.g. deploy@harwex.example}"
REMOTE_DIR="${REMOTE_DIR:-/opt/hw-imagegen}"
IMAGE=hw-imagegen

cd "$(dirname "$0")"

TAG=$(git rev-parse --short HEAD)
# Only this directory: every source that goes into the image lives here.
if [[ -n "$(git status --porcelain -- .)" ]]; then
  # The tag is a label for rollback, and it would lie about which sources went
  # into the image if uncommitted changes were left unmarked.
  TAG="$TAG-dirty"
fi

# Checked before the image transfer rather than after: without the token the
# server cannot start, and the container restart-loops instead.
# The shared `hw` network is created here when missing. compose.yaml declares
# it external, so compose up fails without it.
echo "==> checking $HOST"
ssh "$HOST" "docker version > /dev/null \
  && grep -q '^REMOTE_IMAGEGEN_TOKEN=.' $REMOTE_DIR/.env \
  && { docker network inspect hw > /dev/null 2>&1 || docker network create hw > /dev/null; }" \
  || {
    echo "droplet not ready: needs docker, plus REMOTE_IMAGEGEN_TOKEN in $REMOTE_DIR/.env" >&2
    exit 1
  }

echo "==> building server"
yarn build

# The Mac is arm64 and the droplet is amd64. Without --platform the container
# exits with "exec format error" on the droplet, and npm inside the build would
# fetch the arm64 codex binary.
#
# --provenance=false keeps the result a plain single-platform image. With
# provenance on, buildx wraps it in a manifest list and adds an attestation
# manifest, which the droplet's classic image store can refuse to load.
echo "==> building image $IMAGE:$TAG"
docker build --platform linux/amd64 --provenance=false \
  -t "$IMAGE:$TAG" -t "$IMAGE:latest" .

# Both tags name the same image, so the layers are sent once. The extra tag is
# what makes a rollback possible on the droplet.
echo "==> streaming image to $HOST"
docker save "$IMAGE:$TAG" "$IMAGE:latest" | ssh "$HOST" "docker load"

echo "==> restarting"
scp -q compose.yaml "$HOST:$REMOTE_DIR/compose.yaml"
# --force-recreate because :latest keeps its name across deploys, and compose
# would otherwise see no reason to replace the running container.
#
# The loop waits for the healthcheck in compose.yaml, which probes every 2 s
# while the container starts. "running" alone is not enough: a server that
# crashes after a second still counts as running at first.
ssh "$HOST" "cd $REMOTE_DIR \
  && docker compose up -d --force-recreate \
  && id=\$(docker compose ps -q hw-imagegen) \
  && for i in \$(seq 30); do \
       status=\$(docker inspect --format '{{.State.Health.Status}}' \$id); \
       [ \"\$status\" = healthy ] && break; \
       sleep 1; \
     done \
  && if [ \"\$status\" != healthy ]; then \
       echo \"container is not healthy (\$status):\" >&2; \
       docker compose logs --tail 30 >&2; \
       exit 1; \
     fi \
  && docker image prune -f > /dev/null"

echo "==> deployed $IMAGE:$TAG"
