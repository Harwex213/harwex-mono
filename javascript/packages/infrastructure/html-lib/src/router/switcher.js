import { effect } from "@hw/signals";
import { toFunctionCreator } from "@hw/utils";
import { router } from "./router.js";
import { switcherAlreadyStartedListening } from "../error.js";

class Switcher {
    #routes = new Map();
    #defaultPath = null;
    #startListen = false;

    match(route, handle) {
        if (this.#startListen) {
            throw switcherAlreadyStartedListening();
        }

        this.#routes.set(route, handle);
        return this;
    }

    defaultPath(path) {
        if (this.#startListen) {
            throw switcherAlreadyStartedListening();
        }

        this.#defaultPath = path;
        return this;
    }

    listen() {
        const finalize = effect(() => {
            const currentPath = router.currentPath.value;

            let resolved = false;

            for (const [route, handle] of this.#routes.entries()) {
                const match = route.matchRoute(currentPath);
                if (!!match) {
                    handle(match.params);
                    resolved = true;
                    break;
                }
            }

            if (!resolved && this.#defaultPath) {
                router.push(this.#defaultPath);
            }
        });

        return () => {
            finalize();
            this.#routes.clear();
        };
    }
}

const switcher = toFunctionCreator(Switcher);

export { switcher };
