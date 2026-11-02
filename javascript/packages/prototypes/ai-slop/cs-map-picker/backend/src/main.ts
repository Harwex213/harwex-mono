import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Fastify from "fastify";
import { DATA_DIR, openDb } from "./db.ts";
import { createEventHub } from "./events.ts";
import { renderPickImage } from "./image.ts";
import { MAP_POOL, findMap } from "./maps.ts";
import { findTeam, loadTeams } from "./teams.ts";
import { FORMATS, computeVeto, isFormat, resolveAction } from "./veto.ts";
import type { TSide } from "./veto.ts";
import { loadView } from "./view.ts";

const PORT = Number(process.env.PORT ?? 8131);
const HOST = process.env.HOST ?? "127.0.0.1";
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const IMAGES_DIR = new URL("images/", DATA_DIR);
const MAPS_DIR = new URL("../assets/maps/", import.meta.url);

const createId = () => {
  let id = "";
  for (let index = 0; index < 8; index++) {
    id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return id;
};

const createToken = () => {
  return randomBytes(24).toString("base64url");
};

const db = openDb();
const hub = createEventHub();
const app = Fastify({ logger: { level: "info" } });

type TIdParams = { id: string };

app.get("/api/health", async () => {
  return { ok: true };
});

app.get("/api/meta", async () => {
  return { maps: MAP_POOL, teams: loadTeams(), formats: FORMATS };
});

app.get<{ Params: { file: string } }>("/api/maps/:file", async (request, reply) => {
  const mapId = request.params.file.replace(/\.jpg$/, "");
  const file = new URL(`${mapId}.jpg`, MAPS_DIR);
  if (!findMap(mapId) || !existsSync(file)) {
    return reply.code(404).send({ error: "Нет картинки" });
  }
  return reply.type("image/jpeg").header("cache-control", "public, max-age=86400").send(readFileSync(file));
});

app.post<{ Body: { format?: unknown; teamA?: unknown; teamB?: unknown } }>("/api/picks", async (request, reply) => {
  const { format, teamA, teamB } = request.body ?? {};
  if (!isFormat(format)) {
    return reply.code(400).send({ error: "Неизвестный формат" });
  }
  if (typeof teamA !== "string" || typeof teamB !== "string" || !findTeam(teamA) || !findTeam(teamB)) {
    return reply.code(400).send({ error: "Выбери обе команды" });
  }
  if (teamA === teamB) {
    return reply.code(400).send({ error: "Команда не может играть сама с собой" });
  }

  const id = createId();
  const token = createToken();
  db.createPick({ id, createdAt: new Date().toISOString(), format, teamA, teamB, hostToken: token });
  return { id, token, side: "a" };
});

// Summaries for the "my picks" list on the home screen.
app.get<{ Querystring: { ids?: string } }>("/api/picks", async (request) => {
  const ids = (request.query.ids ?? "").split(",").filter(Boolean).slice(0, 100);
  return ids.map((id) => loadView(db, id)).filter((view) => view !== undefined);
});

app.get<{ Params: TIdParams }>("/api/picks/:id", async (request, reply) => {
  const view = loadView(db, request.params.id);
  if (!view) {
    return reply.code(404).send({ error: "Пики не найдены" });
  }
  return view;
});

// The first visitor without a token takes side B. The coin toss happens at that moment.
app.post<{ Params: TIdParams }>("/api/picks/:id/join", async (request, reply) => {
  const { id } = request.params;
  if (!db.getPick(id)) {
    return reply.code(404).send({ error: "Пики не найдены" });
  }

  const token = createToken();
  const firstSide: TSide = randomInt(2) === 0 ? "a" : "b";
  if (!db.joinPick(id, token, firstSide)) {
    return reply.code(409).send({ error: "Соперник уже подключился" });
  }

  hub.publish(id, loadView(db, id));
  return { id, token, side: "b" };
});

app.post<{ Params: TIdParams; Body: { map?: unknown } }>("/api/picks/:id/actions", async (request, reply) => {
  const { id } = request.params;
  const row = db.getPick(id);
  if (!row) {
    return reply.code(404).send({ error: "Пики не найдены" });
  }

  const token = request.headers["x-pick-token"];
  const side: TSide | null = token === row.hostToken ? "a" : token && token === row.guestToken ? "b" : null;
  if (side === null) {
    return reply.code(403).send({ error: "Ты зритель этих пиков" });
  }

  const map = request.body?.map;
  if (typeof map !== "string") {
    return reply.code(400).send({ error: "Не указана карта" });
  }

  const action = resolveAction(computeVeto(row.format, row.firstSide, db.getActions(id)), side, map);
  if (typeof action === "string") {
    return reply.code(409).send({ error: action });
  }

  db.addAction(id, action);
  const view = loadView(db, id);
  hub.publish(id, view);
  return view;
});

app.get<{ Params: TIdParams }>("/api/picks/:id/events", async (request, reply) => {
  const { id } = request.params;
  const view = loadView(db, id);
  if (!view) {
    return reply.code(404).send({ error: "Пики не найдены" });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.write(`data: ${JSON.stringify(view)}\n\n`);
  hub.subscribe(id, reply.raw);
});

// A finished pick never changes, so its picture is rendered once and kept on disk.
app.get<{ Params: TIdParams }>("/api/picks/:id/image.png", async (request, reply) => {
  const { id } = request.params;
  const view = loadView(db, id);
  if (!view) {
    return reply.code(404).send({ error: "Пики не найдены" });
  }
  if (view.phase !== "done") {
    return reply.code(409).send({ error: "Пики ещё не закончены" });
  }

  const file = new URL(`${id}.png`, IMAGES_DIR);
  if (!existsSync(file)) {
    mkdirSync(IMAGES_DIR, { recursive: true });
    writeFileSync(file, await renderPickImage(view));
  }
  return reply.type("image/png").header("cache-control", "public, max-age=31536000, immutable").send(readFileSync(file));
});

await app.listen({ port: PORT, host: HOST });
