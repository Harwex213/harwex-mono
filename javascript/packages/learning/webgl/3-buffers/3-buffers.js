import { createGl } from "../utils/createGl.js";
import { createProgram } from "../utils/createProgram.js";

/**
 * TODO:
 *  - [x] create buffer
 *  - [x] get buffer parameters to see state alter after applying commands affecting buffer
 *  - [x] buffer data
 *  - [x] buffer sub data
 */

const vertexShaderSource = `
    attribute vec4 a_position;
    uniform float u_size;
    
    void main() {
        gl_PointSize = u_size;
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

const logBuffer = (gl, bufferName) => {
    console.log(`${bufferName}; BUFFER_SIZE: `, gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE));
    console.log(`${bufferName}; BUFFER_USAGE: `, gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE));
};

const drawPoints = (gl, program) => {

    // 1. Create buffer

    const buffer = gl.createBuffer();

    // 2. Bind buffer before load data

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    logBuffer(gl, "DRAW 2; BUFFER 1");

    // 3. Load data to buffer

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0.0, 0.0, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4]), gl.STATIC_DRAW);

    logBuffer(gl, "DRAW 2; BUFFER 1");

    // 4. Obtain vertex position

    const a_position = gl.getAttribLocation(program, "a_position");

    // 5. Bind array buffer to generic attribute by specified index

    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, true, 0, 0);

    // 6. Draw

    gl.drawArrays(gl.POINTS, 0, 5);
};

const drawLines = (gl, program) => {

    // 1. Create buffer

    const buffer = gl.createBuffer();

    // 2. Bind buffer before load data

    logBuffer(gl, "DRAW 2; BUFFER 1");

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    logBuffer(gl, "DRAW 2; BUFFER 2");

    // 3. Load data to buffer

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.3, -0.3, -0.4, -0.4]), gl.STATIC_DRAW);

    logBuffer(gl, "DRAW 2; BUFFER 2");

    // 4. Override last two vertices

    const componentsPerVertex = 2;
    const toSkip = 1;
    const offset = Float32Array.BYTES_PER_ELEMENT * componentsPerVertex * toSkip;

    gl.bufferSubData(gl.ARRAY_BUFFER, offset, new Float32Array([-0.6, -0.6]));

    // 5. Draw (will actually use previously bound buffer, because the new one should be `vertexAttribPointer` again

    let numberOfLines = 2;

    gl.drawArrays(gl.LINES, 0, componentsPerVertex * numberOfLines);

    // 6. Draw with new buffer

    const a_position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, true, 0, 0);

    numberOfLines = 1;

    gl.drawArrays(gl.LINES, 0, componentsPerVertex * numberOfLines);
};

const main = () => {
    const gl = createGl();

    const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    gl.useProgram(program);

    const u_size = gl.getUniformLocation(program, "u_size");
    gl.uniform1f(u_size, 20.0);

    const u_color = gl.getUniformLocation(program, "u_color");
    gl.uniform4f(u_color, Math.random(), Math.random(), Math.random(), 1);

    drawPoints(gl, program);

    drawLines(gl, program);
};

main();