export const observeResize = (() => {
    const subscribers = new WeakMap();
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            let width;
            let height;
            if (entry.contentBoxSize) {
                if (entry.contentBoxSize[0]) {
                    width = entry.contentBoxSize[0].inlineSize;
                    height = entry.contentBoxSize[0].blockSize;
                } else {
                    // legacy
                    width = entry.contentBoxSize.inlineSize;
                    height = entry.contentBoxSize.blockSize;
                }
            } else {
                // legacy
                width = entry.contentRect.width;
                height = entry.contentRect.height;
            }
            const notify = subscribers.get(entry.target);
            if (notify) {
                notify(width, height);
            }
        }
    });

    return (element, notify) => {
        subscribers.set(element, notify);
        resizeObserver.observe(element, { box: "content-box" });
        const boundingRect = element.getBoundingClientRect();
        notify(boundingRect.width, boundingRect.height);
    };
})();

export const createShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const isSuccess = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (isSuccess) {
        return shader;
    }

    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log);
};

export const createProgram = (gl, vertexShader, fragmentShader) => {
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
    throw new Error(log);
};

export const createGlContext = () => {
    const container = document.querySelector("#container");
    const canvas = document.createElement("canvas");
    const canvasSizes = {
        width: 0,
        height: 0,
    };
    observeResize(container, (width, height) => {
        canvasSizes.width = width;
        canvasSizes.height = height;
    });
    const gl = canvas.getContext("webgl");
    if (!gl) {
        throw new Error("We don't have webgl Context!");
    }
    container.append(canvas);
    return { gl, canvas, canvasSizes };
};

export const updateViewportFactory = (canvasSizes) => (gl) => {
    const oldWidth = gl.canvas.width;
    const oldHeight = gl.canvas.height;
    const newWidth = canvasSizes.width;
    const newHeight = canvasSizes.height;
    const needResize = newWidth !== oldWidth || newHeight !== oldHeight;

    if (needResize) {
        gl.canvas.width = newWidth;
        gl.canvas.height = newHeight;
        gl.viewport(0, 0, newWidth, newHeight);
    }
};
