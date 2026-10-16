# remote-imagegen

Image generation with Codex `image_gen`, shared over MCP. Two packages:

- `server/` (`@hw/remote-imagegen-server`): MCP server over Streamable HTTP at `/mcp`, with a Bearer token (`REMOTE_IMAGEGEN_TOKEN`). Its tool `generate_image` takes base64 images and runs one Codex thread per call through `@openai/codex-sdk`. It runs on the droplet as container `hw-imagegen` on the docker network `hw`. nginx (`packages/infrastructure/deploy/nginx.conf`) proxies `imagegen.*` to `http://hw-imagegen:3000`.
- `mcp/` (npm `remote-imagegen-mcp`): local stdio proxy. It reads reference images from local paths, calls the remote `generate_image`, and writes the result to `output_path`.

## Codex facts that are not obvious

- Set the model explicitly (`gpt-5.6-luna`, override with `CODEX_MODEL`). The model from the user's own config fails on a ChatGPT login.
- Do not disable `features.code_mode_host`. The model calls `image_gen` through it.
- Codex always injects `$CODEX_HOME/AGENTS.md`. That is why the server has its own `CODEX_HOME`.
- The image lands in `$CODEX_HOME/generated_images/<thread_id>/`. Read the file from there. Never trust the final message.
- `image_gen` has no size argument. The `size` parameter is only a hint in the prompt.
- Reference images need short paths. The model mistyped long paths, so they go to `os.tmpdir()/ig-*/refN.png`.
- Codex has no cross-process lock on `auth.json`. The start lock lets one thread start at a time, so two refreshes cannot burn the refresh token. Never copy `auth.json` between machines: the Mac and the droplet would log each other out.
- MCP sessions are stateful on purpose. A cancel arrives in a separate POST, and only the session that runs the call can abort its Codex child.

## Timeouts

The server sends progress every 10 s, in the queue and during the run. It caps a run at 5 min after the job leaves the queue. The proxy resets its 360 s idle timeout on each progress event and gives up after 30 min in total.

## Deploy

From `server/`: `DEPLOY_HOST=user@host yarn deploy`. It builds `dist/`, builds a linux/amd64 image, streams it over ssh with `docker load`, and restarts the compose project in `/opt/hw-imagegen`.

One-time setup (details in `server/deploy.sh`):

1. Cloudflare: add a proxied DNS record `imagegen` that points at the droplet.
2. On the droplet: `mkdir -p /opt/hw-imagegen && echo "REMOTE_IMAGEGEN_TOKEN=$(openssl rand -hex 32)" > /opt/hw-imagegen/.env && chmod 600 /opt/hw-imagegen/.env`
3. Redeploy nginx once: `DEPLOY_HOST=... yarn workspace @hw/deploy deploy`
4. After the first deploy, log in once: `cd /opt/hw-imagegen && docker compose exec -it hw-imagegen codex login --device-auth`. The login lives in the `codex-home` volume.

## Publish the proxy

Publish by hand from `mcp/` with `npm publish`. The package is unscoped. `prepublishOnly` runs the build.
