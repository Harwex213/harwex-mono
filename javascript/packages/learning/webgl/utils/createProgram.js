const createProgram = (gl, vertexShaderSource, fragmentShaderSource) => {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    const isVertexShaderSuccess = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
    if (!isVertexShaderSuccess) {
        const log = gl.getShaderInfoLog(vertexShader);
        throw new Error(log);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    const isFragmentShaderSuccess = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
    if (!isFragmentShaderSuccess) {
        const log = gl.getShaderInfoLog(fragmentShader);
        throw new Error(log);
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const isProgramSuccess = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!isProgramSuccess) {
        const log = gl.getProgramInfoLog(program);
        throw new Error(log);
    }

    return program;
};

export { createProgram };