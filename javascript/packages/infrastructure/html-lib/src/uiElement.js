import { randomKey } from "@hw/utils";
import { effect } from "@hw/signals";
import { RESERVED_PROPS } from "./constants.js";

const attachProps = (htmlElement, props, eventListenersMap) => {
    for (const [key, value] of Object.entries(props)) {
        if (RESERVED_PROPS.includes(key)) {
            continue;
        }
        if (key[0] === "o" && key[1] === "n") {
            let name = "";
            if (key.toLowerCase() in htmlElement || key === "onFocusOut" || key === "onFocusIn") {
                name = key.toLowerCase().slice(2);
            } else {
                name = key.slice(2);
            }

            if (eventListenersMap.has(name)) {
                const existedEventListener = eventListenersMap.get(name);

                if (existedEventListener === value) {
                    continue;
                }

                htmlElement.removeEventListener(name, existedEventListener);
                htmlElement.addEventListener(name, value);
                eventListenersMap.set(name, value);
            } else {
                htmlElement.addEventListener(name, value);
                eventListenersMap.set(name, value);
            }
        } else if (key === "checked") {
            htmlElement.setAttribute("class", value);
            htmlElement.checked = value;
        } else if (key === "className") {
            htmlElement.setAttribute("class", value);
        } else {
            htmlElement.setAttribute(key, value);
        }
    }
};

class UiElement {
    key;
    htmlElement;
    #children = [];
    #finalizers = [];
    #eventListenersMap = new Map();

    constructor(htmlElement, props = {}) {
        this.htmlElement = htmlElement;
        this.key = props.key ?? randomKey();

        attachProps(this.htmlElement, props, this.#eventListenersMap);
    }

    #clearChildren() {
        for (const child of this.#children) {
            child.destroy();
        }
        this.#children = [];

        this.htmlElement.replaceChildren();
    }

    addFinalizer(finalizer) {
        this.#finalizers.push(finalizer);
    }

    assocEffect(fn) {
        this.addFinalizer(effect(fn));
    }

    finalize() {
        for (const finalizer of this.#finalizers) {
            finalizer();
        }
        for (const [name, eventListener] of this.#eventListenersMap) {
            this.htmlElement.removeEventListener(name, eventListener);
        }
        this.#eventListenersMap.clear();
    }

    destroy() {
        for (const child of this.#children) {
            child.destroy();
        }
        this.finalize();

        this.htmlElement.remove();
    }

    children(uiElements) {
        if (!uiElements || uiElements.length === 0) {
            this.#clearChildren();
            return this;
        }

        const traverseArray = this.#children.length >= uiElements.length ? this.#children : uiElements;

        for (let i = 0; i < traverseArray.length; i++) {
            const previous = this.#children[i];
            const current = uiElements[i];

            if (!current) {
                previous.destroy();
                continue;
            }

            if (!previous) {
                this.htmlElement.append(current.htmlElement);
                continue;
            }

            if (previous.key !== current.key) {
                previous.htmlElement.replaceWith(current.htmlElement);
                previous.destroy();
            }
        }

        this.#children = uiElements;

        return this;
    }

    child(uiElement) {
        return this.children([uiElement]);
    }

    content(text) {
        return this.child(new UiElement(new Text(text)));
    }

    props(props) {
        attachProps(this.htmlElement, props, this.#eventListenersMap);
    }
}

export { UiElement };
