import { Card } from "./card";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "Card",
  render: () => (
    <>
      <ShowcaseSection title="Default">
        <Card>
          <p>Province: <strong>Nordheim</strong></p>
          <p>Population: 12,400</p>
        </Card>
      </ShowcaseSection>

      <ShowcaseSection title="With more content">
        <Card>
          <p style={{ marginBottom: 8 }}>A card can hold any content. It provides a consistent background, border, and
            padding for grouped information.</p>
          <p>Use it for info panels, sidebars, or overlay content.</p>
        </Card>
      </ShowcaseSection>
    </>
  ),
};
