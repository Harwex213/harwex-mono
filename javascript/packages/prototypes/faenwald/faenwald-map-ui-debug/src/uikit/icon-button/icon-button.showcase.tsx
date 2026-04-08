import { IconButton } from "./icon-button";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "IconButton",
  render: () => (
    <>
      <ShowcaseSection title="Sizes">
        <IconButton size="sm" aria-label="Settings">&#9881;</IconButton>
        <IconButton size="md" aria-label="Settings">&#9881;</IconButton>
      </ShowcaseSection>

      <ShowcaseSection title="Disabled">
        <IconButton size="sm" disabled aria-label="Settings">&#9881;</IconButton>
        <IconButton size="md" disabled aria-label="Settings">&#9881;</IconButton>
      </ShowcaseSection>
    </>
  ),
};
