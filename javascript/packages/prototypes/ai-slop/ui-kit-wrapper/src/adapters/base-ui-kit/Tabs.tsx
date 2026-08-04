import { Tabs as UkTabs } from "@hw/ui-kit-over-base-ui/src/ui/tabs/Tabs";
import type { TabsProps } from "../../ui/contract";
import styles from "./adapter.module.css";

/**
 * Data in, compound tree out.
 *
 * Note what this kit does with panels: it renders all three and hides the
 * inactive ones. The studio kit renders only the active one. Both satisfy the
 * contract, and that difference is visible if a panel holds uncommitted input —
 * one kit keeps it, the other drops it.
 *
 * A contract hides an API. It does not hide behaviour. Test the swap; do not
 * assume it.
 */
function Tabs({ value, onValueChange, items }: TabsProps) {
  return (
    <UkTabs.Root
      className={styles.tabsRoot}
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
    >
      <UkTabs.List className={styles.tabsList}>
        {items.map((item) => (
          <UkTabs.Tab key={item.value} value={item.value}>
            {item.label}
          </UkTabs.Tab>
        ))}
        <UkTabs.Indicator />
      </UkTabs.List>
      {items.map((item) => (
        <UkTabs.Panel key={item.value} value={item.value} className={styles.tabsPanel}>
          {item.render()}
        </UkTabs.Panel>
      ))}
    </UkTabs.Root>
  );
}

export { Tabs };
