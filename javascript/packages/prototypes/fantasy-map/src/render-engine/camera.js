import { mat2d_create, mat2d_setScale } from "./math/mat2d.js";

class Camera {
    #matrix;

    width;
    height;

    constructor(options) {
        const { width, height } = options;

        this.width = Math.max(width, 0);
        this.height = Math.max(height, 0);

        this.#matrix = mat2d_create();
    }

    scale(x, y) {
        mat2d_setScale(this.#matrix, x, y);
    }
}
