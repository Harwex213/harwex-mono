// The library of map images on the server. Today the dev server answers with
// `dev-server/maps-api.mjs`; a real backend replaces it later and keeps the same
// contract:
//
//   GET api/maps -> 200 { "images": [MapImage, ...] }
//
// Every URL is relative to the page, so the app also works when it is served
// under a sub-path.

type MapImage = {
  name: string;
  url: string;
  bytes: number;
  // The JSON manifest beside the image, when the server has one. An export of
  // this editor is such a pair.
  manifestUrl: string | null;
  // The countries file beside the image, `<stem>.countries.json`, when the
  // server has one.
  countriesUrl: string | null;
};

type MapLibrary = {
  listImages(): Promise<MapImage[]>;
  fetchImage(image: MapImage): Promise<Blob>;
  fetchManifest(image: MapImage): Promise<string | null>;
  fetchCountries(image: MapImage): Promise<string | null>;
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

type MapLibraryOptions = {
  listUrl?: string;
  fetch?: FetchFn;
};

const LIST_URL = "api/maps";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The server is outside the app, so its answer is checked field by field. A
// malformed entry is an error, not a silent skip: the list is short, and a
// missing image would look like a bug in the editor.
function optionalUrl(value: unknown, name: string, what: string): string | null {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new Error("map library entry " + name + " has a bad " + what + " url");
  }

  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseImageList(payload: unknown): MapImage[] {
  if (!isRecord(payload) || !Array.isArray(payload.images)) {
    throw new Error("the map library answered without an `images` list");
  }

  return payload.images.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error("map library entry " + index + " is not an object");
    }

    const { name, url, bytes, manifestUrl, countriesUrl } = entry;

    if (typeof name !== "string" || name.length === 0) {
      throw new Error("map library entry " + index + " has no name");
    }
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("map library entry " + name + " has no url");
    }
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
      throw new Error("map library entry " + name + " has no size");
    }
    return {
      name,
      url,
      bytes,
      manifestUrl: optionalUrl(manifestUrl, name, "manifest"),
      countriesUrl: optionalUrl(countriesUrl, name, "countries"),
    };
  });
}

async function request(fetchFn: FetchFn, url: string): Promise<Response> {
  const response = await fetchFn(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(url + " responded " + response.status);
  }

  return response;
}

function createMapLibrary(options: MapLibraryOptions = {}): MapLibrary {
  const listUrl = options.listUrl ?? LIST_URL;
  // Bound, because a bare `fetch` called as a method throws "Illegal invocation".
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => {
    return fetch(input, init);
  });

  return {
    async listImages(): Promise<MapImage[]> {
      const response = await request(fetchFn, listUrl);
      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new Error("the map library answered with something that is not JSON");
      }

      return parseImageList(payload);
    },

    async fetchImage(image: MapImage): Promise<Blob> {
      const response = await request(fetchFn, image.url);

      return response.blob();
    },

    async fetchManifest(image: MapImage): Promise<string | null> {
      if (image.manifestUrl === null) {
        return null;
      }

      const response = await request(fetchFn, image.manifestUrl);

      return response.text();
    },

    async fetchCountries(image: MapImage): Promise<string | null> {
      if (image.countriesUrl === null) {
        return null;
      }

      const response = await request(fetchFn, image.countriesUrl);

      return response.text();
    },
  };
}

export {
  createMapLibrary,
  parseImageList,
  type FetchFn,
  type MapImage,
  type MapLibrary,
  type MapLibraryOptions,
};
