import { VIEW_MODEL } from "../view-model/view-model.js";

const BattleConfigService = {
  setMapId: (mapId) => {
    console.log(123, mapId);
    VIEW_MODEL.battleConfig.mapId.value = mapId;
  }
}

export { BattleConfigService };
