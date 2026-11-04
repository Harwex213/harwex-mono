import assert from "node:assert/strict";
import test from "node:test";
import { createCivitasApi } from "./civitas-api";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(routes: Record<string, () => Response>): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const route = routes[(init?.method ?? "GET") + " " + url];
      return route ? route() : new Response("", { status: 404 });
    },
  };
}

test("maps are listed, and their static image url is put under the proxy", async () => {
  const server = fakeFetch({
    "GET backend/API/maps": () => Response.json([{ id: "m1", name: "World", image: "/static/m1/map.png" }]),
    "GET backend/static/m1/map.png": () => new Response("png"),
  });
  const api = createCivitasApi({ fetch: server.fetch });
  const maps = await api.listMaps();

  assert.deepEqual(maps, [{
    id: "m1",
    name: "World",
    imageUrl: "backend/static/m1/map.png",
    provincesImageUrl: null,
    countriesImageUrl: null,
  }]);
  assert.equal(await (await api.fetchMapImage(maps[0])).text(), "png");
  assert.equal(await api.fetchLayerImage(maps[0], "provinces"), null, "a layer never saved is not fetched");
});

test("a layer image is put as multipart and fetched from its versioned url", async () => {
  const stored = { id: "m1", name: "World", image: "/static/m1/map.png", provincesImage: "/static/m1/provinces.png?v=7", countriesImage: null };
  const server = fakeFetch({
    "PUT backend/API/maps/m1/layers/provinces": () => Response.json(stored),
    "GET backend/static/m1/provinces.png?v=7": () => new Response("layer"),
  });
  const api = createCivitasApi({ fetch: server.fetch });
  const map = await api.saveLayerImage("m1", "provinces", new Blob(["layer"], { type: "image/png" }));

  assert.equal(map.provincesImageUrl, "backend/static/m1/provinces.png?v=7");
  assert.equal(map.countriesImageUrl, null);
  assert.deepEqual([...(server.calls[0].init?.body as FormData).keys()], ["image"]);
  assert.equal(await (await api.fetchLayerImage(map, "provinces"))?.text(), "layer");
});

test("a new map is posted as multipart with the name before the image", async () => {
  const server = fakeFetch({
    "POST backend/API/maps": () => Response.json({ id: "m2", name: "New", image: "/static/m2/map.png" }, { status: 201 }),
  });
  const api = createCivitasApi({ fetch: server.fetch });

  assert.deepEqual(await api.createMap("New", new Blob(["png"], { type: "image/png" })), {
    id: "m2",
    name: "New",
    imageUrl: "backend/static/m2/map.png",
    provincesImageUrl: null,
    countriesImageUrl: null,
  });

  const form = server.calls[0].init?.body as FormData;
  assert.deepEqual([...form.keys()], ["name", "image"]);
  assert.equal(form.get("name"), "New");
});

const STORED = {
  countries: [{ id: "c1", name: "Aurelia", hex: "#c0563f", provinces: [{ id: "p1", name: "Capital", hex: "#112233" }] }],
};

test("the layout is fetched in one request", async () => {
  const server = fakeFetch({
    "GET backend/API/maps/m1/layout": () => Response.json(STORED),
  });
  const api = createCivitasApi({ fetch: server.fetch });

  assert.deepEqual(await api.fetchLayout("m1"), STORED);
});

test("a save puts the whole layout as JSON and answers what is stored", async () => {
  const server = fakeFetch({
    "PUT backend/API/maps/m1/layout": () => Response.json(STORED),
  });
  const api = createCivitasApi({ fetch: server.fetch });
  const body = { countries: [{ name: "Aurelia", hex: "#c0563f", provinces: [{ name: "Capital", hex: "#112233" }] }] };

  assert.deepEqual(await api.saveLayout("m1", body), STORED);
  assert.deepEqual(JSON.parse(server.calls[0].init?.body as string), body);
});

test("an error carries the backend's message", async () => {
  const server = fakeFetch({
    "PUT backend/API/maps/m1/layout": () => Response.json({ message: "province hex \"#112233\" is used twice" }, { status: 409 }),
  });
  const api = createCivitasApi({ fetch: server.fetch });

  await assert.rejects(api.saveLayout("m1", { countries: [] }), /layout responded 409: province hex "#112233" is used twice/);
});
