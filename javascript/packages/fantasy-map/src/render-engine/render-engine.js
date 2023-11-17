import { observeResize } from "@hw/webgl-fundamentals/lib/utils.js";
import { baseFragmentShaderSource, baseVertexShaderSource } from "./shaders.js";
import { Sprite } from "./sprite.js";

const throwError = (what) => throw new Error(what);

const createShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const isSuccess = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (isSuccess) {
        return shader;
    }

    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throwError(log);
};

const createProgram = (gl, vertexShader, fragmentShader) => {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const isSuccess = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (isSuccess) {
        return program;
    }

    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throwError(log);
};

class RenderEngine {
    #gl;
    #canvasWidth = 0;
    #canvasHeight = 0;
    #program;

    #onSpriteDirty;
    #sprites = new Map();
    #dirtySprites = new Set();

    camera;

    constructor(canvasElement) {
        // get context
        const gl = canvasElement.getContext("webgl");
        if (!gl) {
            throwError("We don't have webgl Context!");
        }
        this.#gl = gl;

        // observe canvas element WxH
        observeResize(canvasElement, (width, height) => {
            this.#canvasWidth = width;
            this.#canvasHeight = height;
        });

        // create shaders & program
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, baseVertexShaderSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, baseFragmentShaderSource);
        const program = createProgram(gl, vertexShader, fragmentShader);
        gl.useProgram(program);
        this.#program = program;

        this.#onSpriteDirty = (sprite) => {
            this.#dirtySprites.add(sprite);
        };
    }

    loadSpriteSheet(image) {
        const gl = this.#gl;
        const texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }

    newSprite(x, y, width, height) {
        const sprite = new Sprite(x, y, width, height, this.#onSpriteDirty);
        this.#sprites.set(sprite, sprite);
        return sprite;
    }

    drawLoop = () => {
        /**
         *  - prepare vertex buffer object
         *      - per sprite I need:
         *          - vertex coordinates (12 points)
         *          - texture coordinate (12 points)
         *  - set camera matrix transform
         *
         *
         *
         * preparing vertex buffer object
         * - texture coordinates could be loaded once
         * - but I don't understand how to dynamically increase amount of sprites per request
         * - if everything I'm working with is just an array, thus I need go through every sprite to
         * retrieve it's position & sprite coordinates
         *
         *
         *
         * considering I have a big float32 array, that represents the whole
         */
    };
}

export { RenderEngine };
