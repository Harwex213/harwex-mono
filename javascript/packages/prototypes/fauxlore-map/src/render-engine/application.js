import { View } from "./view.js";
import { observeResize } from "./utils.js";

class Application {
    #view = new View({ observeResize });

    constructor() {
        this.viewService = {
            mount: this.#view.mount.bind(this.#view),
            on: this.#view.on.bind(this.#view),
        };

        const gl = this.#view.getWebGlContext();
    }
}

/**
 * 1) Есть такая вещь как потеря WebGL контекста - вероятно мне нужно её обабатывать
 * 2)
 */

export { Application };
