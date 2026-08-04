# The bundle is built on the host, not here. A build stage would need the whole
# `javascript/` monorepo as its context: the Yarn 4 release binary, the lockfile,
# the committed `.yarn/cache`, and the `@hw/faenwald-uikit` workspace package.
# Run `yarn build` first, then this image is nothing but nginx plus `dist/`.
#
# Build for the droplet's architecture, not the Mac's, and skip provenance so the
# image stays a plain single-platform one that `docker load` accepts:
#   docker build --platform linux/amd64 --provenance=false -t <image> .
# deploy.sh does this for you.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
