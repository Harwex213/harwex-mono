# syntax=docker/dockerfile:1

# ---- builder: install all deps and compile TypeScript ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# ---- runtime: production deps + compiled output only ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
# .env is NOT baked in — it is mounted at runtime (see deploy/deploy.ps1)
CMD ["node", "dist/server.js"]
