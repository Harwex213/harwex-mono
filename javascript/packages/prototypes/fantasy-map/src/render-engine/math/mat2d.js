const INDEX_A = 0;
const INDEX_B = 1;
const INDEX_C = 2;
const INDEX_D = 3;
const INDEX_TX = 4;
const INDEX_TY = 5;

/**
 * | a | c | tx |
 * | b | d | ty |
 */
export const mat2d_create = (a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) => {
    const array = new Float32Array(6);

    array[INDEX_A] = a;
    array[INDEX_B] = b;
    array[INDEX_C] = c;
    array[INDEX_D] = d;
    array[INDEX_TX] = tx;
    array[INDEX_TY] = ty;

    return array;
};

export const mat2d_setScale = (mat2d, x, y) => {
    mat2d[INDEX_A] = x;
    mat2d[INDEX_D] = y;
    
    return mat2d;
};

export const mat2d_scale = (mat2d, x, y) => mat2d;

export const mat2d_translate = (mat2d, x, y) => mat2d;

export const mat2d_rotateZ = (mat2d, rad) => mat2d;
