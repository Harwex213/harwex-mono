import { VIEW_MODEL } from "../view-model/view-model.js";

const BattleConfigService = {
  setMapId: (mapId) => {
    VIEW_MODEL.battleConfig.mapId.value = mapId;
  }
}

export { BattleConfigService };
