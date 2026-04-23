import { Tooltip } from "./tooltip";
import { Button } from "../button/button";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "Tooltip",
  render: () => (
    <>
      <ShowcaseSection title="Sides">
        <Tooltip content="Top tooltip" side="top">
          <Button>Top</Button>
        </Tooltip>
        <Tooltip content="Right tooltip" side="right">
          <Button>Right</Button>
        </Tooltip>
        <Tooltip content="Bottom tooltip" side="bottom">
          <Button>Bottom</Button>
        </Tooltip>
        <Tooltip content="Left tooltip" side="left">
          <Button>Left</Button>
        </Tooltip>
      </ShowcaseSection>
    </>
  ),
};
