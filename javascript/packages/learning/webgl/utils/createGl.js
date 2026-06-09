const createGl = () => {
    const container = document.querySelector("#container");

    const containerRect = container.getBoundingClientRect();
    const width = containerRect.width;
    const height = containerRect.height;

    const canvas = document.createElement("canvas");
    container.append(canvas);
    const gl = canvas.getContext("webgl");
    if (!gl) {
        throw new Error("WebGL not supported");
    }
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);

    return gl;
}

const createGlHighDPI = () => {
    const container = document.querySelector("#container");

    const containerRect = container.getBoundingClientRect();
    const desiredCSSWidth = containerRect.width;
    const desiredCSSHeight = containerRect.height;

    const canvas = document.createElement("canvas");
    container.append(canvas);
    const gl = canvas.getContext("webgl");
    if (!gl) {
        throw new Error("WebGL not supported");
    }

    canvas.width = desiredCSSWidth * devicePixelRatio;
    canvas.height = desiredCSSHeight * devicePixelRatio;

    canvas.style.width = desiredCSSWidth + "px";
    canvas.style.height = desiredCSSHeight + "px";

    gl.viewport(0, 0, canvas.width, canvas.height);

    return gl;
}

export { createGl, createGlHighDPI }