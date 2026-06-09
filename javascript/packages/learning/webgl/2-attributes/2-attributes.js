/**
 * TODO:
 *  - [x] load attribute as single value
 *  - [x] load attribute as vector
 *  - [x] get info about active / nonactive attribute
 */

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

const printGlParameters = (gl) => {
    console.log("GL; ", "ACTIVE_TEXTURE: ", gl.getParameter(gl.ACTIVE_TEXTURE));
    console.log("GL; ", "ALIASED_LINE_WIDTH_RANGE: ", gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE));
    console.log("GL; ", "ALIASED_POINT_SIZE_RANGE: ", gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE));
    console.log("GL; ", "ALPHA_BITS: ", gl.getParameter(gl.ALPHA_BITS));
    console.log("GL; ", "ARRAY_BUFFER_BINDING: ", gl.getParameter(gl.ARRAY_BUFFER_BINDING));
    console.log("GL; ", "BLEND: ", gl.getParameter(gl.BLEND));
    console.log("GL; ", "BLEND_COLOR: ", gl.getParameter(gl.BLEND_COLOR));
    console.log("GL; ", "BLEND_DST_ALPHA: ", gl.getParameter(gl.BLEND_DST_ALPHA));
    console.log("GL; ", "BLEND_DST_RGB: ", gl.getParameter(gl.BLEND_DST_RGB));
    console.log("GL; ", "BLEND_EQUATION_ALPHA: ", gl.getParameter(gl.BLEND_EQUATION_ALPHA));
    console.log("GL; ", "BLEND_EQUATION_RGB: ", gl.getParameter(gl.BLEND_EQUATION_RGB));
    console.log("GL; ", "BLEND_SRC_ALPHA: ", gl.getParameter(gl.BLEND_SRC_ALPHA));
    console.log("GL; ", "BLEND_SRC_RGB: ", gl.getParameter(gl.BLEND_SRC_RGB));
    console.log("GL; ", "BLUE_BITS: ", gl.getParameter(gl.BLUE_BITS));
    console.log("GL; ", "COLOR_CLEAR_VALUE: ", gl.getParameter(gl.COLOR_CLEAR_VALUE));
    console.log("GL; ", "COLOR_WRITEMASK: ", gl.getParameter(gl.COLOR_WRITEMASK));
    console.log("GL; ", "COMPRESSED_TEXTURE_FORMATS: ", gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS));
    console.log("GL; ", "CULL_FACE: ", gl.getParameter(gl.CULL_FACE));
    console.log("GL; ", "CULL_FACE_MODE: ", gl.getParameter(gl.CULL_FACE_MODE));
    console.log("GL; ", "CURRENT_PROGRAM: ", gl.getParameter(gl.CURRENT_PROGRAM));
    console.log("GL; ", "DEPTH_BITS: ", gl.getParameter(gl.DEPTH_BITS));
    console.log("GL; ", "DEPTH_CLEAR_VALUE: ", gl.getParameter(gl.DEPTH_CLEAR_VALUE));
    console.log("GL; ", "DEPTH_FUNC: ", gl.getParameter(gl.DEPTH_FUNC));
    console.log("GL; ", "DEPTH_RANGE: ", gl.getParameter(gl.DEPTH_RANGE));
    console.log("GL; ", "DEPTH_TEST: ", gl.getParameter(gl.DEPTH_TEST));
    console.log("GL; ", "DEPTH_WRITEMASK: ", gl.getParameter(gl.DEPTH_WRITEMASK));
    console.log("GL; ", "DITHER: ", gl.getParameter(gl.DITHER));
    console.log("GL; ", "ELEMENT_ARRAY_BUFFER_BINDING: ", gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING));
    console.log("GL; ", "FRAMEBUFFER_BINDING: ", gl.getParameter(gl.FRAMEBUFFER_BINDING));
    console.log("GL; ", "FRONT_FACE: ", gl.getParameter(gl.FRONT_FACE));
    console.log("GL; ", "GENERATE_MIPMAP_HINT: ", gl.getParameter(gl.GENERATE_MIPMAP_HINT));
    console.log("GL; ", "GREEN_BITS: ", gl.getParameter(gl.GREEN_BITS));
    console.log("GL; ", "IMPLEMENTATION_COLOR_READ_FORMAT: ", gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT));
    console.log("GL; ", "IMPLEMENTATION_COLOR_READ_TYPE: ", gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE));
    console.log("GL; ", "LINE_WIDTH: ", gl.getParameter(gl.LINE_WIDTH));
    console.log("GL; ", "MAX_COMBINED_TEXTURE_IMAGE_UNITS: ", gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
    console.log("GL; ", "MAX_CUBE_MAP_TEXTURE_SIZE: ", gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE));
    console.log("GL; ", "MAX_FRAGMENT_UNIFORM_VECTORS: ", gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS));
    console.log("GL; ", "MAX_RENDERBUFFER_SIZE: ", gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    console.log("GL; ", "MAX_TEXTURE_IMAGE_UNITS: ", gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    console.log("GL; ", "MAX_TEXTURE_SIZE: ", gl.getParameter(gl.MAX_TEXTURE_SIZE));
    console.log("GL; ", "MAX_VARYING_VECTORS: ", gl.getParameter(gl.MAX_VARYING_VECTORS));
    console.log("GL; ", "MAX_VERTEX_ATTRIBS: ", gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
    console.log("GL; ", "MAX_VERTEX_TEXTURE_IMAGE_UNITS: ", gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS));
    console.log("GL; ", "MAX_VERTEX_UNIFORM_VECTORS: ", gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS));
    console.log("GL; ", "MAX_VIEWPORT_DIMS: ", gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    console.log("GL; ", "PACK_ALIGNMENT: ", gl.getParameter(gl.PACK_ALIGNMENT));
    console.log("GL; ", "POLYGON_OFFSET_FACTOR: ", gl.getParameter(gl.POLYGON_OFFSET_FACTOR));
    console.log("GL; ", "POLYGON_OFFSET_FILL: ", gl.getParameter(gl.POLYGON_OFFSET_FILL));
    console.log("GL; ", "POLYGON_OFFSET_UNITS: ", gl.getParameter(gl.POLYGON_OFFSET_UNITS));
    console.log("GL; ", "RED_BITS: ", gl.getParameter(gl.RED_BITS));
    console.log("GL; ", "RENDERBUFFER_BINDING: ", gl.getParameter(gl.RENDERBUFFER_BINDING));
    console.log("GL; ", "RENDERER: ", gl.getParameter(gl.RENDERER));
    console.log("GL; ", "SAMPLE_ALPHA_TO_COVERAGE: ", gl.getParameter(gl.SAMPLE_ALPHA_TO_COVERAGE));
    console.log("GL; ", "SAMPLE_BUFFERS: ", gl.getParameter(gl.SAMPLE_BUFFERS));
    console.log("GL; ", "SAMPLE_COVERAGE: ", gl.getParameter(gl.SAMPLE_COVERAGE));
    console.log("GL; ", "SAMPLE_COVERAGE_INVERT: ", gl.getParameter(gl.SAMPLE_COVERAGE_INVERT));
    console.log("GL; ", "SAMPLE_COVERAGE_VALUE: ", gl.getParameter(gl.SAMPLE_COVERAGE_VALUE));
    console.log("GL; ", "SAMPLES: ", gl.getParameter(gl.SAMPLES));
    console.log("GL; ", "SCISSOR_BOX: ", gl.getParameter(gl.SCISSOR_BOX));
    console.log("GL; ", "SCISSOR_TEST: ", gl.getParameter(gl.SCISSOR_TEST));
    console.log("GL; ", "SHADING_LANGUAGE_VERSION: ", gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
    console.log("GL; ", "STENCIL_BACK_FAIL: ", gl.getParameter(gl.STENCIL_BACK_FAIL));
    console.log("GL; ", "STENCIL_BACK_FUNC: ", gl.getParameter(gl.STENCIL_BACK_FUNC));
    console.log("GL; ", "STENCIL_BACK_PASS_DEPTH_FAIL: ", gl.getParameter(gl.STENCIL_BACK_PASS_DEPTH_FAIL));
    console.log("GL; ", "STENCIL_BACK_PASS_DEPTH_PASS: ", gl.getParameter(gl.STENCIL_BACK_PASS_DEPTH_PASS));
    console.log("GL; ", "STENCIL_BACK_REF: ", gl.getParameter(gl.STENCIL_BACK_REF));
    console.log("GL; ", "STENCIL_BACK_VALUE_MASK: ", gl.getParameter(gl.STENCIL_BACK_VALUE_MASK));
    console.log("GL; ", "STENCIL_BACK_WRITEMASK: ", gl.getParameter(gl.STENCIL_BACK_WRITEMASK));
    console.log("GL; ", "STENCIL_BITS: ", gl.getParameter(gl.STENCIL_BITS));
    console.log("GL; ", "STENCIL_CLEAR_VALUE: ", gl.getParameter(gl.STENCIL_CLEAR_VALUE));
    console.log("GL; ", "STENCIL_FAIL: ", gl.getParameter(gl.STENCIL_FAIL));
    console.log("GL; ", "STENCIL_FUNC: ", gl.getParameter(gl.STENCIL_FUNC));
    console.log("GL; ", "STENCIL_PASS_DEPTH_FAIL: ", gl.getParameter(gl.STENCIL_PASS_DEPTH_FAIL));
    console.log("GL; ", "STENCIL_PASS_DEPTH_PASS: ", gl.getParameter(gl.STENCIL_PASS_DEPTH_PASS));
    console.log("GL; ", "STENCIL_REF: ", gl.getParameter(gl.STENCIL_REF));
    console.log("GL; ", "STENCIL_TEST: ", gl.getParameter(gl.STENCIL_TEST));
    console.log("GL; ", "STENCIL_VALUE_MASK: ", gl.getParameter(gl.STENCIL_VALUE_MASK));
    console.log("GL; ", "STENCIL_WRITEMASK: ", gl.getParameter(gl.STENCIL_WRITEMASK));
    console.log("GL; ", "SUBPIXEL_BITS: ", gl.getParameter(gl.SUBPIXEL_BITS));
    console.log("GL; ", "TEXTURE_BINDING_2D: ", gl.getParameter(gl.TEXTURE_BINDING_2D));
    console.log("GL; ", "TEXTURE_BINDING_CUBE_MAP: ", gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP));
    console.log("GL; ", "UNPACK_ALIGNMENT: ", gl.getParameter(gl.UNPACK_ALIGNMENT));
    console.log("GL; ", "UNPACK_COLORSPACE_CONVERSION_WEBGL: ", gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL));
    console.log("GL; ", "UNPACK_FLIP_Y_WEBGL: ", gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL));
    console.log("GL; ", "UNPACK_PREMULTIPLY_ALPHA_WEBGL: ", gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL));
    console.log("GL; ", "VENDOR: ", gl.getParameter(gl.VENDOR));
    console.log("GL; ", "VERSION: ", gl.getParameter(gl.VERSION));
    console.log("GL; ", "VIEWPORT: ", gl.getParameter(gl.VIEWPORT));
}

