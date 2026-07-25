import { Field, Input } from "@hw/faenwald-uikit";
import { VIEW_MODEL } from "../view-model/view-model.js";
import { BattleConfigService } from "../service/battle-config-service.js";
import "./app.css";

function App() {
  const mapId = VIEW_MODEL.battleConfig.mapId;

  return (
    <div class={"app"}>
      <h1 className={"header"}>
        Hello world!
      </h1>

      <div className={"app-content"}>
        Map: {mapId}
      </div>

      <div>
        <Field.Root>
          <Field.Label className={"field-label"}>
            Map Id
          </Field.Label>

          <Input.Root
            type="input"
            required
            value={mapId.value}
            onValueChange={BattleConfigService.setMapId}
            placeholder="some cool UUID"
          />

          <Field.Description>
            Please enter map Id
          </Field.Description>
        </Field.Root>
      </div>
    </div>
  );
}

export { App };
