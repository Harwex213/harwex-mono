import * as React from "react";
import { Tabs } from "@ui";
import { BillingPanel } from "./BillingPanel";
import { GeneralPanel } from "./GeneralPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { initialSettings } from "./settings";
import type { Settings } from "./settings";
import styles from "./app.module.css";

/**
 * The product code.
 *
 * Everything visual comes from "@ui". There is no import of `@base-ui/react`,
 * no import of `@hw/ui-kit-over-base-ui`, no import of any adapter — and
 * `yarn check:boundaries` fails the build if one appears.
 *
 * That constraint is the whole deliverable. This directory renders identically
 * (in intent) under either kit, and it did not have to be written twice.
 */
function App() {
  const [settings, setSettings] = React.useState<Settings>(initialSettings);
  const [tab, setTab] = React.useState("general");

  function change(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.crumb}>Northwind Studio</p>
        <h1 className={styles.title}>Workspace settings</h1>
        <p className={styles.lede}>
          Everything on this page is rendered by whichever UI kit the app is
          wired to. Switch kits in the bar above and read the code that did not
          change.
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: "general",
            label: "General",
            render: () => <GeneralPanel settings={settings} onChange={change} />,
          },
          {
            value: "billing",
            label: "Billing",
            render: () => <BillingPanel settings={settings} onChange={change} />,
          },
          {
            value: "notifications",
            label: "Notifications",
            render: () => <NotificationsPanel settings={settings} onChange={change} />,
          },
        ]}
      />
    </main>
  );
}

export { App };
