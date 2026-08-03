import { signal } from "@preact/signals";

const battleConfig = {
  mapId: signal(""),
  attacker: signal([]),
  defender: signal([]),
};

const VIEW_MODEL = {
  battleConfig: battleConfig,
};

export { VIEW_MODEL };

