import { h, render } from "preact";
import "@hw/faenwald-uikit/theme.css";
import "./view/styles/base.css";
import "./view/styles/tokens.css";
import "./view/styles/components.css";
import { App } from "./view/app.jsx";

const main = () => {
  render(
    h(App),
    document.querySelector('#container'),
  );
};

main();