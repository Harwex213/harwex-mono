// https://github.com/lukeed/clsx/blob/925494cf31bcd97d3337aacd34e659e80cae7fe2/src/index.js

function toVal(mix) {
    var k,
        y,
        str = "";

    if (typeof mix === "string" || typeof mix === "number") {
        str += mix;
    } else if (typeof mix === "object") {
        if (Array.isArray(mix)) {
            var len = mix.length;
            for (k = 0; k < len; k++) {
                if (mix[k]) {
                    if ((y = toVal(mix[k]))) {
                        str && (str += " ");
                        str += y;
                    }
                }
            }
        } else {
            for (y in mix) {
                if (mix[y]) {
                    str && (str += " ");
                    str += y;
                }
            }
        }
    }

    return str;
}

function clsx() {
    var i = 0,
        tmp,
        x,
        str = "",
        len = arguments.length;
    for (; i < len; i++) {
        if ((tmp = arguments[i])) {
            if ((x = toVal(tmp))) {
                str && (str += " ");
                str += x;
            }
        }
    }
    return str;
}

export { clsx };
