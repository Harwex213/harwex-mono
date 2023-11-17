import { createGlContext, createProgram, createShader, updateViewportFactory } from "../lib/utils.js";
import Matrix from "../lib/matrix.js";
import Point from "../lib/point.js";

const vertexShaderSource = `
    uniform vec2 u_resolution;
    uniform mat4 u_transform;
    attribute vec2 a_rect;
    attribute vec2 a_texture;
    varying vec2 v_texCoord;
    
    vec4 toVec4(vec2 source) {
        return vec4(source, 0, 1);
    }
    
    vec4 toClipSpace(vec4 source) {
        vec4 zeroToOne = source / toVec4(u_resolution);
        vec4 zeroToTwo = zeroToOne * 2.0;
        vec4 clipSpace = zeroToTwo - 1.0;
        return clipSpace * toVec4(vec2(1, -1));
    }
    
    void main() {
        vec4 initialPos = vec4(a_rect, 0, 1);
        vec4 final_pos = u_transform * initialPos;
        
        gl_Position = toClipSpace(final_pos);
        v_texCoord = a_texture;
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    
    uniform sampler2D u_image;
    varying vec2 v_texCoord;
    
    void main() {
        gl_FragColor = texture2D(u_image, v_texCoord);
    }
`;

const loadImage = () =>
    new Promise((resolve) => {
        const image = new Image();
        image.src = new URL("karta.png", import.meta.url);
        image.onload = () => resolve(image);
    });

function setRectangle(gl, x, y, width, height) {
    const x1 = x;
    const x2 = x + width;
    const y1 = y;
    const y2 = y + height;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2]), gl.STATIC_DRAW);
}

const OPTIONS = {
    /**
     * Scaling factor for non-DOM_DELTA_PIXEL scrolling events
     */
    LINE_HEIGHT: 20,

    /**
     * Percent to scroll with each spin
     */
    PERCENT: 0.02,

    /**
     * smooth the zooming by providing the number of frames to zoom between wheel spins
     */
    SMOOTH: 1,
};

const context = {
    transformMatrix: Matrix.IDENTITY,
    scale: {
        isDirty: false,
        value: new Point(1, 1),
        center: new Point(),
    },
};

const imageProcessing = async () => {
    const waitImage = loadImage();

    const { transformMatrix, scale } = context;
    const { gl, canvasSizes } = createGlContext();

    const updateOffset = (e) => {
        transformMatrix.translate(e.movementX, e.movementY);
    };
    document.addEventListener("mousedown", () => {
        document.addEventListener("pointermove", updateOffset);
    });
    document.addEventListener("mouseup", () => {
        document.removeEventListener("pointermove", updateOffset);
    });
    document.addEventListener("wheel", (e) => {
        const { clientX, clientY, deltaY } = e;

        const scaleChange = 1 + (deltaY < 0 ? OPTIONS.PERCENT : -OPTIONS.PERCENT);

        scale.isDirty = true;
        scale.value.set(transformMatrix.scaleX * scaleChange, transformMatrix.scaleY * scaleChange);
        scale.center.set(clientX, clientY);

        // console.log("scaleChange", scaleChange, deltaY);
        // console.log("scale.value", transformMatrix.scaleX * scaleChange - transformMatrix.scaleX);
    });

    const updateViewport = updateViewportFactory(canvasSizes);
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = createProgram(gl, vertexShader, fragmentShader);

    const rectCoordinate = gl.getAttribLocation(program, "a_rect");
    const textureCoordinate = gl.getAttribLocation(program, "a_texture");
    const transform = gl.getUniformLocation(program, "u_transform");
    const resolution = gl.getUniformLocation(program, "u_resolution");

    const rectCoordinateBuffer = gl.createBuffer();
    const textureCoordinateBuffer = gl.createBuffer();

    const image = await waitImage;
    context.imageWidth = image.width;
    context.imageHeight = image.height;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectCoordinateBuffer);
    setRectangle(gl, 0, 0, image.width, image.height);
    gl.bufferSubData(gl.ARRAY_BUFFER, Float32Array.BYTES_PER_ELEMENT * 2 * 5, new Float32Array([100, 100, 110, 100]));
    console.log(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE));
    console.log(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE));
    gl.enableVertexAttribArray(rectCoordinate);
    gl.vertexAttribPointer(rectCoordinate, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordinateBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]),
        gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(textureCoordinate);
    gl.vertexAttribPointer(textureCoordinate, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    gl.useProgram(program);

    const localPointBeforeScale = new Point();
    const globalPointAfterScale = new Point();

    let callFromDirty = 0;

    const drawScene = () => {
        updateViewport(gl);

        if (scale.isDirty) {
            // callFromDirty = 1;
            scale.isDirty = false;

            transformMatrix.applyInverse(scale.center, localPointBeforeScale);
            transformMatrix.setScale(scale.value.x, scale.value.y);
            transformMatrix.apply(localPointBeforeScale, globalPointAfterScale);
            transformMatrix.translate(
                scale.center.x - globalPointAfterScale.x,
                scale.center.y - globalPointAfterScale.y,
            );
            // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
        // if (callFromDirty > 0) {
        //     callFromDirty++;
        // }
        // if (callFromDirty > 31 && scale.value.x > 1) {
        //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        // }

        gl.uniform2f(resolution, gl.canvas.width, gl.canvas.height);
        gl.uniformMatrix4fv(transform, false, transformMatrix.toWebglArray());

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        requestAnimationFrame(drawScene);
    };

    drawScene();
};

imageProcessing();