const useFirstProgram = (gl) => {
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
    gl.useProgram(program);

    console.log("FIRST_PROGRAM; ", "DELETE_STATUS: ", gl.getProgramParameter(program, gl.DELETE_STATUS));
    console.log("FIRST_PROGRAM; ", "LINK_STATUS: ", gl.getProgramParameter(program, gl.LINK_STATUS));
    console.log("FIRST_PROGRAM; ", "VALIDATE_STATUS: ", gl.getProgramParameter(program, gl.VALIDATE_STATUS));
    console.log("FIRST_PROGRAM; ", "ATTACHED_SHADERS: ", gl.getProgramParameter(program, gl.ATTACHED_SHADERS));
    console.log("FIRST_PROGRAM; ", "ACTIVE_ATTRIBUTES: ", gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES));
    console.log("FIRST_PROGRAM; ", "ACTIVE_UNIFORMS: ", gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));

    // 1. Get Attribute location

    const a_position = gl.getAttribLocation(program, "a_position");

    // 2. Load value to generic attribute (and implicitly bind 'a_positon' named attribute with generic attribute by that index)

    gl.vertexAttrib2f(a_position, 0.5, 0.5);

    console.log("FIRST_PROGRAM; a_position; ", "a_position: ", a_position);
    console.log("FIRST_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING));
    console.log("FIRST_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_ENABLED: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_ENABLED));
    console.log("FIRST_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_SIZE: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_SIZE));
    console.log("FIRST_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_STRIDE: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_STRIDE));
    console.log("FIRST_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_TYPE: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_TYPE));
    console.log("FIRST_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_NORMALIZED: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED));
    console.log("FIRST_PROGRAM; a_position; ", "CURRENT_VERTEX_ATTRIB: ", gl.getVertexAttrib(a_position, gl.CURRENT_VERTEX_ATTRIB));
    console.log("FIRST_PROGRAM; a_position; ", "getActiveAttribL ", gl.getActiveAttrib(program, a_position));

    const a_size = gl.getAttribLocation(program, "a_size");
    gl.vertexAttrib1f(a_size, 20.0);

    const u_color = gl.getUniformLocation(program, "u_color");

    gl.uniform4f(u_color, Math.random(), Math.random(), Math.random(), 1);

    gl.drawArrays(gl.POINTS, 0, 1);
}

const vertexShaderSource2 = `
    attribute vec4 a_position;
    attribute vec4 a_size;
    
    void main() {
        gl_PointSize = a_size.x + a_size.y + a_size.z;
        gl_Position = a_position;
    }
`;

const fragmentShaderSource2 = `
    precision mediump float;
    
    uniform vec4 u_color;
    
    void main() {
        gl_FragColor = u_color;
    }
`;

const useSecondProgram = (gl) => {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource2);
    gl.compileShader(vertexShader);
    const isVertexShaderSuccess = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
    if (!isVertexShaderSuccess) {
        const log = gl.getShaderInfoLog(vertexShader);
        throw new Error(log);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource2);
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
    gl.useProgram(program);

    // 1. Get Attribute location

    const a_position = gl.getAttribLocation(program, "a_position");

    // 2. Load value to generic attribute (and implicitly bind 'a_positon' named attribute with generic attribute by that index)

    gl.vertexAttrib2f(a_position, 0.1, 0.1);

    console.log("SECOND_PROGRAM; a_position; ", "a_position: ", a_position);
    console.log("SECOND_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING));
    console.log("SECOND_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_ENABLED: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_ENABLED));
    console.log("SECOND_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_SIZE: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_SIZE));
    console.log("SECOND_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_STRIDE: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_STRIDE));
    console.log("SECOND_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_TYPE: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_TYPE));
    console.log("SECOND_PROGRAM; a_position; ", "VERTEX_ATTRIB_ARRAY_NORMALIZED: ", gl.getVertexAttrib(a_position, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED));
    console.log("SECOND_PROGRAM; a_position; ", "CURRENT_VERTEX_ATTRIB: ", gl.getVertexAttrib(a_position, gl.CURRENT_VERTEX_ATTRIB));
    console.log("SECOND_PROGRAM; a_position; ", "getActiveAttribL ", gl.getActiveAttrib(program, a_position));

    const a_size = gl.getAttribLocation(program, "a_size");

    gl.vertexAttrib3fv(a_size, [20.0, 40.0, 60.0]);

    const u_color = gl.getUniformLocation(program, "u_color");
    gl.uniform4f(u_color, Math.random(), Math.random(), Math.random(), 1);

    gl.drawArrays(gl.POINTS, 0, 1);
}

const main = () => {
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

    printGlParameters(gl);

    useFirstProgram(gl);

    useSecondProgram(gl);
};

main();