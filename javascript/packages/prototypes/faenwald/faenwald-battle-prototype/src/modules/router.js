class Router {
  #routes = [];
  #resolveScheduled = false;

  constructor() {
    window.addEventListener("hashchange", () => this.#resolve());
  }

  registerRoute(path, handler) {
    const paramNames = [];
    const pattern = path
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          paramNames.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");

    this.#routes.push({
      regexp: new RegExp(`^${pattern}/?$`),
      paramNames,
      handler,
    });

    // resolve once after all synchronous registrations, so the current
    // route renders without firing a handler per registerRoute call
    if (!this.#resolveScheduled) {
      this.#resolveScheduled = true;
      queueMicrotask(() => {
        this.#resolveScheduled = false;
        this.#resolve();
      });
    }
  }

  push(path, params) {
    // pushState (unlike assigning location.hash) doesn't fire hashchange,
    // so resolve manually and stay synchronous
    history.pushState(null, "", `#${this.#buildPath(path, params)}`);
    this.#resolve();
  }

  replace(route) {
    history.replaceState(null, "", `#${this.#buildPath(route)}`);
    this.#resolve();
  }

  back() {
    history.back();
  }

  #buildPath(path, params = {}) {
    return path.replace(/:([^/]+)/g, (match, name) =>
      name in params ? encodeURIComponent(params[name]) : match,
    );
  }

  #resolve() {
    const path = window.location.hash.slice(1) || "/";

    for (const { regexp, paramNames, handler } of this.#routes) {
      const match = path.match(regexp);
      if (!match) continue;

      const params = {};
      paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      handler(params);
      return;
    }
  }
}

export { Router }
