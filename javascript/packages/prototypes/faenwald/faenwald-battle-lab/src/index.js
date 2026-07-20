import { signal } from "@preact/signals";
import { html, render } from 'htm/preact';
import { useState } from 'preact/hooks';
import { Button } from './components/button.js';
import { Combobox } from './components/combobox.js';
import { Dialog } from './components/dialog.js';
import { Drawer } from './components/drawer.js';
import './styles.css';

const UNIT_TYPES = [
  'Archers',
  'Crossbowmen',
  'Pikemen',
  'Swordsmen',
  'Knights',
  'Light Cavalry',
  'Siege Engineers',
];

const count = signal(0);

function App() {
  const [unit, setUnit] = useState(null);

  const onClick = () => {
    count.value = count.peek() + 1;
  };

  return html`
      <h1>Faenwald — Battle Lab</h1>

      <section class="demo">
          <h2>Button</h2>
          <${Button} onClick=${onClick}>Clicked x${count} times</
          />
      </section>

      <section class="demo">
          <h2>Combobox</h2>
          <${Combobox}
                  items=${UNIT_TYPES}
                  label="Unit type"
                  placeholder="Pick a unit"
                  onValueChange=${setUnit}
          />
          <p class="demo-note">Selected: ${unit ?? '—'}</p>
      </section>

      <section class="demo">
          <h2>Dialog</h2>
          <${Dialog}
                  trigger="Open dialog"
                  title="Battle report"
                  description="A portal-rendered modal with a focus trap."
          >
              <p>If you can read this, Base UI's Dialog survived preact/compat.</p>
          </
          />
      </section>

      <section class="demo">
          <h2>Drawer</h2>
          <${Drawer} trigger="Open drawer" title="Army roster">
              <p>Slides from the bottom edge; swipe down to dismiss.</p>
          </
          />
      </section>
  `;
}

render(
  html`
      <${App}/>
  `,
  document.querySelector('#container'),
);
