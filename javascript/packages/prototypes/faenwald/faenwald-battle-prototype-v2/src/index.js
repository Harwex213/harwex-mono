import { h, render } from "preact";
import "@hw/faenwald-uikit/theme.css";
import { App } from "./view/app.jsx";

const main = () => {
  render(
    h(App),
    document.querySelector('#container'),
  );
};

main();