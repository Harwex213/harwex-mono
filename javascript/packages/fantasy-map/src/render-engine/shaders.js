export const baseVertexShaderSource = `
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

export const baseFragmentShaderSource = `
    precision mediump float;
    
    uniform sampler2D u_image;
    varying vec2 v_texCoord;
    
    void main() {
        gl_FragColor = texture2D(u_image, v_texCoord);
    }
`;
