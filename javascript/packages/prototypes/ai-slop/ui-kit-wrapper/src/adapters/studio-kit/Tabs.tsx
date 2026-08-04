import { StudioTabset } from "../../vendor/studio-kit";
import type { TabsProps } from "../../ui/contract";

/**
 * This kit takes the tab strip as data and the body as children, so the adapter
 * picks the active item and calls its `render` thunk.
 *
 * Only the active panel mounts here. Under the Base UI adapter all three mount
 * and two are hidden. That is why `TabItem.render` is a function: the contract
 * lets a kit not build what it will not show.
 */
function Tabs({ value, onValueChange, items }: TabsProps) {
  const tabs = items.map((item) => ({ id: item.value, text: item.label }));
  const active = items.find((item) => item.value === value);

  return (
    <StudioTabset tabs={tabs} current={value} onPick={onValueChange}>
      {active ? active.render() : null}
    </StudioTabset>
  );
}

export { Tabs };
