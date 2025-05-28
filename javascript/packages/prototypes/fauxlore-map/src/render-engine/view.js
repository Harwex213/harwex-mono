import { throwError } from "./utils.js";

class View {
    #canvas = document.createElement("canvas");
    #canvasSizes = {
        width: 0,
        height: 0,
    };

    constructor(options) {
        const { observeResize } = options;

        observeResize(this.#canvas, (width, height) => {
            this.#canvasSizes.width = width;
            this.#canvasSizes.height = height;
        });
    }

    mount(container) {
        container.append(this.#canvas);
    }

    getWebGlContext() {
        const gl = this.#canvas.getContext("webgl");
        if (!gl) {
            throwError("WebGL is not supported");
        }
        return gl;
    }

    on(event, handler) {
        this.#canvas.addEventListener(event, handler);
        return () => this.#canvas.removeEventListener(event, handler);
    }
}

export { View };
