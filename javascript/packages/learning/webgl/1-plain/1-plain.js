const vertexShaderSource = `
    attribute vec2 a_position;
    
    void main() {
        gl_Position = vec4(a_position, 0, 1);
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    
    uniform vec4 u_color;
    
    void main() {
        gl_FragColor = u_color;
    }
`;

const main = () => {
    const container = document.querySelector("#container");
    const canvas = document.createElement("canvas");

    // 1. Create Context

    const gl = canvas.getContext("webgl");
    if (!gl) {
        throw new Error("WebGL not supported");
    }

    container.append(canvas);

    // 2. Set viewport

    const containerRect = container.getBoundingClientRect();

    const width = containerRect.width;
    const height = containerRect.height;

    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);

    // 3. Create Vertex shader

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    const isVertexShaderSuccess = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
    if (!isVertexShaderSuccess) {
        const log = gl.getShaderInfoLog(gl);
        throw new Error(log);
    }

    // 4. Create Fragment Shader

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    const isFragmentShaderSuccess = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
    if (!isFragmentShaderSuccess) {
        const log = gl.getShaderInfoLog(gl);
        throw new Error(log);
    }

    // 5. Link and use Program

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

    // 6. Create Buffer for Attributes (Verticies)

    const positionBuffer = gl.createBuffer();
    const positions = new Float32Array([
        -1, -1,
        0, 1,
        1, -1,
    ]);

    // 7. Move data to buffer

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // 8. Set attribute pointer to buffer

    const a_position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, true, 0, 0);


    // 9. Set uniform value

    const u_color = gl.getUniformLocation(program, "u_color");
    gl.uniform4f(u_color, Math.random(), Math.random(), Math.random(), 1);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
};

main();