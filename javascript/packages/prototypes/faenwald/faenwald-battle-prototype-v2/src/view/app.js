import { html } from "htm/preact";
import { Field, Input } from "@hw/faenwald-uikit";
import { VIEW_MODEL } from "../view-model/view-model.js";
import { BattleConfigService } from "../service/battle-config-service.js";
import "./app.css";

function App() {
  const mapId = VIEW_MODEL.battleConfig.mapId;

  console.log("App: rerender!", mapId);

  return html`
    <div class="app">
      <h1 class="header">
        Hello world!
      </h1>

      <div class="app-content">
        Map: ${mapId}
      </div>

      <div>
        <${Field.Root}>
          <${Field.Label}>
            Map Id
          <//>

          <${Input.Root}
            type="input"
            required
            value=${mapId.value}
            onValueChange=${(value) => BattleConfigService.setMapId(value)}
            placeholder="some cool UUID"
          />

          <${Field.Description}>
            Please enter map Id
          <//>
        <//>
      </div>
    </div>
  `
}

export { App };
