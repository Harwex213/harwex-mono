import { isArray } from "@hw/utils";
import assert from "node:assert";

class MockHtmlElement {
    name = "unresolved";
    removed = false;
    parent = null;
    attributes = {};
    eventListeners = {};
    children = [];

    constructor(name) {
        this.name = name;
    }

    setAttribute(key, value) {
        this.attributes[key] = value;
    }

    #getEventListenersScope(key) {
        let scope = this.eventListeners[key];
        if (scope && isArray(scope)) {
            return scope;
        }

        scope = [];
        this.eventListeners[key] = scope;

        return scope;
    }

    addEventListener(key, fn) {
        const scope = this.#getEventListenersScope(key);
        scope.push(fn);
    }

    removeEventListener(key, _fn) {
        const scope = this.#getEventListenersScope(key);
        this.eventListeners[key] = scope.filter((fn) => fn !== _fn);
    }

    remove() {
        this.removed = true;
    }

    #assertHtmlElement(htmlElement) {
        assert.strictEqual(htmlElement instanceof MockHtmlElement, true, "htmlElement should be a mockHtmlElement");
    }

    append(htmlElement) {
        this.#assertHtmlElement(htmlElement);

        this.children.push(htmlElement);
        htmlElement.parent = this;
    }

    replaceWith(htmlElement) {
        this.#assertHtmlElement(htmlElement);

        const parentHtmlElement = this.parent;
        const index = parentHtmlElement.children.indexOf(this);

        assert.notStrictEqual(index, -1, "didn't found html element among children of parent");

        parentHtmlElement.children[index] = htmlElement;
        htmlElement.parent = parentHtmlElement;
    }

    replaceChildren(...newChildren) {
        for (const newChild of newChildren) {
        }

        this.children = newChildren;
    }
}

const createMockHtmlElement = (tagName) => new MockHtmlElement(tagName);

export { createMockHtmlElement };
