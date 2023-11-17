import { voidFn } from "@hw/utils";
import { router } from "../router/router.js";
import { UiElement } from "../uiElement.js";
import { createMockHtmlElement } from "../../tests/mockHtmlElement.js";

const createElement =
    typeof document !== "undefined" ? (tagName) => document.createElement(tagName) : createMockHtmlElement;

const handleAnchorClickFabric =
    (onClick = voidFn) =>
    (e) => {
        e.preventDefault();
        router.push(e.target.getAttribute("href"));
        onClick(e);
    };

const elementFabric =
    (tagName) =>
    (props = {}) =>
        new UiElement(createElement(tagName), props);

const div = elementFabric("div");
const button = elementFabric("button");
const p = elementFabric("p");
const h1 = elementFabric("h1");
const h2 = elementFabric("h2");
const h3 = elementFabric("h3");
const h4 = elementFabric("h4");
const h5 = elementFabric("h5");
const h6 = elementFabric("h6");
const canvas = elementFabric("canvas");
const a = elementFabric("a");
const link = (props = {}) => a({ ...props, onClick: handleAnchorClickFabric(props.onClick) });
const input = elementFabric("input");
const label = elementFabric("label");
const checkbox = (props = {}) => input({ ...props, type: "checkbox" });
const img = elementFabric("img");

const from = (element) => new UiElement(element);

export { from, div, button, h1, h2, h3, h4, h5, h6, a, link, p, input, label, checkbox, img, canvas };
