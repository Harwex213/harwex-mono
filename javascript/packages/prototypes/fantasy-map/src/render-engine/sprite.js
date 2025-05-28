import { rect_create } from "./math/rect.js";

const I_X = 0;
const I_Y = 1;
const I_WIDTH = 2;
const I_HEIGHT = 3;

class Sprite {
    #position = [0, 0, 0, 0];
    #onDirty;

    constructor(x, y, width, height, onDirty) {
        this.#position = [x, y, width, height];
        this.#onDirty = onDirty;
        this.#onDirty(this);
    }

    set x(x) {
        this.#position[I_X] = x;
        this.#onDirty(this);
    }

    set y(y) {
        this.#position[I_Y] = y;
        this.#onDirty(this);
    }

    set width(width) {
        this.#position[I_WIDTH] = width;
        this.#onDirty(this);
    }

    set height(height) {
        this.#position[I_HEIGHT] = height;
        this.#onDirty(this);
    }

    exposePosition() {
        return rect_create(this.#position);
    }
}

export { Sprite };
