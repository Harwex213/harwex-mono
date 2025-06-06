import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/app.js";
import "./client/ws";

const container = document.getElementById("app");
const root = createRoot(container);
root.render(createElement(App));
