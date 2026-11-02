# One image recipe for every package with an `hwApi` field. src/deploy-api.js
# builds it with the API package's own directory as the context:
#   docker build -f api/Dockerfile <package dir>
# Dockerfile.dockerignore next to this file applies to that context.
#
# Contract for the API (see src/scan.js):
#   - `start` script; `build`, if present, runs on the host before this build
#   - listens on HOST and PORT
#   - answers GET /api/health
#   - keeps durable state in DATA_DIR, a volume
FROM node:24-slim

WORKDIR /app

# Dependencies are installed here, not copied from the host: native packages
# pick their binary per platform, and the Mac's node_modules holds darwin-arm64
# ones.
#
# The package.json in the repo lists devDependencies with the `workspace:`
# protocol. npm cannot parse that protocol and fails even with --omit=dev. So
# npm gets a copy that keeps only the fields a runtime install needs.
COPY package.json package.source.json
RUN node -e ' \
    const fs = require("fs"); \
    const src = JSON.parse(fs.readFileSync("package.source.json", "utf8")); \
    const out = { name: src.name, version: src.version, private: true, type: src.type, dependencies: src.dependencies }; \
    fs.writeFileSync("package.json", JSON.stringify(out, null, 2) + "\n"); \
  ' \
  && rm package.source.json \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# The repo's package.json replaces the stripped one: `node --run` reads the
# start script from it.
COPY . .

# A fresh named volume copies the owner of its mount point from the image.
# Without this directory the volume would belong to root, and the app could not
# write to it.
RUN mkdir /data && chown node:node /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data

# The `node` user ships with the base image.
USER node
EXPOSE 8080
CMD ["node", "--run", "start"]
