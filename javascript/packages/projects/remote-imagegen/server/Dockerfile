# The TypeScript is compiled on the host by `yarn build`, not here. A build stage
# would need the whole `javascript/` monorepo as its context, because the
# tsconfig extends a workspace package. This image is node plus `dist/` plus the
# runtime dependencies.
#
# The runtime dependencies are installed here, not copied from the host. The
# codex SDK runs a native `codex` binary that npm picks per platform, and the
# Mac's node_modules holds the darwin-arm64 one.
#
# Build for the droplet's architecture, not the Mac's, and skip provenance so the
# image stays a plain single-platform one that `docker load` accepts:
#   docker build --platform linux/amd64 --provenance=false -t <image> .
# deploy.sh does this for you.
FROM node:24-slim

# The slim image has no CA bundle. Node carries its own, but the codex binary
# reads the system one to reach the OpenAI API over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The package.json in the repo lists devDependencies with the `workspace:`
# protocol. npm cannot parse that protocol and fails even with --omit=dev. So
# npm gets a copy that keeps only the fields a runtime install needs.
#
# The install runs as root, so the app user cannot rewrite its own code.
COPY package.json package.source.json
RUN node -e ' \
    const fs = require("fs"); \
    const src = JSON.parse(fs.readFileSync("package.source.json", "utf8")); \
    const out = { name: src.name, version: src.version, private: true, type: src.type, dependencies: src.dependencies }; \
    fs.writeFileSync("package.json", JSON.stringify(out, null, 2) + "\n"); \
  ' \
  && rm package.source.json \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && node_modules/.bin/codex --version

COPY dist/ dist/

# A fresh named volume copies the owner of its mount point from the image. Without
# this directory the volume would belong to root, and `codex login` could not
# save its credentials there.
RUN mkdir /codex-home && chown node:node /codex-home

# `codex` on PATH lets the one-time login run as
#   docker compose exec -it hw-imagegen codex login --device-auth
ENV NODE_ENV=production \
    PORT=3000 \
    CODEX_HOME=/codex-home \
    PATH=/app/node_modules/.bin:$PATH

# The `node` user ships with the base image.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
