class Router {
    routes: Record<string, React.ComponentType> = {};

    registerRoute(path: string, component: React.ComponentType) {
        this.routes[path] = component;
    }
}

const router = new Router();

export { router };