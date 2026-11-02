import type { TRoute } from "./types";

const parseRoute = (hash: string): TRoute => {
  const path = hash.replace(/^#\/?/, "");
  if (path === "new") {
    return { name: "new" };
  }
  if (path === "join") {
    return { name: "join" };
  }
  const match = /^p\/([a-z0-9]+)$/.exec(path);
  if (match?.[1]) {
    return { name: "pick", id: match[1] };
  }
  return { name: "home" };
};

const routeHash = (route: TRoute) => {
  if (route.name === "pick") {
    return `#/p/${route.id}`;
  }
  return route.name === "home" ? "#/" : `#/${route.name}`;
};

// A pick link a friend can open: the page address with the pick route.
const pickLink = (id: string) => {
  return new URL(routeHash({ name: "pick", id }), location.href).toString();
};

// The pick id from whatever the user pasted: a bare id or a full link.
const extractPickId = (input: string) => {
  const trimmed = input.trim().toLowerCase();
  const fromLink = /#\/p\/([a-z0-9]+)/.exec(trimmed);
  return fromLink?.[1] ?? trimmed.replace(/[^a-z0-9]/g, "");
};

export { parseRoute, routeHash, pickLink, extractPickId };
