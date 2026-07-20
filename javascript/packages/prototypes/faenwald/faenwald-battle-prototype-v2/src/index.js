import { html, render } from "htm/preact";
import "@hw/faenwald-uikit/theme.css";
import { App } from "./view/app.js";

const main = () => {


  render(
    html`
      <${App}/>
    `,
    document.querySelector('#container'),
  );

};

main();