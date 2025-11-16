const createWebGlContext = () => {
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
};

const createProgram = (gl) => {
    const vertexShaderSource = `
        attribute vec4 a_position;
        attribute float a_size;
        
        void main() {
            gl_PointSize = a_size;
            gl_Position = a_position;
        }
    `;

    const fragmentShaderSource = `
        precision mediump float;
        
        uniform vec4 u_color;
        
        void main() {
            gl_FragColor = u_color;
        }
    `;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    const isVertexShaderSuccess = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
    if (!isVertexShaderSuccess) {
        const log = gl.getShaderInfoLog(gl);
        throw new Error(log);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    const isFragmentShaderSuccess = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
    if (!isFragmentShaderSuccess) {
        const log = gl.getShaderInfoLog(gl);
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

    gl.useProgram(program);

    return gl;
};

const main = () => {
    const gl = createWebGlContext();

    const program = gl.createProgram();

    const verticesBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, verticesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verticesBuffer, gl.STATIC_DRAW);

    const a_position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, true, 0, 0);

    printGlParameters(gl);

    createProgram(gl);

    useSecondProgram(gl);
};

main();