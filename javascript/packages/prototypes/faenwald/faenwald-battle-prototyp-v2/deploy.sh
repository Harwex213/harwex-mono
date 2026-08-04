#!/usr/bin/env bash
#
# Builds the bundle, packs it into an nginx image, streams the image straight to
# the droplet over ssh, and restarts the container. No registry is involved.
#
# The whole image crosses the wire every time, about 22 MB. A registry would send
# only the changed layer, roughly 2 MB, at the cost of an account and a token.
# The stream is not gzipped: the layers are already compressed blobs, so gzip
# buys 0.1 MB of the 22 MB and costs CPU on both ends.
#
# Required:
#   DEPLOY_HOST   ssh target, e.g. deploy@faenwald.example
#
# Optional:
#   REMOTE_DIR    dir on the droplet    (default: /opt/faenwald-battle-prototype)
#   CF_ZONE_ID    Cloudflare zone id    — set both to purge the CDN cache
#   CF_API_TOKEN  Cloudflare API token    after a deploy
#
# One-time setup on the droplet:
#   curl -fsSL https://get.docker.com | sh
#   usermod -aG docker <the ssh user>          # so docker runs without sudo
#   mkdir -p /etc/ssl/origin                   # then place cert.pem and key.pem
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST, e.g. deploy@faenwald.example}"
REMOTE_DIR="${REMOTE_DIR:-/opt/faenwald-battle-prototype}"
IMAGE=faenwald-battle

cd "$(dirname "$0")"

TAG=$(git rev-parse --short HEAD)
if [[ -n "$(git status --porcelain -- .)" ]]; then
  # The tag is a label for rollback, and it would lie about which sources went
  # into the image if uncommitted changes were left unmarked.
  TAG="$TAG-dirty"
fi

# Checked before the 22 MB transfer rather than after: a missing certificate
# leaves nginx unable to start, and the container restart-loops instead.
echo "==> checking $HOST"
ssh "$HOST" "docker version > /dev/null \
  && test -r /etc/ssl/origin/cert.pem \
  && test -r /etc/ssl/origin/key.pem" \
  || {
    echo "droplet not ready: needs docker, plus cert.pem and key.pem in /etc/ssl/origin" >&2
    exit 1
  }

echo "==> building bundle"
yarn build

# The Mac is arm64 and the droplet is amd64. Without --platform the container
# exits with "exec format error" on the droplet.
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
ssh "$HOST" "mkdir -p $REMOTE_DIR"
scp -q compose.yaml "$HOST:$REMOTE_DIR/compose.yaml"
# --force-recreate because :latest keeps its name across deploys, and compose
# would otherwise see no reason to replace the running container.
ssh "$HOST" "cd $REMOTE_DIR \
  && docker compose up -d --force-recreate \
  && sleep 3 \
  && if [ -z \"\$(docker compose ps --status running --quiet)\" ]; then \
       echo 'container is not running:' >&2; \
       docker compose logs --tail 30 >&2; \
       exit 1; \
     fi \
  && docker image prune -f > /dev/null"

if [[ -n "${CF_ZONE_ID:-}" && -n "${CF_API_TOKEN:-}" ]]; then
  echo "==> purging Cloudflare cache"
  curl -fsS -X POST \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"purge_everything\":true}" > /dev/null
fi

echo "==> deployed $IMAGE:$TAG"
