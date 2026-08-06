import * as React from "react";
import { Button, Card, ConfirmDialog, SelectField, TextField, useToast } from "@ui";
import { plans } from "./settings";
import type { Settings } from "./settings";
import styles from "./app.module.css";

type PanelProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
};

function BillingPanel({ settings, onChange }: PanelProps) {
  const toast = useToast();
  const [cancelling, setCancelling] = React.useState(false);
  const plan = plans.find((option) => option.value === settings.plan);

  return (
    <div className={styles.stack}>
      <Card
        title="Plan"
        description="Changes take effect on the next invoice."
        footer={<Button onClick={() => toast.show({ title: "Plan updated", tone: "success" })}>Update plan</Button>}
      >
        <div className={styles.pair}>
          <SelectField
            label="Subscription"
            value={settings.plan}
            options={plans}
            onValueChange={(next) => onChange({ plan: next })}
          />
          <TextField
            label="Seats"
            value={settings.seats}
            onValueChange={(next) => onChange({ seats: next })}
            hint="Billed monthly, prorated on change."
          />
        </div>
        <p className={styles.note}>
          Current plan: <strong>{plan?.label ?? "unknown"}</strong>
        </p>
      </Card>

      <Card
        title="Danger zone"
        description="Cancelling stops all builds at the end of the billing period."
      >
        <div className={styles.inline}>
          <Button variant="danger" size="sm" onClick={() => setCancelling(true)}>
            Cancel subscription
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel subscription?"
        description="Builds keep running until the end of the current billing period, then the workspace drops to read-only."
        confirmLabel="Cancel subscription"
        cancelLabel="Keep plan"
        destructive
        onConfirm={() =>
          toast.show({
            title: "Subscription cancelled",
            description: "Access ends on 31 August.",
            tone: "danger",
          })
        }
      >
        Seats in use: {settings.seats}. Exports stay available for 30 days.
      </ConfirmDialog>
    </div>
  );
}

export { BillingPanel };
