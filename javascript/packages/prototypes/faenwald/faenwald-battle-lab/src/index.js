import { h, render } from 'https://esm.sh/preact';
import { useState } from 'https://esm.sh/preact/hooks';
import htm from 'https://esm.sh/htm';

// Initialize htm with Preact
const html = htm.bind(h);

function Main(props) {
  return h("p", null, `Clicked x${props.amount} times`);
}

function App(props) {
  const [value, setValue] = useState(0);

  const onClick = () => {
    setValue(value + 1);
  };

  return html`
      <header>
          <h1 onClick=${onClick}>Hello ${props.name}!</h1>
      </header>
      <main>
          <${Main} amount=${value}/>
      </main>
  `;
}

console.log(`<${App} name="World"/>`);

render(
  html`
      <${App} name="World"/>
  `,
  document.querySelector("#container")
);