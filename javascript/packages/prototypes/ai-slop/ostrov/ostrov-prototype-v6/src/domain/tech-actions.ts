import { getTech, isAvailable } from "../core/techs";
import { replacePlayer } from "./player-updates";
import { showNotice } from "./ui-actions";
import type { TStore } from "../store/store";
import type { TTechId } from "../core/techs";

/** Science buys technologies. Nothing else spends it. */
const researchTechAction = (store: TStore, techId: TTechId) => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  const tech = getTech(techId);
  const researched = store.game.researched.peek();

  if (!isAvailable(tech, researched)) {
    showNotice(store, `«${tech.label}» пока недоступна`);

    return;
  }

  if (player.resources.science < tech.cost) {
    showNotice(store, `Не хватает науки на «${tech.label}»: нужно ${tech.cost} 📖`);

    return;
  }

  store.game.researched.value = [...researched, tech.id];

  replacePlayer(store, {
    ...player,
    techs: player.techs + 1,
    resources: { ...player.resources, science: player.resources.science - tech.cost },
  });
};

export { researchTechAction };
