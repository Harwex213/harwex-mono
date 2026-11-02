import type { TMeta, TPickView, TSide } from "./types";

type TSession = {
  id: string;
  token: string;
  side: TSide;
};

// Relative to the page, so the app works under any deploy route.
const apiUrl = (path: string) => {
  return new URL(`api/${path}`, document.baseURI).toString();
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? `Ошибка сервера ${response.status}`);
  }
  return body as T;
};

const api = {
  meta: () => {
    return request<TMeta>("meta");
  },
  createPick: (format: string, teamA: string, teamB: string) => {
    return request<TSession>("picks", { method: "POST", body: JSON.stringify({ format, teamA, teamB }) });
  },
  listPicks: (ids: string[]) => {
    return request<TPickView[]>(`picks?ids=${ids.map(encodeURIComponent).join(",")}`);
  },
  getPick: (id: string) => {
    return request<TPickView>(`picks/${encodeURIComponent(id)}`);
  },
  joinPick: (id: string) => {
    return request<TSession>(`picks/${encodeURIComponent(id)}/join`, { method: "POST", body: "{}" });
  },
  act: (id: string, token: string, map: string) => {
    return request<TPickView>(`picks/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "x-pick-token": token },
      body: JSON.stringify({ map }),
    });
  },
  eventsUrl: (id: string) => {
    return apiUrl(`picks/${encodeURIComponent(id)}/events`);
  },
  imageUrl: (id: string) => {
    return apiUrl(`picks/${encodeURIComponent(id)}/image.png`);
  },
  mapArtUrl: (mapId: string) => {
    return apiUrl(`maps/${mapId}.jpg`);
  },
};

export type { TSession };
export { api };
