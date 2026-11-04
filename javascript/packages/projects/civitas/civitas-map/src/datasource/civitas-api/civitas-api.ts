import type {
  SaveLayout,
  ServerCountry,
  ServerLayout,
  ServerProvince,
} from "../../domain/index";

// The civitas backend (`../civitas-server`). The dev server proxies `backend/`
// to it, so every url stays relative to the page:
//
//   GET  backend/API/maps                        -> [map]
//   POST backend/API/maps  multipart name, image -> map
//   PUT  backend/API/maps/:id/layers/:layer  multipart image -> map
//   GET  backend/static/<id>/map.png             -> the map image
//   GET  backend/static/<id>/<layer>.png?v=...   -> a layer image
//   GET  backend/API/maps/:id/layout             -> layout
//   PUT  backend/API/maps/:id/layout  layout     -> layout, replacing every
//        country and province the map held
//
// A layout is `{ countries: [{ id, name, hex, provinces: [{ id, name, hex }] }] }`;
// the PUT body is the same without ids.
//
// A map is `{ id, name, image, provincesImage, countriesImage }`; a layer image
// url is null until that layer is first saved.

// The images painted over a map, each a png of the map's size: the province
// layer, and the provinces in the colour of their country.
type ServerMapLayer = "provinces" | "countries";

type ServerMap = {
  id: string;
  name: string;
  // Relative to the page.
  imageUrl: string;
  provincesImageUrl: string | null;
  countriesImageUrl: string | null;
};

type CivitasApi = {
  listMaps(): Promise<ServerMap[]>;
  createMap(name: string, image: Blob): Promise<ServerMap>;
  fetchMapImage(map: ServerMap): Promise<Blob>;
  // A layer image of the map, or null when that layer was never saved.
  fetchLayerImage(map: ServerMap, layer: ServerMapLayer): Promise<Blob | null>;
  // Replaces a layer image of the map. Answers the map with its new urls.
  saveLayerImage(mapId: string, layer: ServerMapLayer, image: Blob): Promise<ServerMap>;
  fetchLayout(mapId: string): Promise<ServerLayout>;
  // Replaces every country and province of the map. Answers what is stored now.
  saveLayout(mapId: string, layout: SaveLayout): Promise<ServerLayout>;
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

type CivitasApiOptions = {
  baseUrl?: string;
  fetch?: FetchFn;
};

const BASE_URL = "backend/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("the backend answered without " + what);
  }

  return value;
}

function list(payload: unknown, what: string): unknown[] {
  if (!Array.isArray(payload)) {
    throw new Error("the backend answered without a list of " + what);
  }

  return payload;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("the backend answered with a " + what + " that is not an object");
  }

  return value;
}

// The backend hands out root-relative static urls, `/static/<id>/map.png`. They
// are put under the base, so the request goes through the same proxy.
function staticUrl(baseUrl: string, url: string): string {
  return baseUrl + url.replace(/^\/+/, "");
}

function optionalUrl(value: unknown, baseUrl: string, what: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return staticUrl(baseUrl, text(value, what));
}

function parseMap(value: unknown, baseUrl: string): ServerMap {
  const entry = record(value, "map");

  return {
    id: text(entry.id, "a map id"),
    name: text(entry.name, "a map name"),
    imageUrl: staticUrl(baseUrl, text(entry.image, "a map image url")),
    provincesImageUrl: optionalUrl(entry.provincesImage, baseUrl, "a provinces image url"),
    countriesImageUrl: optionalUrl(entry.countriesImage, baseUrl, "a countries image url"),
  };
}

function parseProvince(value: unknown): ServerProvince {
  const entry = record(value, "province");

  return {
    id: text(entry.id, "a province id"),
    name: text(entry.name, "a province name"),
    hex: text(entry.hex, "a province hex"),
  };
}

function parseCountry(value: unknown): ServerCountry {
  const entry = record(value, "country");

  return {
    id: text(entry.id, "a country id"),
    name: text(entry.name, "a country name"),
    hex: text(entry.hex, "a country hex"),
    provinces: list(entry.provinces, "provinces").map(parseProvince),
  };
}

function parseLayout(value: unknown): ServerLayout {
  return { countries: list(record(value, "layout").countries, "countries").map(parseCountry) };
}

// The backend answers an error with `{ message }`; that beats a bare status.
async function failure(url: string, response: Response): Promise<Error> {
  let reason = "";

  try {
    const body: unknown = await response.json();

    if (isRecord(body) && typeof body.message === "string") {
      reason = ": " + body.message;
    }
  } catch {
    // Not JSON: the status alone has to do.
  }

  return new Error(url + " responded " + response.status + reason);
}

function createCivitasApi(options: CivitasApiOptions = {}): CivitasApi {
  const baseUrl = options.baseUrl ?? BASE_URL;
  // Bound, because a bare `fetch` called as a method throws "Illegal invocation".
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => {
    return fetch(input, init);
  });

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = baseUrl + path;
    const response = await fetchFn(url, { cache: "no-store", ...init });

    if (!response.ok) {
      throw await failure(url, response);
    }

    return response;
  }

  async function blob(url: string): Promise<Blob> {
    const response = await fetchFn(url, { cache: "no-store" });

    if (!response.ok) {
      throw await failure(url, response);
    }

    return response.blob();
  }

  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(path, init);

    try {
      return await response.json();
    } catch {
      throw new Error("the backend answered " + path + " with something that is not JSON");
    }
  }

  function put(path: string, body: unknown): Promise<unknown> {
    return json(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return {
    async listMaps(): Promise<ServerMap[]> {
      return list(await json("API/maps"), "maps").map((entry) => {
        return parseMap(entry, baseUrl);
      });
    },

    async createMap(name: string, image: Blob): Promise<ServerMap> {
      const form = new FormData();

      // The name goes first: the backend reads fields that precede the file only.
      form.append("name", name);
      form.append("image", image, "map.png");

      return parseMap(await json("API/maps", { method: "POST", body: form }), baseUrl);
    },

    fetchMapImage(map: ServerMap): Promise<Blob> {
      return blob(map.imageUrl);
    },

    async fetchLayerImage(map: ServerMap, layer: ServerMapLayer): Promise<Blob | null> {
      const url = layer === "provinces" ? map.provincesImageUrl : map.countriesImageUrl;

      return url === null ? null : blob(url);
    },

    async saveLayerImage(mapId: string, layer: ServerMapLayer, image: Blob): Promise<ServerMap> {
      const form = new FormData();

      form.append("image", image, layer + ".png");

      const path = "API/maps/" + encodeURIComponent(mapId) + "/layers/" + layer;

      return parseMap(await json(path, { method: "PUT", body: form }), baseUrl);
    },

    async fetchLayout(mapId: string): Promise<ServerLayout> {
      return parseLayout(await json("API/maps/" + encodeURIComponent(mapId) + "/layout"));
    },

    async saveLayout(mapId: string, layout: SaveLayout): Promise<ServerLayout> {
      return parseLayout(await put("API/maps/" + encodeURIComponent(mapId) + "/layout", layout));
    },
  };
}

export {
  createCivitasApi,
  type CivitasApi,
  type CivitasApiOptions,
  type ServerMap,
  type ServerMapLayer,
};
