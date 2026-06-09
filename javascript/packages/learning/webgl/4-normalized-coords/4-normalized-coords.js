import { createGlHighDPI } from "../utils/createGl.js";
import { createProgram } from "../utils/createProgram.js";
import { VERTEX_PER_LINE, VERTEX_PER_POINT } from "../utils/contants.js";

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

const printMousePos = (el, x, y, clipX, clipY) => {
    el.innerHTML = `<div>x: ${x}</div><div>y: ${y}</div><div>clipX: ${clipX.toFixed(2)}</div><div>clipY: ${clipY.toFixed(2)}</div>`;
}

const main = () => {
    const gl = createGlHighDPI();

    const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    gl.useProgram(program);

    const u_size = gl.getUniformLocation(program, "u_size");
    gl.uniform1f(u_size, 35.0);
    gl.lineWidth(2.0);

    const u_color = gl.getUniformLocation(program, "u_color");
    gl.uniform4f(u_color, Math.random(), Math.random(), Math.random(), 1);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const a_position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, true, 0, 0);

    const mouseState = {
        x: 0,
        y: 0,
    }

    document.addEventListener("mousemove", (e) => {
        mouseState.x = e.clientX;
        mouseState.y = e.clientY;
    });

    const infoEl = document.querySelector("#info");

    const POINTS_AMOUNT = 4;
    const LINES_AMOUNT = 2;

    const drawPoint = () => {
        const clipX = (mouseState.x / gl.canvas.width * devicePixelRatio) * 2 - 1;
        const clipY = (mouseState.y / gl.canvas.height * devicePixelRatio) * 2 - 1;

        // We need multiply it with negative, because DOM coordinate system has traversed Y axis
        const actualPoint = [clipX, clipY * -1];

        const pointTraversedY = [clipX, clipY];

        const pointTraversedX = [clipX * -1, clipY];

        const pointTraversedXY = [clipX * -1, clipY * -1];

        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            // POINTS
            actualPoint[0], actualPoint[1],

            pointTraversedY[0], pointTraversedY[1],

            pointTraversedX[0], pointTraversedX[1],

            pointTraversedXY[0], pointTraversedXY[1],

            // LINES
            actualPoint[0], actualPoint[1],
            pointTraversedX[0], pointTraversedX[1],

            pointTraversedY[0], pointTraversedY[1],
            pointTraversedXY[0], pointTraversedXY[1],
        ]), gl.STATIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, POINTS_AMOUNT * VERTEX_PER_POINT);
        gl.drawArrays(gl.LINES, POINTS_AMOUNT * VERTEX_PER_POINT, LINES_AMOUNT * VERTEX_PER_LINE);
        printMousePos(infoEl, mouseState.x, mouseState.y, clipX, clipY);
        requestAnimationFrame(drawPoint);
    };

    drawPoint();
};

main();