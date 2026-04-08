import { ScrollArea } from "./scroll-area";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "ScrollArea",
  render: () => (
    <>
      <ShowcaseSection title="Vertical">
        <ScrollArea direction="vertical" style={{ height: 150, width: 250 }}>
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i} style={{ padding: "4px 0" }}>Item {i + 1}</p>
          ))}
        </ScrollArea>
      </ShowcaseSection>
    </>
  ),
};
