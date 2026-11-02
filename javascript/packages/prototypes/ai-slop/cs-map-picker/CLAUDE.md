# cs-map-picker

CS2 map veto for two players. Two services:

- `backend/` (`@hw/cs-map-picker-backend`) — Fastify + `node:sqlite`, run as plain TypeScript by Node 24 (`node src/main.ts`, imports carry `.ts`). Locally it listens on 127.0.0.1:8131 and keeps its data in `backend/data/`; `HOST`, `PORT` and `DATA_DIR` override that. The data dir holds `picks.sqlite` and the cache of finished-pick images in `images/` (delete it after changing `src/image.ts`).
- `frontend/` (`@hw/cs-map-picker-frontend`) — React + rspack + preact signals, architecture of `@hw/frontend-plain-architecture-v2`. Dev server on 8132 proxies `/api` to the backend (`BACKEND_URL` overrides it).

```bash
yarn workspace @hw/cs-map-picker-backend dev
yarn workspace @hw/cs-map-picker-frontend dev
yarn workspace @hw/cs-map-picker-backend test
```

## Rules of the veto

- The veto logic lives in `backend/src/veto.ts`; `frontend/src/domain/sequence.ts` mirrors its sequences for the timeline.
- The creator plays side A. The first visitor who joins takes side B; the coin toss happens at that moment.
- A seat is proven by a token in the `x-pick-token` header. Tokens sit in the browser's localStorage, together with the list of "my picks".

## Data

- Teams come from `backend/assets/teams.json` (`{ id, name, players[] }`), read on every request. They ship with the image; `data/` is a volume in production.
- The result image uses Inter from `backend/assets/fonts`: the container has no system fonts.
- Map art in `backend/assets/maps/*.jpg` was generated with the `local-image-gen` skill (preset `concept`) and resized to 1280 px.

## Deploy

Live at https://harwexworld.com/cs-map-picker/. The frontend goes out with the static sites (`hwDeploy`), the backend as an API (`hwApi`); see "Deploying an API" in `javascript/CLAUDE.md`.

```bash
DEPLOY_HOST=root@46.101.205.35 yarn workspace @hw/deploy deploy-api cs-map-picker
DEPLOY_HOST=root@46.101.205.35 yarn workspace @hw/deploy deploy
```
