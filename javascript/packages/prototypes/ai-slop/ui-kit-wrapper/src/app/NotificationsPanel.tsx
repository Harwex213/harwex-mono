import * as React from "react";
import { Button, Card, Toggle, useToast } from "@ui";
import type { Settings } from "./settings";
import styles from "./app.module.css";

type PanelProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
};

function NotificationsPanel({ settings, onChange }: PanelProps) {
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);

  function save() {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.show({
        title: "Preferences saved",
        description: "Applies to every project in this workspace.",
        tone: "success",
      });
    }, 900);
  }

  return (
    <Card
      title="Notifications"
      description="Per-workspace defaults. Members can still override their own."
      footer={
        <Button onClick={save} loading={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      }
    >
      <div className={styles.toggles}>
        <Toggle
          label="Deploy results"
          hint="One message per finished deploy, success or failure."
          checked={settings.notifyDeploys}
          onCheckedChange={(next) => onChange({ notifyDeploys: next })}
        />
        <Toggle
          label="Mentions"
          hint="Someone writes @you in a comment or review."
          checked={settings.notifyMentions}
          onCheckedChange={(next) => onChange({ notifyMentions: next })}
        />
        <Toggle
          label="Weekly digest"
          hint="Monday summary of activity across projects."
          checked={settings.notifyDigest}
          onCheckedChange={(next) => onChange({ notifyDigest: next })}
        />
        <Toggle
          label="Billing alerts"
          hint="Always on for workspace owners."
          checked={settings.notifyBilling}
          onCheckedChange={(next) => onChange({ notifyBilling: next })}
          disabled
        />
      </div>
    </Card>
  );
}

export { NotificationsPanel };
