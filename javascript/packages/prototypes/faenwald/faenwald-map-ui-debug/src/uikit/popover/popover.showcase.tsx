import { Popover } from "./popover";
import { Button } from "../button/button";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "Popover",
  render: () => (
    <>
      <ShowcaseSection title="Default">
        <Popover trigger={<Button>Open Popover</Button>}>
          <p style={{ maxWidth: 200 }}>This is popover content. It can contain any elements.</p>
        </Popover>
      </ShowcaseSection>

      <ShowcaseSection title="Sides">
        <Popover trigger={<Button>Top</Button>} side="top">
          <p>Top popover</p>
        </Popover>
        <Popover trigger={<Button>Right</Button>} side="right">
          <p>Right popover</p>
        </Popover>
      </ShowcaseSection>
    </>
  ),
};
