import { Button, Card, SelectField, TextField, useToast } from "@ui";
import { regions, slugError, visibilities } from "./settings";
import type { Settings } from "./settings";
import styles from "./app.module.css";

type PanelProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
};

function GeneralPanel({ settings, onChange }: PanelProps) {
  const toast = useToast();
  const slugProblem = slugError(settings.slug);

  function save() {
    if (slugProblem) {
      toast.show({
        title: "Nothing saved",
        description: "Fix the workspace URL first.",
        tone: "danger",
      });
      return;
    }
    toast.show({ title: "Workspace updated", tone: "success" });
  }

  return (
    <Card
      title="Workspace"
      description="Names and locations your whole team sees."
      footer={
        <>
          <Button variant="ghost">Discard</Button>
          <Button onClick={save}>Save changes</Button>
        </>
      }
    >
      <div className={styles.pair}>
        <TextField
          label="Workspace name"
          value={settings.workspaceName}
          onValueChange={(next) => onChange({ workspaceName: next })}
          required
        />
        <TextField
          label="Workspace URL"
          value={settings.slug}
          onValueChange={(next) => onChange({ slug: next })}
          hint="Appears in every share link."
          error={slugProblem}
          required
        />
      </div>
      <div className={styles.pair}>
        <TextField
          label="Billing contact"
          type="email"
          value={settings.contactEmail}
          onValueChange={(next) => onChange({ contactEmail: next })}
        />
        <SelectField
          label="Primary region"
          value={settings.region}
          options={regions}
          onValueChange={(next) => onChange({ region: next })}
          hint="Where new projects are created."
        />
      </div>
      <SelectField
        label="Default visibility"
        value={settings.visibility}
        options={visibilities}
        onValueChange={(next) => onChange({ visibility: next })}
      />
    </Card>
  );
}

export { GeneralPanel };
