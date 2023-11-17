import { signal } from "@hw/signals";
import { describe, it } from "node:test";
import assert from "node:assert";
import { button, div } from "../src/uiElements/htmlElements.js";

describe("uiElement", () => {
    it("should create children", () => {
        const uiElement = div();

        uiElement.children([div(), div(), div()]);

        const { children } = uiElement.htmlElement;

        assert.strictEqual(children.length, 3);
    });

    it("should replace children with effect", () => {
        const reactiveState = signal(3);
        const container = div();

        container.assocEffect(() => {
            const amount = reactiveState.value;

            const newChildren = [...Array(amount)].map(() => div());

            newChildren.push(button());

            container.children(newChildren);
        });

        reactiveState.value = 5;

        const { children } = container.htmlElement;

        assert.strictEqual(children.length, 6);
    });
});
