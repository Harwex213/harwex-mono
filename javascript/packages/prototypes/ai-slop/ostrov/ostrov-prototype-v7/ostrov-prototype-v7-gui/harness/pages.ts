import { stories as extraActionsPanel } from "../src/extra-actions-panel/extra-actions-panel.stories";
import { stories as resourcePanel } from "../src/resource-panel/resource-panel.stories";
import { stories as turnEndPanel } from "../src/turn-end-panel/turn-end-panel.stories";
import { stories as turnPanel } from "../src/turn-panel/turn-panel.stories";
import type { WidgetStories } from "../src/story";

// The one file a new widget touches besides its own folder.
const pages: readonly WidgetStories[] = [
  resourcePanel,
  turnPanel,
  turnEndPanel,
  extraActionsPanel,
];

export { pages };
